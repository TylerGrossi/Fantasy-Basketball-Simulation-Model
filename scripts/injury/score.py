"""
Will They Play - score every tracked player and write public/data/availability.json.
Runs in the refresh workflow after build_data.py (it reads the league.json just written).

  1. Start from engine/injury/state.json (each player's record through the training
     cutoff) and add every game since, from ESPN box scores kept in a CACHE folder
     (GitHub Actions cache in CI) - so a run fetches only the days it has not seen.
  2. Fetch today's latest official injury report (the league posts every 15 minutes).
  3. For each player in league.json's player pool (every rostered player and the tracked
     free agents), for each of his team's games left in the matchup week:
       - listed on the report for that game  -> GAME-DAY model (status, his and his team's
         record when listed, minutes role, games missed, back-to-back habit)
       - otherwise                            -> LOOK-AHEAD model (back-to-back, his habit,
         availability record, games missed in a row)
       - ESPN has him OUT with no report line -> 0 until his expected return, the same
         injury-aware game count the projections already use (nbaGamesLeft), then
         look-ahead for the games after it.
  4. Write lib/availability.ts's AvailabilityData.

    python scripts/injury/score.py [--league public/data/league.json] [--cache DIR]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pickle
import re
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import fetch_boxscores as FB  # noqa: E402
import parse_reports as PR  # noqa: E402
from build_dataset import classify, key  # noqa: E402
from history import K_AVAIL, K_GAP, PRIOR_AVAIL, PRIOR_GAP  # noqa: E402

ET = ZoneInfo("America/New_York")
ENGINE = ROOT / "engine" / "injury"
# ESPN fantasy abbreviations (league.json) -> ESPN box score abbreviations. Checked
# against every team in both sources (2026-11-03); "FA" is an unsigned player.
TEAM = {"GSW": "GS", "NOP": "NO", "NYK": "NY", "PHL": "PHI", "PHO": "PHX",
        "SAS": "SA", "UTA": "UTAH", "WAS": "WSH"}
OUT_STATUSES = {"OUT", "INJURY_RESERVE", "SSPD"}
REPORT_URL = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_{d}_{t}.pdf"
# ESPN's public NBA injuries feed: an expected return date and a short note for every
# injured player (190 of 190 had a date, 2026-11-03). The fantasy API's own
# expected_return_date field came back empty for all 56 injured players in the pool.
ESPN_INJURIES = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"


def espn_injuries() -> dict[str, dict]:
    """name_key -> {"return": ISO date or None, "note": text}. {} if the feed fails."""
    try:
        r = requests.get(ESPN_INJURIES, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
        data = r.json() if r.status_code == 200 else {}
    except (requests.RequestException, ValueError):
        return {}
    out = {}
    for team in data.get("injuries", []):
        for inj in team.get("injuries", []):
            name = (inj.get("athlete") or {}).get("displayName", "")
            raw = ((inj.get("details") or {}).get("returnDate") or "")[:10]
            try:
                ret = dt.date.fromisoformat(raw).isoformat() if raw else None
            except ValueError:
                ret = None
            # "Left Knee Inflammation": side, body part, detail ("Not Specified" dropped).
            det = inj.get("details") or {}
            what = " ".join(
                x for x in (det.get("side"), det.get("type"), det.get("detail"))
                if x and x not in ("Not Specified", "Other")
            )
            if name:
                out[key(name)] = {"return": ret, "note": inj.get("shortComment", "") or "",
                                  "injury": what}
    return out


def season_end() -> str | None:
    """The fantasy season's last day (engine/config.py SEASON_END_DATE), as ISO. Read from
    the file's text, not imported: config insists on the ESPN secrets, which the scoring
    step does not have."""
    text = (ROOT / "engine" / "config.py").read_text(encoding="utf-8")
    m = re.search(r"^SEASON_END_DATE\s*=\s*_date\((\d+),\s*(\d+),\s*(\d+)\)", text, re.M)
    return dt.date(int(m[1]), int(m[2]), int(m[3])).isoformat() if m else None


def box_team(t: str) -> str:
    return TEAM.get(t, t)


# ---------------------------------------------------------------------------- inputs


def post_cutoff_box(cutoff: dt.date, cache: Path) -> pd.DataFrame:
    """Every box score row after the training cutoff, fetching only days not cached."""
    yesterday = dt.datetime.now(ET).date() - dt.timedelta(days=1)
    box_dir = cache / "box"
    days, d = [], cutoff + dt.timedelta(days=1)
    while d <= yesterday:
        if d.month not in FB.OFF_MONTHS and not (box_dir / f"{d.isoformat()}.csv").exists():
            days.append(d)
        d += dt.timedelta(days=1)
    if days:
        print(f"  box scores: fetching {len(days)} day(s) since the cutoff", flush=True)
        FB.fetch_days(days, box_dir, delay=0.35)
    files = [p for p in sorted(box_dir.glob("*.csv")) if p.stem > cutoff.isoformat() and p.stat().st_size > 200]
    if not files:
        return pd.DataFrame(columns=FB.FIELDS)
    box = pd.concat((pd.read_csv(p) for p in files), ignore_index=True)
    box["date"] = pd.to_datetime(box["date"])
    box["name_key"] = box["player"].map(key)
    return box


def clean_reason(text: str) -> str:
    """The report's reason without its "Injury/Illness - " prefix - and without anything
    before it: a word wrapped in from the neighbouring row of the PDF ("Management
    Injury/Illness - Left Quadriceps Soreness" -> "Left Quadriceps Soreness")."""
    text = re.sub(r"^.*?Injury/Illness\s*-\s*", "", text or "")
    return text.strip(" -;")


def recent_reasons(today: dt.date, cache: Path, days: int = 7) -> dict[str, tuple[str, str]]:
    """Why each player missed his recent games (owner, 2026-11-03): name_key -> (ISO date,
    reason) from the 5 PM injury report of each of the last `days` days, most recent
    listing wins. Reports are cached (the Actions cache keeps them), so after the first run
    this is one new PDF a day. A blocked or missing day is skipped."""
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"
    pdf_dir = cache / "reports"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    out: dict[str, tuple[str, str]] = {}
    for back in range(days, 0, -1):  # oldest first, so later listings overwrite
        d = today - dt.timedelta(days=back)
        path = pdf_dir / f"{d.isoformat()}_05PM-day.pdf"
        if not path.exists():
            got = None
            for slot in ("05_00PM", "05PM"):
                try:
                    r = session.get(REPORT_URL.format(d=d.isoformat(), t=slot), timeout=20)
                except requests.RequestException:
                    continue
                time.sleep(0.5)
                if r.status_code == 200 and r.content[:4] == b"%PDF":
                    got = r.content
                    break
                if b"failover-waf" in r.content:
                    return out
            if got is None:
                continue
            path.write_bytes(got)
        try:
            rows = PR.parse_file(path)
        except Exception:
            continue
        for r in rows:
            if r.get("status") not in ("Out", "Doubtful", "Questionable"):
                continue
            reason = clean_reason(r.get("reason", ""))
            reason = reason or r.get("category", "")
            try:
                gd = dt.datetime.strptime(r["game_date"], "%m/%d/%Y").date().isoformat()
            except ValueError:
                gd = d.isoformat()
            out[key(r["player"])] = (gd, reason)
    return out


def latest_report(today: dt.date, cache: Path):
    """Today's most recent injury report: (rows, "05:30 PM ET" label) or ([], None).
    Steps back from now in 15-minute slots (the 2026 naming), then the hourly names."""
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"
    now = dt.datetime.now(ET)
    slots = []
    t = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0)
    while t.date() == today and len(slots) < 40:
        slots.append(t.strftime("%I_%M%p"))  # 05_30PM
        t -= dt.timedelta(minutes=15)
    for h in range(now.hour, -1, -1):
        slots.append(dt.time(h).strftime("%I%p"))  # 05PM (pre-2026 naming)
    pdf_dir = cache / "reports"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    for slot in slots:
        path = pdf_dir / f"{today.isoformat()}_{slot}.pdf"
        if not path.exists():
            try:
                r = session.get(REPORT_URL.format(d=today.isoformat(), t=slot), timeout=20)
            except requests.RequestException:
                continue
            time.sleep(0.5)
            if r.status_code != 200 or r.content[:4] != b"%PDF":
                if b"failover-waf" in r.content:
                    print("  injury report: blocked by the firewall - game-day reads skipped")
                    return [], None
                continue
            path.write_bytes(r.content)
        rows = PR.parse_file(path)
        label = slot.replace("_", ":") if "_" in slot else slot[:2] + ":00" + slot[2:]
        return rows, f"{today.isoformat()} {label} ET"
    return [], None


