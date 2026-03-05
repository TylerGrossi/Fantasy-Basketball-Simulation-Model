"""
Fantasy Basketball Simulator - Data loading, ESPN API, and schedule utilities.
"""

import pandas as pd
import requests
import streamlit as st
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo

from config import (
    INJURED_STATUSES,
    NUMERIC_COLS,
    STATUS_DISPLAY,
    TEAM_FIXES,
    NBA_TEAM_MAP,
)

ACTIVE_STATUSES = {"ACTIVE", ""}


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


def count_games_left_for_player(player, injury_data=None):
    """
    Count games remaining this week where player is available.
    For non-ACTIVE players: uses expected return date (from player or injury_data) to count only
    games on or after that date. If no return date, assumes ruled out for the week (0 games).
    """
    eastern = ZoneInfo("America/New_York")
    today = datetime.now(eastern).date()
    end_of_week = today + timedelta(days=(6 - today.weekday()))
    team_abbrev = getattr(player, "proTeam", None)
    if pd.isna(team_abbrev):
        return 0
    sched = get_team_schedule(team_abbrev)
    week_games = [g for g in sched if today <= g <= end_of_week]
    if not week_games:
        return 0
    injury_status = getattr(player, "injuryStatus", None) or ""
    status_upper = str(injury_status).upper().strip()
    if status_upper in ACTIVE_STATUSES:
        return len(week_games)
    expected_return = _parse_expected_return_date(player)
    if expected_return is None and injury_data:
        inj_info = injury_data.get(player.name, {})
        if isinstance(inj_info, dict):
            expected_return = inj_info.get("return_date_obj")
    if expected_return is None:
        return 0
    return sum(1 for g in week_games if g >= expected_return)


def filter_injured(roster):
    """Legacy: filter to healthy-only. Prefer add_games_left_with_injury for injury-aware logic."""
    return [p for p in roster if p.injuryStatus not in INJURED_STATUSES]


def is_player_injured(player):
    """Check if a player object is injured."""
    return player.injuryStatus in INJURED_STATUSES


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


def get_matchup_info(league, team_id):
    """Auto-detect current matchup and opponent."""
    current_week = league.currentMatchupPeriod
    boxscores = league.box_scores(matchup_period=current_week)
    your_team_obj = next(t for t in league.teams if t.team_id == team_id)
    matchup = next(
        m for m in boxscores
        if team_id in [m.home_team.team_id, m.away_team.team_id]
    )
    opp_team_obj = (
        matchup.away_team if matchup.home_team.team_id == team_id
        else matchup.home_team
    )
    return your_team_obj, opp_team_obj, matchup, current_week


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


# -----------------------------------------------------------------------------
# Games left / schedule
# -----------------------------------------------------------------------------

@st.cache_data(ttl=3600)
def get_team_schedule(team_abbrev):
    """Get NBA team schedule from ESPN API (cached 1hr)."""
    if pd.isna(team_abbrev):
        return []
    team_abbrev = normalize_team(team_abbrev)
    if team_abbrev not in NBA_TEAM_MAP:
        return []
    slug = NBA_TEAM_MAP[team_abbrev]
    url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{slug}/schedule"
    try:
        r = requests.get(url, timeout=10)
        if r.status_code != 200:
            return []
        eastern = ZoneInfo("America/New_York")
        dates = []
        for event in r.json().get("events", []):
            try:
                utc_dt = datetime.fromisoformat(
                    event["date"].replace("Z", "+00:00")
                ).astimezone(eastern)
                dates.append(utc_dt.date())
            except Exception:
                pass
        return dates
    except Exception:
        return []


def count_games_left(team_abbrev):
    """Count games remaining this week (for a team, no injury consideration)."""
    eastern = ZoneInfo("America/New_York")
    today = datetime.now(eastern).date()
    end_of_week = today + timedelta(days=(6 - today.weekday()))
    sched = get_team_schedule(team_abbrev)
    return sum(today <= g <= end_of_week for g in sched)


def add_games_left(df):
    """Add Games Left column to dataframe (team-based, no injury)."""
    df = df.copy()
    df["Games Left"] = df["NBA_Team"].apply(count_games_left)
    return df


def add_games_left_with_injury(df, roster, injury_data=None):
    """
    Add Games Left column using ESPN estimated return dates.
    Non-ACTIVE players with return date: count only games on/after that date.
    Non-ACTIVE players without return date: 0 games (ruled out for week).
    injury_data from get_espn_injury_data() provides return dates when fantasy API doesn't.
    """
    df = df.copy()
    name_to_player = {p.name: p for p in roster}
    def games_for_row(row):
        player = name_to_player.get(row["Player"])
        if player is None:
            return count_games_left(row["NBA_Team"])
        return count_games_left_for_player(player, injury_data)
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
