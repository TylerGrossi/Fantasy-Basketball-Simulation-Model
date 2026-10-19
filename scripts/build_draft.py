"""
Export the draft guide's data: public/data/draft.json (+ draft-outlooks.json).

    python scripts/build_draft.py          # write
    python scripts/build_draft.py --check  # fetch and validate, write nothing

WHY THIS IS ITS OWN SCRIPT, NOT PART OF build_data.py
  The draft league (`config.DRAFT_LEAGUE_ID`) is a different league, in a different
  season, from the one the rest of the app reports on. Folding it into build_data.py would
  tie a one-night tool to the daily CI export. It also uses only the standard library
  (urllib), so it runs on any machine with the cookies and no `pip install`.

WHERE THE NUMBERS COME FROM
  - Projections: ESPN's own 2026-27 per-game projections (stat split `10<year>`), for the
    ~300 players ESPN ranks highest. These replaced the home-grown model in
    lib/projection.ts for the board: ESPN's numbers already know about offseason trades,
    rookies and depth charts, which a box-score model structurally cannot.
  - DD and TW: ESPN does not project either, so both are ESTIMATED here (see estimate_dd /
    estimate_tw). TW is Team Wins: a team-level number with the player's games attached.
  - Outside rankings: ESPN roto rank and ADP; FantasyPros' expert consensus (ECR, roto);
    Hashtag Basketball's free top-30 projections; and the owner's pasted Hashtag ranking
    of LAST SEASON's totals under this league's categories
    (scripts/draft_inputs/hashtag_2025-26_totals.tsv). Every outside source is optional —
    a failed fetch drops its column, never the export.

Stat ids: counting stats come from league.json's `statIds` (derived from espn-api's
STATS_MAP by build_data.py — never guessed). The three ratio ids (19 FG%, 20 FT%, 21 3P%)
are not in that map; they were confirmed against the projection payload itself, where
Jokic's 19/20/21 read 0.57 / 0.82 / 0.39.
"""

import html
import json
import re
import sys
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine"))

import config  # noqa: E402

OUT = ROOT / "public" / "data" / "draft.json"
OUT_OUTLOOKS = ROOT / "public" / "data" / "draft-outlooks.json"
HASHTAG_PASTE = ROOT / "scripts" / "draft_inputs" / "hashtag_2025-26_totals.tsv"
# The owner's paste of Hashtag's 2026-27 projections under THIS league's categories.
# Preferred over the scraped page, which ranks on Hashtag's default 9-cat settings.
HASHTAG_PROJ_PASTE = ROOT / "scripts" / "draft_inputs" / "hashtag_2026-27_proj_top30.tsv"
# Manual overrides for news newer than ESPN's projections (injuries, role changes).
ADJUSTMENTS = ROOT / "scripts" / "draft_inputs" / "adjustments.json"

YEAR = int(getattr(config, "DRAFT_SEASON_YEAR", config.ESPN_SEASON_YEAR + 1))
LEAGUE_ID = int(getattr(config, "DRAFT_LEAGUE_ID", config.ESPN_LEAGUE_ID))
POOL = 300  # players exported; an 8-10 team draft takes 104-130

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/128 Safari/537.36"}
FANTASY = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons"

RATIO_IDS = {19: "FG%", 20: "FT%", 21: "3P%"}
# Ratio category -> (made, attempts). FTM/FTA are not scored here but carry FT%.
RATIO_OF = {"FG%": ("FGM", "FGA"), "FT%": ("FTM", "FTA"), "3P%": ("3PM", "3PA")}
COUNTING = ["FGM", "FGA", "FTM", "FTA", "3PM", "3PA", "REB", "AST", "STL", "BLK", "TO",
            "PTS"]
