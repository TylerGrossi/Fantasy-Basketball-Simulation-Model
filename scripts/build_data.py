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
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

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


PLAYER_POOL_STATS = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO",
                     "FGM", "FGA", "FTM", "FTA", "3PA", "DD"]


def build_player_pool(app):
    """
    Every rostered player + top free agents with their 9-cat Value and trend.

    Powers Player Value, Player Card, Compare and the Trade Simulator — all four are
    views over this one list, so it is exported once rather than per page.
    """
    try:
        pool = app.get_player_pool(config.ESPN_LEAGUE_ID, config.ESPN_SEASON_YEAR,
                                   config.ESPN_S2, config.ESPN_SWID)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! player pool failed: {exc}")
        return []
    out = []
    for p in pool:
        # EligibleSlots comes back as a plain list from build_stat_df, except when the
        # column was missing entirely (an older cached frame) - pandas fills that as
        # NaN, which fails `isinstance(..., list)`. Fall back to the single Position in
        # that case, same as the front end does for data exported before this field
        # existed.
        elig = p.get("EligibleSlots")
        if not isinstance(elig, list):
            elig = [p["Position"]] if p.get("Position") else []
        row = {
            "name": p.get("Player", ""),
            "nbaTeam": p.get("NBA_Team", ""),
            "position": p.get("Position", ""),
            "eligibleSlots": elig,
            "owner": p.get("Owner", ""),
            "status": p.get("Status", ""),
            "playerId": int(p["PlayerId"]) if p.get("PlayerId") == p.get("PlayerId") and p.get("PlayerId") is not None else None,
            "value": _round(p.get("Value", 0), 3),
            "recent": _round(p.get("Recent", 0), 3),
            "trend": _round(p.get("Trend", 0), 3),
            "recent15": _round(p.get("Recent15", 0), 3),
            "trend15": _round(p.get("Trend15", 0), 3),
            "fgPct": _round(p.get("FG%", 0), 4),
            "ftPct": _round(p.get("FT%", 0), 4),
            "tpPct": _round(p.get("3P%", 0), 4),
        }
        for s in PLAYER_POOL_STATS:
            row[s] = _round(p.get(s, 0), 2)
        out.append(row)
    out.sort(key=lambda r: -r["value"])
    return out


def stat_vector(raw_stats):
    """Banked category totals as a vector in canonical STATS order."""
    flat = D.flatten_stat_dict(raw_stats or {})
    return [_round(flat.get(s, 0) or 0, 2) for s in STATS]


def _cat_value(vec, cat):
    """One scored category's value, deriving the ratio categories from their pair."""
    pair = {"FG%": ("FGM", "FGA"), "FT%": ("FTM", "FTA"), "3P%": ("3PM", "3PA")}.get(cat)
    if pair:
        made, att = vec[STATS.index(pair[0])], vec[STATS.index(pair[1])]
        return made / att if att else 0.0
    return vec[STATS.index(cat)] if cat in STATS else 0.0


def score_vs(a, b):
    """W-L-T for vector `a` against `b`, over the scored categories. TO is inverted."""
    w = l = t = 0
    for cat in config.CATEGORIES:
        x, y = _cat_value(a, cat), _cat_value(b, cat)
        if cat == "TO":
            x, y = -x, -y
        if x > y:
            w += 1
        elif x < y:
            l += 1
        else:
            t += 1
    return w, l, t


@lru_cache(maxsize=64)
def _team_schedule_labels(team_abbrev, year):
    """
    Game-day opponent labels for one NBA team in one season: `{date: "Tor"}` or
    `{date: "@Wsh"}` when away. Mirrors legacy `data.get_team_schedule_game_labels`, but
    takes an explicit `year` — the site API defaults to whatever season is CURRENT right
    now, which in the offseason is next year's barely-populated schedule (4 preseason
    games), not the season that was just played. Confirmed: `?season=2026` returns the
    full 82-game 2025-26 slate; the bare endpoint returns 4.

    Cached for the life of the process (`lru_cache`, not `st.cache_data` — this runs
    outside a Streamlit runtime) and goes through `D.HTTP`, the one pooled session, never
    a bare `requests.get` (see AGENTS.md on the SSLContext cost of skipping it).
    """
    team_abbrev = D.normalize_team(team_abbrev)
    if not team_abbrev or team_abbrev not in D.NBA_TEAM_MAP:
        return {}
    slug = D.NBA_TEAM_MAP[team_abbrev]
    url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{slug}/schedule"
    try:
        r = D.HTTP.get(url, params={"season": year}, timeout=10)
        if r.status_code != 200:
            return {}
        events = r.json().get("events", [])
    except Exception:  # noqa: BLE001
        return {}

    eastern = ZoneInfo("America/New_York")
    labels = {}
    for event in events:
        try:
            d = datetime.fromisoformat(event["date"].replace("Z", "+00:00")).astimezone(eastern).date()
            comp = (event.get("competitions") or [{}])[0]
            competitors = comp.get("competitors") or []
            if len(competitors) < 2:
                continue
            my_side, opp_abbr = None, None
            for c in competitors:
                t = c.get("team") or {}
                ab = D.normalize_team(t.get("abbreviation"))
                if not ab:
                    continue
                if ab == team_abbrev:
                    my_side = c.get("homeAway")
                else:
                    opp_abbr = t.get("abbreviation") or ab
            if my_side is None or not opp_abbr:
                continue
            labels[d] = f"@{str(opp_abbr).strip()}" if my_side == "away" else str(opp_abbr).strip()
        except Exception:  # noqa: BLE001
            continue
    return labels


