"""
Fantasy Basketball Simulator - Data loading, ESPN API, and schedule utilities.
"""

import pandas as pd
import requests
import streamlit as st
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo

from collections import defaultdict

from config import (
    INJURED_STATUSES,
    MAX_PLAYERS_PER_DAY,
    MAX_ROSTER_SIZE,
    NUMERIC_COLS,
    STATUS_DISPLAY,
    TEAM_FIXES,
    NBA_TEAM_MAP,
)

# DTD (day-to-day) players are expected to play — count them the same as active
ACTIVE_STATUSES = {"ACTIVE", "", "DTD", "DAY_TO_DAY"}


# -----------------------------------------------------------------------------
# Helper functions
# -----------------------------------------------------------------------------

def safe_num(x):
    try:
        return float(x)
    except Exception:
        return 0.0


def normalize_team(t):
    if pd.isna(t):
        return None
    t = str(t).upper().strip()
    return TEAM_FIXES.get(t, t)


def flatten_stat_dict(d):
    return {k: (v.get("value", v) if isinstance(v, dict) else v) for k, v in d.items()}


def _parse_expected_return_date(player):
    """Parse expected return date from ESPN player object. Returns date or None."""
    val = getattr(player, "expected_return_date", None)
    if val is None:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, (list, tuple)) and len(val) >= 3:
        try:
            return date(int(val[0]), int(val[1]), int(val[2]))
        except (ValueError, TypeError):
            pass
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00")).date()
        except (ValueError, TypeError):
            pass
    return None


def count_games_left_for_player(player, injury_data=None, trust_return_dates=True, week_span=1, period_end_date=None,
                                window_start=None, window_end=None):
    """
    Count games in the matchup window where player is available.
    window_start/window_end: inclusive range (overrides today/period_end_date logic when both set).
    For non-ACTIVE players:
      - trust_return_dates=True: counts games on/after expected return date.
        If no return date, assumes ruled out (0 games).
      - trust_return_dates=False: any non-ACTIVE player is held out for the full period (0 games).
    """
    eastern = ZoneInfo("America/New_York")
    today = datetime.now(eastern).date()
    if window_start is not None and window_end is not None:
        start_d, end_d = window_start, window_end
    elif period_end_date is not None:
        start_d, end_d = today, period_end_date
    else:
        end_d = today + timedelta(days=(6 - today.weekday()) + (week_span - 1) * 7)
        start_d = today
    team_abbrev = getattr(player, "proTeam", None)
    if pd.isna(team_abbrev):
        return 0
    sched = get_team_schedule(team_abbrev)
    period_games = [g for g in sched if start_d <= g <= end_d]
    if not period_games:
        return 0
    injury_status = getattr(player, "injuryStatus", None) or ""
    status_upper = str(injury_status).upper().strip()
    if status_upper in ACTIVE_STATUSES:
        return len(period_games)
    if not trust_return_dates:
        return 0
    expected_return = _parse_expected_return_date(player)
    if expected_return is None and injury_data:
        inj_info = injury_data.get(player.name, {})
        if isinstance(inj_info, dict):
            expected_return = inj_info.get("return_date_obj")
    if expected_return is None:
        return 0
    return sum(1 for g in period_games if g >= expected_return)


def get_week_date_range(week, year):
    """
    Map fantasy matchup period to (start_date, end_date).
    NBA season typically starts ~Oct 21. Week 1 = Oct 21-27, Week 2 = Oct 28-Nov 3, etc.
    """
    season_year = year - 1 if year >= 2020 else year
    try:
        start = date(season_year, 10, 21) + timedelta(days=(week - 1) * 7)
        end = start + timedelta(days=6)
        return start, end
    except (ValueError, TypeError):
        return None, None


