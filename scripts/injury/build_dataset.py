"""
Join the parsed injury reports (parse_reports.py) to ESPN box scores (fetch_boxscores.py):
one row per player listed on a game day's 5 PM report, with the features the model reads
and the label - did he play that night (minutes > 0)?

LEAKAGE RULE. Every history feature (games missed in a row, minutes role, how often THIS
player / team played when listed) is computed only from games strictly BEFORE the row's
date. The model may learn that a player tends to sit the second night of a back-to-back,
never what he did that night.

NAME MATCHING. Both sides reduce names to letters only (accents folded): 'Nance Jr.,
Larry' and 'Larry Nance Jr.' both become 'larrynancejr'. A listed player who never appears
in ESPN's box scores under that key within the season cannot be labelled (absent from the
box would read as "did not play" even when it is just a spelling difference), so those
rows are DROPPED and counted, not guessed.

    python scripts/injury/build_dataset.py   -> %LOCALAPPDATA%/fbbsim-injury-data/dataset.csv
"""

from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

from history import roster_games

DATA = Path(os.environ.get("LOCALAPPDATA", ".")) / "fbbsim-injury-data"

# Body part, from the free-text reason. First match wins, so the specific beats the general.
BODY = [
    ("achilles", "achilles"), ("concussion", "concussion"), ("hamstring", "hamstring"),
    ("groin", "groin"), ("adductor", "groin"), ("calf", "calf"), ("quad", "quad"),
    ("knee", "knee"), ("acl", "knee"), ("mcl", "knee"), ("patell", "knee"), ("meniscus", "knee"),
    ("ankle", "ankle"), ("foot", "foot"), ("plantar", "foot"), ("heel", "foot"), ("toe", "toe"),
    ("hip", "hip"), ("back", "back"), ("lumbar", "back"), ("spine", "back"), ("neck", "neck"),
    ("shoulder", "shoulder"), ("elbow", "elbow"), ("wrist", "hand"), ("hand", "hand"),
    ("finger", "hand"), ("thumb", "hand"), ("rib", "rib"), ("oblique", "rib"),
    ("abdom", "rib"), ("illness", "illness"), ("ilness", "illness"), ("flu", "illness"),
    ("covid", "illness"), ("protocol", "protocols"), ("eye", "face"), ("nose", "face"),
    ("face", "face"), ("tooth", "face"),
]
SEVERITY = [
    ("surgery", "surgery"), ("fracture", "fracture"), ("tear", "tear"), ("rupture", "tear"),
    ("sprain", "sprain"), ("strain", "strain"), ("soreness", "soreness"), ("sore", "soreness"),
    ("tightness", "soreness"), ("contusion", "contusion"), ("bruise", "contusion"),
    ("tendin", "tendinitis"), ("recovery", "recovery"), ("management", "management"),
    ("rest", "rest"),
]


def fold(s: str) -> str:
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()


SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
# Same player, two names: a legal name change, or the report and ESPN disagreeing.
ALIASES = {"eneskanter": "enesfreedom"}


def key(name: str) -> str:
    """Letters only, first name then last, suffixes dropped: ESPN writes 'Jimmy Butler III'
    and 'Reggie Bullock Jr.' where the report writes 'Butler, Jimmy' - 99 listings were
    lost to that before (2026-11-03)."""
    name = fold(name)
    if "," in name:
        last, first = name.split(",", 1)
        name = f"{first} {last}"
    parts = [t for t in re.split(r"[^a-z]+", name.lower()) if t and t not in SUFFIXES]
    k = "".join(parts)
    return ALIASES.get(k, k)


def season_of(d: pd.Timestamp) -> int:
    """Start year of the season: Oct-Dec belong to that year's season, Jan-Jul to the last.
    The 2020 bubble finished in October 2020 and belongs to 2019-20."""
    if d.year == 2020 and d.month == 10 and d.day < 15:
        return 2019
    return d.year if d.month >= 10 else d.year - 1


