"""
Every NBA game's box score since 2018-19, from ESPN's public site API - the OUTCOME side of
the Will They Play model (did a listed player actually play?) and the history its features
are built from (games missed in a row, minutes role, back-to-backs).

One row per player per game:
  date, event_id, season_type, team, team_name, opp, home, player, name_key, athlete_id,
  played, minutes, starter, dnp_reason
A player ruled out before the game is often not in the box at all; the model treats
"absent" and "did not play" the same (he did not play).

Sequential with a pause, and resumable: each date is its own CSV under
%LOCALAPPDATA%/fbbsim-injury-data/box/, so a rerun only fetches missing dates.

    python scripts/injury/fetch_boxscores.py [--start 2018-10-16] [--end yesterday]
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import re
import time
from pathlib import Path

import requests

DATA = Path(os.environ.get("LOCALAPPDATA", ".")) / "fbbsim-injury-data"
BOX = DATA / "box"
SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={d}"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={e}"
FIELDS = ["date", "event_id", "season_type", "team", "team_name", "opp", "home", "player",
          "name_key", "athlete_id", "played", "minutes", "starter", "dnp_reason"]
OFF_MONTHS = {8, 9}  # no games (the 2020 bubble ran July-October and is kept)


def name_key(name: str) -> str:
    """Letters only, lower case: 'Kevin McCullar Jr.' -> 'kevinmccullarjr' (matches parse_reports)."""
    return re.sub(r"[^a-z]", "", name.lower())


def get_json(session, url, delay):
    for attempt in range(4):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 200:
                time.sleep(delay)
                return r.json()
        except requests.RequestException:
            pass
        time.sleep(delay * (attempt + 2) * 2)
    return None


def game_rows(session, event, day, delay):
    """Box score rows for one game; None if the summary could not be fetched."""
    comp = event["competitions"][0]
    season_type = event.get("season", {}).get("type")  # 2 regular, 3 playoffs, 5 play-in
    g = get_json(session, SUMMARY.format(e=event["id"]), delay)
    if g is None:
        return None
    sides = {c["team"]["id"]: c for c in comp["competitors"]}
    rows = []
    for team in g.get("boxscore", {}).get("players", []):
        tid = team["team"]["id"]
        opp = next((c for k, c in sides.items() if k != tid), None)
        stats = (team.get("statistics") or [{}])[0]
        names = stats.get("names") or stats.get("labels") or []
        mi = names.index("MIN") if "MIN" in names else None
        for a in stats.get("athletes", []):
            vals = a.get("stats") or []
            minutes = vals[mi] if mi is not None and mi < len(vals) else ""
            try:
                mins = float(str(minutes).split(":")[0]) if minutes not in ("", "--") else 0.0
            except ValueError:
                mins = 0.0
            dnp = bool(a.get("didNotPlay")) or mins <= 0
            ath = a.get("athlete", {})
            rows.append({
                "date": day,
                "event_id": event["id"],
                "season_type": season_type,
                "team": team["team"].get("abbreviation", ""),
                "team_name": team["team"].get("displayName", ""),
                "opp": (opp or {}).get("team", {}).get("abbreviation", ""),
                "home": int(sides.get(tid, {}).get("homeAway") == "home"),
                "player": ath.get("displayName", ""),
                "name_key": name_key(ath.get("displayName", "")),
                "athlete_id": ath.get("id", ""),
                "played": int(not dnp),
                "minutes": mins,
                "starter": int(bool(a.get("starter"))),
                "dnp_reason": a.get("reason", "") if dnp else "",
            })
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2018-10-16")
    ap.add_argument("--end", default=(dt.date.today() - dt.timedelta(days=1)).isoformat())
    ap.add_argument("--delay", type=float, default=0.35)
    args = ap.parse_args()
    BOX.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"

    d, end = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)
    days = []
    while d <= end:
        if d.month not in OFF_MONTHS and not (BOX / f"{d.isoformat()}.csv").exists():
            days.append(d)
        d += dt.timedelta(days=1)
    print(f"{len(days)} dates to fetch", flush=True)
    fetch_days(days, BOX, args.delay, session)


def fetch_days(days, box_dir: Path, delay: float, session=None) -> int:
    """Fetch and write one CSV per date into `box_dir` (score.py reuses this with its own
    cache folder). A date that fails is skipped and retried on the next run."""
    if session is None:
        session = requests.Session()
        session.headers["User-Agent"] = "Mozilla/5.0"
    box_dir.mkdir(parents=True, exist_ok=True)
    args = argparse.Namespace(delay=delay)
    games = 0
    for i, day in enumerate(days, 1):
        sb = get_json(session, SCOREBOARD.format(d=day.strftime("%Y%m%d")), args.delay)
        if sb is None:
            print(f"  {day}: scoreboard failed, will retry next run", flush=True)
            continue
        events = [
            e for e in sb.get("events", [])
            if e.get("season", {}).get("type") in (2, 3, 5)
            and e["competitions"][0].get("status", {}).get("type", {}).get("completed")
        ]
        rows, ok = [], True
        for e in events:
            got = game_rows(session, e, day.isoformat(), args.delay)
            if got is None:
                ok = False
                break
            rows += got
        if not ok:
            print(f"  {day}: a box score failed, will retry next run", flush=True)
            continue
        # Written even when empty (no games that day) so the date is not fetched again.
        with open(box_dir / f"{day.isoformat()}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(rows)
        games += len(events)
        if i % 25 == 0:
            print(f"  {i}/{len(days)} dates, {games} games", flush=True)
    print(f"done: {games} games")
    return games


if __name__ == "__main__":
    main()