ESPN_MIN, ESPN_GP = "40", "42"  # minutes / games in averageStats (checked on live data)
SLOT_NAMES = {0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C"}
POS_NAMES = {1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C"}


# --------------------------------------------------------------------------- http

def _get(url, headers=None, cookies=False, timeout=40):
    h = dict(UA)
    if cookies:
        h["Cookie"] = f"espn_s2={config.ESPN_S2}; SWID={config.ESPN_SWID}"
    if headers:
        h.update(headers)
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.read().decode("utf8", "ignore")


def _json(url, **kw):
    return json.loads(_get(url, **kw))


def team_abbrev(raw):
    raw = (raw or "").upper()
    return config.TEAM_FIXES.get(raw, raw)


def norm_name(name):
    """Name key for joining sources: no accents, punctuation or Jr./III suffixes."""
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z ]", "", s.lower().replace("-", " "))
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _r(x, n=3):
    return round(float(x), n)


# --------------------------------------------------------------------------- league

def fetch_league(stat_ids):
    base = f"{FANTASY}/{YEAR}/segments/0/leagues/{LEAGUE_ID}"
    d = _json(base + "?view=mSettings&view=mTeam&view=mDraftDetail", cookies=True)
    s = d["settings"]
    id_to_name = {v: k for k, v in stat_ids.items()}
    id_to_name.update(RATIO_IDS)
    cats, lower, unknown = [], [], []
    for item in s["scoringSettings"]["scoringItems"]:
        name = id_to_name.get(int(item["statId"]))
        if not name:
            unknown.append(item["statId"])
            continue
        cats.append(name)
        if item.get("isReverseItem"):
            lower.append(name)
    if unknown:
        # Loud, not fatal: the board ranks on the categories it knows and the page says
        # which ones it could not score.
        print(f"  ! league scores stat ids with no known name: {unknown}")

    counts = s["rosterSettings"]["lineupSlotCounts"]
    labels = [(0, "PG"), (1, "SG"), (2, "SF"), (3, "PF"), (4, "C"), (5, "G"), (6, "F"),
              (11, "UTIL"), (12, "Bench"), (13, "IR")]
    slots = [lab for sid, lab in labels for _ in range(int(counts.get(str(sid), 0) or 0))]
    rounds = sum(1 for x in slots if x != "IR")

    swid = (config.ESPN_SWID or "").strip().upper()
    teams = [{"id": t["id"], "name": (t.get("name") or "").strip(), "abbrev": t.get("abbrev", "")}
             for t in d["teams"]]
    mine = next((t["id"] for t in d["teams"]
                 if swid and swid in [o.upper() for o in t.get("owners", [])]), None)
    ds = s.get("draftSettings") or {}
    return {
        "id": LEAGUE_ID,
        "season": YEAR,
        "name": s.get("name", ""),
        "teams": teams,
        "myTeamId": mine,
        "categories": cats,
        "lowerIsBetter": lower,
        "unknownStatIds": unknown,
        "rosterSlots": slots,
        "rounds": rounds,
        "draftType": ds.get("type"),
        "draftDate": ds.get("date"),
        "secondsPerPick": ds.get("timePerSelection"),
        "pickOrder": ds.get("pickOrder") or [],
    }


def fetch_pro_teams():
    d = _json(f"{FANTASY}/{YEAR}?view=proTeamSchedules_wl")
    return {t["id"]: team_abbrev(t["abbrev"]) for t in d["settings"]["proTeams"]}


def fetch_win_pct():
    """Last season's win% by team, from ESPN's public standings."""
    d = _json(f"https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season={YEAR - 1}")
    out = {}
    for conf in d.get("children", []):
        for e in conf["standings"]["entries"]:
            wp = next((x.get("value") for x in e["stats"] if x["name"] == "winPercent"), None)
            if wp is not None:
                out[team_abbrev(e["team"]["abbreviation"])] = float(wp)
    return out


def fetch_ages():
    """{playerId: (age, exp)} from the 30 NBA roster endpoints — same ids as fantasy."""
    teams = _json("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams")
    ids = [t["team"]["id"] for t in teams["sports"][0]["leagues"][0]["teams"]]

    def one(tid):
        try:
            r = _json(f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{tid}/roster")
        except Exception:  # noqa: BLE001
            return {}
        out = {}
        for a in r.get("athletes", []) or []:
            try:
                out[int(a["id"])] = (a.get("age"), (a.get("experience") or {}).get("years"))
            except (KeyError, TypeError, ValueError):
                pass
        return out

    ages = {}
    with ThreadPoolExecutor(8) as ex:
        for part in ex.map(one, ids):
            ages.update(part)
    return ages


def fetch_players():
    base = f"{FANTASY}/{YEAR}/segments/0/leagues/{LEAGUE_ID}?view=kona_player_info"
    filt = {"players": {
        "limit": 450,
        "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "ROTO"},
        "filterStatsForTopScoringPeriodIds": {
            "value": 2, "additionalValue": [f"00{YEAR - 1}", f"10{YEAR}"]},
    }}
    d = _json(base, cookies=True, headers={"x-fantasy-filter": json.dumps(filt)})
    return [e["player"] for e in d.get("players", [])]


# --------------------------------------------------------------------------- outside ranks

def fetch_fantasypros():
    """FantasyPros expert consensus (roto), keyed by normalised name."""
    h = _get("https://www.fantasypros.com/nba/rankings/overall.php")
    m = re.search(r"var ecrData = (\{.*?\});", h)
    if not m:
        raise ValueError("ecrData not found on the page")
    d = json.loads(m.group(1))
    out = {}
    for p in d["players"]:
        out.setdefault(norm_name(p["player_name"]), int(p["rank_ecr"]))
    return out, d.get("last_updated", "")


def fetch_hashtag_projections():
    """Hashtag's free 2026-27 projection rankings — the top 30 only (the rest is paid)."""
    h = _get("https://hashtagbasketball.com/fantasy-basketball-projections")
    out = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", h, flags=re.S):
        link = re.search(r'/player"?[^>]*>([^<]+)</a>', row)
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S)
        if not link or not cells:
            continue
        num = re.match(r"\s*(\d+)", re.sub(r"<[^>]+>", " ", cells[0]))
        if num:
            out.setdefault(norm_name(html.unescape(link.group(1))), int(num.group(1)))
    return out


def read_hashtag_paste(path=HASHTAG_PASTE):
    out = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0].strip().isdigit():
            out.setdefault(norm_name(parts[1]), int(parts[0]))
    return out


