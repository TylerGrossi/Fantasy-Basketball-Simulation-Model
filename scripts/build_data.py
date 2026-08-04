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

# espn-api's short slot names -> the labels the board prints, which are ESPN's own UI
# wording. Anything not listed (PG, SG, ... IR) already matches and passes through.
SLOT_ALIASES = {"UT": "UTIL", "BE": "Bench"}

# ESPN's raw `acquisitionType` values, as the League Rosters view labels them.
#
# "ADD" is the one that matters and the one that is easy to miss: it - not "FREEAGENCY" -
# is what this league actually returns for a wire pickup (45 of 142 rostered players),
# and ESPN's own roster page prints those as "Free Agency". The rest are here because
# other leagues/seasons do return them.
ACQUISITION_LABELS = {
    "DRAFT": "Draft",
    "ADD": "Free Agency",
    "FREEAGENT": "Free Agency",
    "FREEAGENCY": "Free Agency",
    "WAIVER": "Waivers",
    "TRADE": "Trade",
}


def acquisition_label(raw):
    """
    A display label for ESPN's `acquisitionType`.

    An UNRECOGNISED but non-empty code is title-cased rather than blanked, so a value
    ESPN adds later shows up as itself instead of silently vanishing from the column -
    which is exactly how "ADD" went missing on the first pass. Genuinely absent (a free
    agent, never acquired) stays "".
    """
    code = str(raw or "").strip().upper()
    if not code:
        return ""
    return ACQUISITION_LABELS.get(code, code.replace("_", " ").title())


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

# ESPN's public site API, same host the Player Card's bio already reads client-side.
_NBA_TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams"
_NBA_ROSTER_URL = ("https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
                   "/teams/{team_id}/roster")


def fetch_player_ages():
    """
    ``{playerId: {"age": int, "exp": int}}`` for every player on an NBA roster.

    The draft projection needs age: a 22-year-old's line and a 34-year-old's identical
    line are not worth the same thing next season, and nothing in the fantasy export
    carries a birthday. ESPN's per-team roster endpoint returns age and experience for a
    whole roster in one response, so the whole league costs **31 requests** (one team
    list + 30 rosters) rather than the ~290 the per-athlete bio endpoint would - the
    same reason the Player Card fetches bios one at a time on open instead.

    The athlete `id` here is the SAME id space as the fantasy `playerId` (it is what the
    headshot URLs are built from), so no name matching is involved.

    Returns ``{}`` on any failure. Age is an input the projection degrades without, not
    one it requires - see `ageMultiplier` in lib/projection.ts, which treats a missing
    age as "at peak" and so applies no adjustment at all.
    """
    try:
        # D.HTTP, never requests.get - a bare get rebuilds an SSLContext per call at
        # ~0.25s of CPU each. See the performance notes in AGENTS.md.
        teams = D.HTTP.get(_NBA_TEAMS_URL, timeout=20).json()
        ids = [t["team"]["id"]
               for t in teams["sports"][0]["leagues"][0]["teams"]]
    except Exception as exc:  # noqa: BLE001
        print(f"  ! NBA team list failed: {exc}")
        return {}

    out = {}
    failed = 0
    for team_id in ids:
        try:
            roster = D.HTTP.get(_NBA_ROSTER_URL.format(team_id=team_id), timeout=20).json()
        except Exception:  # noqa: BLE001
            failed += 1
            continue
        for a in roster.get("athletes", []) or []:
            try:
                pid = int(a["id"])
            except (KeyError, TypeError, ValueError):
                continue
            age = a.get("age")
            exp = (a.get("experience") or {}).get("years")
            row = {}
            if isinstance(age, (int, float)) and age > 0:
                row["age"] = int(age)
            if isinstance(exp, (int, float)) and exp >= 0:
                row["exp"] = int(exp)
            if row:
                out[pid] = row
    if failed:
        print(f"  ! {failed}/{len(ids)} NBA rosters failed; ages partial")
    return out


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
    ages = fetch_player_ages()
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
            # Blank for a free agent, who was never on a roster to have either.
            "lineupSlot": SLOT_ALIASES.get(
                p.get("LineupSlot", "") or "", p.get("LineupSlot", "") or ""
            ),
            "acquisitionType": acquisition_label(p.get("AcquisitionType", "")),
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

        # --- Draft-projection inputs (read only by lib/projection.ts) -------------
        # Games played is the SAMPLE SIZE behind every per-game figure above. Without
        # it a 9-game line and a 74-game line look equally certain, and the projection
        # has no basis on which to regress one harder than the other.
        row["gp"] = int(_round(p.get("GP", 0), 0) or 0)
        bio = ages.get(row["playerId"]) or {}
        if "age" in bio:
            row["age"] = bio["age"]
        if "exp" in bio:
            row["exp"] = bio["exp"]

        # The recent windows as their own per-game categories, alongside the season line.
        # `recent`/`recent15` collapse each window to one z-score; these are the raw
        # categories behind them — read by the draft projection (last30) and by the
        # Player Card's Season/30D/15D averages switch (both).
        #
        # A window is omitted ENTIRELY for a player who has no games in it: an absent key
        # reads as "no sample" downstream, where zeros would read as "played and produced
        # nothing" and drag both the blend and the displayed averages toward zero.
        for prefix, key in (("L30", "last30"), ("L15", "last15")):
            window = {}
            for s in PLAYER_POOL_STATS:
                v = p.get(f"{prefix}_{s}")
                if v is not None and v == v:  # NaN != NaN
                    window[s] = _round(v, 2)
            gp = p.get(f"{prefix}_GP")
            if window and gp is not None and gp == gp and gp > 0:
                window["gp"] = int(_round(gp, 0))
                row[key] = window

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


