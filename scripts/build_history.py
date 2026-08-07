"""
Every player you have ever rostered, across every league and season, with their stats.

    python scripts/build_history.py            # writes public/data/career.json
    python scripts/build_history.py --check    # fetch and report, write nothing

RUN THIS ON DEMAND, NOT ON A SCHEDULE. It is deliberately not part of build_data.py:
finished seasons never change, and this makes ~25 requests per season against leagues that
have not moved in years. build_data.py runs hourly in-season; adding 70 pointless requests
to every one of those runs would be the wrong trade. Re-run it when a season ends, or when
you add a league below.

-------------------------------------------------------------------------------------
LEAGUES MOVE. YOU DO NOT.
-------------------------------------------------------------------------------------
The team id changes between seasons, the team NAME changes, and the LEAGUE ID changes when
a group starts a fresh league — this manager has played in three different league ids over
four seasons and been "Team Grossi", "New Balance Ballers" and "VJ Maxx". So none of those
are used to find you. The SWID cookie is the one stable identity, and every season is
matched by looking for it in each team's owner list.

That also protects against the opposite error: a league you LEFT keeps existing, and your
old team keeps sitting in it with an empty roster. Those are skipped by requiring that the
team actually played (a roster, or a record).

-------------------------------------------------------------------------------------
WHY THIS SWEEPS DAYS INSTEAD OF CALLING box_scores()
-------------------------------------------------------------------------------------
`League.box_scores(matchup_period=N)` LOOKS like the right call and quietly returns
nothing for older seasons. Its internals:

    scoring_id = self.matchup_ids[matchup_period][-1] if matchup_period in self.matchup_ids else 1

`matchup_ids` is built from `home.pointsByScoringPeriod`, which ESPN stops publishing for
older seasons — so the map comes back EMPTY and every week silently falls through to
`else 1`, querying scoring period 1 over and over. The symptom is a season that appears to
have only its first and last week of data, which reads exactly like ESPN having dropped
the history. It has not. The library just asked the wrong question 22 times.

ESPN's scoring period for this sport is a DAY, not a week. Asking for a day returns
`rosterForCurrentScoringPeriod` — the roster as it stood that day — along with the
`matchupPeriodId` the day belongs to. Sweeping every day of the season therefore recovers
the full roster history, verified back to 2021-22.

Every day is swept rather than every second or third, because the whole point is catching
the streamer who was on the roster for one day in January. Sampling would drop exactly the
players this page exists to remember.

-------------------------------------------------------------------------------------
WHERE THE STATS COME FROM
-------------------------------------------------------------------------------------
Membership AND stats both come from the daily sweep, and they measure the same thing: the
days this team held the player. Nothing here is a full-season number.

That is the whole point, and it replaced an earlier version that used ESPN's athlete
career endpoint. That endpoint returns a player's SEASON, which is the wrong number for a
page about one roster — hold a streamer for a single day and his 79-game season came with
him, so the table showed 0 games rostered beside a full stat line. Meanwhile the daily
payload the sweep was ALREADY fetching carries each rostered player's line for that
scoring period (`statSourceId: 0`, `statSplitTypeId: 5`), keyed by ESPN's stat ids, which
`espn_api.basketball.constant.STATS_MAP` already decodes. Verified against real box scores
and present in every season back to 2017-18.

So the correct stats cost zero extra requests, and GP is now COUNTED — one per day with a
line, an empty `stats` dict meaning rostered but did not play — rather than estimated from
days held. The athlete endpoint and its ~200 requests are gone.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "legacy"))

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

import config  # noqa: E402
from espn_api.basketball import League  # noqa: E402
from espn_api.basketball.constant import STATS_MAP  # noqa: E402

OUT = ROOT / "public" / "data" / "career.json"

# Every league id this manager has ever played in. ADD NEW ONES HERE — the script probes
# each across a range of seasons and keeps the ones where you actually had a team, so an
# id that only overlaps for one year costs nothing but a few requests.
LEAGUE_IDS = [
    267469544,   # 2025-26 -> current
    642866361,   # 2023-24, 2024-25
    987011059,   # 2022-23
    110391621,   # 2021-22
    104587,      # 2017-18
]

# Seasons to probe. ESPN's seasonId is the year the season ENDS (2022-23 is 2023).
SEASON_RANGE = range(2015, 2028)

# The stats accumulated per player. Kept to what a box-score line actually carries.
STATS = ["PTS", "REB", "AST", "STL", "BLK", "TO",
         "FGM", "FGA", "FTM", "FTA", "3PM", "3PA"]

# Managers who have played under more than one ESPN account.
#
# ESPN identity is the account, not the person, and a manager who switches accounts (or
# plays from a partner's) becomes two rows that never merge — two separate head-to-head
# records against what is really one rival. Owner-supplied, because nothing in the data
# can infer it: the accounts share no id, no email and no team name.
#
# Keyed on the DISPLAY NAME ESPN returns, mapped to the canonical person.
OWNER_ALIASES = {
    "Brenna Alyse": "Andrew Connell",
    "Teri-Anne Ceseretti": "Chris Ceseretti",
}

# Weeks of lineups a season needs before it counts as fully covered.
#
# Set high on purpose. An earlier value of 5 marked 2021-22 "full" off NINE weeks of 23,
# which is exactly the mislabelling this file is meant to prevent — a third of a season
# presented as all of it. A season is either essentially complete or it is partial, and
# anything in between is partial.
FULL_COVERAGE_MIN = 18


def my_swid() -> str:
    return str(config.ESPN_SWID).strip("{}").upper()


def find_my_team(league, swid: str):
    """The team owned by this SWID, or None. Never matched on name or id — see the header."""
    for team in league.teams:
        for owner in getattr(team, "owners", []) or []:
            oid = owner.get("id") if isinstance(owner, dict) else owner
            if str(oid or "").strip("{}").upper() == swid:
                return team
    return None


def played(team) -> bool:
    """Did this team actually play, or is it a shell left behind in a league you left?"""
    if len(getattr(team, "roster", []) or []) > 0:
        return True
    return (getattr(team, "wins", 0) or 0) + (getattr(team, "losses", 0) or 0) > 0


# Every player who was on this team on any day, and WHAT THEY DID ON THOSE DAYS.
#
# The stat line is the point of the rewrite. The obvious source — ESPN's athlete career
# endpoint — gives a player's whole SEASON, which is the wrong number for a page about one
# roster: hold someone for a single day and their 79-game season came along with them, so a
# streamer showed 0 games and a full stat line at once. The daily response already carries
# each rostered player's line for that scoring period (`statSplitTypeId: 5`,
# `statSourceId: 0`), so the right stats cost NO extra requests — they were in the payload
# the sweep was already making and were being thrown away.
#
# An empty `stats` dict means the player did not play that day. That is what makes GP real:
# games are COUNTED here, one per day with a line, rather than inferred from days held.

# The stat ids come from espn_api rather than a hand-written map — the ids are ESPN's and
# a local copy would be one more thing to keep in step. Only the nine-cat inputs are kept.
_WANTED = {"PTS", "REB", "AST", "STL", "BLK", "TO", "3PM", "3PA",
           "FGM", "FGA", "FTM", "FTA", "MIN"}
STAT_IDS = {sid: name for sid, name in STATS_MAP.items() if name in _WANTED}


def sweep_days(league, team_id, max_day):
    """
    Every player who was on this team on any day of the season, with their real line.

    Returns `(players, matchups_seen, days_seen)` where each player is
    `{playerId, name, days, gp, <per-game stats>}` — all of it measured over the days
    THIS TEAM held them, never over the player's full season.

    One request per DAY — see the header for why this is not `box_scores`. A day that
    returns nothing (the off-season tail, an All-Star break, a gap in ESPN's data) is
    skipped rather than treated as an empty roster, because "no data" and "nobody on the
    roster" are very different claims and only one of them is ever true here.
    """
    players = {}
    matchups = set()
    days = 0
    for day in range(1, max_day + 1):
        try:
            raw = league.espn_request.league_get(
                params={"view": ["mMatchupScore", "mScoreboard"], "scoringPeriodId": day}
            )
        except Exception:
            continue
        hit = False
        # A team can appear in more than one schedule entry for a day; without this a
        # player would be credited with two days for one, and two games for one game.
        seen_today = set()
        for entry in raw.get("schedule") or []:
            for slot in ("home", "away"):
                side = entry.get(slot) or {}
                if side.get("teamId") != team_id:
                    continue
                roster = side.get("rosterForCurrentScoringPeriod") or {}
                for e in roster.get("entries") or []:
                    pl = (e.get("playerPoolEntry") or {}).get("player") or {}
                    pid = pl.get("id") or e.get("playerId")
                    if pid is None or int(pid) in seen_today:
                        continue
                    seen_today.add(int(pid))
                    row = players.setdefault(int(pid), {
                        "playerId": int(pid),
                        "name": pl.get("fullName") or "",
                        "days": 0,
                        "gp": 0,
                        "totals": {},
                    })
                    if not row["name"] and pl.get("fullName"):
                        row["name"] = pl["fullName"]
                    row["days"] += 1
                    hit = True

                    # That day's box line, if they played. Only the single-scoring-period,
                    # real (not projected) split counts.
                    for st in pl.get("stats") or []:
                        if st.get("statSourceId") != 0 or st.get("statSplitTypeId") != 5:
                            continue
                        line = st.get("stats") or {}
                        if not line:
                            continue  # rostered, did not play
                        row["gp"] += 1
                        for sid, val in line.items():
                            name = STAT_IDS.get(str(sid))
                            if name:
                                row["totals"][name] = row["totals"].get(name, 0.0) + (val or 0.0)
                        break
                if hit and entry.get("matchupPeriodId"):
                    matchups.add(entry["matchupPeriodId"])
        if hit:
            days += 1

    for row in players.values():
        finalize_line(row)
    return players, matchups, days


def finalize_line(row):
    """Turn a player's accumulated totals into the per-game line the app reads."""
    totals = row.pop("totals", {})
    gp = row.get("gp") or 0
    if not gp:
        return
    for name in ("PTS", "REB", "AST", "STL", "BLK", "TO", "3PM", "3PA",
                 "FGM", "FGA", "FTM", "FTA"):
        if name in totals:
            row[name] = round(totals[name] / gp, 2)
    if "MIN" in totals:
        row["min"] = round(totals["MIN"] / gp, 1)


def owner_names(league) -> dict:
    """`{swid: "First Last"}` for everyone in the league, from the members block."""
    raw = getattr(league, "_raw_members", None)
    out = {}
    for m in raw or []:
        out[str(m.get("id", "")).strip("{}").upper()] = (
            (m.get("firstName", "") + " " + m.get("lastName", "")).strip() or "?"
        )
    return out


def canonical(name: str) -> str:
    """Collapse a manager's alternate accounts onto one person — see OWNER_ALIASES."""
    return OWNER_ALIASES.get(name, name)


def team_owner(team, names: dict) -> str:
    """
    The PERSON behind a team, not the team name.

    Everything historical is keyed on this. Team names change every year — the same
    manager has been "Team Grossi", "New Balance Ballers" and "VJ Maxx" — so grouping by
    name would scatter one opponent across a dozen rows and make the head-to-head record
    meaningless. The owner id is stable; the name attached to it is just for display.
    """
    for o in getattr(team, "owners", []) or []:
        oid = o.get("id") if isinstance(o, dict) else o
        got = names.get(str(oid or "").strip("{}").upper())
        if got:
            return canonical(got)
    return getattr(team, "team_name", "?")


def collect_matchups(league, team_id: int, names: dict, scoring: str):
    """
    Every matchup this team played, week by week.

    THE SCORE LIVES IN A DIFFERENT FIELD PER LEAGUE TYPE, and reading the wrong one is
    silent rather than an error:

      - **H2H_CATEGORY** puts categories won in `cumulativeScore.wins/losses/ties` and
        leaves `totalPoints` at 0.0.
      - **H2H_POINTS** does the exact opposite — real fantasy points in `totalPoints`,
        and `cumulativeScore` absent entirely.

    Read the category field on a points league and every week comes back 0-0, which looks
    exactly like ESPN having dropped the data for an old season. It has not: 2017-18 is a
    points league and its scores were there the whole time.

    `winner` is ESPN's own verdict either way, so a tie-break the score alone would not
    explain still lands on the right side.

    BYES ARE NOT GAMES. A first-round playoff bye appears in the schedule as a normal
    entry with no opponent on the other side: `teamId` is null, both scores are 0, and
    `winner` is UNDECIDED. Read literally that is a 0-0 tie against a manager called "?",
    which is how two of these seasons ended up with a phantom rival on the head-to-head
    table. They are flagged `bye` here and left out of every record and rate downstream —
    the week still shows in the game log, because earning a bye is a result worth seeing.
    """
    cats = scoring == "H2H_CATEGORY"
    raw = getattr(league, "_raw_schedule", None) or []
    by_team = {t.team_id: t for t in league.teams}
    out = []
    for e in raw:
        home, away = e.get("home") or {}, e.get("away") or {}
        if home.get("teamId") != team_id and away.get("teamId") != team_id:
            continue
        mine, theirs = (home, away) if home.get("teamId") == team_id else (away, home)
        opp_team = by_team.get(theirs.get("teamId"))
        cs_m = mine.get("cumulativeScore") or {}
        cs_t = theirs.get("cumulativeScore") or {}
        won = e.get("winner")
        side = "HOME" if mine is home else "AWAY"
        if cats:
            for_, against = int(cs_m.get("wins", 0) or 0), int(cs_t.get("wins", 0) or 0)
            tied = int(cs_m.get("ties", 0) or 0)
        else:
            for_ = round(float(mine.get("totalPoints", 0) or 0), 1)
            against = round(float(theirs.get("totalPoints", 0) or 0), 1)
            tied = 0
        bye = theirs.get("teamId") is None
        out.append({
            "week": e.get("matchupPeriodId"),
            "playoff": (e.get("playoffTierType") or "NONE") != "NONE",
            "bye": bye,
            "oppTeamId": theirs.get("teamId"),
            "oppTeam": "Bye" if bye else (getattr(opp_team, "team_name", "?") if opp_team else "?"),
            "oppOwner": "Bye" if bye else (team_owner(opp_team, names) if opp_team else "?"),
            "scoring": "categories" if cats else "points",
            "scoreFor": for_,
            "scoreAgainst": against,
            "tied": tied,
            # A bye has no result. "T" would count it as a game played against nobody.
            "result": "BYE" if bye else
                      ("W" if won == side else ("T" if won in (None, "TIE", "UNDECIDED") else "L")),
        })
    out.sort(key=lambda m: (m["week"] or 0))
    return out


def collect_season(league_id: int, season: int, swid: str, verbose=True):
    """One season's roster history, or None when this manager had no team in it."""
    try:
        league = League(league_id=league_id, year=season,
                        espn_s2=config.ESPN_S2, swid=config.ESPN_SWID)
    except Exception:
        return None  # league did not exist that year — the ordinary case while probing

    team = find_my_team(league, swid)
    if not team or not played(team):
        return None

    # espn_api keeps neither the raw schedule nor the members block, and both are needed
    # for the head-to-head and manager tables. One extra request per season, against the
    # ~170 the day sweep already costs.
    try:
        raw = league.espn_request.league_get(
            params={"view": ["mMatchupScore", "mTeam", "mSettings"]})
        league._raw_schedule = raw.get("schedule") or []
        league._raw_members = raw.get("members") or []
    except Exception:
        raw = {}
        league._raw_schedule, league._raw_members = [], []
    names = owner_names(league)
    scoring = str(((raw.get("settings") or {}).get("scoringSettings") or {})
                  .get("scoringType") or "H2H_CATEGORY")
    matchups = collect_matchups(league, team.team_id, names, scoring)
    standings = [{
        "teamId": t.team_id,
        "teamName": t.team_name,
        "owner": team_owner(t, names),
        "record": [int(getattr(t, "wins", 0) or 0), int(getattr(t, "losses", 0) or 0),
                   int(getattr(t, "ties", 0) or 0)],
        "finalStanding": int(getattr(t, "final_standing", 0) or 0),
        "standing": int(getattr(t, "standing", 0) or 0),
    } for t in league.teams]

    # `current_week` on a finished season is its LAST scoring period, i.e. the number of
    # days to sweep. Padded a little in case the final day sits past it.
    max_day = int(getattr(league, "current_week", 0) or 0) or 170
    players, _weeks_seen, days = sweep_days(league, team.team_id, max_day + 5)

    # The end-of-season roster too: cheap, and it catches anyone the sweep missed.
    for p in getattr(team, "roster", []) or []:
        pid = getattr(p, "playerId", None)
        if pid is None:
            continue
        players.setdefault(int(pid), {"playerId": int(pid), "name": p.name, "days": 0})

    rows = sorted(players.values(), key=lambda r: (-r["days"], r["name"]))
    out = {
        "season": season,
        "leagueId": league_id,
        "leagueName": str(getattr(getattr(league, "settings", None), "name", "") or ""),
        "teamId": team.team_id,
        "teamName": team.team_name,
        "record": [int(getattr(team, "wins", 0) or 0),
                   int(getattr(team, "losses", 0) or 0),
                   int(getattr(team, "ties", 0) or 0)],
        "finalStanding": int(getattr(team, "final_standing", 0) or 0),
        "standing": int(getattr(team, "standing", 0) or 0),
        "scoringType": scoring,
        "weeksCovered": len(matchups),
        "daysCovered": days,
        "matchups": matchups,
        "standings": standings,
        "players": rows,
    }
    if verbose:
        print(f"  {season}  league {league_id}  \"{team.team_name}\"  "
              f"{len(rows)} players  {len(matchups)} matchups / {days} days"
              f"  [{'pts' if scoring == 'H2H_POINTS' else 'cats'}]")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fetch and report, write nothing")
    args = ap.parse_args()

    swid = my_swid()
    print(f"identity: SWID {swid[:8]}…  probing {len(LEAGUE_IDS)} leagues "
          f"x {len(SEASON_RANGE)} seasons")
    t0 = time.perf_counter()

    seasons = []
    seen = set()
    for league_id in LEAGUE_IDS:
        for season in SEASON_RANGE:
            got = collect_season(league_id, season, swid)
            if not got:
                continue
            # A season can only be yours once. If two leagues both claim one, the first
            # listed wins and the clash is reported rather than silently merged.
            if got["season"] in seen:
                print(f"  ! {got['season']} already claimed by another league — "
                      f"skipping league {league_id}")
                continue
            seen.add(got["season"])
            seasons.append(got)

    seasons.sort(key=lambda s: -s["season"])
    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "stats": STATS,
        "seasons": seasons,
    }

    total = sum(len(s["players"]) for s in seasons)
    names = {p["name"] for s in seasons for p in s["players"]}
    print(f"\n{len(seasons)} seasons, {total} season-player rows, "
          f"{len(names)} distinct players, in {time.perf_counter() - t0:.0f}s")
    if not seasons:
        print("no seasons found — check LEAGUE_IDS and that the cookies are current")
        return 1

    if args.check:
        print("--check: nothing written")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
