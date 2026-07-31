"""
Export the slow-tier data the web app needs, as JSON.

This is the "SLOW" half of the two-tier split (see docs/ARCHITECTURE.md): everything that
shifts gradually - player per-game averages, games left, the free-agent pool, season
aggregates. It is meant to run on a schedule (GitHub Actions, hourly in-season). The
"LIVE" half - the current week's category totals, which change as games finish - is
fetched per request by api/live.py and simply ADDED to these numbers in the browser.

Why that split works: a team's projected total for a category is

    mu  = current_total            (live, certain, adds no uncertainty)
        + sum_players(avg * games_left)     (slow)
    sd  = sqrt(sum_players(games_left * (avg * variance)^2))    (slow only)

so everything expensive is cacheable and the live part is one addition.

Run:  python scripts/build_data.py            (writes public/data/*.json)
      python scripts/build_data.py --check    (validate only, no write)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The engine still lives with the Streamlit app. Importing it here rather than copying it
# keeps ONE source of truth while both front ends exist; it gets extracted into its own
# package once the Streamlit app is retired.
sys.path.insert(0, str(ROOT / "legacy"))

# Team names come from ESPN and contain emoji ("Brother Brunson <emoji>"). The default
# Windows console codepage is cp1252 and raises UnicodeEncodeError on them, which killed
# this script halfway through a run. Force UTF-8 on our own output so the log can never
# fail on data we don't control - CI runners vary here too.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

import config  # noqa: E402
import data as D  # noqa: E402
import simulation as S  # noqa: E402

OUT_DIR = ROOT / "public" / "data"
STATS = list(config.CATEGORY_VARIANCE.keys())
VARIANCE = [float(config.CATEGORY_VARIANCE[s]) for s in STATS]


def espn_stat_ids():
    """
    ESPN's numeric id for each of our stats, taken from espn-api's own STATS_MAP.

    Exported so app/api/live/route.ts reads the ids instead of hardcoding them. Guessing
    these is a trap: TW is id 43, not 38 (38 is TD, triple-doubles), and a wrong id fails
    SILENTLY as a column of zeros rather than an error - which is exactly how it slipped
    through until the scoreboard read 10-4-1 instead of 10-5-0.
    """
    from espn_api.basketball import constant as espn_const

    by_name = {}
    for sid, name in espn_const.STATS_MAP.items():
        by_name.setdefault(str(name), str(sid))
    missing = [s for s in STATS if s not in by_name]
    if missing:
        raise SystemExit(
            f"espn-api's STATS_MAP has no id for {missing}. It cannot be guessed - a wrong "
            f"id silently reads as zero. Check espn_api.basketball.constant.STATS_MAP."
        )
    return {s: int(by_name[s]) for s in STATS}


def _round(x, n=4):
    """JSON-safe float. NaN/inf would serialise as invalid JSON and break the client."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(v):
        return 0.0
    return round(v, n)


def player_moments(row_vals, games_left):
    """
    One player's contribution to their team's totals, as (mu, var) per stat.

    mu  = games * avg
    var = games * (avg * variance_factor)^2
    Variances add across independent players, which is what lets the browser evaluate
    "drop A, add B" with a subtraction instead of a re-simulation.

    NOT exported per player — the browser derives it from `avg` + `gamesLeft` + the
    shared `variance` vector (see playerMoments in lib/league.ts). Shipping it would
    triple the per-player payload and give the same formula two homes to drift between.
    Still used here to build the team aggregates.
    """
    g = float(games_left)
    mu = [_round(v * g, 3) for v in row_vals]
    var = [_round(g * (v * f) ** 2, 4) for v, f in zip(row_vals, VARIANCE)]
    return mu, var