def player_lines(lineup, window=None, year=None):
    """
    One team's players for one matchup period, from ESPN's own box score.

    `points_breakdown` carries that WEEK's totals per player — the same numbers ESPN
    prints in its box-score view — so nothing here is derived or estimated. Players who
    did not play are kept with `gp: 0` and no vector: the recap shows them the way ESPN
    does, as a roster spot that produced nothing, and an absent row would quietly rewrite
    the week's lineup.

    NO SLOT FIELD. `slot_position` is worth having — it is how ESPN splits starters from
    bench — but espn-api reports "PG" for every player in this league's box scores, so
    exporting it would ship a column that is uniformly wrong. Nothing is lost: summing
    every line here reproduces the team's category totals EXACTLY (verified at 1688.0 PTS
    for period 20), which means ESPN only lists players whose stats counted. There is no
    bench to separate.

    `window`/`year`, when given, add `opp`: the player's NBA team's game-day opponents
    within the period's date range ("GAMES: OPPONENTS" in ESPN's own box score) —
    every day their team played in that window, not just days this player individually
    logged a stat line, matching what ESPN shows.
    """
    start, end = window if window else (None, None)
    out = []
    for bp in lineup or []:
        bd = getattr(bp, "points_breakdown", None) or {}
        gp = int(bd.get("GP", 0) or 0)
        row = {
            "name": getattr(bp, "name", "") or "",
            "gp": gp,
            "min": _round(bd.get("MIN", 0) or 0, 1),
        }
        # Only carry a stat vector for someone who actually played — a zero vector is
        # ~40 bytes per player per week across 22 weeks and says nothing gp doesn't.
        if gp:
            row["v"] = [_round(bd.get(stat, 0) or 0, 2) for stat in STATS]
        if start and end and year:
            team = getattr(bp, "proTeam", "") or ""
            labels = _team_schedule_labels(team, year)
            opp = [labels[d] for d in sorted(labels) if start <= d <= end]
            if opp:
                row["opp"] = opp
        out.append(row)
    return out


def matchup_period_id_for(app_period, regular_season_weeks):
    """
    ESPN's own matchupPeriodId for an app period.

    The app (and `periodLabel` in lib/league.ts) numbers a playoff round with TWO
    consecutive period integers — the round spans two scoring periods — while ESPN's
    `matchupPeriodId` uses ONE integer per round (AGENTS.md: app period 23 is ESPN
    matchupPeriodId 21). Same halving arithmetic as `periodLabel`; keep them in lockstep.
    """
    if app_period <= regular_season_weeks:
        return app_period
    round_n = (app_period - regular_season_weeks - 1) // 2 + 1
    return regular_season_weeks + round_n


