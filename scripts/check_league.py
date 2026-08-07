"""
Check any ESPN fantasy league id: which seasons were actually PLAYED, who won, and
whether you were in it.

    python scripts/check_league.py 1701707
    python scripts/check_league.py 1701707 551781 --sport ffl --from 2015 --to 2026
    python scripts/check_league.py 267469544 --sport fba

WHY THIS EXISTS. A league id that "resolves" for a season is NOT proof the season
happened. ESPN keeps a shell for every league that was rolled over and then abandoned
before week 1 — it returns 200, it lists teams, it has your name on one of them, and every
record is 0-0-0. Two of this manager's football leagues look exactly like that in 2019,
which is why an earlier pass reported a season that was never played.

So the test here is GAMES PLAYED, not whether the request succeeded. A season is only
real if the teams have a record.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "legacy"))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

import config  # noqa: E402

SPORTS = {"ffl": "football", "fba": "basketball", "flb": "baseball", "fhl": "hockey"}


def cookie() -> str:
    swid = str(config.ESPN_SWID)
    if not swid.startswith("{"):
        swid = "{" + swid.strip("{}") + "}"
    return f"SWID={swid}; espn_s2={config.ESPN_S2}"


def get(url: str):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0", "Cookie": cookie(),
                 "Accept": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=25))


def season(sport: str, lid: int, year: int):
    """One season, or None. Tries the live path then the history path."""
    for url in (
        f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/{sport}/seasons/{year}"
        f"/segments/0/leagues/{lid}?view=mTeam&view=mSettings",
        f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/{sport}/leagueHistory/{lid}"
        f"?seasonId={year}&view=mTeam&view=mSettings",
    ):
        try:
            d = get(url)
        except (urllib.error.HTTPError, urllib.error.URLError, ValueError):
            continue
        if isinstance(d, list):
            d = d[0] if d else {}
        if d.get("teams"):
            return d
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("league_ids", nargs="+", type=int)
    ap.add_argument("--sport", default="ffl", choices=sorted(SPORTS))
    ap.add_argument("--from", dest="lo", type=int, default=2015)
    ap.add_argument("--to", dest="hi", type=int, default=2027)
    a = ap.parse_args()

    me = str(config.ESPN_SWID).strip("{}").upper()
    print(f"{SPORTS[a.sport]} · seasons {a.lo}-{a.hi} · your SWID {me[:8]}…\n")

    for lid in a.league_ids:
        print(f"league {lid}")
        found = False
        for year in range(a.lo, a.hi + 1):
            d = season(a.sport, lid, year)
            if not d:
                continue
            found = True
            teams = d.get("teams") or []
            members = {
                str(m.get("id", "")).strip("{}").upper():
                    (m.get("firstName", "") + " " + m.get("lastName", "")).strip()
                for m in (d.get("members") or [])
            }
            games = sum(
                ((t.get("record") or {}).get("overall") or {}).get("wins", 0)
                + ((t.get("record") or {}).get("overall") or {}).get("losses", 0)
                for t in teams
            )
            mine = next(
                (t for t in teams
                 if any(str(o).strip("{}").upper() == me for o in (t.get("owners") or []))),
                None,
            )
            champ = next((t for t in teams if t.get("rankCalculatedFinal") == 1), None)
            champ_name = (
                members.get(str((champ.get("owners") or ["?"])[0]).strip("{}").upper(), "?")
                if champ else "—"
            )
            name = (d.get("settings") or {}).get("name") or "?"
            label = (
                (mine.get("location", "") + " " + mine.get("nickname", "")).strip()
                or mine.get("name", "")
            ) if mine else None

            # The check that matters — a shell resolves exactly like a real season.
            if games == 0:
                print(f"  {year}  \"{name}\"  NOT PLAYED (rolled over, abandoned before week 1)")
            else:
                print(f"  {year}  \"{name}\"  {games} games · champion {champ_name}"
                      + (f" · YOU = \"{label}\" (teamId {mine.get('id')})" if mine else " · you were NOT in it"))
                if mine:
                    print(f"        https://fantasy.espn.com/{SPORTS[a.sport]}/team"
                          f"?leagueId={lid}&teamId={mine.get('id')}&seasonId={year}")
        if not found:
            print("  no seasons resolved — wrong id, wrong sport, or no access")
        print()


if __name__ == "__main__":
    raise SystemExit(main())