# --------------------------------------------------------------------------- records


def player_records(state: dict, box: pd.DataFrame, pool: list[dict]) -> dict:
    """Each pool player's record going into today: the state at the cutoff plus his
    current team's games since (absent from the box = did not play)."""
    team_games = (box.groupby(["team", "date"], as_index=False)["home"].first()
                     .sort_values(["team", "date"]))
    team_games["b2b"] = (team_games.groupby("team")["date"].diff() == pd.Timedelta(days=1)).astype(int)
    by_team = {t: g for t, g in team_games.groupby("team")}
    played = {(k, d): (int(p), float(m), int(s)) for k, d, p, m, s in
              box[["name_key", "date", "played", "minutes", "starter"]].itertuples(index=False)}

    out = {}
    for pl in pool:
        k = key(pl["name"])
        rec = dict(state["players"].get(k, {"n": 0, "p": 0, "nb": 0, "pb": 0, "streak": 0,
                                               "mins": [], "starts": [], "season_games": 0}))
        rec["mins"], rec["starts"] = list(rec.get("mins", [])), list(rec.get("starts", []))
        for g in by_team.get(box_team(pl["nbaTeam"]), pd.DataFrame()).itertuples(index=False):
            got = played.get((k, g.date))
            p = got[0] if got else 0
            rec["n"] += 1
            rec["p"] += p
            rec["nb"] += g.b2b
            rec["pb"] += p * g.b2b
            rec["season_games"] = rec.get("season_games", 0) + 1
            if p:
                rec["streak"] = 0
                rec["mins"] = (rec["mins"] + [got[1]])[-10:]
                rec["starts"] = (rec["starts"] + [got[2]])[-10:]
            else:
                rec["streak"] = min(rec["streak"] + 1, 30)
        # The same shrunk rates history.py trains on.
        n0, p0n = rec["n"] - rec["nb"], rec["p"] - rec["pb"]
        p0 = (p0n + K_AVAIL * PRIOR_AVAIL) / (n0 + K_AVAIL)
        p1 = (rec["pb"] + K_GAP * (p0 - PRIOR_GAP)) / (rec["nb"] + K_GAP)
        rec["avail_rate"] = (rec["p"] + K_AVAIL * PRIOR_AVAIL) / (rec["n"] + K_AVAIL)
        rec["rest_gap"] = float(np.clip(p0 - p1, -0.3, 0.8))
        rec["min_avg10"] = float(np.mean(rec["mins"])) if rec["mins"] else 0.0
        rec["starter_rate10"] = float(np.mean(rec["starts"])) if rec["starts"] else 0.0
        out[pl["name"]] = rec
    return out