def get_game_count_window(year, view_week, league_current_week, period_end_date=None, week_span=1):
    """
    Inclusive NBA game-count window for the selected matchup view.

    - If view_week == league_current_week (ESPN's live period): from **today**
      through playoff period end or through the end of the current matchup span.
    - Otherwise (another week, past or future): full Mon–Sun span from
      get_week_date_range(view_week, year) so you can preview a week ahead.
    """
    eastern = ZoneInfo("America/New_York")
    today = datetime.now(eastern).date()
    if view_week != league_current_week:
        start_d, end_d = get_week_date_range(view_week, year)
        if start_d is not None and end_d is not None:
            return start_d, end_d
        return today, today
    if period_end_date is not None:
        return today, period_end_date
    end = today + timedelta(days=(6 - today.weekday()) + (week_span - 1) * 7)
    return today, end


def count_games_for_player_in_week(player, week, year, injury_data=None, trust_return_dates=True):
    """
    Count games for a player in a specific fantasy week, accounting for injury return date.
    For non-ACTIVE players:
      - trust_return_dates=True: only counts games on/after expected return. No return date = 0.
      - trust_return_dates=False: held out for the full week (0 games).
    """
    start_d, end_d = get_week_date_range(week, year)
    if start_d is None:
        return 0
    team_abbrev = getattr(player, "proTeam", None)
    if pd.isna(team_abbrev):
        return 0
    sched = get_team_schedule(team_abbrev)
    week_games = [g for g in sched if start_d <= g <= end_d]
    if not week_games:
        return 0
    injury_status = getattr(player, "injuryStatus", None) or ""
    status_upper = str(injury_status).upper().strip()
    if status_upper in ACTIVE_STATUSES:
        return len(week_games)
    if not trust_return_dates:
        return 0
    expected_return = _parse_expected_return_date(player)
    if expected_return is None and injury_data:
        inj_info = injury_data.get(player.name, {})
        if isinstance(inj_info, dict):
            expected_return = inj_info.get("return_date_obj")
    if expected_return is None:
        return 0
    return sum(1 for g in week_games if g >= expected_return)


def _get_games_by_day_for_week(roster, week, year, injury_data=None, trust_return_dates=True):
    """
    Get which players have games on each day in a specific week (injury-aware).
    Returns dict: date -> list of (player_name, team_abbrev).
    """
    start_d, end_d = get_week_date_range(week, year)
    if start_d is None:
        return {}
    games_by_day = defaultdict(list)
    for p in roster:
        team_abbrev = getattr(p, "proTeam", None)
        if pd.isna(team_abbrev):
            continue
        sched = get_team_schedule(team_abbrev)
        week_games = [g for g in sched if start_d <= g <= end_d]
        if not week_games:
            continue
        injury_status = getattr(p, "injuryStatus", None) or ""
        status_upper = str(injury_status).upper().strip()
        if status_upper not in ACTIVE_STATUSES:
            if not trust_return_dates:
                continue
            expected_return = _parse_expected_return_date(p)
            if expected_return is None and injury_data:
                inj_info = injury_data.get(p.name, {})
                if isinstance(inj_info, dict):
                    expected_return = inj_info.get("return_date_obj")
            if expected_return is None:
                continue
            week_games = [g for g in week_games if g >= expected_return]
        for d in week_games:
            games_by_day[d].append((p.name, team_abbrev))
    return dict(games_by_day)


def _pts_rank_scores_from_df(df):
    """Per-player PTS from stats df (higher = prioritized when trimming roster or busy days)."""
    if df is None or df.empty or "Player" not in df.columns:
        return {}
    if "PTS" not in df.columns:
        return {}
    out = {}
    for _, row in df.iterrows():
        name = row["Player"]
        v = row["PTS"]
        out[name] = float(v) if pd.notna(v) else 0.0
    return out


def _roster_for_projection_caps(roster, rank_scores, max_roster_size):
    """
    If roster exceeds max_roster_size, keep the top players by rank_scores (PTS), tie-break by name.
    Returns (trimmed_roster, kept_player_names).
    """
    if max_roster_size is None or len(roster) <= max_roster_size:
        trimmed = list(roster)
        return trimmed, {p.name for p in trimmed}
    sorted_p = sorted(
        roster,
        key=lambda p: (-float(rank_scores.get(p.name, 0.0)), p.name),
    )
    trimmed = sorted_p[:max_roster_size]
    return trimmed, {p.name for p in trimmed}