def build_roster(roster, team_name, year, injury_data, window):
    """Per-player averages + games left for one fantasy roster."""
    season = D.build_stat_df(roster, f"{year}_total", "Season", team_name, year)
    last30 = D.build_stat_df(roster, f"{year}_last_30", "Last30", team_name, year)
    if season.empty:
        return []
    merged = D.blend_season_last30(season, last30, config_blend())
    start, end = window
    if start is not None and end is not None:
        merged = D.add_games_left_with_injury(
            merged, roster, injury_data, window_start=start, window_end=end,
        )
    else:
        merged["Games Left"] = 0

    by_name = {getattr(p, "name", None): p for p in roster}
    out = []
    for _, r in merged.iterrows():
        vals = [float(r.get(s, 0) or 0) for s in STATS]
        games = int(r.get("Games Left", 0) or 0)
        p = by_name.get(r["Player"])
        out.append({
            "name": r["Player"],
            "nbaTeam": r.get("NBA_Team", ""),
            "gamesLeft": games,
            "avg": [_round(v, 3) for v in vals],
            "status": str(getattr(p, "injuryStatus", "") or "") if p else "",
            "injured": bool(D.is_player_injured(p)) if p else False,
        })
    return out


def build_free_agents(league, year, injury_data, window, size=150):
    """
    The waiver pool, for the Streamers page.

    Exported as plain per-game averages + games left. The browser turns every
    (pick up X, drop Y) pair into moment arithmetic, so a full 150-FA sweep is a few
    milliseconds and needs no server — see lib/streamers.ts.
    """
    try:
        pool = league.free_agents(size=size)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! free_agents failed: {exc}")
        return []
    healthy = [p for p in pool if not D.is_player_injured(p)]
    if not healthy:
        return []

    start, end = window
    season = D.build_stat_df(healthy, f"{year}_total", "Season", "Waiver", year)
    last30 = D.build_stat_df(healthy, f"{year}_last_30", "Last30", "Waiver", year)
    if season.empty:
        return []
    merged = D.blend_season_last30(season, last30, config_blend())
    if start is not None and end is not None:
        D.prefetch_team_schedules_for_rosters(healthy)
        merged = D.add_games_left(merged, 1, None, start, end)
    else:
        merged["Games Left"] = 0

    by_name = {getattr(p, "name", None): p for p in healthy}
    out = []
    for _, r in merged.iterrows():
        p = by_name.get(r["Player"])
        out.append({
            "name": r["Player"],
            "nbaTeam": r.get("NBA_Team", ""),
            "gamesLeft": int(r.get("Games Left", 0) or 0),
            "avg": [_round(float(r.get(s, 0) or 0), 3) for s in STATS],
            "status": str(getattr(p, "injuryStatus", "") or "") if p else "",
        })
    # Most useful first: games left, then scoring. The client re-ranks by actual impact.
    out.sort(key=lambda x: (-x["gamesLeft"], -x["avg"][STATS.index("PTS")]))
    return out


def config_blend():
    return 0.7  # matches the app's blend_weight default