def fetch_acquisition_totals(league):
    """
    Raw per-team, per-ESPN-matchup-period acquisition counts, plus the league's declared
    per-scoring-period cap — together, "Matchup Acquisition Limit (Used/Max)" on ESPN's
    own box score page.

    One `mTeam` request covers every team's counts for the whole season; `mSettings` has
    the cap once. `matchupAcquisitionLimit` (1.0 in this league) applies PER SCORING
    PERIOD, and this league scores daily, so days-in-window IS scoring-periods-in-window —
    confirmed against a real 14-day playoff round reading exactly the ESPN-shown 14.

    Returns `(totals, limit_per_day)`; `totals` is `{team_id: {matchupPeriodId: used}}`.
    `limit_per_day` is `None` when the setting can't be read, and every caller treats that
    as "omit the acquisition line" rather than guessing a cap.
    """
    totals = {}
    try:
        raw = league.espn_request.league_get(params={"view": "mTeam"})
        for tm in raw.get("teams", []):
            tid = tm.get("id")
            mat = (tm.get("transactionCounter") or {}).get("matchupAcquisitionTotals") or {}
            if tid is not None:
                totals[int(tid)] = {int(k): int(v) for k, v in mat.items()}
    except Exception as exc:  # noqa: BLE001
        print(f"  ! acquisition totals failed: {exc}")

    limit_per_day = None
    try:
        raw2 = league.espn_request.league_get(params={"view": "mSettings"})
        acq = (raw2.get("settings") or {}).get("acquisitionSettings") or {}
        limit = acq.get("matchupAcquisitionLimit")
        if limit and float(limit) > 0:
            limit_per_day = float(limit)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! acquisition limit setting failed: {exc}")

    return totals, limit_per_day


def acquisition_summary(team_id, app_period, window, totals, limit_per_day, regular_season_weeks):
    """
    `{"used": int, "max": int}` for one team's allowance in one matchup, or `None` when
    any input needed to compute it is missing (an old export, a bye, a window that
    couldn't be resolved) — the frontend just omits the line rather than showing a zero
    that would read as "no acquisitions" instead of "unknown".
    """
    if limit_per_day is None or regular_season_weeks is None:
        return None
    start, end = window if window else (None, None)
    if start is None or end is None:
        return None
    # ESPN's own counter is SPARSE: a team with zero acquisitions in a period gets no key
    # at all, not a 0 - confirmed against the raw response (a heavy-waiver team's dict had
    # no gaps; a quiet team's had several). So a MISSING team is "can't compute" (omit),
    # but a missing PERIOD for a team we DO have data for is a real zero, not unknown -
    # matching ESPN's own box score, which always prints a number, never a blank.
    team_totals = totals.get(team_id)
    if team_totals is None:
        return None
    mpid = matchup_period_id_for(app_period, regular_season_weeks)
    used = team_totals.get(mpid, 0)
    days = (end - start).days + 1
    return {"used": int(used), "max": int(round(limit_per_day * days))}


def build_period_results(
    league, schedules, box_out=None, year=None, regular_season_weeks=None, extra_periods=None
):
    """
    Final category totals for every completed matchup period.

    Only TOTALS - no rosters, no projections. A finished week has no games left, so its
    page needs the two stat vectors and nothing else; that keeps this whole section to a
    few KB instead of re-exporting ten rosters per week.

    ESPN's `matchupPeriodId` is NOT always the app's period number (the app counts scoring
    periods, and playoff rounds span two). Rather than assume they line up, each period is
    keyed by ESPN's id and then CHECKED against the score already in the schedule table -
    a wrong mapping would silently show the wrong week's numbers, which is precisely the
    failure mode that made the TW stat id bug survive so long.

    `box_out`, when given, is filled with the per-player lines for the same periods. It
    rides along HERE because this loop already pays for `league.box_scores(...)` on every
    period - fetching them separately would double ~22 round trips for data we are
    already holding.

    `year`/`regular_season_weeks`, when given, add two things ESPN's own box score shows
    and this export previously didn't: each player's GAMES: OPPONENTS
    (`player_lines`' `opp`) and each team's Matchup Acquisition Limit (`homeAcq`/
    `awayAcq`) on the game row. Both degrade to simply absent when the inputs needed to
    compute them aren't available - never a guess.

    `extra_periods` covers a gap the schedule table has: a playoff ROUND logs only its
    FIRST scoring period there (20, not 21, for round 1), while `league.period` - what
    /scoreboard actually renders as "the current week" - resolves to the SECOND (21).
    Without this, the period /scoreboard shows for a just-finished season has no exported
    box lines at all. Pass the exporter's own `period` here so it always gets one.
    """
    wanted = sorted(
        {int(r["period"]) for rows in schedules.values() for r in rows}
        | {int(p) for p in (extra_periods or [])}
    )
    if not wanted:
        return []

    try:
        import streamlit_app as app  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        print(f"  ! could not import the legacy app for period windows: {exc}")
        app = None

    acq_totals, acq_limit_per_day = ({}, None)
    if regular_season_weeks is not None:
        acq_totals, acq_limit_per_day = fetch_acquisition_totals(league)

    out = []
    for p in range(1, max(wanted) + 1):
        try:
            games = league.box_scores(matchup_period=p)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! period {p}: {exc}", flush=True)
            continue

        window = (None, None)
        if app is not None and year is not None:
            try:
                w_start, w_end, _, _ = app.resolve_view_window(p, year)
                window = (w_start, w_end)
            except Exception:  # noqa: BLE001
                pass

        rows = []
        for m in games:
            home, away = m.home_team, m.away_team
            if not hasattr(home, "team_id") or not hasattr(away, "team_id"):
                continue
            h, a = stat_vector(m.home_stats), stat_vector(m.away_stats)
            if not any(h) and not any(a):
                continue  # unplayed week
            row = {
                "homeId": int(home.team_id), "awayId": int(away.team_id),
                "home": h, "away": a,
            }
            if regular_season_weeks is not None:
                h_acq = acquisition_summary(
                    int(home.team_id), p, window, acq_totals, acq_limit_per_day,
                    regular_season_weeks,
                )
                a_acq = acquisition_summary(
                    int(away.team_id), p, window, acq_totals, acq_limit_per_day,
                    regular_season_weeks,
                )
                if h_acq:
                    row["homeAcq"] = h_acq
                if a_acq:
                    row["awayAcq"] = a_acq
            rows.append(row)
            if box_out is not None:
                teams = box_out.setdefault(str(p), {})
                teams[str(int(home.team_id))] = player_lines(
                    getattr(m, "home_lineup", None), window, year
                )
                teams[str(int(away.team_id))] = player_lines(
                    getattr(m, "away_lineup", None), window, year
                )
        if rows:
            out.append({"period": p, "games": rows})
    print(f"  period results: {len(out)} periods", flush=True)
    return out