def _accumulate_counted_games_by_day(games_by_day, rank_scores, max_per_day):
    """
    Each calendar day, at most max_per_day rostered players get a counted NBA game.
    When more than max_per_day have a game, keep the top max_per_day by PTS (rank_scores).
    """
    player_effective = defaultdict(float)
    cap = max_per_day if max_per_day is not None else MAX_PLAYERS_PER_DAY
    for _, players_on_day in games_by_day.items():
        names = [pname for pname, _ in players_on_day]
        n = len(names)
        if n == 0:
            continue
        if n <= cap:
            chosen = names
        else:
            chosen = sorted(
                names,
                key=lambda pname: (-float(rank_scores.get(pname, 0.0)), pname),
            )[:cap]
        for pname in chosen:
            player_effective[pname] += 1.0
    return player_effective


def add_games_in_week(df, roster, week, year, injury_data=None, max_per_day=None, trust_return_dates=True,
                      max_roster_size=None):
    """
    Add 'Games This Week' column for a specific fantasy week (injury-aware).
    Used for projected roster strength in playoff simulation.
    At most max_roster_size players contribute (default 13); lower projections are dropped.
    When more than max_per_day players have an NBA game the same day, only the top max_per_day
    by PTS get a counted game for that day (default max_per_day from config).
    trust_return_dates: if False, non-ACTIVE players are treated as out the full week.
    """
    df = df.copy()
    cap = max_per_day if max_per_day is not None else MAX_PLAYERS_PER_DAY
    rank_scores = _pts_rank_scores_from_df(df)
    cap_roster = max_roster_size if max_roster_size is not None else MAX_ROSTER_SIZE
    roster_eff, kept_names = _roster_for_projection_caps(roster, rank_scores, cap_roster)
    games_by_day = _get_games_by_day_for_week(roster_eff, week, year, injury_data, trust_return_dates)
    player_effective = _accumulate_counted_games_by_day(games_by_day, rank_scores, cap)
    name_to_player = {p.name: p for p in roster}

    def games_for_row(row):
        player = name_to_player.get(row["Player"])
        if player is None:
            team_abbrev = row.get("NBA_Team")
            if pd.isna(team_abbrev):
                return 0
            start_d, end_d = get_week_date_range(week, year)
            if start_d is None:
                return 0
            sched = get_team_schedule(team_abbrev)
            return sum(1 for g in sched if start_d <= g <= end_d)
        if row["Player"] not in kept_names:
            return 0
        eff = player_effective.get(row["Player"], 0.0)
        return max(0, int(round(eff))) if eff > 0 else 0

    df["Games This Week"] = df.apply(games_for_row, axis=1)
    return df


def filter_injured(roster):
    """Legacy: filter to healthy-only. Prefer add_games_left_with_injury for injury-aware logic."""
    return [p for p in roster if p.injuryStatus not in INJURED_STATUSES]


def get_ir_players_returning_this_week(roster, injury_data=None):
    """
    Return list of injured players (on IR or out) with expected return this week.
    When these players get healthy, a roster spot is needed - a drop will be required
    if roster is at max (13 active + IR).
    Returns: list of dicts with Player, NBA_Team, expected_return.
    """
    eastern = ZoneInfo("America/New_York")
    today = datetime.now(eastern).date()
    end_of_week = today + timedelta(days=(6 - today.weekday()))
    result = []
    for p in roster:
        status = getattr(p, "injuryStatus", None) or ""
        if str(status).upper().strip() in ACTIVE_STATUSES:
            continue
        expected_return = _parse_expected_return_date(p)
        if expected_return is None and injury_data:
            inj_info = injury_data.get(p.name, {})
            if isinstance(inj_info, dict):
                expected_return = inj_info.get("return_date_obj")
        if expected_return is None:
            continue
        if today <= expected_return <= end_of_week:
            result.append({
                "Player": p.name,
                "NBA_Team": getattr(p, "proTeam", ""),
                "expected_return": expected_return,
            })
    return result