def listed_rate(state: dict, table: str, k: str, status: str, prior_k: float) -> float:
    n, p = state[table].get(f"{k}|{status}", [0, 0])
    ln, lp = state["league_listed"].get(status, [0, 0])
    base = (lp + 1) / (ln + 2)
    return (p + prior_k * base) / (n + prior_k)


# ----------------------------------------------------------------------------- score


def predict(bundle: dict, X: pd.DataFrame) -> np.ndarray:
    cols = bundle["nums"] + bundle["cats"]
    raw = bundle["model"].predict_proba(X[cols])[:, 1]
    return np.clip(bundle["calibration"].predict(raw), 0.001, 0.999)


def encode_cats(bundle: dict, X: pd.DataFrame) -> pd.DataFrame:
    for c in bundle["cats"]:
        levels = {v: i for i, v in enumerate(bundle["levels"][c])}
        X[c] = X[c].map(levels).astype(float)
    return X


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", default=str(ROOT / "public" / "data" / "league.json"))
    ap.add_argument("--out", default=str(ROOT / "public" / "data" / "availability.json"))
    ap.add_argument("--cache", default=os.environ.get(
        "FBB_INJURY_CACHE", str(Path.home() / ".cache" / "fbbsim-injury")))
    args = ap.parse_args()
    cache = Path(args.cache)

    league = json.loads(Path(args.league).read_text(encoding="utf-8"))
    state = json.loads((ENGINE / "state.json").read_text())
    with open(ENGINE / "model.pkl", "rb") as f:
        gameday = pickle.load(f)
    with open(ENGINE / "model_lookahead.pkl", "rb") as f:
        ahead = pickle.load(f)

    today = dt.datetime.now(ET).date()
    sched = league.get("weekSchedule") or {}
    week_dates = [d for d in sorted({d for t in sched.get("teams", {}).values() for d in t}) if d >= today.isoformat()]
    pool = [p for p in (league.get("seasonData") or {}).get("playerPool", []) if p.get("nbaTeam") not in ("", "FA")]
    # Injury-aware games left this week (the projections' own count), for OUT players.
    games_left = {}
    for m in league.get("matchups", []):
        for side in ("home", "away"):
            for p in m[side]["players"]:
                games_left[p["name"]] = p.get("nbaGamesLeft", p.get("gamesLeft"))

    cutoff = dt.date.fromisoformat(state["cutoff"])
    box = post_cutoff_box(cutoff, cache)
    recs = player_records(state, box, pool)
    report, report_time = latest_report(today, cache)
    espn = espn_injuries()
    reasons = recent_reasons(today, cache)
    # ESPN's own "did not play" note for a player missing from every report (Coach's
    # Decision, Rest): his latest one since the cutoff.
    dnp = {}
    if len(box):
        for r in box[(box["played"] == 0) & box["dnp_reason"].fillna("").ne("")].sort_values("date").itertuples():
            dnp[r.name_key] = (r.date.date().isoformat(), str(r.dnp_reason).title())
    listed = {}
    for r in report:
        try:
            gd = dt.datetime.strptime(r["game_date"], "%m/%d/%Y").date().isoformat()
        except ValueError:
            continue
        listed[(key(r["player"]), gd)] = r
    print(f"  {len(pool)} players, {len(week_dates)} day(s) left, report: {report_time or 'none yet'} "
          f"({len(report)} listings)", flush=True)

    # One row per (player, remaining game).
    rows = []
    for pl in pool:
        team_sched = sched.get("teams", {}).get(pl["nbaTeam"], {})
        dates = [d for d in week_dates if d in team_sched]
        rec = recs[pl["name"]]
        k = key(pl["name"])
        for i, d in enumerate(dates):
            prev = (dt.date.fromisoformat(d) - dt.timedelta(days=1)).isoformat()
            opp = team_sched[d]
            rep = listed.get((k, d))
            rows.append({
                "name": pl["name"], "key": k, "date": d, "opp": opp.lstrip("@"),
                "home": int(not opp.startswith("@")), "b2b": int(prev in team_sched),
                "listed": rep, "idx": i, "n_games": len(dates),
                "b2b_rest": int(prev in team_sched) * rec["rest_gap"],
                "rest_gap": rec["rest_gap"], "avail_rate": rec["avail_rate"],
                "missed_streak": rec["streak"], "min_avg10": rec["min_avg10"],
                "starter_rate10": rec["starter_rate10"], "games_season": rec["season_games"],
                "month": int(d[5:7]), "playoffs": 0,
            })
    G = pd.DataFrame(rows)
    if len(G):
        G["p"] = predict(ahead, encode_cats(ahead, G.copy()))
        G["source"] = "lookahead"
        rep_rows = G[G["listed"].notna()].copy()
        if len(rep_rows):
            team_of = {pl["name"]: box_team(pl["nbaTeam"]) for pl in pool}
            feats = []
            for r in rep_rows.itertuples():
                kind, body, sev = classify(r.listed.get("category", ""), r.listed.get("reason", ""))
                st = r.listed["status"]
                feats.append({"status": st, "kind": kind, "body": body, "severity": sev,
                              "player_rate": listed_rate(state, "listed", r.key, st, 8.0),
                              "team_rate": listed_rate(state, "team_listed", team_of[r.name], st, 30.0)})
            rep_rows = pd.concat([rep_rows.reset_index(drop=True), pd.DataFrame(feats)], axis=1)
            p = predict(gameday, encode_cats(gameday, rep_rows.copy()))
            G.loc[G["listed"].notna(), "p"] = p
            G.loc[G["listed"].notna(), "source"] = "report"

    # GAME BY GAME, NOT ALL FROM TODAY (2026-11-03). The look-ahead was trained one game
    # ahead: it reads "missed his last N games" as of the previous game. Fed today's streak
    # for every game this week, it could not see recovery - Aldama read 83% tonight, 11% on
    # Friday; Jalen Johnson 61%, 58%, 55%. So each player's week is CHAINED: a distribution
    # over his missed streak going into each game; a game he plays resets it to 0, one he
    # misses adds 1. P(plays game k) = sum over streaks of P(streak) x look-ahead(streak).
    # A report-covered game uses the report's number for that step. Healthy players (streak
    # 0) barely move; an injured player's odds rise through the week as he recovers.
    if len(G):
        for name, g in G.groupby("name"):
            idx = list(g.sort_values("date").index)
            dist = {int(G.at[idx[0], "missed_streak"]): 1.0}
            for i in idx:
                streaks = sorted(dist)
                if G.at[i, "source"] == "report":
                    p_s = {s: float(G.at[i, "p"]) for s in streaks}
                else:
                    X = pd.DataFrame([G.loc[i]] * len(streaks)).reset_index(drop=True)
                    X["missed_streak"] = streaks
                    X["b2b_rest"] = X["b2b"] * X["rest_gap"]
                    p_s = dict(zip(streaks, predict(ahead, encode_cats(ahead, X))))
                    G.at[i, "p"] = sum(dist[s] * p_s[s] for s in streaks)
                nxt: dict[int, float] = {}
                for s in streaks:
                    nxt[0] = nxt.get(0, 0.0) + dist[s] * p_s[s]
                    t = min(s + 1, 30)
                    nxt[t] = nxt.get(t, 0.0) + dist[s] * (1 - p_s[s])
                dist = nxt

    # ESPN OUT with no report line for the game: out until his expected return - the last
    # nbaGamesLeft of the week's games are his, the earlier ones 0.
    #
    # THE REPORT OUTRANKS ESPN (2026-11-03): ESPN's status lags the official report. Santi
    # Aldama and Jordan Poole were Questionable / Probable on tonight's report but still OUT
    # on ESPN, and as free agents (no injury-aware game count) every later game was zeroed:
    # "83%, then 0, 0". A player the latest report lists as anything but Out is past the
    # ESPN rule; his later games are the look-ahead's.
    status_of = {pl["name"]: pl.get("status", "") for pl in pool}
    cleared = {
        name for (k, _d), r in listed.items() if r["status"] != "Out"
        for name in [n for n in status_of if key(n) == k]
    }
    for name, g in G.groupby("name") if len(G) else []:
        # Off ESPN's live injury list too: the export's OUT is stale (it can be hours old),
        # so he is treated as returning - the chained look-ahead, not 0.
        stale = bool(espn) and key(name) not in espn
        if status_of.get(name) not in OUT_STATUSES or name in cleared or stale:
            continue
        ret = (espn.get(key(name)) or {}).get("return")
        if ret:
            for idx in g.index:
                if G.at[idx, "source"] != "report" and G.at[idx, "date"] < ret:
                    G.at[idx, "p"] = 0.0
            continue
        left = games_left.get(name)
        allowed = 0 if left is None else int(round(left))
        for j, idx in enumerate(g.index):
            if G.at[idx, "source"] == "report":
                continue
            if j < len(g) - allowed:
                G.at[idx, "p"] = 0.0

    players = []
    by_name = {n: g for n, g in G.groupby("name")} if len(G) else {}
    for pl in pool:
        g = by_name.get(pl["name"])
        rec = recs[pl["name"]]
        k = key(pl["name"])
        week = [] if g is None else [
            {"date": r.date, "opp": r.opp, "home": bool(r.home), "b2b": bool(r.b2b),
             "p": round(float(r.p), 3), "source": r.source}
            for r in g.itertuples()
        ]
        nxt = week[0] if week else None
        rep = g.iloc[0]["listed"] if g is not None and len(g) else None
        status = rep["status"] if rep else ("" if pl.get("status") in ("ACTIVE", "", None) else pl["status"])
        # OUT in the export but gone from ESPN's live injury list and not on the report:
        # stale, not out (Kyrie Irving, Paul George read "OUT" beside 62%, 2026-11-03).
        # Day-to-day too (Scottie Barnes); a suspension is not an injury, so it stays.
        off_list = (not rep and status in OUT_STATUSES | {"DAY_TO_DAY"} and status != "SSPD"
                    and bool(espn) and k not in espn)
        if off_list:
            status = ""
        injury = ""
        if rep:
            injury = clean_reason(rep.get("reason", "")) or rep.get("category", "")
        # Injury column, in order: today's NBA report, ESPN's injury feed (Kawhi Leonard is
        # not on a report the day before his game, but ESPN has "Left Knee Inflammation"),
        # then the reason for his last missed game (below).
        if not injury and not off_list:
            injury = (espn.get(k) or {}).get("injury", "")
        factors = []
        # OUT says it all (owner, 2026-11-03): no reasons, no "played 0 of 152" record.
        # The one useful line for an Out player is WHEN he is expected back this week.
        is_out = (rep and rep["status"] == "Out") or (not rep and status in OUT_STATUSES)
        back = next((w for w in week if w["p"] > 0), None)
        if is_out:
            if back and nxt and back["date"] != nxt["date"]:
                d = dt.date.fromisoformat(back["date"])
                factors.append(f"Expected back {d.strftime('%a')} {d.month}/{d.day}")
        elif rep:
            factors.append(f"Listed {rep['status']} on the injury report")
        elif off_list:
            factors.append(f"Off ESPN's injury list (was {'day-to-day' if pl.get('status') == 'DAY_TO_DAY' else 'Out'})")
        if is_out:
            pass
        elif rec["streak"] >= 1:
            why_missed = reasons.get(k) or dnp.get(k)
            # Only a reason from THIS missed stretch: about two days per game missed (plus
            # one), so an older listing (Nembhard's 10/28 neck, before a game he played)
            # is not pinned on his latest absence.
            if why_missed and why_missed[0] < (today - dt.timedelta(days=2 * rec["streak"] + 1)).isoformat():
                why_missed = None
            factors.append(f"Missed his last {rec['streak']} game{'s' if rec['streak'] > 1 else ''}")
            # What the miss was FOR goes in the Injury column (owner, 2026-11-03), when
            # nothing current fills it (below: ESPN's feed first): "Rest (missed Mon 11/2)".
            if why_missed and not injury and not (espn.get(k) or {}).get("injury"):
                d = dt.date.fromisoformat(why_missed[0])
                injury = f"{why_missed[1]} (missed {d.strftime('%a')} {d.month}/{d.day})"
        if not is_out and nxt and nxt["b2b"]:
            factors.append("Second night of a back-to-back")
        # Only when it bites: he has a second night of a back-to-back this week.
        if not is_out and rec["rest_gap"] >= 0.12 and rec["nb"] >= 10 and any(w["b2b"] for w in week):
            factors.append(f"Sits second nights {round(rec['rest_gap'] * 100)} points more often than other nights")
        if not is_out and rec["avail_rate"] < 0.75 and rec["n"] >= 20:
            factors.append(f"Has played {round(rec['avail_rate'] * 100)}% of his teams' games")
        record = None
        if rep and not is_out:
            n, p = state["listed"].get(f"{k}|{rep['status']}", [0, 0])
            record = {"listed": n, "played": p} if n else None
        players.append({
            "name": pl["name"], "nbaTeam": pl["nbaTeam"],
            "positions": [s for s in (pl.get("eligibleSlots") or [pl.get("position", "")]) if s in ("PG", "SG", "SF", "PF", "C")],
            "owner": pl.get("owner", "") if pl.get("owner") not in ("Waivers", "FA") else "",
            "status": status, "injury": injury, "next": nxt, "week": week,
            "factors": factors, "record": record,
            # ESPN's date, for Out rows (the page's Why column, the agent).
            # ESPN's estimated return for EVERY player on its injury list (the date ESPN's
            # own player card shows), not only the Out ones (owner, 2026-11-03).
            "expectedReturn": (espn.get(k) or {}).get("return"),
            # ESPN's note ("expected to miss four weeks"), for the agent; "" when none.
            "note": (espn.get(k) or {}).get("note", "") if (is_out or status) else "",
        })

    # "2018-19 to 2026-27": the season the cutoff falls in (October starts a season).
    c = dt.date.fromisoformat(state["cutoff"])
    start = c.year if c.month >= 10 else c.year - 1
    seasons = f"2018-19 to {start}-{str(start + 1)[2:]}"
    data = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "reportTime": report_time,
        "model": {"trainedThrough": state["cutoff"], "seasons": seasons},
        # The page hides anyone ESPN does not expect back before this (out for the season).
        "seasonEnd": season_end(),
        "players": players,
    }
    Path(args.out).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    risky = sum(1 for p in players if p["next"] and p["next"]["p"] < 0.85)
    print(f"availability: {len(players)} players, {risky} below 85% for their next game -> {args.out}")


if __name__ == "__main__":
    main()
