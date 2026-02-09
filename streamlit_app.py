"""
🏀 Fantasy Basketball Win Percentage Simulation - Streamlit App
================================================================
A web-based Monte Carlo simulation tool for ESPN Fantasy Basketball
"""

import streamlit as st
import pandas as pd
import numpy as np
import random
import requests
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# Must be the first Streamlit command
st.set_page_config(
    page_title="Fantasy Basketball Simulator",
    page_icon="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%23FF6B35' stroke='%23000' stroke-width='2'/><path d='M50 5 Q50 50 50 95' stroke='%23000' stroke-width='2' fill='none'/><path d='M5 50 Q50 50 95 50' stroke='%23000' stroke-width='2' fill='none'/><path d='M15 20 Q50 35 85 20' stroke='%23000' stroke-width='2' fill='none'/><path d='M15 80 Q50 65 85 80' stroke='%23000' stroke-width='2' fill='none'/></svg>",
    layout="wide",
    initial_sidebar_state="expanded"
)

# =============================================================================
# CONSTANTS
# =============================================================================

CATEGORY_VARIANCE = {
    "FGM": 0.7, "FGA": 0.7,
    "FTM": 0.2, "FTA": 0.2,
    "3PM": 0.7, "3PA": 0.7,
    "REB": 0.4, "AST": 0.4,
    "STL": 0.8, "BLK": 0.8,
    "TO": 0.5, "PTS": 0.7,
    "DD": 0.7, "TW": 0.7
}

CATEGORIES = ["FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%",
              "REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW"]

NUMERIC_COLS = ['FGM', 'FGA', 'FG%', 'FTM', 'FTA', 'FT%', '3PM', '3PA', '3P%',
                'REB', 'AST', 'STL', 'BLK', 'TO', 'DD', 'PTS', 'TW']

INJURED_STATUSES = {"OUT", "INJURY_RESERVE", "SSPD"}

# Display abbreviations for availability statuses in streamer table
STATUS_DISPLAY = {
    "DAY_TO_DAY": "DTD", "DTD": "DTD",
    "QUESTIONABLE": "Q", "Q": "Q",
    "PROBABLE": "P", "P": "P",
    "DOUBTFUL": "D", "D": "D",
}

NBA_TEAM_MAP = {
    "ATL": "atl", "BOS": "bos", "BKN": "bkn", "CHA": "cha", "CHI": "chi",
    "CLE": "cle", "DAL": "dal", "DEN": "den", "DET": "det", "GSW": "gs",
    "HOU": "hou", "IND": "ind", "LAC": "lac", "LAL": "la", "MEM": "mem",
    "MIA": "mia", "MIL": "mil", "MIN": "min", "NOP": "no", "NYK": "ny",
    "OKC": "okc", "ORL": "orl", "PHI": "phi", "PHX": "pho", "POR": "por",
    "SAC": "sac", "SAS": "sa", "TOR": "tor", "UTA": "utah", "WAS": "wsh"
}

TEAM_FIXES = {"PHL": "PHI", "PHO": "PHX", "GS": "GSW", "WSH": "WAS", 
              "NO": "NOP", "SA": "SAS", "NY": "NYK"}

# =============================================================================
# CUSTOM CSS
# =============================================================================