def build_season(league, injury_data, sims=8000):
    """
    Season-wide data: standings, power rankings, schedules, playoff odds.

    These are computed by the legacy Streamlit module rather than reimplemented here —
    `calculate_league_stats`, the all-play maths, the rank history and the playoff bracket
    are hundreds of lines of already-verified logic, and a second copy would drift.
    Importing `streamlit_app` outside a Streamlit runtime works (its `st.*` calls become
    no-ops with warnings); it is done lazily and guarded so a failure here degrades to
    "no season data" instead of losing the matchup export, which matters more.
    """
    out = {}
    try:
        import streamlit_app as app  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        print(f"  ! could not import the legacy app for season data: {exc}")
        return out

    lid, yr = config.ESPN_LEAGUE_ID, config.ESPN_SEASON_YEAR
    s2, swid = config.ESPN_S2, config.ESPN_SWID

    def step(name, fn):
        t = time.perf_counter()
        try:
            v = fn()
            print(f"  {name}: ok ({time.perf_counter() - t:.1f}s)", flush=True)
            return v
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {name} failed: {exc}", flush=True)
            return None

    stats = step("league stats", lambda: app.get_season_stats(lid, yr, s2, swid))
    if stats:
        out["standings"] = [{
            "teamId": int(t["team_id"]),
            "teamName": t["team_name"],
            "standing": int(t["standing"]),
            "wins": int(t["actual_wins"]), "losses": int(t["actual_losses"]),
            "ties": int(t["actual_ties"]), "winPct": _round(t["actual_pct"], 5),
            "allPlayWins": int(t["all_play_wins"]), "allPlayLosses": int(t["all_play_losses"]),
            "allPlayTies": int(t["all_play_ties"]), "allPlayPct": _round(t["all_play_pct"], 5),
            "luck": _round(t["luck"], 3),
            "catTotals": {k: _round(v, 4) for k, v in (t.get("cat_totals") or {}).items()},
        } for t in stats]

    pr = step("power rankings", lambda: app.get_power_rankings(lid, yr, s2, swid))
    if pr:
        out["powerRankings"] = {
            "weeks": [int(w) for w in pr.get("weeks", [])],
            "teams": [{
                "teamId": int(t["team_id"]), "teamName": t["team_name"],
                "rank": int(t["rank"]), "prevRank": int(t["prev_rank"]),
                "delta": int(t["delta"]),
                "powerPct": _round(t["power_pct"], 5),
                "recentPct": _round(t["recent_pct"], 5),
                "form": t["form"], "sos": _round(t["sos"], 5),
                "record": [int(x) for x in t["record"]],
                "rankHistory": [int(r) for r in t.get("rank_history", [])],
            } for t in pr.get("teams", [])],
        }

    schedules = {}
    for t in league.teams:
        rows = step(f"schedule {t.team_name}",
                    lambda tid=int(t.team_id): app.get_team_schedule_data(lid, yr, s2, swid, tid))
        if rows:
            schedules[str(int(t.team_id))] = [{
                "period": int(r.get("_period", 0) or 0),
                "matchup": r.get("Matchup", ""),
                "result": r.get("Result", ""),
                "score": r.get("Score", ""),
                "winPct": r.get("Win %", ""),
                "opponent": r.get("Opponent", ""),
                "manager": r.get("Manager", ""),
            } for r in rows]
    if schedules:
        out["schedules"] = schedules

    if stats:
        odds = step("playoff odds",
                    lambda: app.get_playoff_probabilities(yr, int(sims), stats,
                                                          config_blend(), injury_data))
        rows = odds[0] if isinstance(odds, tuple) else odds
        if rows:
            out["playoffOdds"] = [{
                "teamId": int(r["team_id"]), "teamName": r["team_name"],
                "playoffProb": _round(r.get("playoff_prob", 0), 3),
                "advanceProb": _round(r.get("advance_prob", 0), 3),
                "championshipProb": _round(r.get("championship_prob", 0), 3),
                "inPlayoffs": bool(r.get("in_playoffs", False)),
                "record": list(r.get("record", [])),
            } for r in rows]
            fin = rows[0].get("championship_finalist_team_ids")
            if fin:
                out["championshipFinalists"] = [int(x) for x in fin]
    return out