def classify(category: str, reason: str) -> tuple[str, str, str]:
    """(kind, body, severity) from the report's category and reason text."""
    text = fold(f"{category} {reason}").lower()
    flat = re.sub(r"[^a-z]", "", text)
    if "gleague" in flat:
        kind = "g_league"
    elif "suspension" in flat:
        kind = "suspension"
    elif "personal" in flat or "notwithteam" in flat:
        kind = "personal"
    elif "healthandsafety" in flat or "protocols" in flat:
        kind = "protocols"
    elif "injurymanagement" in flat or "loadmanagement" in flat or re.search(r"\brest\b", text):
        kind = "management"
    else:
        kind = "injury"
    body = next((b for k, b in BODY if k in flat), "other")
    sev = next((s for k, s in SEVERITY if k in flat), "none")
    return kind, body, sev


def main() -> None:
    rep = pd.read_csv(DATA / "reports.csv", dtype=str).fillna("")
    rep["report_date"] = pd.to_datetime(rep["report"].str[:10])
    rep["game_date"] = pd.to_datetime(rep["game_date"], format="%m/%d/%Y", errors="coerce")
    # The 5 PM report also lists tomorrow's early games; keep the night's own games only.
    rep = rep[rep["game_date"] == rep["report_date"]].copy()
    rep["name_key"] = rep["player"].map(key)
    rep = rep.drop_duplicates(["game_date", "name_key"])

    box = pd.concat(
        (pd.read_csv(p, dtype={"event_id": str, "athlete_id": str}) for p in sorted((DATA / "box").glob("*.csv"))
         if p.stat().st_size > 200),
        ignore_index=True,
    )
    box["date"] = pd.to_datetime(box["date"])
    box["name_key"] = box["player"].map(key)
    box["season"] = box["date"].map(season_of)
    print(f"reports: {len(rep)} same-day listings; box: {len(box)} player-games "
          f"({box['date'].min().date()} to {box['date'].max().date()})")

    # ---- per-player game history (from box scores), strictly before each date ----
    box = box.sort_values(["name_key", "date"])
    # The team's schedule: every date each team played, to count games missed and B2Bs.
    team_dates = box.groupby("team")["date"].apply(lambda s: np.array(sorted(s.unique()))).to_dict()
    # Home/away from the TEAM's game, never the player's own row: a player who sat is often
    # missing from the box, so reading it from his row made "home is blank" mean "did not
    # play" - a leak the first evaluation fell into (home ranked above status, 2026-11-03).
    team_home = box.groupby(["team", "date"])["home"].first().to_dict()
    team_type = box.groupby(["team", "date"])["season_type"].first().astype(str).to_dict()

    hist = {k: g for k, g in box.groupby("name_key")}
    # Report team name -> ESPN abbreviation ("NewYorkKnicks" / "New York Knicks" -> NY).
    flat = lambda s: re.sub(r"[^a-z]", "", fold(s).lower())
    team_by_name = {flat(n): t for n, t in box[["team_name", "team"]].drop_duplicates().values}

    rep["season"] = rep["game_date"].map(season_of)
    rows = []
    unmatched = 0
    for r in rep.itertuples(index=False):
        h = hist.get(r.name_key)
        # The name must be one ESPN knows (any season) - otherwise "absent from the box"
        # could just be a spelling difference. NOT "played this season": that would drop
        # exactly the listed players who never got on the floor, biasing the labels.
        if h is None:
            unmatched += 1
            continue
        today = h[h["date"] == r.game_date]
        before = h[h["date"] < r.game_date]
        # His team, from the REPORT (known before tip-off). Using tonight's box would only
        # find it when he played - the same leak as home/away.
        team = team_by_name.get(flat(r.team))
        if team is None:
            cur = before[before["season"] == r.season]
            if not len(cur):
                unmatched += 1
                continue
            team = cur["team"].iloc[-1]
        sched = team_dates.get(team, np.array([], dtype="datetime64[ns]"))
        played_tonight = int(len(today) > 0 and today["played"].iloc[0] == 1)

        # Did the team actually play tonight? If not, the listing is for a game ESPN does
        # not have (postponed) - no label.
        if not (sched == np.datetime64(r.game_date)).any():
            unmatched += 1
            continue

        prev_team_games = sched[sched < np.datetime64(r.game_date)]
        played_dates = set(before.loc[before["played"] == 1, "date"].values)
        # Consecutive team games missed going into tonight.
        missed = 0
        for d in prev_team_games[::-1]:
            if d in played_dates:
                break
            missed += 1
            if missed >= 82:
                break
        last_team_game = prev_team_games[-1] if len(prev_team_games) else None
        b2b = int(last_team_game is not None and (np.datetime64(r.game_date) - last_team_game) == np.timedelta64(1, "D"))
        recent = before[before["played"] == 1].tail(10)
        kind, body, sev = classify(r.category, r.reason)
        rows.append({
            "date": r.game_date, "season": r.season, "player": r.player, "name_key": r.name_key,
            "team": team, "status": r.status, "kind": kind, "body": body, "severity": sev,
            "reason": r.reason,
            "missed_streak": min(missed, 30),
            "b2b": b2b,
            "home": int(team_home.get((team, r.game_date), 0)),
            "min_avg10": recent["minutes"].mean() if len(recent) else 0.0,
            "starter_rate10": recent["starter"].mean() if len(recent) else 0.0,
            "games_season": int((before["season"] == r.season).sum()),
            "month": r.game_date.month,
            "playoffs": int(team_type.get((team, r.game_date)) == "3"),
            "played": played_tonight,
        })
    df = pd.DataFrame(rows).sort_values(["date", "name_key"]).reset_index(drop=True)

    # His availability record and back-to-back rest habit going into the game (history.py),
    # from the roster-expanded table - every team game, not just the ones he is in the box
    # for. The latest roster row on or before the date; its record is strictly pre-game.
    rg = roster_games(box)
    rg.to_csv(DATA / "roster_games.csv", index=False)
    rec = rg[["name_key", "date", "avail_rate", "rest_gap"]].sort_values("date")
    df = pd.merge_asof(df.sort_values("date"), rec, on="date", by="name_key",
                       direction="backward")
    df["avail_rate"] = df["avail_rate"].fillna(0.85)
    df["rest_gap"] = df["rest_gap"].fillna(0.06)
    df["b2b_rest"] = df["b2b"] * df["rest_gap"]  # his habit, switched on only on 2nd nights
    df = df.sort_values(["date", "name_key"]).reset_index(drop=True)

    # ---- the player's / team's own record when listed, strictly before each date ----
    # Shrunk toward the league rate for the same status, so a player listed twice does not
    # read as a 0% or 100% player. k = how many listings it takes to trust him half-way.
    # The league rate it shrinks toward is ALSO only what was known before the date, so no
    # test season leaks into its own features. Same-day rows never see each other.
    def prior_rate(by, k=8.0):
        out = np.empty(len(df))
        keys = df[by].to_numpy()
        status = df["status"].to_numpy()
        played = df["played"].to_numpy()
        seen: dict[tuple, tuple[int, int]] = {}
        league: dict[str, tuple[int, int]] = {}
        for _, idx in df.groupby("date", sort=True).indices.items():
            for i in idx:
                ln, lp = league.get(status[i], (0, 0))
                base = (lp + 1) / (ln + 2)  # Laplace: 50% before anything is known
                n, p = seen.get((keys[i], status[i]), (0, 0))
                out[i] = (p + k * base) / (n + k)
            for i in idx:
                g = (keys[i], status[i])
                n, p = seen.get(g, (0, 0))
                seen[g] = (n + 1, p + int(played[i]))
                ln, lp = league.get(status[i], (0, 0))
                league[status[i]] = (ln + 1, lp + int(played[i]))
        return out

    df["player_rate"] = prior_rate("name_key")
    df["team_rate"] = prior_rate("team", k=30.0)
    df.to_csv(DATA / "dataset.csv", index=False)
    print(f"dataset: {len(df)} rows ({unmatched} listings could not be matched to a box score)")
    print(df.groupby("status")["played"].agg(["count", "mean"]).round(3).to_string())


if __name__ == "__main__":
    main()