def player_lines(lineup):
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

    NO OPPONENTS COLUMN. This used to carry `opp` — the team's game-day opponents
    within the period ("GAMES: OPPONENTS" in ESPN's own box score). It was dropped: the
    column read badly next to the stat line, and building it cost one schedule request
    per NBA team per export on top of everything else.
    """
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


def fetch_recent_activity(league):
    """
    League-wide add/drop/trade feed, newest first — ESPN's "Recent Activity".

    Tried espn-api's own `recent_activity()` first (the natural fit: one
    `kona_league_communication` request, pre-grouped into (team, action, player) tuples).
    It 404s for this league with "This Communication Group does not exist" — an
    ESPN-side thing (that message board/topics group appears to not exist for this
    league/season), not something this app controls, so this falls back to the
    transaction log instead: `mTransactions2`, which ESPN scopes PER SCORING PERIOD (no
    "give me the whole season" call, unlike `mTeam`), so it's one request per day of the
    season. That's ~167 pooled calls here — a few seconds through `data.HTTP`'s shared
    session (see the pooling note above `fetch_acquisition_totals`), not the dozens of
    seconds a per-call `requests.get` used to cost.

    Reads the raw JSON via `league.espn_request.league_get` rather than
    `league.transactions()`/`Transaction`: that wrapper's `.date` only reads
    `processDate`, which is blank on most FREEAGENT rows even though the transaction
    plainly happened — `proposedDate` (read here) is populated on every row tested.

    Only `EXECUTED` rows count as a move that happened — pending waiver claims and
    trade proposals/vetoes aren't.

    `types` deliberately includes `ROSTER`: a standalone drop (cutting a player with no
    matching add) files under `ROSTER`, not `FREEAGENT`/`WAIVER` — leaving it out
    silently dropped every add-only-no-corresponding-drop-shown gap in the feed (found
    by spot-checking one player's full-season history against this export and finding
    two adds with no drop between them). `FUTURE_ROSTER` is excluded on purpose: every
    item under it is a lineup-slot move (`LINEUP`), never an add/drop, and at ~1,800
    rows for this league alone it would dwarf the real moves. The item-type allowlist
    below is the actual belt-and-suspenders check — it skips any `LINEUP` item even if
    it turns up under a type this function didn't expect to carry one.
    """
    types = ["FREEAGENT", "WAIVER", "TRADE_ACCEPT", "TRADE_UPHOLD", "ROSTER", "DRAFT"]
    filters = {"transactions": {"filterType": {"value": types}}}
    headers = {"x-fantasy-filter": json.dumps(filters)}

    rows = []
    for period in range(league.firstScoringPeriod, league.finalScoringPeriod + 1):
        try:
            data = league.espn_request.league_get(
                params={"view": "mTransactions2", "scoringPeriodId": period},
                headers=headers,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  ! transactions period {period} failed: {exc}")
            continue
        for tx in data.get("transactions", []):
            if tx.get("status") != "EXECUTED":
                continue
            ttype = tx.get("type", "")
            try:
                team_name = league.get_team_data(tx.get("teamId")).team_name
            except Exception:  # noqa: BLE001
                team_name = "—"
            when = tx.get("proposedDate")
            when_iso = (
                datetime.fromtimestamp(when / 1000, tz=ZoneInfo("America/New_York")).isoformat()
                if when else ""
            )
            for item in tx.get("items", []):
                itype = item.get("type", "")
                if itype not in ("ADD", "DROP", "DRAFT"):
                    continue  # LINEUP etc. — a roster-slot move, not an add/drop
                player = league.player_map.get(item.get("playerId"), "")
                if not player:
                    continue
                if itype == "DRAFT":
                    label = "Draft"
                elif ttype.startswith("TRADE"):
                    label = "Trade"
                elif itype == "DROP":
                    label = "Drop"
                elif ttype == "WAIVER":
                    label = "Waiver Add"
                else:
                    label = "Add"
                rows.append({
                    "date": when_iso,
                    "team": team_name,
                    "action": label,
                    "player": player,
                    "position": "",
                })
    rows.sort(key=lambda r: r["date"], reverse=True)
    return rows


# ESPN's lineupSlotId -> the label the League Rosters board prints, in BOARD ORDER.
# Ordered because the board renders slots in this sequence (ESPN's own), so the mapping
# and the ordering are one thing that cannot drift apart. Ids absent here (the
# combination slots this league doesn't use, 7-10) carry a count of 0 anyway.
SLOT_LABELS = [
    (0, "PG"), (1, "SG"), (2, "SF"), (3, "PF"), (4, "C"),
    (5, "G"), (6, "F"), (11, "UTIL"), (12, "Bench"), (13, "IR"),
]


def fetch_roster_slots(league):
    """
    The league's starting-lineup shape as a flat, ordered list of slot labels -
    `["PG", "SG", ..., "UTIL", "UTIL", "UTIL", "Bench", ...]`, one entry per roster spot.

    Read from `rosterSettings.lineupSlotCounts` rather than hardcoded: the League Rosters
    board draws an "Empty" row for every unfilled spot the way ESPN does, and it can only
    know a spot is empty by knowing how many there are meant to be. Returns `[]` on
    failure, which the page treats as "just list the players" rather than inventing slots.
    """
    try:
        raw = league.espn_request.league_get(params={"view": "mSettings"})
        counts = ((raw.get("settings") or {}).get("rosterSettings") or {}).get(
            "lineupSlotCounts"
        ) or {}
    except Exception as exc:  # noqa: BLE001
        print(f"  ! roster slot settings failed: {exc}")
        return []
    out = []
    for slot_id, label in SLOT_LABELS:
        out.extend([label] * int(counts.get(str(slot_id), 0) or 0))
    return out


def fetch_transaction_counters(league):
    """
    Per-team `moveToActive`/`moveToIR` counts from the same raw `mTeam` payload
    `fetch_acquisition_totals` reads - roster-management moves (activating a bench spot,
    stashing someone on IR) that `espn_api`'s `Team` object doesn't surface, unlike
    `acquisitions`/`drops`/`trades`, which it does. This is ESPN's own "Transaction
    Counter" widget (Team / Loss / Trade / Acq / Drop / Activate / IR); `Loss` there is
    just the standings loss column repeated, so it isn't duplicated here.

    Returns `{team_id: {"moveToActive": int, "moveToIR": int}}`, empty on failure - the
    page then falls back to 0, same as an export built before this was added.
    """
    out = {}
    try:
        raw = league.espn_request.league_get(params={"view": "mTeam"})
        for tm in raw.get("teams", []):
            tid = tm.get("id")
            tc = tm.get("transactionCounter") or {}
            if tid is not None:
                out[int(tid)] = {
                    "moveToActive": int(tc.get("moveToActive", 0) or 0),
                    "moveToIR": int(tc.get("moveToIR", 0) or 0),
                }
    except Exception as exc:  # noqa: BLE001
        print(f"  ! transaction counters failed: {exc}")
    return out


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

    `year`/`regular_season_weeks`, when given, add each team's Matchup Acquisition Limit
    (`homeAcq`/`awayAcq`) on the game row. It degrades to simply absent when the inputs
    needed to compute it aren't available - never a guess.

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
                    getattr(m, "home_lineup", None)
                )
                teams[str(int(away.team_id))] = player_lines(
                    getattr(m, "away_lineup", None)
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
        counters = fetch_transaction_counters(league)
        moves_by_id = {
            int(t.team_id): {
                "acquisitions": int(getattr(t, "acquisitions", 0) or 0),
                "drops": int(getattr(t, "drops", 0) or 0),
                "trades": int(getattr(t, "trades", 0) or 0),
                **counters.get(int(t.team_id), {}),
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

    out["recentMoves"] = step("recent moves", lambda: fetch_recent_activity(league)) or []

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
        # The roster's slot shape, so the League Rosters board can draw empty spots.
        "rosterSlots": fetch_roster_slots(league),
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