def team_totals(players):
    """Sum per-player moments into team-level (mu, var) vectors."""
    mu = [0.0] * len(STATS)
    var = [0.0] * len(STATS)
    for p in players:
        p_mu, p_var = player_moments(p["avg"], p["gamesLeft"])
        for i in range(len(STATS)):
            mu[i] += p_mu[i]
            var[i] += p_var[i]
    return [_round(x, 3) for x in mu], [_round(x, 4) for x in var]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    ap.add_argument("--period", type=int, default=None,
                    help="matchup period to export (default: the league's current one)")
    args = ap.parse_args()

    t0 = time.perf_counter()
    lid, yr = config.ESPN_LEAGUE_ID, config.ESPN_SEASON_YEAR
    s2, swid = config.ESPN_S2, config.ESPN_SWID

    print(f"connecting to ESPN (league {lid}, {yr}) ...", flush=True)
    league = D.connect_to_espn(lid, yr, s2, swid)
    injury = D.get_espn_injury_data()

    league_period = S.current_matchup_period_effective(league)
    season_over = datetime.now().date() > date(2026, 4, 5)
    period = args.period if args.period is not None else (
        23 if season_over else league_period
    )
    print(f"  league period {league_period}, exporting period {period} "
          f"(season_over={season_over})", flush=True)

    # Game window: only meaningful for a live week. A completed period has no games left,
    # which is exactly what the zeros below represent.
    window = (None, None)
    if not season_over and period == league_period:
        try:
            start, end = D.get_game_count_window(yr, period, league_period)
            window = (start, end)
        except Exception as exc:
            print(f"  ! could not resolve game window: {exc}", flush=True)

    teams = []
    for t in league.teams:
        teams.append({
            "id": int(t.team_id),
            "name": t.team_name,
            "abbrev": getattr(t, "team_abbrev", ""),
            "wins": int(getattr(t, "wins", 0) or 0),
            "losses": int(getattr(t, "losses", 0) or 0),
            "ties": int(getattr(t, "ties", 0) or 0),
            "standing": int(getattr(t, "standing", 0) or 0),
        })

    def current_vector(raw_stats):
        """Current banked totals as a vector in canonical STATS order."""
        flat = D.flatten_stat_dict(raw_stats or {})
        return [_round(flat.get(s, 0) or 0, 2) for s in STATS]

    matchups = []
    for m in league.box_scores(matchup_period=period):
        home, away = m.home_team, m.away_team
        if not hasattr(home, "team_id") or not hasattr(away, "team_id"):
            continue
        h_players = build_roster(home.roster, home.team_name, yr, injury, window)
        a_players = build_roster(away.roster, away.team_name, yr, injury, window)
        h_mu, h_var = team_totals(h_players)
        a_mu, a_var = team_totals(a_players)
        # A SNAPSHOT of the live tier, so a page can paint immediately from static data
        # without waiting on ESPN. api/live returns the same shape and supersedes it.
        matchups.append({
            "homeId": int(home.team_id), "awayId": int(away.team_id),
            "home": {"players": h_players, "projMu": h_mu, "projVar": h_var,
                     "current": current_vector(m.home_stats)},
            "away": {"players": a_players, "projMu": a_mu, "projVar": a_var,
                     "current": current_vector(m.away_stats)},
        })
        print(f"  {home.team_name} vs {away.team_name}: "
              f"{len(h_players)}v{len(a_players)} players", flush=True)

    free_agents = build_free_agents(league, yr, injury, window)
    print(f"  free agents: {len(free_agents)}", flush=True)

    print("season-wide data:", flush=True)
    season = build_season(league, injury)

    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "season": yr,
        "leaguePeriod": league_period,
        "period": period,
        "seasonOver": season_over,
        "stats": STATS,              # the 14 counting stats, in canonical order
        "statIds": espn_stat_ids(),  # ESPN's numeric id per stat (see espn_stat_ids)
        "categories": list(config.CATEGORIES),   # the 15 SCORED categories
        "variance": [_round(v, 4) for v in VARIANCE],
        "lowerIsBetter": ["TO"],
        "teams": teams,
        "matchups": matchups,
        "freeAgents": free_agents,
        "seasonData": season,
    }

    problems = validate(payload)
    dt = time.perf_counter() - t0
    if problems:
        print("\nVALIDATION FAILED:")
        for p in problems:
            print(f"  - {p}")
        return 1

    blob = json.dumps(payload, separators=(",", ":"))
    print(f"\nvalidated OK in {dt:.1f}s  ({len(blob) / 1024:.0f} KB)")
    if args.check:
        print("--check: nothing written")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "league.json").write_text(blob, encoding="utf-8")
    print(f"wrote {OUT_DIR / 'league.json'}")
    return 0


def validate(payload):
    """Fail loudly here rather than shipping malformed data to the browser."""
    problems = []
    n = len(payload["stats"])
    if n != len(payload["variance"]):
        problems.append("stats/variance length mismatch")
    if not payload["teams"]:
        problems.append("no teams")
    if not payload["matchups"]:
        problems.append("no matchups")
    for i, m in enumerate(payload["matchups"]):
        for side in ("home", "away"):
            s = m[side]
            if len(s["projMu"]) != n or len(s["projVar"]) != n:
                problems.append(f"matchup {i} {side}: moment vector wrong length")
            if len(s["current"]) != n:
                problems.append(f"matchup {i} {side}: current-totals vector wrong length")
            if any(v < 0 for v in s["projVar"]):
                problems.append(f"matchup {i} {side}: negative variance")
            for p in s["players"]:
                if len(p["avg"]) != n:
                    problems.append(f"matchup {i} {side}: player {p['name']} wrong length")
                    break
    for fa in payload.get("freeAgents", []):
        if len(fa["avg"]) != n:
            problems.append(f"free agent {fa['name']}: avg vector wrong length")
            break
    try:
        json.dumps(payload)
    except (TypeError, ValueError) as exc:
        problems.append(f"not JSON-serialisable: {exc}")
    return problems


if __name__ == "__main__":
    raise SystemExit(main())