def is_player_injured(player):
    """Check if a player object is injured."""
    raw = getattr(player, "injuryStatus", "")
    if isinstance(raw, (list, tuple, set)):
        for x in raw:
            if str(x).upper().strip() in INJURED_STATUSES:
                return True
        return False
    return str(raw).upper().strip() in INJURED_STATUSES


def player_stashed_on_ir(player):
    """
    True if the player is on an IR slot (ESPN). IR players cannot score until moved
    to an active roster spot (often requires a drop), so streaming math should not
    count their NBA games while stashed.
    """
    raw = getattr(player, "injuryStatus", None) or ""
    if isinstance(raw, (list, tuple, set)):
        uppers = {str(x).upper().strip() for x in raw if x is not None}
        if "INJURY_RESERVE" in uppers:
            return True
    elif str(raw).upper().strip() == "INJURY_RESERVE":
        return True
    for attr in ("lineupSlot", "lineup_slot", "slot_position"):
        v = getattr(player, attr, None)
        if isinstance(v, str) and "IR" in v.upper().replace(" ", ""):
            return True
    return False


def _player_considered_active_for_schedule(player):
    """Match ACTIVE_STATUSES; supports list/tuple injuryStatus from API."""
    raw = getattr(player, "injuryStatus", None) or ""
    if isinstance(raw, (list, tuple, set)):
        tokens = {str(x).upper().strip() for x in raw if x is not None and str(x).strip()}
        if not tokens:
            return True
        return tokens <= ACTIVE_STATUSES
    return str(raw).upper().strip() in ACTIVE_STATUSES


def filter_schedule_for_roster_player_injury(
    player,
    sched,
    labels,
    injury_data=None,
    trust_return_dates=True,
):
    """
    Restrict NBA game dates to when the player can realistically count for your team.

    - IR-stashed: no games (activation + possible drop is not modeled).
    - Active / DTD / empty status: full schedule in the window.
    - Other statuses: if trust_return_dates, only games on/after expected return
      (player + injury_data); if no return date, no games. If trust_return_dates is
      False, no games for the window.

    sched: set of datetime.date; labels: dict date -> opponent label.
    """
    injury_data = injury_data or {}
    if not sched:
        return set(), {}
    if player_stashed_on_ir(player):
        return set(), {}
    if _player_considered_active_for_schedule(player):
        return set(sched), {d: labels[d] for d in sched if d in labels}
    if not trust_return_dates:
        return set(), {}
    expected_return = _parse_expected_return_date(player)
    if expected_return is None:
        inj_info = injury_data.get(player.name, {})
        if isinstance(inj_info, dict):
            expected_return = inj_info.get("return_date_obj")
    if expected_return is None:
        return set(), {}
    sched_f = {d for d in sched if d >= expected_return}
    lbl_f = {d: labels[d] for d in sched_f if d in labels}
    return sched_f, lbl_f


# -----------------------------------------------------------------------------
# ESPN data
# -----------------------------------------------------------------------------

def connect_to_espn(league_id, year, espn_s2, swid):
    """Connect to ESPN Fantasy Basketball API - always fetches fresh data."""
    from espn_api.basketball import League
    league = League(
        league_id=league_id,
        year=year,
        espn_s2=espn_s2,
        swid=swid
    )
    return league