def check_period_results(period_results, schedules):
    """
    Confirm the exported periods line up with the schedule table, by re-deriving each
    week's W-L-T from the totals and comparing it to the score ESPN already reported.
    Returns a list of problems (empty = the mapping is right).
    """
    by_period = {pr["period"]: pr for pr in period_results}
    problems, checked = [], 0
    for team_id, rows in schedules.items():
        for r in rows:
            want = str(r.get("score") or "").strip()
            if not want or "-" not in want:
                continue
            pr = by_period.get(int(r["period"]))
            if pr is None:
                problems.append(f"team {team_id} period {r['period']}: no exported totals")
                continue
            tid = int(team_id)
            game = next(
                (g for g in pr["games"] if tid in (g["homeId"], g["awayId"])), None
            )
            if game is None:
                problems.append(f"team {team_id} period {r['period']}: not in that period")
                continue
            mine = game["home"] if game["homeId"] == tid else game["away"]
            theirs = game["away"] if game["homeId"] == tid else game["home"]
            got = "-".join(str(n) for n in score_vs(mine, theirs))
            checked += 1
            if got != want:
                problems.append(
                    f"team {team_id} period {r['period']}: derived {got}, schedule says {want}"
                )
    print(f"  period-result cross-check: {checked} matchups, {len(problems)} mismatch(es)",
          flush=True)
    return problems


def build_team_season_stats(app, league):
    """Per-team season totals and per-player season lines, for the Season Stats page."""
    lid, yr = config.ESPN_LEAGUE_ID, config.ESPN_SEASON_YEAR
    s2, swid = config.ESPN_S2, config.ESPN_SWID
    out = {}
    for t in league.teams:
        try:
            res = app.get_team_season_stats(lid, yr, s2, swid, int(t.team_id))
        except Exception as exc:  # noqa: BLE001
            print(f"  ! season stats for {t.team_name} failed: {exc}")
            continue
        totals, per_player = (res[0], res[1]) if isinstance(res, tuple) else ({}, {})
        players = []
        for name, line in (per_player or {}).items():
            row = {"name": name, "gp": _round(line.get("GP", 0), 0)}
            for k, v in line.items():
                if k != "GP":
                    row[k] = _round(v, 2)
            players.append(row)
        players.sort(key=lambda r: -(r.get("PTS") or 0))
        out[str(int(t.team_id))] = {
            "totals": {k: _round(v, 3) for k, v in (totals or {}).items()},
            "players": players,
        }
    return out