st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Roboto+Condensed:wght@300;400;700&display=swap');
    @import url('https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css');
    
    /* Hide anchor link icons */
    .stMarkdown a[href^="#"]::after,
    h1 a, h2 a, h3 a, h4 a, h5 a, h6 a,
    [data-testid="stHeaderActionElements"],
    .stMarkdown h1 a, .stMarkdown h2 a, .stMarkdown h3 a {
        display: none !important;
        visibility: hidden !important;
    }
    
    a.anchor-link {
        display: none !important;
    }
    
    :root {
        --primary: #FF6B35;
        --secondary: #1A1A2E;
        --accent: #00D4FF;
        --success: #00FF88;
        --danger: #FF4757;
        --bg-dark: #0F0F1A;
        --card-bg: #1A1A2E;
    }
    
    .stApp {
        background: linear-gradient(135deg, #0F0F1A 0%, #1A1A2E 50%, #0F0F1A 100%);
    }
    
    h1, h2, h3 {
        font-family: 'Oswald', sans-serif !important;
        text-transform: uppercase;
        letter-spacing: 2px;
    }
    
    .main-header {
        background: linear-gradient(90deg, #FF6B35, #FF8C42, #FFD93D);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        font-size: 3.5rem !important;
        font-weight: 700;
        text-align: center;
        padding: 1rem 0;
        margin-bottom: 1rem;
    }
    
    .stat-card {
        background: linear-gradient(145deg, #1A1A2E, #252545);
        border-radius: 16px;
        padding: 1.5rem;
        border: 1px solid rgba(255, 107, 53, 0.3);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .stat-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 12px 40px rgba(255, 107, 53, 0.2);
    }
    
    .win-pct {
        font-family: 'Oswald', sans-serif;
        font-size: 4rem;
        font-weight: 700;
        text-align: center;
    }
    
    .win-pct.winning {
        color: #00FF88;
        text-shadow: 0 0 30px rgba(0, 255, 136, 0.5);
    }
    
    .win-pct.losing {
        color: #FF4757;
        text-shadow: 0 0 30px rgba(255, 71, 87, 0.5);
    }
    
    .category-row {
        display: flex;
        justify-content: space-between;
        padding: 0.5rem 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .swing-badge {
        background: linear-gradient(90deg, #FFD93D, #FF6B35);
        color: #0F0F1A;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
    }
    
    .streamer-card {
        background: linear-gradient(145deg, #252545, #1A1A2E);
        border-radius: 12px;
        padding: 1rem;
        margin: 0.5rem 0;
        border-left: 4px solid #00D4FF;
    }
    
    .streamer-card.positive {
        border-left-color: #00FF88;
    }
    
    .streamer-card.negative {
        border-left-color: #FF4757;
    }
    
    /* Sidebar styling */
    [data-testid="stSidebar"] {
        background: linear-gradient(180deg, #1A1A2E 0%, #0F0F1A 100%);
    }
    
    [data-testid="stSidebar"] h1 {
        color: #FF6B35;
    }
    
    /* Button styling */
    .stButton > button {
        background: linear-gradient(90deg, #FF6B35, #FF8C42) !important;
        color: white !important;
        font-family: 'Oswald', sans-serif !important;
        font-weight: 600 !important;
        text-transform: uppercase !important;
        letter-spacing: 1px !important;
        border: none !important;
        padding: 0.75rem 2rem !important;
        border-radius: 8px !important;
        transition: all 0.3s ease !important;
    }
    
    .stButton > button:hover {
        transform: scale(1.02);
        box-shadow: 0 8px 25px rgba(255, 107, 53, 0.4) !important;
    }
    
    /* Progress bars */
    .stProgress > div > div {
        background: linear-gradient(90deg, #00FF88, #00D4FF) !important;
    }
    
    /* Metrics */
    [data-testid="stMetricValue"] {
        font-family: 'Oswald', sans-serif !important;
        font-size: 2rem !important;
    }
    
    /* Center metrics */
    [data-testid="stMetric"] {
        text-align: center;
    }
    
    [data-testid="stMetricLabel"] {
        display: flex;
        justify-content: center;
    }
    
    /* Make metric value and delta inline */
    [data-testid="stMetric"] > div {
        display: flex;
        flex-direction: row;
        align-items: baseline;
        justify-content: center;
        gap: 0.5rem;
    }
    
    [data-testid="stMetricValue"] {
        display: flex;
        justify-content: center;
    }
    
    [data-testid="stMetricDelta"] {
        font-size: 0.9rem !important;
    }
    
    /* Expander */
    .streamlit-expanderHeader {
        font-family: 'Oswald', sans-serif !important;
        text-transform: uppercase !important;
    }
    
    /* Tables */
    .dataframe {
        font-family: 'Roboto Condensed', sans-serif !important;
    }
    
    /* Info boxes */
    .stAlert {
        background: rgba(26, 26, 46, 0.9) !important;
        border: 1px solid rgba(255, 107, 53, 0.3) !important;
    }
    
    /* Mobile responsive card */
    .mobile-card {
        background: linear-gradient(145deg, #252545, #1A1A2E);
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 1rem;
        border-left: 4px solid #00D4FF;
    }
    
    /* Responsive scoreboard table */
    .scoreboard-table {
        width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
    }
    
    /* ========================================
       MOBILE RESPONSIVE STYLES
       ======================================== */
    
    /* Tablets and smaller (max-width: 992px) */
    @media screen and (max-width: 992px) {
        .main-header {
            font-size: 2.5rem !important;
        }
        
        [data-testid="stMetricValue"] {
            font-size: 1.5rem !important;
        }
    }
    
    /* Mobile devices (max-width: 768px) */
    @media screen and (max-width: 768px) {
        .main-header {
            font-size: 1.8rem !important;
            letter-spacing: 1px;
        }
        
        h2 {
            font-size: 1.3rem !important;
        }
        
        h3 {
            font-size: 1.1rem !important;
        }
        
        .win-pct {
            font-size: 2.5rem;
        }
        
        [data-testid="stMetricValue"] {
            font-size: 1.3rem !important;
        }
        
        .stat-card {
            padding: 1rem;
            border-radius: 12px;
        }
        
        /* Stack columns on mobile */
        [data-testid="column"] {
            width: 100% !important;
            flex: 1 1 100% !important;
        }
        
        /* Smaller table fonts on mobile */
        .dataframe {
            font-size: 0.75rem !important;
        }
        
        .dataframe th, .dataframe td {
            padding: 4px 6px !important;
        }
        
        /* Adjust plotly charts for mobile */
        .js-plotly-plot {
            max-width: 100% !important;
        }
        
        /* Mobile scoreboard adjustments */
        .scoreboard-table table {
            font-size: 0.7rem;
        }
        
        .scoreboard-table th, .scoreboard-table td {
            padding: 4px 2px !important;
        }
    }
    
    /* Small mobile devices (max-width: 480px) */
    @media screen and (max-width: 480px) {
        .main-header {
            font-size: 1.4rem !important;
            letter-spacing: 0.5px;
        }
        
        h2 {
            font-size: 1.1rem !important;
        }
        
        h3 {
            font-size: 1rem !important;
        }
        
        .win-pct {
            font-size: 2rem;
        }
        
        [data-testid="stMetricValue"] {
            font-size: 1.1rem !important;
        }
        
        /* Hide less important columns on very small screens */
        .hide-mobile {
            display: none !important;
        }
        
        .dataframe {
            font-size: 0.65rem !important;
        }
        
        /* Compact button on mobile */
        .stButton > button {
            padding: 0.5rem 1rem !important;
            font-size: 0.9rem !important;
        }
    }
    
    /* Ensure horizontal scroll for wide tables */
    [data-testid="stDataFrame"] {
        overflow-x: auto !important;
    }
    
    [data-testid="stDataFrame"] > div {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
    }
</style>
""", unsafe_allow_html=True)

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def safe_num(x):
    try:
        return float(x)
    except:
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
    """Check if a player object is injured"""
    return player.injuryStatus in INJURED_STATUSES


# =============================================================================
# ESPN DATA FUNCTIONS
# =============================================================================

def connect_to_espn(league_id, year, espn_s2, swid):
    """Connect to ESPN Fantasy Basketball API - always fetches fresh data"""
    from espn_api.basketball import League
    league = League(
        league_id=league_id,
        year=year,
        espn_s2=espn_s2,
        swid=swid
    )
    return league


def get_matchup_info(league, team_id):
    """Auto-detect current matchup and opponent"""
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
    """Get current week live totals for both teams"""
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
    """Build per-game stats dataframe from ESPN roster data"""
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


# =============================================================================
# GAMES LEFT FUNCTIONS
# =============================================================================

@st.cache_data(ttl=3600)
def get_team_schedule(team_abbrev):
    """Get NBA team schedule from ESPN API"""
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
            except:
                pass
        return dates
    except:
        return []


def count_games_left(team_abbrev):
    """Count games remaining this week"""
    eastern = ZoneInfo("America/New_York")
    today = datetime.now(eastern).date()
    end_of_week = today + timedelta(days=(6 - today.weekday()))
    
    sched = get_team_schedule(team_abbrev)
    return sum(today <= g <= end_of_week for g in sched)


def add_games_left(df):
    """Add Games Left column to dataframe"""
    df = df.copy()
    df["Games Left"] = df["NBA_Team"].apply(count_games_left)
    return df


# =============================================================================
# SIMULATION FUNCTIONS
# =============================================================================

def simulate_team(team_df, sims=10000):
    """Monte Carlo simulation for team stats - Vectorized NumPy version for speed"""
    if team_df.empty:
        # Return zeros if no players
        all_stats = list(CATEGORY_VARIANCE.keys()) + ["FG%", "FT%", "3P%"]
        return {stat: [0.0] * sims for stat in all_stats}
    
    # Prepare data as numpy arrays
    stats_to_sim = list(CATEGORY_VARIANCE.keys())
    variance_vals = np.array([CATEGORY_VARIANCE[s] for s in stats_to_sim])
    
    # Get means and games for each player
    team_df_clean = team_df.fillna(0)
    means = team_df_clean[stats_to_sim].values  # Shape: (n_players, n_stats)
    games = team_df_clean["Games Left"].values.astype(int)  # Shape: (n_players,)
    
    # Initialize totals array: (sims, n_stats)
    totals = np.zeros((sims, len(stats_to_sim)))
    
    # Simulate each player
    for p_idx in range(len(team_df_clean)):
        n_games = games[p_idx]
        if n_games <= 0:
            continue
        
        player_means = means[p_idx]  # Shape: (n_stats,)
        player_stds = player_means * variance_vals  # Shape: (n_stats,)
        
        # Generate all random values at once: (sims, n_games, n_stats)
        random_vals = np.random.normal(
            loc=player_means,
            scale=player_stds,
            size=(sims, n_games, len(stats_to_sim))
        )
        
        # Sum across games and add to totals
        totals += random_vals.sum(axis=1)  # Sum over games dimension
    
    # Build results dict
    results = {}
    for i, stat in enumerate(stats_to_sim):
        results[stat] = totals[:, i].tolist()
    
    # Calculate percentage stats
    fgm = totals[:, stats_to_sim.index("FGM")]
    fga = totals[:, stats_to_sim.index("FGA")]
    ftm = totals[:, stats_to_sim.index("FTM")]
    fta = totals[:, stats_to_sim.index("FTA")]
    tpm = totals[:, stats_to_sim.index("3PM")]
    tpa = totals[:, stats_to_sim.index("3PA")]
    
    with np.errstate(divide='ignore', invalid='ignore'):
        results["FG%"] = np.where(fga > 0, fgm / fga, 0).tolist()
        results["FT%"] = np.where(fta > 0, ftm / fta, 0).tolist()
        results["3P%"] = np.where(tpa > 0, tpm / tpa, 0).tolist()
    
    return results


def add_current_to_sim(current, sim):
    """Add current week totals to simulated rest-of-week stats - Vectorized"""
    adjusted = {}
    
    # Convert to numpy for speed
    for stat in sim:
        sim_arr = np.array(sim[stat])
        if stat in ["FG%", "FT%", "3P%"]:
            adjusted[stat] = np.zeros_like(sim_arr)
        else:
            adjusted[stat] = sim_arr + current.get(stat, 0)
    
    # Recalculate percentages
    fgm = adjusted["FGM"]
    fga = adjusted["FGA"]
    ftm = adjusted["FTM"]
    fta = adjusted["FTA"]
    tpm = adjusted["3PM"]
    tpa = adjusted["3PA"]
    
    with np.errstate(divide='ignore', invalid='ignore'):
        adjusted["FG%"] = np.where(fga > 0, fgm / fga, 0)
        adjusted["FT%"] = np.where(fta > 0, ftm / fta, 0)
        adjusted["3P%"] = np.where(tpa > 0, tpm / tpa, 0)
    
    # Convert back to lists for compatibility
    return {k: v.tolist() if isinstance(v, np.ndarray) else v for k, v in adjusted.items()}


def compare_matchups(sim1, sim2, categories):
    """Compare two teams across all simulations - Vectorized"""
    sims = len(sim1["FGM"])
    
    # Convert to numpy arrays
    sim1_arr = {cat: np.array(sim1[cat]) for cat in categories}
    sim2_arr = {cat: np.array(sim2[cat]) for cat in categories}
    
    # Initialize category outcomes
    category_outcomes = {cat: {"you": 0, "opponent": 0, "tie": 0} for cat in categories}
    
    # Calculate wins per simulation
    your_wins_per_sim = np.zeros(sims)
    opp_wins_per_sim = np.zeros(sims)
    
    for cat in categories:
        y_vals = sim1_arr[cat]
        o_vals = sim2_arr[cat]
        
        if cat == "TO":
            # Lower is better for TO
            you_win = y_vals < o_vals
            opp_win = y_vals > o_vals
        else:
            you_win = y_vals > o_vals
            opp_win = y_vals < o_vals
        
        ties = ~you_win & ~opp_win
        
        category_outcomes[cat]["you"] = int(you_win.sum())
        category_outcomes[cat]["opponent"] = int(opp_win.sum())
        category_outcomes[cat]["tie"] = int(ties.sum())
        
        your_wins_per_sim += you_win.astype(int)
        opp_wins_per_sim += opp_win.astype(int)
    
    # Count matchup outcomes
    you_win_matchup = your_wins_per_sim > opp_wins_per_sim
    opp_win_matchup = opp_wins_per_sim > your_wins_per_sim
    tie_matchup = your_wins_per_sim == opp_wins_per_sim
    
    matchup_results = {
        "you": int(you_win_matchup.sum()),
        "opponent": int(opp_win_matchup.sum()),
        "tie": int(tie_matchup.sum())
    }
    
    # Count outcome distribution
    outcome_counts = defaultdict(int)
    for y_w, o_w in zip(your_wins_per_sim.astype(int), opp_wins_per_sim.astype(int)):
        outcome_counts[(y_w, o_w)] += 1
    
    return matchup_results, category_outcomes, outcome_counts


def analyze_streamers(league, your_team_df, opp_team_df, current_totals_you, current_totals_opp, 
                     baseline_results, blend_weight, year, num_streamers=20, 
                     untouchables=None, has_open_roster_spot=False, manual_watchlist=None):
    """
    Analyze potential streamer pickups, considering who to drop.
    Uses fully vectorized NumPy operations for speed.
    
    Args:
        league: ESPN league object
        your_team_df: Your team's player stats DataFrame
        opp_team_df: Opponent's player stats DataFrame
        current_totals_you: Current week totals for your team
        current_totals_opp: Current week totals for opponent
        baseline_results: Tuple of (win_pct, cat_results, avg_cats)
        blend_weight: Weight for last 30 days vs season stats
        year: Season year
        num_streamers: Number of streamers to analyze
        untouchables: List of player names that cannot be dropped
        has_open_roster_spot: If True, can add without dropping
        manual_watchlist: List of player names to mark as watchlist
    """
    baseline_win_pct, baseline_cat_results, baseline_avg_cats = baseline_results
    untouchables = untouchables or []
    untouchables_lower = [p.lower().strip() for p in untouchables]
    
    # Manual watchlist names (case-insensitive matching)
    manual_watchlist = manual_watchlist or []
    watchlist_names_lower = {p.lower().strip() for p in manual_watchlist}
    
    # Get droppable players from your team (not untouchables)
    droppable_players = your_team_df[
        ~your_team_df["Player"].str.lower().str.strip().isin(untouchables_lower)
    ].copy()
    
    # Get free agents - ESPN returns them sorted by % owned (most owned first)
    # Request more than needed to account for filtering
    free_agents = league.free_agents(size=min(200, num_streamers * 2))
    
    # Filter out injured players
    healthy_players = [p for p in free_agents if not is_player_injured(p)]
    
    if not healthy_players:
        return []
    
    # Map player name -> availability status (DTD, Q, P, D) for table display
    player_status_map = {}
    for p in healthy_players:
        raw = getattr(p, "injuryStatus", None) or ""
        display = STATUS_DISPLAY.get(str(raw).upper().strip(), "") if raw else ""
        if display:
            player_status_map[p.name] = display
    
    fa_season = build_stat_df(healthy_players, f"{year}_total", "Season", "Waiver", year)
    fa_last30 = build_stat_df(healthy_players, f"{year}_last_30", "Last30", "Waiver", year)
    
    fa_season = add_games_left(fa_season)
    fa_last30 = add_games_left(fa_last30)
    
    merged = fa_season.merge(fa_last30, on=["Player", "NBA_Team"], suffixes=("_season", "_30"))
    
    rows = []
    for _, r in merged.iterrows():
        g = r.get("Games Left_30", 0)
        if g <= 0:
            continue
        
        # Check if player is on manual watchlist (case-insensitive)
        is_on_watchlist = r["Player"].lower().strip() in watchlist_names_lower
        
        out = {
            "Player": r["Player"], 
            "NBA_Team": r["NBA_Team"], 
            "Games Left": g, 
            "Team": "Waiver",
            "On Watchlist": is_on_watchlist,
            "Status": player_status_map.get(r["Player"], ""),
        }
        for col in NUMERIC_COLS:
            c30, csea = f"{col}_30", f"{col}_season"
            if c30 in r and csea in r:
                out[col] = r[c30] * blend_weight + r[csea] * (1 - blend_weight)
            else:
                out[col] = r.get(c30, r.get(csea, 0))
        rows.append(out)
    
    waiver_df = pd.DataFrame(rows)
    
    # Sort: watchlist players first, then by games left and points
    waiver_df["_watchlist_sort"] = waiver_df["On Watchlist"].map({True: 0, False: 1})
    waiver_df = waiver_df.sort_values(["_watchlist_sort", "Games Left", "PTS"], ascending=[True, False, False])
    waiver_df = waiver_df.drop(columns=["_watchlist_sort"])
    
    streamers = waiver_df.head(num_streamers)
    
    if streamers.empty:
        return []
    
    # Simulation parameters
    streamer_sims = 2000
    stats_to_sim = list(CATEGORY_VARIANCE.keys())
    variance_vals = np.array([CATEGORY_VARIANCE[s] for s in stats_to_sim])
    
    # Pre-compute opponent simulation arrays ONCE
    opp_df_clean = opp_team_df.fillna(0)
    opp_means = opp_df_clean[stats_to_sim].values
    opp_games = opp_df_clean["Games Left"].values.astype(int)
    
    opp_totals = np.zeros((streamer_sims, len(stats_to_sim)))
    for p_idx in range(len(opp_df_clean)):
        n_games = opp_games[p_idx]
        if n_games <= 0:
            continue
        player_means = opp_means[p_idx]
        player_stds = player_means * variance_vals
        random_vals = np.random.normal(loc=player_means, scale=player_stds, size=(streamer_sims, n_games, len(stats_to_sim)))
        opp_totals += random_vals.sum(axis=1)
    
    # Add current totals to opponent
    for i, stat in enumerate(stats_to_sim):
        opp_totals[:, i] += current_totals_opp.get(stat, 0)
    
    # Calculate opponent percentages
    opp_fgm = opp_totals[:, stats_to_sim.index("FGM")]
    opp_fga = opp_totals[:, stats_to_sim.index("FGA")]
    opp_ftm = opp_totals[:, stats_to_sim.index("FTM")]
    opp_fta = opp_totals[:, stats_to_sim.index("FTA")]
    opp_3pm = opp_totals[:, stats_to_sim.index("3PM")]
    opp_3pa = opp_totals[:, stats_to_sim.index("3PA")]
    
    with np.errstate(divide='ignore', invalid='ignore'):
        opp_fgp = np.where(opp_fga > 0, opp_fgm / opp_fga, 0)
        opp_ftp = np.where(opp_fta > 0, opp_ftm / opp_fta, 0)
        opp_3pp = np.where(opp_3pa > 0, opp_3pm / opp_3pa, 0)
    
    # Pre-compute base team data (without any drops)
    your_df_clean = your_team_df.fillna(0)
    your_means = your_df_clean[stats_to_sim].values
    your_games = your_df_clean["Games Left"].values.astype(int)
    your_players = your_df_clean["Player"].values
    
    results = []
    
    for _, streamer_row in streamers.iterrows():
        best_drop = None
        best_net_cats = float('-inf')
        best_exp_cats = 0
        best_win_pct = 0
        best_cat_impacts = {}
        
        # Streamer stats
        streamer_means = np.array([streamer_row.get(s, 0) for s in stats_to_sim])
        streamer_stds = streamer_means * variance_vals
        streamer_games = int(streamer_row["Games Left"])
        
        # Pre-generate streamer contribution for all sims
        if streamer_games > 0:
            streamer_contrib = np.random.normal(
                loc=streamer_means, scale=streamer_stds, 
                size=(streamer_sims, streamer_games, len(stats_to_sim))
            ).sum(axis=1)
        else:
            streamer_contrib = np.zeros((streamer_sims, len(stats_to_sim)))
        
        # If there's an open roster spot, try adding without dropping
        if has_open_roster_spot:
            # Full team + streamer
            test_totals = np.zeros((streamer_sims, len(stats_to_sim)))
            for p_idx in range(len(your_df_clean)):
                n_games = your_games[p_idx]
                if n_games <= 0:
                    continue
                player_means = your_means[p_idx]
                player_stds = player_means * variance_vals
                random_vals = np.random.normal(loc=player_means, scale=player_stds, size=(streamer_sims, n_games, len(stats_to_sim)))
                test_totals += random_vals.sum(axis=1)
            
            test_totals += streamer_contrib
            
            # Add current totals
            for i, stat in enumerate(stats_to_sim):
                test_totals[:, i] += current_totals_you.get(stat, 0)
            
            # Calculate percentages and compare
            net_cats, exp_cats, win_pct, cat_impacts = _evaluate_matchup(
                test_totals, opp_totals, opp_fgp, opp_ftp, opp_3pp,
                stats_to_sim, baseline_avg_cats, baseline_cat_results, streamer_sims
            )
            
            best_drop = "(Open Spot)"
            best_net_cats = net_cats
            best_exp_cats = exp_cats
            best_win_pct = win_pct
            best_cat_impacts = cat_impacts
        
        # Try dropping each droppable player
        for drop_idx, (_, drop_row) in enumerate(droppable_players.iterrows()):
            drop_player_name = drop_row["Player"]
            
            # Build team totals excluding dropped player
            test_totals = np.zeros((streamer_sims, len(stats_to_sim)))
            for p_idx in range(len(your_df_clean)):
                if your_players[p_idx] == drop_player_name:
                    continue  # Skip dropped player
                n_games = your_games[p_idx]
                if n_games <= 0:
                    continue
                player_means = your_means[p_idx]
                player_stds = player_means * variance_vals
                random_vals = np.random.normal(loc=player_means, scale=player_stds, size=(streamer_sims, n_games, len(stats_to_sim)))
                test_totals += random_vals.sum(axis=1)
            
            # Add streamer
            test_totals += streamer_contrib
            
            # Add current totals
            for i, stat in enumerate(stats_to_sim):
                test_totals[:, i] += current_totals_you.get(stat, 0)
            
            # Evaluate
            net_cats, exp_cats, win_pct, cat_impacts = _evaluate_matchup(
                test_totals, opp_totals, opp_fgp, opp_ftp, opp_3pp,
                stats_to_sim, baseline_avg_cats, baseline_cat_results, streamer_sims
            )
            
            if net_cats > best_net_cats:
                best_drop = drop_player_name
                best_net_cats = net_cats
                best_exp_cats = exp_cats
                best_win_pct = win_pct
                best_cat_impacts = cat_impacts
        
        # Skip if no valid transaction found
        if best_drop is None:
            continue
        
        risk_tags = []
        if streamer_row.get("FGA", 0) > 12:
            risk_tags.append("High FGA")
        if streamer_row.get("TO", 0) > 2:
            risk_tags.append("High TO")
        if streamer_row.get("FG%", 1.0) < 0.42:
            risk_tags.append("Low FG%")
        
        results.append({
            "Player": streamer_row["Player"],
            "Team": streamer_row["NBA_Team"],
            "Games": int(streamer_row["Games Left"]),
            "Drop": best_drop,
            "Δ Cats": round(best_net_cats, 2),
            "Exp Cats": round(best_exp_cats, 2),
            "Win %": round(best_win_pct, 1),
            "Cat Impacts": best_cat_impacts,
            "Risks": risk_tags,
            "Status": streamer_row.get("Status", ""),
            "PTS": round(streamer_row.get("PTS", 0), 1),
            "REB": round(streamer_row.get("REB", 0), 1),
            "AST": round(streamer_row.get("AST", 0), 1),
            "Watchlist": "W" if streamer_row.get("On Watchlist", False) else "",
        })
    
    return sorted(results, key=lambda x: x["Δ Cats"], reverse=True)


def _evaluate_matchup(test_totals, opp_totals, opp_fgp, opp_ftp, opp_3pp,
                      stats_to_sim, baseline_avg_cats, baseline_cat_results, sims):
    """Helper function to evaluate a matchup using vectorized operations."""
    # Calculate your percentages
    fgm_idx = stats_to_sim.index("FGM")
    fga_idx = stats_to_sim.index("FGA")
    ftm_idx = stats_to_sim.index("FTM")
    fta_idx = stats_to_sim.index("FTA")
    tpm_idx = stats_to_sim.index("3PM")
    tpa_idx = stats_to_sim.index("3PA")
    
    your_fgm = test_totals[:, fgm_idx]
    your_fga = test_totals[:, fga_idx]
    your_ftm = test_totals[:, ftm_idx]
    your_fta = test_totals[:, fta_idx]
    your_3pm = test_totals[:, tpm_idx]
    your_3pa = test_totals[:, tpa_idx]
    
    with np.errstate(divide='ignore', invalid='ignore'):
        your_fgp = np.where(your_fga > 0, your_fgm / your_fga, 0)
        your_ftp = np.where(your_fta > 0, your_ftm / your_fta, 0)
        your_3pp = np.where(your_3pa > 0, your_3pm / your_3pa, 0)
    
    # Compare categories
    your_wins = np.zeros(sims)
    opp_wins = np.zeros(sims)
    cat_results = {}
    
    for cat in CATEGORIES:
        if cat == "FG%":
            y_vals, o_vals = your_fgp, opp_fgp
        elif cat == "FT%":
            y_vals, o_vals = your_ftp, opp_ftp
        elif cat == "3P%":
            y_vals, o_vals = your_3pp, opp_3pp
        else:
            cat_idx = stats_to_sim.index(cat) if cat in stats_to_sim else None
            if cat_idx is None:
                continue
            y_vals = test_totals[:, cat_idx]
            o_vals = opp_totals[:, cat_idx]
        
        if cat == "TO":
            you_win = y_vals < o_vals
            opp_win = y_vals > o_vals
        else:
            you_win = y_vals > o_vals
            opp_win = y_vals < o_vals
        
        cat_results[cat] = {"you": int(you_win.sum()), "opponent": int(opp_win.sum()), "tie": int((~you_win & ~opp_win).sum())}
        your_wins += you_win.astype(int)
        opp_wins += opp_win.astype(int)
    
    # Calculate metrics
    you_win_matchup = (your_wins > opp_wins).sum()
    avg_cats_won = your_wins.mean()
    net_cats = avg_cats_won - baseline_avg_cats
    win_pct = you_win_matchup / sims * 100
    
    # Category impacts
    cat_impacts = {}
    for cat in CATEGORIES:
        if cat in cat_results:
            base_win_rate = baseline_cat_results[cat]["you"] / sum(baseline_cat_results[cat].values())
            new_win_rate = cat_results[cat]["you"] / sims
            delta = (new_win_rate - base_win_rate) * 100
            if abs(delta) > 3:
                cat_impacts[cat] = delta
    
    return net_cats, avg_cats_won, win_pct, cat_impacts


def analyze_bench_strategy(your_team_df, opp_team_df, current_totals_you, current_totals_opp, 
                           baseline_results, sims=3000):
    """
    Analyze whether benching all players today would improve win probability.
    Useful for protecting leads in categories like TO, FG%, FT%.
    
    Returns comparison of playing vs benching scenarios.
    """
    baseline_win_pct, baseline_cat_results, baseline_avg_cats = baseline_results
    
    stats_to_sim = list(CATEGORY_VARIANCE.keys())
    variance_vals = np.array([CATEGORY_VARIANCE[s] for s in stats_to_sim])
    
    # Simulate opponent playing all their games
    opp_df_clean = opp_team_df.fillna(0)
    opp_means = opp_df_clean[stats_to_sim].values
    opp_games = opp_df_clean["Games Left"].values.astype(int)
    
    opp_totals = np.zeros((sims, len(stats_to_sim)))
    for p_idx in range(len(opp_df_clean)):
        n_games = opp_games[p_idx]
        if n_games <= 0:
            continue
        player_means = opp_means[p_idx]
        player_stds = player_means * variance_vals
        random_vals = np.random.normal(loc=player_means, scale=player_stds, size=(sims, n_games, len(stats_to_sim)))
        opp_totals += random_vals.sum(axis=1)
    
    # Add current totals to opponent
    for i, stat in enumerate(stats_to_sim):
        opp_totals[:, i] += current_totals_opp.get(stat, 0)
    
    # Calculate opponent percentages
    opp_fgm = opp_totals[:, stats_to_sim.index("FGM")]
    opp_fga = opp_totals[:, stats_to_sim.index("FGA")]
    opp_ftm = opp_totals[:, stats_to_sim.index("FTM")]
    opp_fta = opp_totals[:, stats_to_sim.index("FTA")]
    opp_3pm = opp_totals[:, stats_to_sim.index("3PM")]
    opp_3pa = opp_totals[:, stats_to_sim.index("3PA")]
    
    with np.errstate(divide='ignore', invalid='ignore'):
        opp_fgp = np.where(opp_fga > 0, opp_fgm / opp_fga, 0)
        opp_ftp = np.where(opp_fta > 0, opp_ftm / opp_fta, 0)
        opp_3pp = np.where(opp_3pa > 0, opp_3pm / opp_3pa, 0)
    
    # SCENARIO 1: You play all games (normal)
    your_df_clean = your_team_df.fillna(0)
    your_means = your_df_clean[stats_to_sim].values
    your_games = your_df_clean["Games Left"].values.astype(int)
    
    play_totals = np.zeros((sims, len(stats_to_sim)))
    for p_idx in range(len(your_df_clean)):
        n_games = your_games[p_idx]
        if n_games <= 0:
            continue
        player_means = your_means[p_idx]
        player_stds = player_means * variance_vals
        random_vals = np.random.normal(loc=player_means, scale=player_stds, size=(sims, n_games, len(stats_to_sim)))
        play_totals += random_vals.sum(axis=1)
    
    # Add current totals
    for i, stat in enumerate(stats_to_sim):
        play_totals[:, i] += current_totals_you.get(stat, 0)
    
    # SCENARIO 2: You bench everyone (only current totals)
    bench_totals = np.zeros((sims, len(stats_to_sim)))
    for i, stat in enumerate(stats_to_sim):
        bench_totals[:, i] = current_totals_you.get(stat, 0)
    
    # Evaluate both scenarios
    def evaluate_scenario(your_totals):
        # Calculate your percentages
        fgm_idx = stats_to_sim.index("FGM")
        fga_idx = stats_to_sim.index("FGA")
        ftm_idx = stats_to_sim.index("FTM")
        fta_idx = stats_to_sim.index("FTA")
        tpm_idx = stats_to_sim.index("3PM")
        tpa_idx = stats_to_sim.index("3PA")
        
        your_fgm = your_totals[:, fgm_idx]
        your_fga = your_totals[:, fga_idx]
        your_ftm = your_totals[:, ftm_idx]
        your_fta = your_totals[:, fta_idx]
        your_3pm = your_totals[:, tpm_idx]
        your_3pa = your_totals[:, tpa_idx]
        
        with np.errstate(divide='ignore', invalid='ignore'):
            your_fgp = np.where(your_fga > 0, your_fgm / your_fga, 0)
            your_ftp = np.where(your_fta > 0, your_ftm / your_fta, 0)
            your_3pp = np.where(your_3pa > 0, your_3pm / your_3pa, 0)
        
        # Compare categories
        your_wins = np.zeros(sims)
        cat_results = {}
        
        for cat in CATEGORIES:
            if cat == "FG%":
                y_vals, o_vals = your_fgp, opp_fgp
            elif cat == "FT%":
                y_vals, o_vals = your_ftp, opp_ftp
            elif cat == "3P%":
                y_vals, o_vals = your_3pp, opp_3pp
            else:
                cat_idx = stats_to_sim.index(cat) if cat in stats_to_sim else None
                if cat_idx is None:
                    continue
                y_vals = your_totals[:, cat_idx]
                o_vals = opp_totals[:, cat_idx]
            
            if cat == "TO":
                you_win = y_vals < o_vals
            else:
                you_win = y_vals > o_vals
            
            cat_results[cat] = {
                "win_pct": float(you_win.mean() * 100),
                "your_avg": float(y_vals.mean()),
                "opp_avg": float(o_vals.mean())
            }
            your_wins += you_win.astype(int)
        
        # Calculate overall metrics
        opp_wins = len(CATEGORIES) - your_wins  # Simplified
        you_win_matchup = (your_wins > (len(CATEGORIES) / 2)).sum()
        avg_cats_won = your_wins.mean()
        win_pct = you_win_matchup / sims * 100
        
        return {
            "win_pct": win_pct,
            "avg_cats": avg_cats_won,
            "cat_results": cat_results
        }
    
    play_results = evaluate_scenario(play_totals)
    bench_results = evaluate_scenario(bench_totals)
    
    # Determine recommendation
    play_better = play_results["avg_cats"] >= bench_results["avg_cats"]
    cats_diff = play_results["avg_cats"] - bench_results["avg_cats"]
    win_pct_diff = play_results["win_pct"] - bench_results["win_pct"]
    
    # Find categories where benching helps
    bench_helps_cats = []
    play_helps_cats = []
    for cat in CATEGORIES:
        play_cat_pct = play_results["cat_results"][cat]["win_pct"]
        bench_cat_pct = bench_results["cat_results"][cat]["win_pct"]
        diff = bench_cat_pct - play_cat_pct
        if diff > 5:  # Benching helps this category by >5%
            bench_helps_cats.append((cat, diff))
        elif diff < -5:  # Playing helps this category by >5%
            play_helps_cats.append((cat, -diff))
    
    return {
        "play": play_results,
        "bench": bench_results,
        "recommendation": "PLAY" if play_better else "BENCH",
        "cats_diff": cats_diff,
        "win_pct_diff": win_pct_diff,
        "bench_helps": sorted(bench_helps_cats, key=lambda x: x[1], reverse=True),
        "play_helps": sorted(play_helps_cats, key=lambda x: x[1], reverse=True)
    }


def calculate_league_stats(league, year):
    """
    Calculate league-wide statistics including all-play records.
    All-play = total category wins/losses if you played every team every week.
    Each week: (num_teams - 1) opponents × num_categories = category matchups per week
    """
    teams = league.teams
    num_teams = len(teams)
    # Use currentMatchupPeriod - 1 to only count COMPLETED weeks, not current week
    current_week = league.currentMatchupPeriod
    num_completed_weeks = current_week - 1 if current_week > 1 else current_week
    
    # Initialize all-play records - tracking CATEGORY wins, not matchup wins
    all_play_records = {team.team_id: {"wins": 0, "losses": 0, "ties": 0} for team in teams}
    
    # Calculate all-play record by going through each COMPLETED week
    for week in range(1, num_completed_weeks + 1):
        try:
            boxscores = league.box_scores(matchup_period=week)
            
            # Get each team's category totals for this week
            weekly_stats = {}
            for matchup in boxscores:
                # Home team stats
                home_stats = flatten_stat_dict(matchup.home_stats)
                home_id = matchup.home_team.team_id
                weekly_stats[home_id] = home_stats
                
                # Away team stats  
                away_stats = flatten_stat_dict(matchup.away_stats)
                away_id = matchup.away_team.team_id
                weekly_stats[away_id] = away_stats
            
            # Skip if we don't have stats for this week
            if not weekly_stats:
                continue
                
            # Compare each team against every other team for this week
            team_ids = list(weekly_stats.keys())
            
            for team1_id in team_ids:
                for team2_id in team_ids:
                    if team1_id == team2_id:
                        continue
                    
                    stats1 = weekly_stats.get(team1_id, {})
                    stats2 = weekly_stats.get(team2_id, {})
                    
                    if not stats1 or not stats2:
                        continue
                    
                    # Count EACH CATEGORY as a separate win/loss/tie
                    for cat in CATEGORIES:
                        val1 = stats1.get(cat, 0)
                        val2 = stats2.get(cat, 0)
                        
                        # Handle percentage categories
                        if cat == "FG%":
                            fgm1, fga1 = stats1.get("FGM", 0), stats1.get("FGA", 0)
                            fgm2, fga2 = stats2.get("FGM", 0), stats2.get("FGA", 0)
                            val1 = fgm1 / fga1 if fga1 > 0 else 0
                            val2 = fgm2 / fga2 if fga2 > 0 else 0
                        elif cat == "FT%":
                            ftm1, fta1 = stats1.get("FTM", 0), stats1.get("FTA", 0)
                            ftm2, fta2 = stats2.get("FTM", 0), stats2.get("FTA", 0)
                            val1 = ftm1 / fta1 if fta1 > 0 else 0
                            val2 = ftm2 / fta2 if fta2 > 0 else 0
                        elif cat == "3P%":
                            tpm1, tpa1 = stats1.get("3PM", 0), stats1.get("3PA", 0)
                            tpm2, tpa2 = stats2.get("3PM", 0), stats2.get("3PA", 0)
                            val1 = tpm1 / tpa1 if tpa1 > 0 else 0
                            val2 = tpm2 / tpa2 if tpa2 > 0 else 0
                        
                        # Compare values - each category is its own win/loss
                        if cat == "TO":
                            # Lower is better for turnovers
                            if val1 < val2:
                                all_play_records[team1_id]["wins"] += 1
                            elif val2 < val1:
                                all_play_records[team1_id]["losses"] += 1
                            else:
                                all_play_records[team1_id]["ties"] += 1
                        else:
                            if val1 > val2:
                                all_play_records[team1_id]["wins"] += 1
                            elif val2 > val1:
                                all_play_records[team1_id]["losses"] += 1
                            else:
                                all_play_records[team1_id]["ties"] += 1
        
        except Exception as e:
            # Skip weeks that fail
            continue
    
    # Combine data
    league_data = []
    for team in teams:
        tid = team.team_id
        ap = all_play_records[tid]
        ap_total = ap["wins"] + ap["losses"] + ap["ties"]
        ap_pct = ap["wins"] / ap_total if ap_total > 0 else 0
        
        actual_total = team.wins + team.losses + getattr(team, 'ties', 0)
        actual_pct = team.wins / actual_total if actual_total > 0 else 0
        
        # Calculate luck factor (actual win% - all-play win%)
        luck = (actual_pct - ap_pct) * 100
        
        league_data.append({
            "team_id": tid,
            "team_name": team.team_name,
            "standing": team.standing,
            "actual_wins": team.wins,
            "actual_losses": team.losses,
            "actual_ties": getattr(team, 'ties', 0),
            "actual_pct": actual_pct,
            "all_play_wins": ap["wins"],
            "all_play_losses": ap["losses"],
            "all_play_ties": ap["ties"],
            "all_play_pct": ap_pct,
            "luck": luck,
            "points_for": getattr(team, 'points_for', 0),
        })
    
    # Sort by standing
    league_data = sorted(league_data, key=lambda x: x["standing"])
    
    return league_data


# =============================================================================
# VISUALIZATION FUNCTIONS
# =============================================================================

def create_scoreboard(current_you, current_opp, your_team_name, opp_team_name):
    """Create a scoreboard showing current week stats"""
    
    categories_order = ["FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%", "REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW"]
    
    # Calculate percentages
    your_fgp = current_you["FGM"] / current_you["FGA"] if current_you["FGA"] > 0 else 0
    opp_fgp = current_opp["FGM"] / current_opp["FGA"] if current_opp["FGA"] > 0 else 0
    your_ftp = current_you["FTM"] / current_you["FTA"] if current_you["FTA"] > 0 else 0
    opp_ftp = current_opp["FTM"] / current_opp["FTA"] if current_opp["FTA"] > 0 else 0
    your_3pp = current_you["3PM"] / current_you["3PA"] if current_you["3PA"] > 0 else 0
    opp_3pp = current_opp["3PM"] / current_opp["3PA"] if current_opp["3PA"] > 0 else 0
    
    your_stats = {
        "FGM": current_you["FGM"], "FGA": current_you["FGA"], "FG%": your_fgp,
        "FT%": your_ftp, "3PM": current_you["3PM"], "3PA": current_you["3PA"], "3P%": your_3pp,
        "REB": current_you["REB"], "AST": current_you["AST"], "STL": current_you["STL"],
        "BLK": current_you["BLK"], "TO": current_you["TO"], "DD": current_you["DD"],
        "PTS": current_you["PTS"], "TW": current_you["TW"]
    }
    
    opp_stats = {
        "FGM": current_opp["FGM"], "FGA": current_opp["FGA"], "FG%": opp_fgp,
        "FT%": opp_ftp, "3PM": current_opp["3PM"], "3PA": current_opp["3PA"], "3P%": opp_3pp,
        "REB": current_opp["REB"], "AST": current_opp["AST"], "STL": current_opp["STL"],
        "BLK": current_opp["BLK"], "TO": current_opp["TO"], "DD": current_opp["DD"],
        "PTS": current_opp["PTS"], "TW": current_opp["TW"]
    }
    
    # Count wins
    your_wins = 0
    opp_wins = 0
    ties = 0
    
    for cat in categories_order:
        y_val = your_stats[cat]
        o_val = opp_stats[cat]
        if cat == "TO":
            if y_val < o_val: your_wins += 1
            elif y_val > o_val: opp_wins += 1
            else: ties += 1
        else:
            if y_val > o_val: your_wins += 1
            elif y_val < o_val: opp_wins += 1
            else: ties += 1
    
    # Build header cells
    header_cells = '<th style="padding: 8px 4px; text-align: left; color: #888; font-size: 0.75rem;">TEAM</th>'
    for cat in categories_order:
        header_cells += f'<th style="padding: 8px 4px; text-align: center; color: #888; font-size: 0.75rem;">{cat}</th>'
    header_cells += '<th style="padding: 8px 4px; text-align: center; color: #888; font-size: 0.75rem;">SCORE</th>'
    
    # Build your team row
    your_cells = f'<td style="padding: 10px 4px; color: white; font-weight: 600;">{your_team_name[:15]}</td>'
    for cat in categories_order:
        y_val = your_stats[cat]
        o_val = opp_stats[cat]
        
        # Determine color
        if cat == "TO":
            if y_val < o_val:
                color = "#00FF88"
            elif y_val > o_val:
                color = "#FF4757"
            else:
                color = "white"
        else:
            if y_val > o_val:
                color = "#00FF88"
            elif y_val < o_val:
                color = "#FF4757"
            else:
                color = "white"
        
        # Format value
        if "%" in cat:
            val_str = f"{y_val:.4f}"
        else:
            val_str = str(int(y_val))
        
        your_cells += f'<td style="padding: 10px 4px; text-align: center; color: {color}; font-weight: 600;">{val_str}</td>'
    
    your_cells += f'<td style="padding: 10px 4px; text-align: center; color: #00FF88; font-weight: 700; font-family: Oswald;">{your_wins}-{opp_wins}-{ties}</td>'
    
    # Build opponent row
    opp_cells = f'<td style="padding: 10px 4px; color: white; font-weight: 600;">{opp_team_name[:15]}</td>'
    for cat in categories_order:
        y_val = your_stats[cat]
        o_val = opp_stats[cat]
        
        # Determine color (reversed for opponent)
        if cat == "TO":
            if o_val < y_val:
                color = "#00FF88"
            elif o_val > y_val:
                color = "#FF4757"
            else:
                color = "white"
        else:
            if o_val > y_val:
                color = "#00FF88"
            elif o_val < y_val:
                color = "#FF4757"
            else:
                color = "white"
        
        # Format value
        if "%" in cat:
            val_str = f"{o_val:.4f}"
        else:
            val_str = str(int(o_val))
        
        opp_cells += f'<td style="padding: 10px 4px; text-align: center; color: {color}; font-weight: 600;">{val_str}</td>'
    
    opp_cells += f'<td style="padding: 10px 4px; text-align: center; color: #FF4757; font-weight: 700; font-family: Oswald;">{opp_wins}-{your_wins}-{ties}</td>'
    
    # Build the complete HTML - clean version without backgrounds
    html = f"""
    <div style="margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <div style="text-align: left; flex: 1;">
                <span style="font-family: Oswald; font-size: 1.5rem; color: white;">{your_team_name}</span>
            </div>
            <div style="text-align: center; flex: 1;">
                <span style="font-family: Oswald; font-size: 2.5rem; color: #00FF88;">{your_wins}-{opp_wins}-{ties}</span>
                <span style="font-family: Oswald; font-size: 1.2rem; color: #666; margin-left: 2rem;">{opp_wins}-{your_wins}-{ties}</span>
            </div>
            <div style="text-align: right; flex: 1;">
                <span style="font-family: Oswald; font-size: 1.5rem; color: white;">{opp_team_name}</span>
            </div>
        </div>
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-family: Roboto Condensed;">
                <thead>
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.2);">
                        {header_cells}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        {your_cells}
                    </tr>
                    <tr>
                        {opp_cells}
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
    """
    
    return html


def create_win_probability_gauge(win_pct):
    """Create a gauge chart for win probability"""
    fig = go.Figure(go.Indicator(
        mode="gauge+number",
        value=win_pct,
        domain={'x': [0, 1], 'y': [0, 1]},
        number={'suffix': '%', 'font': {'size': 60, 'family': 'Oswald', 'color': 'white'}},
        gauge={
            'axis': {'range': [0, 100], 'tickwidth': 1, 'tickcolor': "white"},
            'bar': {'color': "#00FF88" if win_pct >= 50 else "#FF4757"},
            'bgcolor': "rgba(0,0,0,0)",
            'borderwidth': 2,
            'bordercolor': "rgba(255,255,255,0.3)",
            'steps': [
                {'range': [0, 40], 'color': 'rgba(255, 71, 87, 0.3)'},
                {'range': [40, 60], 'color': 'rgba(255, 217, 61, 0.3)'},
                {'range': [60, 100], 'color': 'rgba(0, 255, 136, 0.3)'}
            ],
            'threshold': {
                'line': {'color': "white", 'width': 4},
                'thickness': 0.75,
                'value': win_pct
            }
        }
    ))
    
    fig.update_layout(
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': 'white', 'family': 'Oswald'},
        height=300,
        margin=dict(l=30, r=30, t=30, b=30)
    )
    
    return fig


def create_category_chart(category_results, your_sim, opp_sim):
    """Create horizontal bar chart for category win rates"""
    cats = []
    you_pcts = []
    opp_pcts = []
    
    # Reverse the order so FGM is at top
    for cat in reversed(CATEGORIES):
        outcome = category_results[cat]
        total = sum(outcome.values())
        you_pcts.append(outcome["you"] / total * 100)
        opp_pcts.append(outcome["opponent"] / total * 100)
        cats.append(cat)
    
    fig = go.Figure()
    
    fig.add_trace(go.Bar(
        name='You',
        y=cats,
        x=you_pcts,
        orientation='h',
        marker_color='#00FF88',
        text=[f'{p:.0f}%' for p in you_pcts],
        textposition='inside',
        textfont=dict(family='Oswald', size=12, color='black')
    ))
    
    fig.add_trace(go.Bar(
        name='Opponent',
        y=cats,
        x=[-p for p in opp_pcts],
        orientation='h',
        marker_color='#FF4757',
        text=[f'{p:.0f}%' for p in opp_pcts],
        textposition='inside',
        textfont=dict(family='Oswald', size=12, color='white')
    ))
    
    fig.update_layout(
        barmode='overlay',
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': 'white', 'family': 'Roboto Condensed'},
        height=500,
        margin=dict(l=60, r=60, t=20, b=20),
        xaxis=dict(
            range=[-100, 100],
            showgrid=True,
            gridcolor='rgba(255,255,255,0.1)',
            zeroline=True,
            zerolinecolor='white',
            zerolinewidth=2,
            tickvals=[-100, -75, -50, -25, 0, 25, 50, 75, 100],
            ticktext=['100%', '75%', '50%', '25%', '0', '25%', '50%', '75%', '100%']
        ),
        yaxis=dict(showgrid=False),
        legend=dict(
            orientation='h',
            yanchor='bottom',
            y=1.02,
            xanchor='center',
            x=0.5
        ),
        showlegend=True
    )
    
    return fig


def create_outcome_distribution(outcome_counts, total_sims):
    """Create chart showing distribution of score outcomes"""
    sorted_outcomes = sorted(outcome_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    
    labels = [f"{your_w}-{opp_w}" for (your_w, opp_w), _ in sorted_outcomes]
    values = [count / total_sims * 100 for _, count in sorted_outcomes]
    colors = ['#00FF88' if your_w > opp_w else '#FF4757' if opp_w > your_w else '#FFD93D' 
              for (your_w, opp_w), _ in sorted_outcomes]
    
    fig = go.Figure(data=[
        go.Bar(
            x=labels,
            y=values,
            marker_color=colors,
            text=[f'{v:.1f}%' for v in values],
            textposition='outside',
            textfont=dict(family='Oswald', size=12, color='white'),
            cliponaxis=False
        )
    ])
    
    # Calculate max value for y-axis range with padding
    max_val = max(values) if values else 50
    y_max = max_val * 1.2  # 20% padding above tallest bar
    
    fig.update_layout(
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': 'white', 'family': 'Roboto Condensed'},
        height=300,
        margin=dict(l=40, r=40, t=50, b=60),
        xaxis=dict(
            title='Score Outcome (You - Opponent)',
            showgrid=False,
            tickfont=dict(family='Oswald', size=12),
            type='category'
        ),
        yaxis=dict(
            title='Probability',
            showgrid=True,
            gridcolor='rgba(255,255,255,0.1)',
            ticksuffix='%',
            range=[0, y_max]
        )
    )
    
    return fig


# =============================================================================
# MAIN APP
# =============================================================================

def main():
    # Header
    st.markdown('''
    <div style="display: flex; align-items: center; justify-content: center; gap: 1rem; margin-bottom: 0.5rem;">
        <svg width="50" height="50" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" fill="#FF6B35" stroke="#000" stroke-width="3"/>
            <path d="M50 5 Q50 50 50 95" stroke="#000" stroke-width="2.5" fill="none"/>
            <path d="M5 50 Q50 50 95 50" stroke="#000" stroke-width="2.5" fill="none"/>
            <path d="M12 25 Q50 40 88 25" stroke="#000" stroke-width="2" fill="none"/>
            <path d="M12 75 Q50 60 88 75" stroke="#000" stroke-width="2" fill="none"/>
        </svg>
        <h1 class="main-header" style="margin: 0;">FANTASY BASKETBALL SIMULATOR</h1>
    </div>
    ''', unsafe_allow_html=True)
    st.markdown('<p style="text-align: center; color: #888; font-family: Roboto Condensed;">Monte Carlo Simulation for ESPN Fantasy Basketball <span style="color: #00FF88;"><i class="bi bi-arrow-repeat"></i> Fresh Data Each Run</span></p>', unsafe_allow_html=True)
    
    # Sidebar Configuration
    with st.sidebar:
        st.markdown('<h2><i class="bi bi-gear-fill" style="color: #FF6B35;"></i> Configuration</h2>', unsafe_allow_html=True)
        
        st.markdown('<h4><i class="bi bi-link-45deg" style="color: #00D4FF;"></i> ESPN Credentials</h4>', unsafe_allow_html=True)
        league_id = st.number_input("League ID", value=267469544, help="Your ESPN League ID")
        year = st.number_input("Season Year", value=2026, min_value=2020, max_value=2030)
        
        espn_s2 = st.text_input(
            "ESPN S2 Cookie", 
            value="AEBSyUk%2FmdLqOc%2BSzyDjGNUS5ikQCnK8FvvsGLMAu7mVyKgLRXAa6q6s9eaLrXj3rPzfOoB9H%2BIukXFCBnnSjLEjnSmOIiRzuXP8bEZGpYrVN4FJ5OgT3FuHfRmKV0SrwKJRbyjW0Irlz%2BTyk2QCsg5eTa7GtgXJ8sxXaF9MVhjc9ielluRUU%2FbGcCrpIAOhAzkbklw4Gs2UsEBHdWXzgMO6TUWJjzFN5afsaby20y9ONU5rz6r1J27VWoC5YgUiR3NpH%2F4hpyMf0xXvJUGv9fSI5lt6%2BskojM22lBfr2DwJgA%3D%3D",
            type="password",
            help="Found in ESPN cookies"
        )
        
        swid = st.text_input(
            "SWID Cookie",
            value="{D7E89394-85F1-4264-831E-481F3B4157D4}",
            type="password",
            help="Found in ESPN cookies"
        )
        
        team_id = st.number_input("Your Team ID", value=6, min_value=1, max_value=20)
        
        st.markdown('<h4><i class="bi bi-sliders" style="color: #00D4FF;"></i> Simulation Settings</h4>', unsafe_allow_html=True)
        sim_count = st.slider("Simulations", 1000, 50000, 10000, 1000, help="More = more accurate but slower")
        blend_weight = st.slider("Last 30 Days Weight", 0.0, 1.0, 0.7, 0.05, help="Blend of recent vs season stats")
        num_streamers = st.slider("Streamers to Analyze", 5, 100, 20, 5, help="Number of free agents to analyze")
        
        st.markdown('<h4><i class="bi bi-shield-fill" style="color: #FFD93D;"></i> Roster Settings</h4>', unsafe_allow_html=True)
        has_open_spot = st.checkbox("I have an open roster spot", value=False, 
                                    help="Check if you have an empty roster spot and can add without dropping")
        
        untouchables_input = st.text_area(
            "Untouchable Players",
            value="Tyrese Maxey\nNikola Jokic\nJalen Williams\nVJ Edgecombe\nNikola Vucevic\nJa Morant\nIvica Zubac\nKawhi Leonard\nKel'el Ware\nShaedon Sharpe\nKyshawn George\nMatas Buzelis",
            help="Enter player names (one per line) that should never be recommended as drops",
            placeholder="LeBron James\nStephen Curry\nKevin Durant"
        )
        untouchables = [p.strip() for p in untouchables_input.split("\n") if p.strip()]
        
        st.markdown('<h4><i class="bi bi-star-fill" style="color: #FFD93D;"></i> Watchlist</h4>', unsafe_allow_html=True)
        watchlist_input = st.text_area(
            "Manual Watchlist",
            value="",
            help="Enter player names (one per line) to prioritize in streamer analysis. These will be marked with 'W' in results.",
            placeholder="Paste player names from your ESPN watchlist here\nOne name per line"
        )
        manual_watchlist = [p.strip() for p in watchlist_input.split("\n") if p.strip()]
        
        st.markdown("---")
        run_button = st.button("RUN SIMULATION", use_container_width=True)
    
    # Main content area
    if run_button:
        try:
            # Connect to ESPN
            with st.spinner("Connecting to ESPN..."):
                league = connect_to_espn(league_id, year, espn_s2, swid)
                fetch_time = datetime.now(ZoneInfo("America/New_York")).strftime("%I:%M %p ET")
                st.success(f"Connected to **{league.settings.name}** - Data fetched at {fetch_time}")
            
            # Get matchup info
            with st.spinner("Loading matchup data..."):
                your_team_obj, opp_team_obj, matchup, current_week = get_matchup_info(league, team_id)
                your_team_name = your_team_obj.team_name
                opp_team_name = opp_team_obj.team_name
                current_you, current_opp = get_current_totals(matchup, team_id)
            
            # Display matchup header
            col1, col2, col3 = st.columns([2, 1, 2])
            with col1:
                st.markdown(f'<h3><i class="bi bi-house-fill" style="color: #00FF88;"></i> {your_team_name}</h3>', unsafe_allow_html=True)
            with col2:
                st.markdown(f"<h3 style='text-align: center; color: #FF6B35;'>Week {current_week}</h3>", unsafe_allow_html=True)
            with col3:
                st.markdown(f'<h3><i class="bi bi-person-fill" style="color: #FF4757;"></i> {opp_team_name}</h3>', unsafe_allow_html=True)
            
            # Build player stats
            status_text = st.empty()
            progress = st.progress(0)
            status_text.text("Loading player stats...")
            
            your_filtered = filter_injured(your_team_obj.roster)
            opp_filtered = filter_injured(opp_team_obj.roster)
            
            your_season = build_stat_df(your_filtered, f"{year}_total", "Season", your_team_name, year)
            your_last30 = build_stat_df(your_filtered, f"{year}_last_30", "Last30", your_team_name, year)
            opp_season = build_stat_df(opp_filtered, f"{year}_total", "Season", opp_team_name, year)
            opp_last30 = build_stat_df(opp_filtered, f"{year}_last_30", "Last30", opp_team_name, year)
            
            progress.progress(25)
            status_text.text("Fetching NBA schedules...")
            
            your_season = add_games_left(your_season)
            your_last30 = add_games_left(your_last30)
            opp_season = add_games_left(opp_season)
            opp_last30 = add_games_left(opp_last30)
            
            progress.progress(50)
            status_text.text("Blending statistics...")
            
            # Blend stats
            season_df = pd.concat([your_season, opp_season], ignore_index=True)
            last30_df = pd.concat([your_last30, opp_last30], ignore_index=True)
            
            merged = pd.merge(last30_df, season_df, on="Player", suffixes=("_30", "_season"))
            for col in NUMERIC_COLS:
                merged[col] = merged[f"{col}_30"] * blend_weight + merged[f"{col}_season"] * (1 - blend_weight)
            
            merged["Games Left"] = merged["Games Left_30"]
            merged["Team"] = merged["Team_30"]
            merged["NBA_Team"] = merged["NBA_Team_30"]
            
            your_team_df = merged[merged["Team"] == your_team_name].copy()
            opp_team_df = merged[merged["Team"] == opp_team_name].copy()
            
            your_team_df = your_team_df[your_team_df["Games Left"] > 0]
            opp_team_df = opp_team_df[opp_team_df["Games Left"] > 0]
            
            progress.progress(75)
            status_text.text(f"Running {sim_count:,} simulations...")
            
            # Run simulation
            your_sim_raw = simulate_team(your_team_df, sims=sim_count)
            opp_sim_raw = simulate_team(opp_team_df, sims=sim_count)
            
            your_sim = add_current_to_sim(current_you, your_sim_raw)
            opp_sim = add_current_to_sim(current_opp, opp_sim_raw)
            
            matchup_results, category_results, outcome_counts = compare_matchups(your_sim, opp_sim, CATEGORIES)
            
            progress.progress(100)
            status_text.text("Complete!")
            progress.empty()
            status_text.empty()
            
            # Calculate key metrics
            total_sims = sum(matchup_results.values())
            win_pct = matchup_results["you"] / total_sims * 100
            baseline_avg_cats = sum(your_w * count for (your_w, opp_w), count in outcome_counts.items()) / total_sims
            
            # Store data in session state for tabs
            st.session_state['simulation_done'] = True
            st.session_state['league'] = league
            st.session_state['year'] = year
            st.session_state['team_id'] = team_id
            
            # Create tabs for different sections
            tab_matchup, tab_streamers, tab_strategy, tab_season, tab_league = st.tabs([
                "Matchup Analysis",
                "Streamer Analysis", 
                "Bench Strategy",
                "My Season Stats",
                "League Stats"
            ])
            
            # ==================== TAB 1: MATCHUP ANALYSIS ====================
            with tab_matchup:
                st.markdown('<h2><i class="bi bi-bar-chart-fill" style="color: #FF6B35;"></i> Simulation Results</h2>', unsafe_allow_html=True)
                
                # Current Scoreboard
                st.markdown('<h3><i class="bi bi-trophy-fill" style="color: #FFD93D;"></i> Current Scoreboard</h3>', unsafe_allow_html=True)
                st.markdown(create_scoreboard(current_you, current_opp, your_team_name, opp_team_name), unsafe_allow_html=True)
                
                # Key metrics row
                st.markdown('<h3><i class="bi bi-graph-up-arrow" style="color: #00FF88;"></i> Key Metrics</h3>', unsafe_allow_html=True)
                your_roster_games = int(your_team_df["Games Left"].sum())
                opp_roster_games = int(opp_team_df["Games Left"].sum())
                metric_cols = st.columns(5)
                with metric_cols[0]:
                    st.metric("Expected Cats", f"{baseline_avg_cats:.1f}", delta=f"{baseline_avg_cats - 7.5:.1f} vs even")
                with metric_cols[1]:
                    sorted_outcomes = sorted(outcome_counts.items(), key=lambda x: x[1], reverse=True)
                    most_likely = sorted_outcomes[0][0]
                    st.metric("Most Likely", f"{most_likely[0]}-{most_likely[1]}")
                with metric_cols[2]:
                    st.metric("Simulations", f"{sim_count:,}")
                with metric_cols[3]:
                    st.metric(f"{your_team_name} Games Left", your_roster_games)
                with metric_cols[4]:
                    st.metric(f"{opp_team_name} Games Left", opp_roster_games)
                
                # Win probability gauge and Score Distribution side by side
                col1, col2 = st.columns([1, 1])
                
                with col1:
                    st.markdown('<h3><i class="bi bi-bullseye" style="color: #00D4FF;"></i> Win Probability</h3>', unsafe_allow_html=True)
                    st.plotly_chart(create_win_probability_gauge(win_pct), use_container_width=True)
                
                with col2:
                    st.markdown('<h3><i class="bi bi-dice-5-fill" style="color: #FFD93D;"></i> Score Distribution</h3>', unsafe_allow_html=True)
                    st.plotly_chart(create_outcome_distribution(outcome_counts, total_sims), use_container_width=True)
                
                # Category breakdown
                st.markdown('<h3><i class="bi bi-clipboard-data-fill" style="color: #00D4FF;"></i> Category Analysis</h3>', unsafe_allow_html=True)
                st.plotly_chart(create_category_chart(category_results, your_sim, opp_sim), use_container_width=True)
                
                # Detailed category table
                with st.expander("Detailed Category Projections", expanded=False):
                    cat_data = []
                    for cat in CATEGORIES:
                        outcome = category_results[cat]
                        total_cat = sum(outcome.values())
                        you_pct = outcome["you"] / total_cat * 100
                        opp_pct = outcome["opponent"] / total_cat * 100
                        
                        y_proj = np.mean(your_sim[cat])
                        o_proj = np.mean(opp_sim[cat])
                        y_ci = (np.percentile(your_sim[cat], 10), np.percentile(your_sim[cat], 90))
                        o_ci = (np.percentile(opp_sim[cat], 10), np.percentile(opp_sim[cat], 90))
                        
                        is_swing = abs(you_pct - opp_pct) <= 15
                        
                        cat_data.append({
                            "Category": cat,
                            "You Win %": f"{you_pct:.0f}%",
                            "Opp Win %": f"{opp_pct:.0f}%",
                            "Your Proj": f"{y_proj:.2f}" if "%" in cat else f"{y_proj:.1f}",
                            "Opp Proj": f"{o_proj:.2f}" if "%" in cat else f"{o_proj:.1f}",
                            "Your CI": f"{y_ci[0]:.1f} - {y_ci[1]:.1f}",
                            "Opp CI": f"{o_ci[0]:.1f} - {o_ci[1]:.1f}",
                            "Swing": "*" if is_swing else ""
                        })
                    
                    st.dataframe(pd.DataFrame(cat_data), use_container_width=True, hide_index=True, height=560)
                
                # Rosters
                with st.expander("Your Roster"):
                    roster_cols = ["Player", "NBA_Team", "Games Left", "PTS", "REB", "AST", "3PM", "FG%", "FT%"]
                    display_cols = [c for c in roster_cols if c in your_team_df.columns]
                    display_df = your_team_df[display_cols].round(2).copy()
                    if untouchables:
                        untouchables_lower = [p.lower().strip() for p in untouchables]
                        display_df["Lock"] = display_df["Player"].str.lower().str.strip().isin(untouchables_lower).map({True: "Y", False: ""})
                    st.dataframe(display_df, use_container_width=True, hide_index=True)
                
                with st.expander("Opponent Roster"):
                    display_cols = [c for c in roster_cols if c in opp_team_df.columns]
                    st.dataframe(opp_team_df[display_cols].round(2), use_container_width=True, hide_index=True)
            
            # ==================== TAB 2: STREAMER ANALYSIS ====================
            with tab_streamers:
                st.markdown('<h2><i class="bi bi-arrow-repeat" style="color: #FF6B35;"></i> Streamer Analysis</h2>', unsafe_allow_html=True)
                
                if untouchables:
                    st.markdown(f'<div style="padding: 0.75rem; background: rgba(0, 212, 255, 0.1); border-left: 4px solid #00D4FF; border-radius: 4px; margin-bottom: 1rem;"><i class="bi bi-lock-fill" style="color: #00D4FF;"></i> <strong>Untouchable players:</strong> {", ".join(untouchables)}</div>', unsafe_allow_html=True)
                if has_open_spot:
                    st.markdown('<div style="padding: 0.75rem; background: rgba(0, 255, 136, 0.1); border-left: 4px solid #00FF88; border-radius: 4px; margin-bottom: 1rem;"><i class="bi bi-check-circle-fill" style="color: #00FF88;"></i> You have an open roster spot - streamers can be added without dropping anyone</div>', unsafe_allow_html=True)
                
                with st.spinner(f"Analyzing {num_streamers} potential streamers (considering drop candidates)..."):
                    baseline_results = (win_pct, category_results, baseline_avg_cats)
                    streamers = analyze_streamers(
                        league, your_team_df, opp_team_df, 
                        current_you, current_opp, baseline_results,
                        blend_weight, year, num_streamers,
                        untouchables=untouchables,
                        has_open_roster_spot=has_open_spot,
                        manual_watchlist=manual_watchlist
                    )
                
                if streamers:
                    st.markdown('<h3><i class="bi bi-star-fill" style="color: #FFD93D;"></i> Top Recommendations</h3>', unsafe_allow_html=True)
                    
                    top_3 = streamers[:3]
                    cols = st.columns(3)
                    
                    for i, player in enumerate(top_3):
                        with cols[i]:
                            delta_color = "#00FF88" if player["Δ Cats"] > 0 else "#FF4757" if player["Δ Cats"] < 0 else "#FFD93D"
                            border_color = delta_color
                            
                            drop_text = player["Drop"]
                            if drop_text == "(Open Spot)":
                                drop_display = '<span style="color: #00FF88;">Add (Open Spot)</span>'
                            else:
                                drop_display = f'<span style="color: #FF4757;">Drop: {drop_text}</span>'
                            
                            watchlist_badge = ' <i class="bi bi-star-fill" style="color: #FFD93D; font-size: 0.9rem;"></i>' if player.get("Watchlist") else ""
                            status_tag = f" <span style='color: #FFD93D;'>({player['Status']})</span>" if player.get("Status") else ""
                            
                            st.markdown(f"""
                            <div style="background: linear-gradient(145deg, #252545, #1A1A2E); 
                                        border-radius: 12px; padding: 1.2rem; 
                                        border-left: 4px solid {border_color};">
                                <h4 style="margin: 0; color: white; font-family: Oswald;">{player['Player']}{watchlist_badge}</h4>
                                <p style="color: #888; margin: 0.3rem 0; font-size: 0.9rem;">{player['Team']} - {player['Games']} games{status_tag}</p>
                                <p style="margin: 0.5rem 0; font-size: 0.85rem;">{drop_display}</p>
                                <div style="display: flex; justify-content: space-between; margin-top: 0.8rem;">
                                    <div>
                                        <span style="color: #888; font-size: 0.8rem;">Δ CATS</span><br/>
                                        <span style="color: {delta_color}; font-size: 1.5rem; font-family: Oswald; font-weight: 600;">
                                            {player['Δ Cats']:+.2f}
                                        </span>
                                    </div>
                                    <div>
                                        <span style="color: #888; font-size: 0.8rem;">EXP CATS</span><br/>
                                        <span style="color: white; font-size: 1.5rem; font-family: Oswald;">
                                            {player['Exp Cats']:.1f}
                                        </span>
                                    </div>
                                    <div>
                                        <span style="color: #888; font-size: 0.8rem;">WIN %</span><br/>
                                        <span style="color: white; font-size: 1.5rem; font-family: Oswald;">
                                            {player['Win %']:.0f}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                            """, unsafe_allow_html=True)
                            
                            if player["Cat Impacts"]:
                                impacts_str = ", ".join([f"{'▲' if v > 0 else '▼'}{k}: {v:+.0f}%" for k, v in sorted(player["Cat Impacts"].items(), key=lambda x: abs(x[1]), reverse=True)[:3]])
                                st.caption(impacts_str)
                            
                            if player["Risks"]:
                                st.caption(f"Risk: {', '.join(player['Risks'])}")
                    
                    with st.expander("All Analyzed Streamers"):
                        streamer_df = pd.DataFrame([{
                            "WL": p.get("Watchlist", ""),
                            "Player": p["Player"],
                            "Team": p["Team"],
                            "Status": p.get("Status", ""),
                            "Games": p["Games"],
                            "Drop": p["Drop"],
                            "Δ Cats": p["Δ Cats"],
                            "Exp Cats": p["Exp Cats"],
                            "Win %": p["Win %"],
                            "PTS": p["PTS"],
                            "REB": p["REB"],
                            "AST": p["AST"],
                            "Risks": ", ".join(p["Risks"]) if p["Risks"] else ""
                        } for p in streamers])
                        
                        st.dataframe(streamer_df, use_container_width=True, hide_index=True)
                else:
                    st.warning("No streamers found with games remaining this week.")
            
            # ==================== TAB 3: BENCH STRATEGY ====================
            with tab_strategy:
                st.markdown('<h2><i class="bi bi-pause-circle-fill" style="color: #FF6B35;"></i> Bench Strategy Analysis</h2>', unsafe_allow_html=True)
                st.markdown('<p style="color: #888;">Should you bench your players today to protect your lead? This analyzes whether sitting everyone improves your expected categories won.</p>', unsafe_allow_html=True)
                
                with st.spinner("Analyzing bench vs play scenarios..."):
                    bench_analysis = analyze_bench_strategy(
                        your_team_df, opp_team_df,
                        current_you, current_opp,
                        (win_pct, category_results, baseline_avg_cats)
                    )
                
                is_bench_better = bench_analysis["recommendation"] == "BENCH"
                rec_color = "#FFD93D" if is_bench_better else "#00FF88"
                rec_icon = "bi-pause-circle-fill" if is_bench_better else "bi-play-circle-fill"
                
                st.markdown(f"""
                <div style="background: linear-gradient(145deg, #252545, #1A1A2E); 
                            border-radius: 16px; padding: 1.5rem; 
                            border: 2px solid {rec_color}; margin-bottom: 1.5rem;">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <i class="{rec_icon}" style="font-size: 3rem; color: {rec_color};"></i>
                        <div>
                            <h3 style="margin: 0; color: {rec_color}; font-family: Oswald;">RECOMMENDATION: {bench_analysis["recommendation"]}</h3>
                            <p style="margin: 0.5rem 0 0 0; color: #888;">
                                Expected cats difference: <strong style="color: white;">{bench_analysis["cats_diff"]:+.2f}</strong> | 
                                Win % difference: <strong style="color: white;">{bench_analysis["win_pct_diff"]:+.1f}%</strong>
                            </p>
                        </div>
                    </div>
                </div>
                """, unsafe_allow_html=True)
                
                col1, col2 = st.columns(2)
                
                with col1:
                    st.markdown(f"""
                    <div style="background: linear-gradient(145deg, #1A1A2E, #252545); border-radius: 12px; padding: 1.2rem; border-left: 4px solid #00FF88;">
                        <h4 style="margin: 0; color: #00FF88; font-family: Oswald;"><i class="bi bi-play-fill"></i> PLAY SCENARIO</h4>
                        <div style="margin-top: 1rem;">
                            <p style="margin: 0.3rem 0; color: #888;">Win Probability: <span style="color: white; font-size: 1.3rem; font-family: Oswald;">{bench_analysis["play"]["win_pct"]:.1f}%</span></p>
                            <p style="margin: 0.3rem 0; color: #888;">Expected Cats: <span style="color: white; font-size: 1.3rem; font-family: Oswald;">{bench_analysis["play"]["avg_cats"]:.2f}</span></p>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    if bench_analysis["play_helps"]:
                        st.markdown("<p style='color: #888; margin-top: 0.5rem;'><strong>Playing helps:</strong></p>", unsafe_allow_html=True)
                        for cat, diff in bench_analysis["play_helps"][:5]:
                            st.markdown(f"<span style='color: #00FF88;'>▲ {cat}: +{diff:.1f}%</span>", unsafe_allow_html=True)
                
                with col2:
                    st.markdown(f"""
                    <div style="background: linear-gradient(145deg, #1A1A2E, #252545); border-radius: 12px; padding: 1.2rem; border-left: 4px solid #FFD93D;">
                        <h4 style="margin: 0; color: #FFD93D; font-family: Oswald;"><i class="bi bi-pause-fill"></i> BENCH SCENARIO</h4>
                        <div style="margin-top: 1rem;">
                            <p style="margin: 0.3rem 0; color: #888;">Win Probability: <span style="color: white; font-size: 1.3rem; font-family: Oswald;">{bench_analysis["bench"]["win_pct"]:.1f}%</span></p>
                            <p style="margin: 0.3rem 0; color: #888;">Expected Cats: <span style="color: white; font-size: 1.3rem; font-family: Oswald;">{bench_analysis["bench"]["avg_cats"]:.2f}</span></p>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    if bench_analysis["bench_helps"]:
                        st.markdown("<p style='color: #888; margin-top: 0.5rem;'><strong>Benching helps:</strong></p>", unsafe_allow_html=True)
                        for cat, diff in bench_analysis["bench_helps"][:5]:
                            st.markdown(f"<span style='color: #FFD93D;'>▲ {cat}: +{diff:.1f}%</span>", unsafe_allow_html=True)
                
                with st.expander("Detailed Category Comparison (Play vs Bench)"):
                    bench_cat_data = []
                    for cat in CATEGORIES:
                        play_pct = bench_analysis["play"]["cat_results"][cat]["win_pct"]
                        bench_pct = bench_analysis["bench"]["cat_results"][cat]["win_pct"]
                        diff = bench_pct - play_pct
                        better = "Bench" if diff > 2 else "Play" if diff < -2 else "Same"
                        bench_cat_data.append({
                            "Category": cat,
                            "Play Win %": f"{play_pct:.1f}%",
                            "Bench Win %": f"{bench_pct:.1f}%",
                            "Difference": f"{diff:+.1f}%",
                            "Better": better
                        })
                    st.dataframe(pd.DataFrame(bench_cat_data), use_container_width=True, hide_index=True)
            
            # ==================== TAB 4: MY SEASON STATS ====================
            with tab_season:
                st.markdown('<h2><i class="bi bi-people-fill" style="color: #FF6B35;"></i> My Season Stats</h2>', unsafe_allow_html=True)
                st.markdown('<p style="color: #888;">All players who have contributed to your team this season, with their total stats and percentage of team production.</p>', unsafe_allow_html=True)
                
                # Load data (this runs once when tab is first opened)
                # Get weekly stats for your team
                current_week = league.currentMatchupPeriod
                
                # Initialize season totals and player tracking
                season_totals = {"FGM": 0, "FGA": 0, "FTM": 0, "FTA": 0, "3PM": 0, "3PA": 0, 
                                "REB": 0, "AST": 0, "STL": 0, "BLK": 0, "TO": 0, "PTS": 0}
                player_season_stats = {}
                weekly_data = []
                
                with st.spinner("Loading player season statistics..."):
                    for week in range(1, current_week + 1):
                        try:
                            boxscores = league.box_scores(matchup_period=week)
                            
                            for matchup in boxscores:
                                # Find your team's matchup
                                if matchup.home_team.team_id == team_id:
                                    week_stats = flatten_stat_dict(matchup.home_stats)
                                    opponent = matchup.away_team.team_name
                                    lineup = matchup.home_lineup if hasattr(matchup, 'home_lineup') else []
                                elif matchup.away_team.team_id == team_id:
                                    week_stats = flatten_stat_dict(matchup.away_stats)
                                    opponent = matchup.home_team.team_name
                                    lineup = matchup.away_lineup if hasattr(matchup, 'away_lineup') else []
                                else:
                                    continue
                                
                                # Add to season totals
                                for stat in season_totals.keys():
                                    season_totals[stat] += week_stats.get(stat, 0)
                                
                                # Calculate weekly result
                                fgm, fga = week_stats.get("FGM", 0), week_stats.get("FGA", 0)
                                fg_pct = fgm / fga if fga > 0 else 0
                                
                                weekly_data.append({
                                    "Week": week,
                                    "Opponent": opponent,
                                    "PTS": week_stats.get("PTS", 0),
                                    "REB": week_stats.get("REB", 0),
                                    "AST": week_stats.get("AST", 0),
                                })
                                
                                # Extract player stats from lineup
                                if lineup:
                                    for player_entry in lineup:
                                        try:
                                            # Get player name
                                            player_name = getattr(player_entry, 'name', None)
                                            if not player_name:
                                                continue
                                            
                                            # Get slot position - skip bench/IR
                                            slot = getattr(player_entry, 'slot_position', "")
                                            if slot in ["BE", "IR", "Bench", "IR+"]:
                                                continue
                                            
                                            # Initialize player if first time seeing them
                                            if player_name not in player_season_stats:
                                                player_season_stats[player_name] = {
                                                    "GP": 0, "PTS": 0, "REB": 0, "AST": 0, 
                                                    "STL": 0, "BLK": 0, "3PM": 0, "TO": 0,
                                                    "FGM": 0, "FGA": 0, "FTM": 0, "FTA": 0,
                                                    "3PA": 0, "DD": 0, "TW": 0
                                                }
                                            
                                            # Get player's stats for this week
                                            # Try points_breakdown first (most detailed)
                                            if hasattr(player_entry, 'points_breakdown') and player_entry.points_breakdown:
                                                pb = player_entry.points_breakdown
                                                # Count actual games played (estimate from stats)
                                                # If player has any stats, they played
                                                games_this_week = pb.get("GP", 0)
                                                if games_this_week == 0 and pb.get("PTS", 0) > 0:
                                                    # Estimate games from minutes or just count as playing
                                                    games_this_week = max(1, int(pb.get("MIN", 0) / 30)) if pb.get("MIN", 0) > 0 else (1 if pb.get("PTS", 0) > 0 else 0)
                                                
                                                player_season_stats[player_name]["GP"] += games_this_week if games_this_week > 0 else (1 if pb.get("PTS", 0) > 0 else 0)
                                                player_season_stats[player_name]["PTS"] += pb.get("PTS", 0)
                                                player_season_stats[player_name]["REB"] += pb.get("REB", 0)
                                                player_season_stats[player_name]["AST"] += pb.get("AST", 0)
                                                player_season_stats[player_name]["STL"] += pb.get("STL", 0)
                                                player_season_stats[player_name]["BLK"] += pb.get("BLK", 0)
                                                player_season_stats[player_name]["3PM"] += pb.get("3PM", 0)
                                                player_season_stats[player_name]["TO"] += pb.get("TO", 0)
                                                player_season_stats[player_name]["FGM"] += pb.get("FGM", 0)
                                                player_season_stats[player_name]["FGA"] += pb.get("FGA", 0)
                                                player_season_stats[player_name]["FTM"] += pb.get("FTM", 0)
                                                player_season_stats[player_name]["FTA"] += pb.get("FTA", 0)
                                                player_season_stats[player_name]["3PA"] += pb.get("3PA", 0)
                                                player_season_stats[player_name]["DD"] += pb.get("DD", 0)
                                                player_season_stats[player_name]["TW"] += pb.get("TW", 0)
                                            # Fallback to stats dict
                                            elif hasattr(player_entry, 'stats') and player_entry.stats:
                                                stats = player_entry.stats
                                                if isinstance(stats, dict):
                                                    games_this_week = stats.get("GP", 0)
                                                    if games_this_week == 0 and stats.get("PTS", 0) > 0:
                                                        games_this_week = 1
                                                    player_season_stats[player_name]["GP"] += games_this_week
                                                    player_season_stats[player_name]["PTS"] += stats.get("PTS", 0)
                                                    player_season_stats[player_name]["REB"] += stats.get("REB", 0)
                                                    player_season_stats[player_name]["AST"] += stats.get("AST", 0)
                                                    player_season_stats[player_name]["STL"] += stats.get("STL", 0)
                                                    player_season_stats[player_name]["BLK"] += stats.get("BLK", 0)
                                                    player_season_stats[player_name]["3PM"] += stats.get("3PM", 0)
                                                    player_season_stats[player_name]["TO"] += stats.get("TO", 0)
                                                    player_season_stats[player_name]["FGM"] += stats.get("FGM", 0)
                                                    player_season_stats[player_name]["FGA"] += stats.get("FGA", 0)
                                                    player_season_stats[player_name]["TW"] += stats.get("TW", 0)
                                        except Exception as e:
                                            continue
                                
                                break  # Found our matchup, move to next week
                        except Exception as e:
                            continue
                
                # Calculate season percentages
                season_fg_pct = season_totals["FGM"] / season_totals["FGA"] if season_totals["FGA"] > 0 else 0
                season_ft_pct = season_totals["FTM"] / season_totals["FTA"] if season_totals["FTA"] > 0 else 0
                season_3p_pct = season_totals["3PM"] / season_totals["3PA"] if season_totals["3PA"] > 0 else 0
                
                # Season Totals Summary Card
                st.markdown('<h3><i class="bi bi-bar-chart-line-fill" style="color: #00FF88;"></i> Team Season Totals</h3>', unsafe_allow_html=True)
                
                col1, col2, col3, col4 = st.columns(4)
                with col1:
                    st.metric("Total Points", f"{int(season_totals['PTS']):,}")
                    st.metric("Total Rebounds", f"{int(season_totals['REB']):,}")
                with col2:
                    st.metric("Total Assists", f"{int(season_totals['AST']):,}")
                    st.metric("Total Steals", f"{int(season_totals['STL']):,}")
                with col3:
                    st.metric("Total Blocks", f"{int(season_totals['BLK']):,}")
                    st.metric("Total 3PM", f"{int(season_totals['3PM']):,}")
                with col4:
                    st.metric("FG%", f"{season_fg_pct:.3f}")
                    st.metric("FT%", f"{season_ft_pct:.3f}")
                
                # Player Stats Table - TOTALS
                st.markdown('<h3><i class="bi bi-person-lines-fill" style="color: #00D4FF;"></i> Player Contributions (Season Totals)</h3>', unsafe_allow_html=True)
                
                if player_season_stats:
                    # Build player dataframe for totals
                    player_data_total = []
                    
                    for name, stats in player_season_stats.items():
                        # Player percentages
                        player_fg_pct = stats["FGM"] / stats["FGA"] if stats["FGA"] > 0 else 0
                        player_ft_pct = stats["FTM"] / stats["FTA"] if stats["FTA"] > 0 else 0
                        player_3p_pct = stats["3PM"] / stats["3PA"] if stats["3PA"] > 0 else 0
                        
                        # Total view - ESPN column order
                        player_data_total.append({
                            "Player": name,
                            "GP": stats["GP"],
                            "FGM": int(stats["FGM"]),
                            "FGA": int(stats["FGA"]),
                            "FG%": f"{player_fg_pct:.4f}",
                            "FT%": f"{player_ft_pct:.4f}",
                            "3PM": int(stats["3PM"]),
                            "3PA": int(stats["3PA"]),
                            "3P%": f"{player_3p_pct:.4f}",
                            "REB": int(stats["REB"]),
                            "AST": int(stats["AST"]),
                            "STL": int(stats["STL"]),
                            "BLK": int(stats["BLK"]),
                            "TO": int(stats["TO"]),
                            "DD": int(stats.get("DD", 0)),
                            "PTS": int(stats["PTS"]),
                            "TW": int(stats.get("TW", 0)),
                            "_pts_raw": stats["PTS"],
                        })
                    
                    # Sort by total points (highest first)
                    player_data_total = sorted(player_data_total, key=lambda x: x["_pts_raw"], reverse=True)
                    
                    # Remove sorting column before display
                    for p in player_data_total:
                        del p["_pts_raw"]
                    
                    player_df_total = pd.DataFrame(player_data_total)
                    
                    st.dataframe(
                        player_df_total, 
                        use_container_width=True, 
                        hide_index=True,
                        column_config={
                            "Player": st.column_config.TextColumn(width="medium"),
                            "GP": st.column_config.NumberColumn(width="small"),
                        }
                    )
                    
                    # Player Stats Table - PER GAME AVERAGES
                    st.markdown('<h3><i class="bi bi-calculator" style="color: #00FF88;"></i> Player Contributions (Per Game Average)</h3>', unsafe_allow_html=True)
                    
                    player_data_avg = []
                    
                    for name, stats in player_season_stats.items():
                        # Player percentages
                        player_fg_pct = stats["FGM"] / stats["FGA"] if stats["FGA"] > 0 else 0
                        player_ft_pct = stats["FTM"] / stats["FTA"] if stats["FTA"] > 0 else 0
                        player_3p_pct = stats["3PM"] / stats["3PA"] if stats["3PA"] > 0 else 0
                        
                        gp = stats["GP"] if stats["GP"] > 0 else 1  # Avoid division by zero
                        
                        # Average view - same order
                        player_data_avg.append({
                            "Player": name,
                            "GP": stats["GP"],
                            "FGM": round(stats["FGM"] / gp, 1),
                            "FGA": round(stats["FGA"] / gp, 1),
                            "FG%": f"{player_fg_pct:.4f}",
                            "FT%": f"{player_ft_pct:.4f}",
                            "3PM": round(stats["3PM"] / gp, 1),
                            "3PA": round(stats["3PA"] / gp, 1),
                            "3P%": f"{player_3p_pct:.4f}",
                            "REB": round(stats["REB"] / gp, 1),
                            "AST": round(stats["AST"] / gp, 1),
                            "STL": round(stats["STL"] / gp, 1),
                            "BLK": round(stats["BLK"] / gp, 1),
                            "TO": round(stats["TO"] / gp, 1),
                            "DD": round(stats.get("DD", 0) / gp, 2),
                            "PTS": round(stats["PTS"] / gp, 1),
                            "TW": round(stats.get("TW", 0) / gp, 2),
                            "_pts_raw": stats["PTS"],
                        })
                    
                    # Sort by total points (highest first)
                    player_data_avg = sorted(player_data_avg, key=lambda x: x["_pts_raw"], reverse=True)
                    
                    # Remove sorting column before display
                    for p in player_data_avg:
                        del p["_pts_raw"]
                    
                    player_df_avg = pd.DataFrame(player_data_avg)
                    
                    st.dataframe(
                        player_df_avg, 
                        use_container_width=True, 
                        hide_index=True,
                        column_config={
                            "Player": st.column_config.TextColumn(width="medium"),
                            "GP": st.column_config.NumberColumn(width="small"),
                        }
                    )
                    
                    # Top contributors summary - use total data for leaders
                    st.markdown('<h3><i class="bi bi-award-fill" style="color: #FFD93D;"></i> Top Contributors</h3>', unsafe_allow_html=True)
                    
                    # Find leaders in each category from raw stats
                    if player_season_stats:
                        # Get leaders from raw stats
                        pts_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["PTS"])
                        reb_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["REB"])
                        ast_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["AST"])
                        stl_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["STL"])
                        blk_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["BLK"])
                        tpm_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["3PM"])
                        
                        col1, col2, col3 = st.columns(3)
                        with col1:
                            pts_val = int(player_season_stats[pts_leader_name]["PTS"])
                            pts_pct = (pts_val / season_totals["PTS"] * 100) if season_totals["PTS"] > 0 else 0
                            st.markdown(f"""
                            <div style="background: linear-gradient(145deg, #1A1A2E, #252545); border-radius: 8px; padding: 1rem; margin-bottom: 0.5rem;">
                                <p style="color: #888; margin: 0; font-size: 0.8rem;">POINTS LEADER</p>
                                <p style="color: #FF6B35; margin: 0; font-family: Oswald; font-size: 1.2rem;">{pts_leader_name}</p>
                                <p style="color: white; margin: 0;">{pts_val:,} pts ({pts_pct:.1f}%)</p>
                            </div>
                            """, unsafe_allow_html=True)
                            stl_val = int(player_season_stats[stl_leader_name]["STL"])
                            st.markdown(f"""
                            <div style="background: linear-gradient(145deg, #1A1A2E, #252545); border-radius: 8px; padding: 1rem;">
                                <p style="color: #888; margin: 0; font-size: 0.8rem;">STEALS LEADER</p>
                                <p style="color: #FF6B35; margin: 0; font-family: Oswald; font-size: 1.2rem;">{stl_leader_name}</p>
                                <p style="color: white; margin: 0;">{stl_val:,} stl</p>
                            </div>
                            """, unsafe_allow_html=True)
                        with col2:
                            reb_val = int(player_season_stats[reb_leader_name]["REB"])
                            reb_pct = (reb_val / season_totals["REB"] * 100) if season_totals["REB"] > 0 else 0
                            st.markdown(f"""
                            <div style="background: linear-gradient(145deg, #1A1A2E, #252545); border-radius: 8px; padding: 1rem; margin-bottom: 0.5rem;">
                                <p style="color: #888; margin: 0; font-size: 0.8rem;">REBOUNDS LEADER</p>
                                <p style="color: #00D4FF; margin: 0; font-family: Oswald; font-size: 1.2rem;">{reb_leader_name}</p>
                                <p style="color: white; margin: 0;">{reb_val:,} reb ({reb_pct:.1f}%)</p>
                            </div>
                            """, unsafe_allow_html=True)
                            blk_val = int(player_season_stats[blk_leader_name]["BLK"])
                            st.markdown(f"""
                            <div style="background: linear-gradient(145deg, #1A1A2E, #252545); border-radius: 8px; padding: 1rem;">
                                <p style="color: #888; margin: 0; font-size: 0.8rem;">BLOCKS LEADER</p>
                                <p style="color: #00D4FF; margin: 0; font-family: Oswald; font-size: 1.2rem;">{blk_leader_name}</p>
                                <p style="color: white; margin: 0;">{blk_val:,} blk</p>
                            </div>
                            """, unsafe_allow_html=True)
                        with col3:
                            ast_val = int(player_season_stats[ast_leader_name]["AST"])
                            ast_pct = (ast_val / season_totals["AST"] * 100) if season_totals["AST"] > 0 else 0
                            st.markdown(f"""
                            <div style="background: linear-gradient(145deg, #1A1A2E, #252545); border-radius: 8px; padding: 1rem; margin-bottom: 0.5rem;">
                                <p style="color: #888; margin: 0; font-size: 0.8rem;">ASSISTS LEADER</p>
                                <p style="color: #00FF88; margin: 0; font-family: Oswald; font-size: 1.2rem;">{ast_leader_name}</p>
                                <p style="color: white; margin: 0;">{ast_val:,} ast ({ast_pct:.1f}%)</p>
                            </div>
                            """, unsafe_allow_html=True)
                            tpm_val = int(player_season_stats[tpm_leader_name]["3PM"])
                            tpm_pct = (tpm_val / season_totals["3PM"] * 100) if season_totals["3PM"] > 0 else 0
                            st.markdown(f"""
                            <div style="background: linear-gradient(145deg, #1A1A2E, #252545); border-radius: 8px; padding: 1rem;">
                                <p style="color: #888; margin: 0; font-size: 0.8rem;">3PM LEADER</p>
                                <p style="color: #00FF88; margin: 0; font-family: Oswald; font-size: 1.2rem;">{tpm_leader_name}</p>
                                <p style="color: white; margin: 0;">{tpm_val:,} 3pm ({tpm_pct:.1f}%)</p>
                            </div>
                            """, unsafe_allow_html=True)
                else:
                    st.warning("No player data available. Player-level stats may not be accessible through the ESPN API for your league.")
                    
                    # Fallback to weekly breakdown
                    st.markdown('<h3><i class="bi bi-calendar-week-fill" style="color: #FFD93D;"></i> Weekly Breakdown</h3>', unsafe_allow_html=True)
                    if weekly_data:
                        weekly_df = pd.DataFrame(weekly_data)
                        st.dataframe(weekly_df, use_container_width=True, hide_index=True)
            
            # ==================== TAB 5: LEAGUE STATS ====================
            with tab_league:
                st.markdown('<h2><i class="bi bi-trophy-fill" style="color: #FF6B35;"></i> League Statistics</h2>', unsafe_allow_html=True)
                st.markdown('<p style="color: #888;">League standings, all-play records (your record if you played everyone every week), and luck factor analysis.</p>', unsafe_allow_html=True)
                
                with st.spinner("Calculating league statistics (this may take a moment)..."):
                    league_stats = calculate_league_stats(league, year)
                
                your_team_stats = next((t for t in league_stats if t["team_id"] == team_id), None)
                
                if your_team_stats:
                    luck_color = "#00FF88" if your_team_stats["luck"] > 0 else "#FF4757" if your_team_stats["luck"] < 0 else "#888"
                    luck_text = "Lucky" if your_team_stats["luck"] > 2 else "Unlucky" if your_team_stats["luck"] < -2 else "Average"
                    
                    st.markdown(f"""
                    <div style="background: linear-gradient(145deg, #252545, #1A1A2E); 
                                border-radius: 16px; padding: 1.5rem; 
                                border: 2px solid #FF6B35; margin-bottom: 1.5rem;">
                        <h3 style="margin: 0 0 1rem 0; color: #FF6B35; font-family: Oswald;">
                            <i class="bi bi-person-circle"></i> {your_team_stats["team_name"]} - #{your_team_stats["standing"]}
                        </h3>
                        <div style="display: flex; flex-wrap: wrap; gap: 2rem;">
                            <div>
                                <span style="color: #888; font-size: 0.85rem;">ACTUAL RECORD</span><br/>
                                <span style="color: white; font-size: 1.8rem; font-family: Oswald;">
                                    {your_team_stats["actual_wins"]}-{your_team_stats["actual_losses"]}-{your_team_stats["actual_ties"]}
                                </span>
                                <span style="color: #888; font-size: 1rem;"> ({your_team_stats["actual_pct"]:.3f})</span>
                            </div>
                            <div>
                                <span style="color: #888; font-size: 0.85rem;">ALL-PLAY RECORD</span><br/>
                                <span style="color: #00D4FF; font-size: 1.8rem; font-family: Oswald;">
                                    {your_team_stats["all_play_wins"]}-{your_team_stats["all_play_losses"]}-{your_team_stats["all_play_ties"]}
                                </span>
                                <span style="color: #888; font-size: 1rem;"> ({your_team_stats["all_play_pct"]:.3f})</span>
                            </div>
                            <div>
                                <span style="color: #888; font-size: 0.85rem;">LUCK FACTOR</span><br/>
                                <span style="color: {luck_color}; font-size: 1.8rem; font-family: Oswald;">
                                    {your_team_stats["luck"]:+.1f}%
                                </span>
                                <span style="color: {luck_color}; font-size: 1rem;"> ({luck_text})</span>
                            </div>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                
                st.markdown('<h3><i class="bi bi-list-ol" style="color: #00D4FF;"></i> Full League Standings</h3>', unsafe_allow_html=True)
                
                standings_df = pd.DataFrame([{
                    "#": t["standing"],
                    "Team": t["team_name"],
                    "Record": f"{t['actual_wins']}-{t['actual_losses']}-{t['actual_ties']}",
                    "PCT": f"{t['actual_pct']:.3f}",
                    "All-Play": f"{t['all_play_wins']}-{t['all_play_losses']}-{t['all_play_ties']}",
                    "AP PCT": f"{t['all_play_pct']:.3f}",
                    "Luck": f"{t['luck']:+.1f}%",
                } for t in league_stats])
                
                st.dataframe(
                    standings_df, 
                    use_container_width=True, 
                    hide_index=True,
                    column_config={
                        "#": st.column_config.NumberColumn(width="small"),
                        "Team": st.column_config.TextColumn(width="medium"),
                    }
                )
                
                with st.expander("All-Play Power Rankings"):
                    st.markdown('<p style="color: #888;">Teams ranked by all-play win percentage - the truest measure of team strength.</p>', unsafe_allow_html=True)
                    ap_sorted = sorted(league_stats, key=lambda x: x["all_play_pct"], reverse=True)
                    
                    for i, team in enumerate(ap_sorted, 1):
                        ap_pct = team["all_play_pct"]
                        bar_width = ap_pct * 100
                        is_your_team = team["team_id"] == team_id
                        border_style = "border: 2px solid #FF6B35;" if is_your_team else ""
                        name_style = "color: #FF6B35;" if is_your_team else "color: white;"
                        
                        st.markdown(f"""
                        <div style="background: linear-gradient(145deg, #1A1A2E, #252545); 
                                    border-radius: 8px; padding: 0.75rem; margin-bottom: 0.5rem; {border_style}">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="{name_style} font-family: Oswald; font-size: 1.1rem;">
                                    #{i} {team["team_name"]}
                                </span>
                                <span style="color: #00D4FF; font-family: Oswald;">
                                    {team["all_play_wins"]}-{team["all_play_losses"]} ({ap_pct:.3f})
                                </span>
                            </div>
                            <div style="background: #0F0F1A; border-radius: 4px; height: 8px; margin-top: 0.5rem; overflow: hidden;">
                                <div style="background: linear-gradient(90deg, #00D4FF, #00FF88); width: {bar_width}%; height: 100%;"></div>
                            </div>
                        </div>
                        """, unsafe_allow_html=True)
                
                with st.expander("Luck Rankings"):
                    st.markdown('<p style="color: #888;">Luck = Actual Win% - All-Play Win%. Positive = lucky (winning more than expected), Negative = unlucky.</p>', unsafe_allow_html=True)
                    luck_sorted = sorted(league_stats, key=lambda x: x["luck"], reverse=True)
                    
                    luck_data = []
                    for team in luck_sorted:
                        luck_val = team["luck"]
                        luck_label = "Lucky" if luck_val > 2 else "Unlucky" if luck_val < -2 else "Neutral"
                        luck_data.append({
                            "Team": team["team_name"],
                            "Actual PCT": f"{team['actual_pct']:.3f}",
                            "All-Play PCT": f"{team['all_play_pct']:.3f}",
                            "Luck": f"{luck_val:+.1f}%",
                            "Status": luck_label
                        })
                    
                    st.dataframe(pd.DataFrame(luck_data), use_container_width=True, hide_index=True)
            
            st.success("Simulation complete!")
            
        except Exception as e:
            st.error(f"Error: {str(e)}")
            st.exception(e)
    
    else:
        # Welcome screen
        st.markdown("""
        <div style="text-align: center; padding: 3rem; background: linear-gradient(145deg, #1A1A2E, #252545); 
                    border-radius: 20px; margin: 2rem 0; border: 1px solid rgba(255, 107, 53, 0.3);">
            <h2 style="color: #FF6B35; font-family: Oswald;">Welcome to the Fantasy Basketball Simulator</h2>
            <p style="color: #888; font-family: Roboto Condensed; font-size: 1.1rem; max-width: 600px; margin: 1rem auto;">
                This tool uses Monte Carlo simulation to predict your weekly matchup outcome 
                based on player projections, remaining games, and statistical variance.
            </p>
            <div style="margin-top: 2rem;">
                <p style="color: #FFD93D;"><i class="bi bi-arrow-left-circle-fill"></i> Configure your settings in the sidebar and click <strong>RUN SIMULATION</strong></p>
            </div>
        </div>
        """, unsafe_allow_html=True)
        
        # Feature cards
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.markdown("""
            <div style="background: #1A1A2E; border-radius: 12px; padding: 1.5rem; height: 200px;">
                <h3 style="color: #00FF88; font-family: Oswald;"><i class="bi bi-dice-5-fill"></i> Monte Carlo</h3>
                <p style="color: #888; font-family: Roboto Condensed;">
                    Run thousands of simulations to estimate your true win probability, accounting for game-to-game variance.
                </p>
            </div>
            """, unsafe_allow_html=True)
        
        with col2:
            st.markdown("""
            <div style="background: #1A1A2E; border-radius: 12px; padding: 1.5rem; height: 200px;">
                <h3 style="color: #00D4FF; font-family: Oswald;"><i class="bi bi-clipboard-data-fill"></i> Category Analysis</h3>
                <p style="color: #888; font-family: Roboto Condensed;">
                    See which categories are locks, which are swing categories, and where to focus streaming efforts.
                </p>
            </div>
            """, unsafe_allow_html=True)
        
        with col3:
            st.markdown("""
            <div style="background: #1A1A2E; border-radius: 12px; padding: 1.5rem; height: 200px;">
                <h3 style="color: #FF6B35; font-family: Oswald;"><i class="bi bi-arrow-repeat"></i> Smart Streaming</h3>
                <p style="color: #888; font-family: Roboto Condensed;">
                    Analyze streamers with drop recommendations. Set untouchables and find the best add/drop combos.
                </p>
            </div>
            """, unsafe_allow_html=True)


if __name__ == "__main__":
    main()