def get_matchup_info(league, team_id, matchup_period=None):
    """
    Matchup and opponent for a fantasy scoring period.
    matchup_period: ESPN matchup week number, or None for league.currentMatchupPeriod.
    """
    period = matchup_period if matchup_period is not None else league.currentMatchupPeriod
    boxscores = league.box_scores(matchup_period=period)
    your_team_obj = next(t for t in league.teams if t.team_id == team_id)
    matchup = next(
        m for m in boxscores
        if team_id in [m.home_team.team_id, m.away_team.team_id]
    )
    opp_team_obj = (
        matchup.away_team if matchup.home_team.team_id == team_id
        else matchup.home_team
    )
    return your_team_obj, opp_team_obj, matchup, period


def get_current_totals(matchup, team_id):
    """Get current week live totals for both teams."""
    home_stats = flatten_stat_dict(matchup.home_stats)
    away_stats = flatten_stat_dict(matchup.away_stats)
    if matchup.home_team.team_id == team_id:
        your_stats, opp_stats = home_stats, away_stats
    else:
        your_stats, opp_stats = away_stats, home_stats

    def build_totals(stats):
        return {
            "FGM": stats.get("FGM", 0),
            "FGA": stats.get("FGA", 0),
            "FTM": stats.get("FTM", 0),
            "FTA": stats.get("FTA", 0),
            "3PM": stats.get("3PM", 0),
            "3PA": stats.get("3PA", 0),
            "REB": stats.get("REB", 0),
            "AST": stats.get("AST", 0),
            "STL": stats.get("STL", 0),
            "BLK": stats.get("BLK", 0),
            "TO": stats.get("TO", 0),
            "PTS": stats.get("PTS", 0),
            "DD": stats.get("DD", 0),
            "TW": stats.get("TW", 0),
        }
    return build_totals(your_stats), build_totals(opp_stats)


def build_stat_df(roster, period_key, label, fantasy_team_name, year):
    """Build per-game stats dataframe from ESPN roster data."""
    rows = []
    for p in roster:
        period = p.stats.get(period_key, {}) or {}
        avg_block = period.get("avg", {}) or {}
        total_block = period.get("total", {}) or {}
        gp = safe_num(total_block.get("GP", avg_block.get("GP", 0)))
        if gp <= 0:
            continue
        if avg_block:
            per_game = {k: safe_num(v) for k, v in avg_block.items()}
        else:
            per_game = {k: (safe_num(v) / gp) for k, v in total_block.items() if k != "GP"}
        fgm = per_game.get("FGM", 0)
        fga = per_game.get("FGA", 0)
        ftm = per_game.get("FTM", 0)
        fta = per_game.get("FTA", 0)
        tpm = per_game.get("3PM", 0)
        tpa = per_game.get("3PA", 0)
        rows.append({
            "Player": p.name,
            "NBA_Team": p.proTeam,
            "Team": fantasy_team_name,
            "FGM": fgm, "FGA": fga,
            "FG%": fgm / fga if fga > 0 else 0,
            "FTM": ftm, "FTA": fta,
            "FT%": ftm / fta if fta > 0 else 0,
            "3PM": tpm, "3PA": tpa,
            "3P%": tpm / tpa if tpa > 0 else 0,
            "REB": per_game.get("REB", 0),
            "AST": per_game.get("AST", 0),
            "STL": per_game.get("STL", 0),
            "BLK": per_game.get("BLK", 0),
            "TO": per_game.get("TO", 0),
            "PTS": per_game.get("PTS", 0),
            "DD": safe_num(total_block.get("DD", 0)) / gp,
            "TW": safe_num(total_block.get("TW", 0)) / gp,
        })
    return pd.DataFrame(rows)