def _season_shape():
    """
    How many regular-season weeks and playoff rounds this league has.

    Read from the legacy module (where REGULAR_SEASON_WEEKS / PLAYOFF_SCORING_DATES
    live) so the two front ends can't disagree about where the playoffs start.
    Guarded like every other legacy import here: if it fails the export still ships,
    and the browser falls back to its own defaults.
    """
    try:
        import streamlit_app as app  # noqa: PLC0415

        return {
            "regularSeasonWeeks": int(app.REGULAR_SEASON_WEEKS),
            "playoffRounds": len(app.PLAYOFF_SCORING_DATES),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"  ! could not read the season shape: {exc}")
        return {}


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
        # `standing` from get_season_stats is the CATEGORY-RECORD order; ESPN's
        # final_standing is where the bracket actually left each team. The Season
        # Summary ranks by the latter (it's the placing the league remembers), so
        # carry it too rather than making the page infer one from the other.
        final_by_id = {
            int(t.team_id): int(getattr(t, "final_standing", 0) or 0)
            for t in league.teams
        }
        # Roster churn, straight off the Team object. "Moves" in ESPN's standings is the
        # acquisition count — how many players a manager added all season, which is the
        # difference between a set-and-forget roster and one that was worked every week.
        moves_by_id = {
            int(t.team_id): {
                "acquisitions": int(getattr(t, "acquisitions", 0) or 0),
                "drops": int(getattr(t, "drops", 0) or 0),
                "trades": int(getattr(t, "trades", 0) or 0),
            }
            for t in league.teams
        }
        out["standings"] = [{
            "teamId": int(t["team_id"]),
            "teamName": t["team_name"],
            "standing": int(t["standing"]),
            "finalStanding": final_by_id.get(int(t["team_id"]), 0),
            "wins": int(t["actual_wins"]), "losses": int(t["actual_losses"]),
            "ties": int(t["actual_ties"]), "winPct": _round(t["actual_pct"], 5),
            "allPlayWins": int(t["all_play_wins"]), "allPlayLosses": int(t["all_play_losses"]),
            "allPlayTies": int(t["all_play_ties"]), "allPlayPct": _round(t["all_play_pct"], 5),
            "luck": _round(t["luck"], 3),
            **moves_by_id.get(int(t["team_id"]), {}),
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

    out["playerPool"] = step("player pool", lambda: build_player_pool(app)) or []
    out["teamSeasonStats"] = step("team season stats",
                                  lambda: build_team_season_stats(app, league)) or {}

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
                # Seed distribution (keys are seed numbers plus "no_playoffs"). Only
                # meaningful before the bracket starts, but the page renders those
                # columns then, so it has to ship.
                "seedProbs": {str(k): _round(v, 3)
                              for k, v in (r.get("seed_probs") or {}).items()},
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

    current_vector = stat_vector

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
    season_shape = _season_shape()

    # Per-player weekly lines go in their OWN file. They are several times the size of
    # everything else put together, and only the week-recap view reads them — keeping
    # them out of league.json means every other page's server render stays cheap.
    box_scores = {}
    period_results = build_period_results(
        league, season.get("schedules") or {}, box_out=box_scores,
        year=yr, regular_season_weeks=season_shape.get("regularSeasonWeeks"),
        extra_periods=[period],
    )
    mapping_problems = check_period_results(period_results, season.get("schedules") or {})

    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "season": yr,
        # The league's own name, shown in the Home eyebrow. Falls back rather than
        # failing: a missing name costs a nicety, not a page.
        "leagueName": str(
            getattr(getattr(league, "settings", None), "name", "") or ""
        ).strip(),
        "leaguePeriod": league_period,
        "period": period,
        "seasonOver": season_over,
        # The season's shape, so the browser can name a period ("Week 12",
        # "Playoffs · Round 2") with the SAME arithmetic resolve_view_window uses
        # rather than a second copy of these numbers in TypeScript.
        **season_shape,
        "stats": STATS,              # the 14 counting stats, in canonical order
        "statIds": espn_stat_ids(),  # ESPN's numeric id per stat (see espn_stat_ids)
        "categories": list(config.CATEGORIES),   # the 15 SCORED categories
        "variance": [_round(v, 4) for v in VARIANCE],
        "lowerIsBetter": ["TO"],
        "teams": teams,
        "matchups": matchups,
        "freeAgents": free_agents,
        # Final totals per completed week, for the clickable schedule -> week view.
        "periodResults": period_results,
        "seasonData": season,
    }

    problems = validate(payload) + mapping_problems
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

    if box_scores:
        box_blob = json.dumps(
            {"generatedAt": payload["generatedAt"], "stats": STATS, "periods": box_scores},
            separators=(",", ":"),
        )
        (OUT_DIR / "boxscores.json").write_text(box_blob, encoding="utf-8")
        lines = sum(len(v) for teams in box_scores.values() for v in teams.values())
        print(
            f"wrote {OUT_DIR / 'boxscores.json'}  "
            f"({len(box_blob) / 1024:.0f} KB, {len(box_scores)} periods, {lines} player lines)"
        )
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
