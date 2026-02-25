"""
Fantasy Basketball Simulator - Data loading, ESPN API, and schedule utilities.
"""

import pandas as pd
import requests
import streamlit as st
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from config import (
    INJURED_STATUSES,
    NUMERIC_COLS,
    TEAM_FIXES,
    NBA_TEAM_MAP,
)


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


def filter_injured(roster):
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


@st.cache_data(ttl=3600)
def get_team_win_pcts_espn():
    """
    Get each NBA team's win percentage from ESPN (no nba_api needed).
    Returns dict {abbrev: win_pct}, e.g. {"OKC": 0.759, "BOS": 0.661}.
    Used as fallback for TW when nba_api is unavailable.
    """
    out = {}
    for abbrev, slug in NBA_TEAM_MAP.items():
        try:
            r = requests.get(
                f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{slug}",
                timeout=10,
            )
            if r.status_code != 200:
                continue
            d = r.json()
            team = d.get("team") or d
            record = team.get("record") or {}
            items = record.get("items") or []
            for item in items:
                if item.get("type") == "total":
                    for s in item.get("stats") or []:
                        if s.get("name") == "winPercent":
                            out[abbrev] = float(s["value"])
                            break
                    break
        except Exception:
            pass
    return out


def count_games_left(team_abbrev):
    """Count games remaining this week."""
    eastern = ZoneInfo("America/New_York")
    today = datetime.now(eastern).date()
    end_of_week = today + timedelta(days=(6 - today.weekday()))
    sched = get_team_schedule(team_abbrev)
    return sum(today <= g <= end_of_week for g in sched)


def add_games_left(df):
    """Add Games Left column to dataframe."""
    df = df.copy()
    df["Games Left"] = df["NBA_Team"].apply(count_games_left)
    return df