def blend_season_last30(season_df, last30_df, blend_weight, merge_on=None):
    """
    Left-merge last-30 stats onto season. If a player has no last-30 row (e.g. zero
    games in that window on ESPN), use season per-game numbers only instead of
    treating missing last-30 as zeros in the blend.
    """
    merge_on = merge_on or ["Player", "NBA_Team"]
    if season_df.empty:
        return season_df.copy()
    if last30_df.empty:
        out = season_df.copy()
        for col in NUMERIC_COLS:
            if col not in out.columns:
                out[col] = 0.0
        return out
    merged = season_df.merge(
        last30_df, on=merge_on, how="left", suffixes=("_season", "_30")
    )
    has_last30 = merged["PTS_30"].notna()
    for col in NUMERIC_COLS:
        c_sea = f"{col}_season"
        c30 = f"{col}_30"
        sea = merged[c_sea].fillna(0) if c_sea in merged.columns else 0
        t30 = merged[c30].fillna(0) if c30 in merged.columns else 0
        blended = t30 * blend_weight + sea * (1 - blend_weight)
        merged[col] = blended.where(has_last30, sea)
    for base in ("Team", "Games Left"):
        sb = f"{base}_season"
        st = f"{base}_30"
        if sb in merged.columns and st in merged.columns:
            merged[base] = merged[st].combine_first(merged[sb])
        elif sb in merged.columns:
            merged[base] = merged[sb]
        elif st in merged.columns:
            merged[base] = merged[st]
    drop_cols = [
        c for c in merged.columns
        if c.endswith("_season") or c.endswith("_30")
    ]
    return merged.drop(columns=drop_cols, errors="ignore")


# -----------------------------------------------------------------------------
# Games left / schedule
# -----------------------------------------------------------------------------

@st.cache_data(ttl=3600)
def get_team_schedule_bundle(team_abbrev):
    """
    One ESPN HTTP request per team: game dates and opponent labels (cached 1hr).
    Returns (list[date], dict[date, opponent_label]).
    """
    if pd.isna(team_abbrev):
        return [], {}
    team_abbrev = normalize_team(team_abbrev)
    if not team_abbrev or team_abbrev not in NBA_TEAM_MAP:
        return [], {}
    slug = NBA_TEAM_MAP[team_abbrev]
    url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{slug}/schedule"
    try:
        r = requests.get(url, timeout=10)
        if r.status_code != 200:
            return [], {}
        eastern = ZoneInfo("America/New_York")
        dates = []
        labels = {}
        for event in r.json().get("events", []):
            try:
                utc_dt = datetime.fromisoformat(
                    event["date"].replace("Z", "+00:00")
                ).astimezone(eastern)
                d = utc_dt.date()
                dates.append(d)
            except Exception:
                continue
            try:
                comp = (event.get("competitions") or [{}])[0]
                competitors = comp.get("competitors") or []
                if len(competitors) < 2:
                    continue
                my_side = None
                opp_abbr = None
                for c in competitors:
                    t = c.get("team") or {}
                    ab = normalize_team(t.get("abbreviation"))
                    if not ab:
                        continue
                    if ab == team_abbrev:
                        my_side = c.get("homeAway")
                    else:
                        opp_abbr = t.get("abbreviation") or ab
                if my_side is None or not opp_abbr:
                    continue
                if my_side == "away":
                    labels[d] = f"@{str(opp_abbr).strip()}"
                else:
                    labels[d] = str(opp_abbr).strip()
            except Exception:
                continue
        return dates, labels
    except Exception:
        return [], {}


def get_team_schedule(team_abbrev):
    """Get NBA team schedule from ESPN API (cached 1hr)."""
    dates, _ = get_team_schedule_bundle(team_abbrev)
    return dates


def get_team_schedule_game_labels(team_abbrev):
    """
    Map each game date to a short opponent label: home opponent abbrev, or @OPP when away.
    Same cached HTTP request as get_team_schedule.
    """
    _, labels = get_team_schedule_bundle(team_abbrev)
    return labels if isinstance(labels, dict) else {}