# --------------------------------------------------------------------------- estimates

def dd_model(line):
    """
    Double-double rate from a per-game line. ESPN projects neither DD nor TW, so this is
    fitted to last season's actuals (see fit_dd): the rate is driven almost entirely by
    the player's SECOND-best of points / rebounds / assists, because that is the one that
    has to reach ten.
    """
    vals = sorted([line.get("PTS", 0), line.get("REB", 0), line.get("AST", 0)])
    return vals[1]


def fit_dd(players):
    """Binned mean DD rate against dd_model(x), from players with a real sample."""
    pts = []
    for p in players:
        a = p.get("_act")
        if a and a.get("gp", 0) >= 20:
            pts.append((dd_model(a), a.get("DD", 0)))
    pts.sort()
    bins = []
    step = max(1, len(pts) // 14)
    for i in range(0, len(pts), step):
        chunk = pts[i:i + step]
        bins.append((sum(x for x, _ in chunk) / len(chunk), sum(y for _, y in chunk) / len(chunk)))

    def f(x):
        if not bins:
            return 0.0
        if x <= bins[0][0]:
            return bins[0][1]
        for (x0, y0), (x1, y1) in zip(bins, bins[1:]):
            if x <= x1:
                return y0 + (y1 - y0) * (x - x0) / ((x1 - x0) or 1)
        return bins[-1][1]
    return f


def estimate_dd(proj, act, f):
    """
    The player's own DD rate where there is one, moved by how much ESPN expects his line
    to change; the fitted curve for anyone without a season of evidence (rookies).
    """
    model_now = f(dd_model(proj))
    if act and act.get("gp", 0) >= 20:
        base = f(dd_model(act))
        scale = model_now / base if base > 0.02 else 1.0
        return max(0.0, min(1.0, act.get("DD", 0) * max(0.6, min(1.6, scale))))
    return model_now


def estimate_tw(team, win_pct):
    """
    TW per game ~ the team's win probability. Last season's win% regressed 40% toward .500
    — rosters turn over and win totals regress — and .500 for anyone without a team.
    """
    wp = win_pct.get(team)
    return 0.5 if wp is None else 0.5 + 0.6 * (wp - 0.5)


# --------------------------------------------------------------------------- build

def line_from(avg, keys):
    return {name: _r(avg.get(str(sid), 0) or 0) for name, sid in keys.items()}


def build():
    league_json = json.loads((ROOT / "public" / "data" / "league.json").read_text(encoding="utf8"))
    stat_ids = {k: int(v) for k, v in league_json["statIds"].items()}
    keys = {k: stat_ids[k] for k in COUNTING}

    print(f"draft league {LEAGUE_ID} / {YEAR}")
    league = fetch_league(stat_ids)
    print(f"  {league['name']}: {len(league['teams'])} teams, {league['rounds']} rounds, "
          f"cats {league['categories']}")
    pro = fetch_pro_teams()
    players = fetch_players()
    print(f"  {len(players)} ESPN players")

    sources = {"espn": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
    win_pct, ages, fp, hb, hb_last = {}, {}, {}, {}, {}
    for label, fn in [("win%", fetch_win_pct), ("ages", fetch_ages)]:
        try:
            if label == "win%":
                win_pct = fn()
            else:
                ages = fn()
            print(f"  {label}: {len(win_pct) if label == 'win%' else len(ages)}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {label} failed: {exc}")
    try:
        fp, upd = fetch_fantasypros()
        sources["fantasypros"] = upd
        print(f"  FantasyPros ECR: {len(fp)} (updated {upd})")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! FantasyPros failed: {exc}")
    hb = read_hashtag_paste(HASHTAG_PROJ_PASTE)
    if hb:
        sources["hashtag"] = "top 30 under your categories (pasted 2026-10-19)"
        print(f"  Hashtag projections (pasted, your cats): {len(hb)}")
    else:
        try:
            hb = fetch_hashtag_projections()
            if hb:
                sources["hashtag"] = "top 30, default 9-cat (free tier)"
            print(f"  Hashtag projections (scraped): {len(hb)}")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! Hashtag failed: {exc}")
    hb_last = read_hashtag_paste()
    if hb_last:
        sources["hashtagLast"] = "2025-26 totals, pasted 2026-10-19"
    print(f"  Hashtag last-season paste: {len(hb_last)}")

    # Last season's team, from the old league's pool, to name trades/signings.
    old_team = {p["playerId"]: team_abbrev(p["nbaTeam"])
                for p in league_json["seasonData"].get("playerPool", []) if p.get("playerId")}

    rows = []
    for p in players:
        proj_avg = act_avg = None
        for s in p.get("stats", []) or []:
            if s.get("id") == f"10{YEAR}":
                proj_avg = s.get("averageStats") or None
            elif s.get("id") == f"00{YEAR - 1}":
                act_avg = s.get("averageStats") or None
        if not proj_avg:
            continue
        ranks = p.get("draftRanksByRankType") or {}
        roto = (ranks.get("ROTO") or {}).get("rank")
        adp = (p.get("ownership") or {}).get("averageDraftPosition") or 0
        if not roto and not adp:
            continue
        proj = line_from(proj_avg, keys)
        act = None
        if act_avg and (act_avg.get(ESPN_GP) or 0) > 0:
            act = line_from(act_avg, keys)
            act["DD"] = _r(act_avg.get(str(stat_ids["DD"]), 0) or 0)
            act["TW"] = _r(act_avg.get(str(stat_ids["TW"]), 0) or 0)
            act["gp"] = int(act_avg.get(ESPN_GP) or 0)
            act["min"] = _r(act_avg.get(ESPN_MIN) or 0, 1)
        rows.append({"p": p, "proj": proj, "_act": act, "projAvg": proj_avg,
                     "roto": roto, "adp": adp})

    rows.sort(key=lambda r: (r["roto"] or 9999, r["adp"] or 9999))
    rows = rows[:POOL]
    f_dd = fit_dd(rows)

    adjustments = {}
    if ADJUSTMENTS.exists():
        adjustments = {k: v for k, v in json.loads(ADJUSTMENTS.read_text(encoding="utf8")).items()
                       if not k.startswith("_")}
    applied = set()

    lines, outlooks = [], {}
    for r in rows:
        p, proj, act = r["p"], r["proj"], r["_act"]
        pid = int(p["id"])
        team = pro.get(p.get("proTeamId"), "FA")
        proj["DD"] = _r(estimate_dd(proj, act, f_dd))
        proj["TW"] = _r(estimate_tw(team, win_pct))
        proj_gp = int(round(r["projAvg"].get(ESPN_GP) or 0))
        proj_min = _r(r["projAvg"].get(ESPN_MIN) or 0, 1)
        age, exp = ages.get(pid, (None, None))
        # Only a REAL rookie (0 years). A veteran with no line last season (sat out, or
        # missing from the roster lookup) is not one, and gets his own driver below.
        rookie = exp == 0

        drivers = []
        if rookie:
            drivers.append("Rookie — no NBA line, ESPN projection only")
        elif act is None:
            drivers.append("No NBA line last season — ESPN projection only")
        prev = old_team.get(pid)
        if prev and prev not in ("FA", team):
            drivers.append(f"New team: {prev} to {team}")
        if act:
            dm = proj_min - act["min"]
            if abs(dm) >= 3:
                drivers.append(f"Minutes {'up' if dm > 0 else 'down'} {abs(dm):.1f} "
                               f"({act['min']:.1f} to {proj_min:.1f})")
            if proj_gp - act["gp"] >= 15:
                drivers.append(f"Played {act['gp']} games last season; ESPN projects {proj_gp}")
        adj = adjustments.get(p.get("fullName", ""))
        if adj:
            applied.add(p.get("fullName", ""))
            if "minScale" in adj:
                k = float(adj["minScale"])
                for stat in COUNTING + ["DD"]:
                    proj[stat] = _r(proj[stat] * k)
                proj_min = _r(proj_min * k, 1)
            if "projGp" in adj:
                proj_gp = int(adj["projGp"])
            if adj.get("note"):
                drivers.insert(0, f"Adjusted: {adj['note']}")
        status = p.get("injuryStatus") or "ACTIVE"
        if status not in ("ACTIVE", "NORMAL"):
            drivers.append(f"Injury status: {status.replace('_', ' ').title()}")

        def pct(line, k):
            m, a = RATIO_OF[k]
            return _r(line[m] / line[a], 4) if line.get(a) else 0.0

        actual = {k: v for k, v in (act or {}).items() if k not in ("gp", "min")}
        name = p.get("fullName", "")
        key = norm_name(name)
        row = {
            "name": name,
            "nbaTeam": team,
            "position": POS_NAMES.get(p.get("defaultPositionId"), ""),
            "eligibleSlots": [SLOT_NAMES[s] for s in p.get("eligibleSlots", []) if s in SLOT_NAMES],
            "owner": "",
            "status": status,
            "playerId": pid,
            "age": int(age) if isinstance(age, (int, float)) and age else None,
            "exp": int(exp) if isinstance(exp, (int, float)) else None,
            "gp": act["gp"] if act else 0,
            "projGp": proj_gp,
            "projMin": proj_min,
            "lastMin": act["min"] if act else None,
            "proj": proj,
            "actual": actual,
            "projFgPct": pct(proj, "FG%"), "projFtPct": pct(proj, "FT%"), "projTpPct": pct(proj, "3P%"),
            "fgPct": pct(actual, "FG%") if act else 0.0,
            "ftPct": pct(actual, "FT%") if act else 0.0,
            "tpPct": pct(actual, "3P%") if act else 0.0,
            "drivers": drivers,
            "confidence": "low" if (rookie or act is None) else ("med" if act["gp"] < 40 else "high"),
            "espnRank": int(r["roto"]) if r["roto"] else None,
            "espnStdRank": (p.get("draftRanksByRankType") or {}).get("STANDARD", {}).get("rank"),
            "adp": _r(r["adp"], 1) if r["adp"] else None,
            "fpRank": fp.get(key),
            "hbRank": hb.get(key),
            "hbLastRank": hb_last.get(key),
            "rookie": rookie,
        }
        lines.append({k: v for k, v in row.items() if v is not None})
        if p.get("seasonOutlook"):
            outlooks[str(pid)] = p["seasonOutlook"].strip()

    missing = set(adjustments) - applied
    if missing:
        print(f"  ! adjustments for names not in the pool: {sorted(missing)}")
    if applied:
        print(f"  adjustments applied: {sorted(applied)}")

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "league": league,
        "sources": sources,
        "lines": lines,
    }
    return payload, outlooks


def validate(payload):
    lines = payload["lines"]
    assert len(lines) >= 150, f"only {len(lines)} projected players"
    assert payload["league"]["categories"], "no categories"
    jokic = next((l for l in lines if l["name"] == "Nikola Jokic"), None)
    assert jokic and jokic["proj"]["PTS"] > 15, "projection sanity check failed (Jokic)"
    matched = sum(1 for l in lines[:150] if "fpRank" in l)
    print(f"  FantasyPros matched {matched}/150 of the top 150")
    missing = [l["name"] for l in lines[:120] if "fpRank" not in l]
    if missing:
        print(f"  unmatched in FP top 120: {missing[:15]}")


def main():
    check = "--check" in sys.argv
    payload, outlooks = build()
    validate(payload)
    if check:
        print("check only — nothing written")
        return 0
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf8")
    OUT_OUTLOOKS.write_text(json.dumps(outlooks, separators=(",", ":")), encoding="utf8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB), "
          f"{OUT_OUTLOOKS.relative_to(ROOT)} ({OUT_OUTLOOKS.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