def prefetch_team_schedules_for_rosters(*rosters, max_workers=12):
    """
    Parallel warm-up of schedule cache for every distinct NBA team on the given ESPN rosters.
    Cuts cold-load latency when many teams are fetched right after (e.g. matchup + streamers).
    """
    from concurrent.futures import ThreadPoolExecutor

    seen = set()
    abbrevs = []
    for roster in rosters:
        for p in roster or []:
            t = getattr(p, "proTeam", None)
            if pd.isna(t):
                continue
            t = normalize_team(t)
            if t and t in NBA_TEAM_MAP and t not in seen:
                seen.add(t)
                abbrevs.append(t)
    if not abbrevs:
        return
    nw = max(1, min(max_workers, len(abbrevs)))

    def _warm(ab):
        get_team_schedule_bundle(ab)

    with ThreadPoolExecutor(max_workers=nw) as ex:
        ex.map(_warm, abbrevs)


def count_games_left(team_abbrev, week_span=1, period_end_date=None, window_start=None, window_end=None):
    """Count games in the matchup window (no injury consideration).
    If window_start and window_end are set, they define the inclusive date range.
    Otherwise legacy: today through period_end_date or end of week_span.
    """
    eastern = ZoneInfo("America/New_York")
    today = datetime.now(eastern).date()
    if window_start is not None and window_end is not None:
        start_d, end_d = window_start, window_end
    elif period_end_date is not None:
        start_d, end_d = today, period_end_date
    else:
        end_d = today + timedelta(days=(6 - today.weekday()) + (week_span - 1) * 7)
        start_d = today
    sched = get_team_schedule(team_abbrev)
    return sum(start_d <= g <= end_d for g in sched)


def _get_games_by_day_for_roster(roster, injury_data=None, trust_return_dates=True, week_span=1, period_end_date=None,
                                 window_start=None, window_end=None):
    """
    Get which players have games on each day in the matchup period (injury-aware).
    window_start/window_end: inclusive range when both set; else today through period end / week span.
    Returns dict: date -> list of (player_name, team_abbrev).
    """
    eastern = ZoneInfo("America/New_York")
    today = datetime.now(eastern).date()
    if window_start is not None and window_end is not None:
        start_d, end_d = window_start, window_end
    elif period_end_date is not None:
        start_d, end_d = today, period_end_date
    else:
        end_d = today + timedelta(days=(6 - today.weekday()) + (week_span - 1) * 7)
        start_d = today
    games_by_day = defaultdict(list)
    for p in roster:
        team_abbrev = getattr(p, "proTeam", None)
        if pd.isna(team_abbrev):
            continue
        sched = get_team_schedule(team_abbrev)
        period_games = [g for g in sched if start_d <= g <= end_d]
        if not period_games:
            continue
        injury_status = getattr(p, "injuryStatus", None) or ""
        status_upper = str(injury_status).upper().strip()
        if status_upper not in ACTIVE_STATUSES:
            if not trust_return_dates:
                continue
            expected_return = _parse_expected_return_date(p)
            if expected_return is None and injury_data:
                inj_info = injury_data.get(p.name, {})
                if isinstance(inj_info, dict):
                    expected_return = inj_info.get("return_date_obj")
            if expected_return is None:
                continue
            period_games = [g for g in period_games if g >= expected_return]
        for d in period_games:
            games_by_day[d].append((p.name, team_abbrev))
    return dict(games_by_day)


def add_games_left(df, week_span=1, period_end_date=None, window_start=None, window_end=None):
    """Add Games Left column to dataframe (team-based, no injury)."""
    df = df.copy()
    df["Games Left"] = df["NBA_Team"].apply(
        lambda t: count_games_left(t, week_span, period_end_date, window_start, window_end)
    )
    return df


def add_games_left_with_injury(df, roster, injury_data=None, max_per_day=None,
                               trust_return_dates=True, week_span=1, period_end_date=None,
                               window_start=None, window_end=None, max_roster_size=None):
    """
    Add Games Left column using ESPN estimated return dates.
    Non-ACTIVE players with return date: count only games on/after that date.
    Non-ACTIVE players without return date: 0 games (ruled out for period).
    injury_data from get_espn_injury_data() provides return dates when fantasy API doesn't.
    window_start/window_end: inclusive NBA schedule window (e.g. full week when previewing ahead).

    At most max_roster_size players contribute (default 13); others get 0 counted games.
    When more than max_per_day players have an NBA game the same day, only the top max_per_day
    by PTS get a counted game that day (default max_per_day from config).
    trust_return_dates: if False, any non-ACTIVE player is treated as out the full period.
    """
    df = df.copy()
    cap = max_per_day if max_per_day is not None else MAX_PLAYERS_PER_DAY
    rank_scores = _pts_rank_scores_from_df(df)
    cap_roster = max_roster_size if max_roster_size is not None else MAX_ROSTER_SIZE
    roster_eff, kept_names = _roster_for_projection_caps(roster, rank_scores, cap_roster)
    games_by_day = _get_games_by_day_for_roster(
        roster_eff, injury_data, trust_return_dates, week_span, period_end_date,
        window_start=window_start, window_end=window_end,
    )
    player_effective = _accumulate_counted_games_by_day(games_by_day, rank_scores, cap)
    name_to_player = {p.name: p for p in roster}

    def games_for_row(row):
        pname = row["Player"]
        if pname not in kept_names:
            return 0
        player = name_to_player.get(pname)
        if player is None:
            return count_games_left(
                row["NBA_Team"], week_span, period_end_date, window_start, window_end,
            )
        eff = player_effective.get(pname, 0.0)
        return max(0, int(round(eff))) if eff > 0 else 0

    df["Games Left"] = df.apply(games_for_row, axis=1)
    return df


@st.cache_data(ttl=3600)
def get_espn_injury_data():
    """Fetch NBA injuries from ESPN public API. Returns dict: player_name -> {description, return_date}."""
    url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
    try:
        r = requests.get(url, timeout=15)
        if r.status_code != 200:
            return {}
        data = r.json()
        result = {}
        for team in data.get("injuries", []):
            for inj in team.get("injuries", []):
                athlete = inj.get("athlete", {})
                display_name = athlete.get("displayName") or f"{athlete.get('firstName', '')} {athlete.get('lastName', '')}".strip()
                short_name = athlete.get("shortName", "")
                if not display_name:
                    continue
                details = inj.get("details", {}) or {}
                return_date_raw = details.get("returnDate")
                return_date = ""
                return_date_obj = None
                try:
                    if return_date_raw:
                        d = date.fromisoformat(return_date_raw[:10])
                        return_date = d.strftime("%m/%d/%Y")
                        return_date_obj = d
                except (ValueError, TypeError):
                    pass
                inj_entry = {
                    "description": inj.get("shortComment", ""),
                    "return_date": return_date or "",
                    "return_date_obj": return_date_obj,
                }
                result[display_name] = inj_entry
                if short_name and short_name != display_name:
                    result[short_name] = inj_entry
        return result
    except Exception:
        return {}


def build_injury_table(roster_list, injury_data):
    """
    Build injury table for roster players who are NOT active.
    roster_list: list of (roster, team_name) tuples
    injury_data: dict from get_espn_injury_data() - player_name -> {description, return_date}
    Returns list of dicts: Player, Team, Injury, Expected Return, Description
    """
    rows = []
    for roster, team_name in roster_list:
        for p in roster:
            status = getattr(p, "injuryStatus", None) or ""
            status_upper = str(status).upper().strip()
            if status_upper in ACTIVE_STATUSES:
                continue
            inj_info = injury_data.get(p.name, {})
            if isinstance(inj_info, str):
                inj_info = {"description": inj_info, "return_date": ""}
            expected = _parse_expected_return_date(p)
            expected_str = expected.strftime("%m/%d/%Y") if expected else inj_info.get("return_date", "") or "—"
            desc = inj_info.get("description", "") or "—"
            status_display = STATUS_DISPLAY.get(status_upper, status) if status else "—"
            rows.append({
                "Player": p.name,
                "Team": team_name,
                "Injury": status_display,
                "Expected Return": expected_str,
                "Description": desc,
            })
    return rows
