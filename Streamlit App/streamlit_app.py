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
    page_title="🏀 Fantasy Basketball Simulator",
    page_icon="🏀",
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
              "REB", "AST", "STL", "BLK", "TO", "PTS", "DD", "TW"]

NUMERIC_COLS = ['FGM', 'FGA', 'FG%', 'FTM', 'FTA', 'FT%', '3PM', '3PA', '3P%',
                'REB', 'AST', 'STL', 'BLK', 'TO', 'DD', 'PTS', 'TW']

INJURED_STATUSES = {"OUT", "INJURY_RESERVE"}

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


# =============================================================================
# ESPN DATA FUNCTIONS
# =============================================================================

@st.cache_resource(ttl=300)
def connect_to_espn(league_id, year, espn_s2, swid):
    """Connect to ESPN Fantasy Basketball API"""
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
    """Monte Carlo simulation for team stats"""
    results = defaultdict(list)
    all_stats = list(CATEGORY_VARIANCE.keys()) + ["FG%", "FT%", "3P%"]
    
    for _ in range(sims):
        totals = defaultdict(float)
        
        for _, row in team_df.iterrows():
            row = row.fillna(0)
            for _ in range(int(row["Games Left"])):
                for stat in CATEGORY_VARIANCE:
                    mean = row[stat]
                    std_dev = mean * CATEGORY_VARIANCE[stat]
                    totals[stat] += random.gauss(mean, std_dev)
        
        totals["FG%"] = totals["FGM"] / totals["FGA"] if totals["FGA"] > 0 else 0
        totals["FT%"] = totals["FTM"] / totals["FTA"] if totals["FTA"] > 0 else 0
        totals["3P%"] = totals["3PM"] / totals["3PA"] if totals["3PA"] > 0 else 0
        
        for stat in all_stats:
            results[stat].append(totals[stat])
    
    return results


def add_current_to_sim(current, sim):
    """Add current week totals to simulated rest-of-week stats"""
    adjusted = defaultdict(list)
    
    for stat in sim:
        for val in sim[stat]:
            if stat in ["FG%", "FT%", "3P%"]:
                adjusted[stat].append(0)
            else:
                adjusted[stat].append(val + current.get(stat, 0))
    
    for i in range(len(sim["FGM"])):
        FGM = adjusted["FGM"][i]
        FGA = adjusted["FGA"][i]
        adjusted["FG%"][i] = FGM / FGA if FGA > 0 else 0
        
        FTM = adjusted["FTM"][i]
        FTA = adjusted["FTA"][i]
        adjusted["FT%"][i] = FTM / FTA if FTA > 0 else 0
        
        adjusted["3P%"][i] = adjusted["3PM"][i] / adjusted["3PA"][i] if adjusted["3PA"][i] > 0 else 0
    
    return adjusted


def compare_matchups(sim1, sim2, categories):
    """Compare two teams across all simulations"""
    sims = len(next(iter(sim1.values())))
    matchup_results = {"you": 0, "opponent": 0, "tie": 0}
    category_outcomes = {cat: {"you": 0, "opponent": 0, "tie": 0} for cat in categories}
    outcome_counts = defaultdict(int)
    
    for i in range(sims):
        your_wins = opp_wins = 0
        for cat in categories:
            y_val, o_val = sim1[cat][i], sim2[cat][i]
            
            if cat == "TO":
                if y_val < o_val:
                    your_wins += 1
                    category_outcomes[cat]["you"] += 1
                elif y_val > o_val:
                    opp_wins += 1
                    category_outcomes[cat]["opponent"] += 1
                else:
                    category_outcomes[cat]["tie"] += 1
            else:
                if y_val > o_val:
                    your_wins += 1
                    category_outcomes[cat]["you"] += 1
                elif y_val < o_val:
                    opp_wins += 1
                    category_outcomes[cat]["opponent"] += 1
                else:
                    category_outcomes[cat]["tie"] += 1
        
        outcome_counts[(your_wins, opp_wins)] += 1
        
        if your_wins > opp_wins:
            matchup_results["you"] += 1
        elif opp_wins > your_wins:
            matchup_results["opponent"] += 1
        else:
            matchup_results["tie"] += 1
    
    return matchup_results, category_outcomes, outcome_counts


def analyze_streamers(league, your_team_df, opp_team_df, current_totals_you, current_totals_opp, 
                     baseline_results, blend_weight, year, num_streamers=20):
    """Analyze potential streamer pickups"""
    baseline_win_pct, baseline_cat_results, baseline_avg_cats = baseline_results
    
    free_agents = league.free_agents(size=150)
    
    fa_season = build_stat_df(free_agents, f"{year}_total", "Season", "Waiver", year)
    fa_last30 = build_stat_df(free_agents, f"{year}_last_30", "Last30", "Waiver", year)
    
    fa_season = add_games_left(fa_season)
    fa_last30 = add_games_left(fa_last30)
    
    merged = fa_season.merge(fa_last30, on=["Player", "NBA_Team"], suffixes=("_season", "_30"))
    
    rows = []
    for _, r in merged.iterrows():
        g = r.get("Games Left_30", 0)
        if g <= 0:
            continue
        
        out = {"Player": r["Player"], "NBA_Team": r["NBA_Team"], "Games Left": g, "Team": "Waiver"}
        for col in NUMERIC_COLS:
            c30, csea = f"{col}_30", f"{col}_season"
            if c30 in r and csea in r:
                out[col] = r[c30] * blend_weight + r[csea] * (1 - blend_weight)
            else:
                out[col] = r.get(c30, r.get(csea, 0))
        rows.append(out)
    
    waiver_df = pd.DataFrame(rows).sort_values(["Games Left", "PTS"], ascending=[False, False])
    streamers = waiver_df.head(num_streamers)
    
    streamer_sims = 2000
    opp_sim_raw = simulate_team(opp_team_df, sims=streamer_sims)
    opp_sim = add_current_to_sim(current_totals_opp, opp_sim_raw)
    
    results = []
    for _, row in streamers.iterrows():
        test_team = pd.concat([your_team_df, pd.DataFrame([row])], ignore_index=True)
        test_sim_raw = simulate_team(test_team, sims=streamer_sims)
        test_sim = add_current_to_sim(current_totals_you, test_sim_raw)
        
        result, cat_results, outcome_counts = compare_matchups(test_sim, opp_sim, CATEGORIES)
        
        total_sims = sum(result.values())
        avg_cats_won = sum(your_w * count for (your_w, opp_w), count in outcome_counts.items()) / total_sims
        cats_gained = avg_cats_won - baseline_avg_cats
        
        win_pct = result["you"] / total_sims * 100
        
        cat_impacts = {}
        for cat in CATEGORIES:
            base_win_rate = baseline_cat_results[cat]["you"] / sum(baseline_cat_results[cat].values())
            new_win_rate = cat_results[cat]["you"] / sum(cat_results[cat].values())
            delta = (new_win_rate - base_win_rate) * 100
            if abs(delta) > 3:
                cat_impacts[cat] = delta
        
        risk_tags = []
        if row.get("FGA", 0) > 12:
            risk_tags.append("High FGA")
        if row.get("TO", 0) > 2:
            risk_tags.append("High TO")
        if row.get("FG%", 1.0) < 0.42:
            risk_tags.append("Low FG%")
        
        results.append({
            "Player": row["Player"],
            "Team": row["NBA_Team"],
            "Games": int(row["Games Left"]),
            "Δ Cats": round(cats_gained, 2),
            "Exp Cats": round(avg_cats_won, 2),
            "Win %": round(win_pct, 1),
            "Cat Impacts": cat_impacts,
            "Risks": risk_tags,
            "PTS": round(row.get("PTS", 0), 1),
            "REB": round(row.get("REB", 0), 1),
            "AST": round(row.get("AST", 0), 1),
        })
    
    return sorted(results, key=lambda x: x["Δ Cats"], reverse=True)


# =============================================================================
# VISUALIZATION FUNCTIONS
# =============================================================================

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
    
    for cat in CATEGORIES:
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
            textfont=dict(family='Oswald', size=14, color='white')
        )
    ])
    
    fig.update_layout(
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': 'white', 'family': 'Roboto Condensed'},
        height=300,
        margin=dict(l=40, r=40, t=40, b=40),
        xaxis=dict(
            title='Score Outcome',
            showgrid=False,
            tickfont=dict(family='Oswald', size=14)
        ),
        yaxis=dict(
            title='Probability',
            showgrid=True,
            gridcolor='rgba(255,255,255,0.1)',
            ticksuffix='%'
        )
    )
    
    return fig


# =============================================================================
# MAIN APP
# =============================================================================

def main():
    # Header
    st.markdown('<h1 class="main-header">🏀 Fantasy Basketball Simulator</h1>', unsafe_allow_html=True)
    st.markdown('<p style="text-align: center; color: #888; font-family: Roboto Condensed;">Monte Carlo Simulation for ESPN Fantasy Basketball</p>', unsafe_allow_html=True)
    
    # Sidebar Configuration
    with st.sidebar:
        st.markdown("## ⚙️ Configuration")
        
        st.markdown("### ESPN Credentials")
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
        
        st.markdown("### Simulation Settings")
        sim_count = st.slider("Simulations", 1000, 50000, 10000, 1000, help="More = more accurate but slower")
        blend_weight = st.slider("Last 30 Days Weight", 0.0, 1.0, 0.7, 0.05, help="Blend of recent vs season stats")
        num_streamers = st.slider("Streamers to Analyze", 5, 50, 20, 5)
        
        st.markdown("---")
        run_button = st.button("🎲 RUN SIMULATION", use_container_width=True)
    
    # Main content area
    if run_button:
        try:
            # Connect to ESPN
            with st.spinner("🔌 Connecting to ESPN..."):
                league = connect_to_espn(league_id, year, espn_s2, swid)
                st.success(f"Connected to **{league.settings.name}**")
            
            # Get matchup info
            with st.spinner("📊 Loading matchup data..."):
                your_team_obj, opp_team_obj, matchup, current_week = get_matchup_info(league, team_id)
                your_team_name = your_team_obj.team_name
                opp_team_name = opp_team_obj.team_name
                current_you, current_opp = get_current_totals(matchup, team_id)
            
            # Display matchup header
            col1, col2, col3 = st.columns([2, 1, 2])
            with col1:
                st.markdown(f"### 🏠 {your_team_name}")
            with col2:
                st.markdown(f"<h3 style='text-align: center; color: #FF6B35;'>Week {current_week}</h3>", unsafe_allow_html=True)
            with col3:
                st.markdown(f"### 🏃 {opp_team_name}")
            
            # Build player stats
            progress = st.progress(0, text="Loading player stats...")
            
            your_filtered = filter_injured(your_team_obj.roster)
            opp_filtered = filter_injured(opp_team_obj.roster)
            
            your_season = build_stat_df(your_filtered, f"{year}_total", "Season", your_team_name, year)
            your_last30 = build_stat_df(your_filtered, f"{year}_last_30", "Last30", your_team_name, year)
            opp_season = build_stat_df(opp_filtered, f"{year}_total", "Season", opp_team_name, year)
            opp_last30 = build_stat_df(opp_filtered, f"{year}_last_30", "Last30", opp_team_name, year)
            
            progress.progress(25, text="Fetching NBA schedules...")
            
            your_season = add_games_left(your_season)
            your_last30 = add_games_left(your_last30)
            opp_season = add_games_left(opp_season)
            opp_last30 = add_games_left(opp_last30)
            
            progress.progress(50, text="Blending statistics...")
            
            # Blend stats
            season_df = pd.concat([your_season, opp_season], ignore_index=True)
            last30_df = pd.concat([your_last30, opp_last30], ignore_index=True)
            
            merged = pd.merge(last30_df, season_df, on="Player", suffixes=("_30", "_season"))
            for col in NUMERIC_COLS:
                merged[col] = merged[f"{col}_30"] * blend_weight + merged[f"{col}_season"] * (1 - blend_weight)
            
            merged["Games Left"] = merged["Games Left_30"]
            merged["Team"] = merged["Team_30"]
            
            your_team_df = merged[merged["Team"] == your_team_name].copy()
            opp_team_df = merged[merged["Team"] == opp_team_name].copy()
            
            your_team_df = your_team_df[your_team_df["Games Left"] > 0]
            opp_team_df = opp_team_df[opp_team_df["Games Left"] > 0]
            
            progress.progress(75, text=f"Running {sim_count:,} simulations...")
            
            # Run simulation
            your_sim_raw = simulate_team(your_team_df, sims=sim_count)
            opp_sim_raw = simulate_team(opp_team_df, sims=sim_count)
            
            your_sim = add_current_to_sim(current_you, your_sim_raw)
            opp_sim = add_current_to_sim(current_opp, opp_sim_raw)
            
            matchup_results, category_results, outcome_counts = compare_matchups(your_sim, opp_sim, CATEGORIES)
            
            progress.progress(100, text="Complete!")
            progress.empty()
            
            # Calculate key metrics
            total_sims = sum(matchup_results.values())
            win_pct = matchup_results["you"] / total_sims * 100
            baseline_avg_cats = sum(your_w * count for (your_w, opp_w), count in outcome_counts.items()) / total_sims
            
            # Display Results
            st.markdown("---")
            st.markdown("## 📊 Simulation Results")
            
            # Win probability gauge and key stats
            col1, col2 = st.columns([1, 1])
            
            with col1:
                st.markdown("### 🎯 Win Probability")
                st.plotly_chart(create_win_probability_gauge(win_pct), use_container_width=True)
            
            with col2:
                st.markdown("### 📈 Key Metrics")
                metric_cols = st.columns(3)
                with metric_cols[0]:
                    st.metric("Expected Cats", f"{baseline_avg_cats:.1f}", delta=f"{baseline_avg_cats - 7.5:.1f} vs even")
                with metric_cols[1]:
                    sorted_outcomes = sorted(outcome_counts.items(), key=lambda x: x[1], reverse=True)
                    most_likely = sorted_outcomes[0][0]
                    st.metric("Most Likely", f"{most_likely[0]}-{most_likely[1]}")
                with metric_cols[2]:
                    st.metric("Simulations", f"{sim_count:,}")
                
                # Top outcomes
                st.markdown("#### Most Likely Outcomes")
                for i, ((your_w, opp_w), count) in enumerate(sorted_outcomes[:5]):
                    pct = count / total_sims * 100
                    color = "#00FF88" if your_w > opp_w else "#FF4757" if opp_w > your_w else "#FFD93D"
                    st.markdown(f"<span style='color: {color}; font-family: Oswald; font-size: 1.2rem;'>{your_w}-{opp_w}</span> <span style='color: #888;'>({pct:.1f}%)</span>", unsafe_allow_html=True)
            
            # Outcome distribution
            st.markdown("### 🎲 Score Distribution")
            st.plotly_chart(create_outcome_distribution(outcome_counts, total_sims), use_container_width=True)
            
            # Category breakdown
            st.markdown("### 📊 Category Analysis")
            st.plotly_chart(create_category_chart(category_results, your_sim, opp_sim), use_container_width=True)
            
            # Detailed category table
            with st.expander("📋 Detailed Category Projections"):
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
                        "Swing?": "⭐" if is_swing else ""
                    })
                
                st.dataframe(pd.DataFrame(cat_data), use_container_width=True, hide_index=True)
            
            # Rosters
            with st.expander("🏀 Your Roster"):
                roster_cols = ["Player", "NBA_Team", "Games Left", "PTS", "REB", "AST", "3PM", "FG%", "FT%"]
                display_cols = [c for c in roster_cols if c in your_team_df.columns]
                st.dataframe(your_team_df[display_cols].round(2), use_container_width=True, hide_index=True)
            
            with st.expander("🏃 Opponent Roster"):
                display_cols = [c for c in roster_cols if c in opp_team_df.columns]
                st.dataframe(opp_team_df[display_cols].round(2), use_container_width=True, hide_index=True)
            
            # Streamer Analysis
            st.markdown("---")
            st.markdown("## 🔄 Streamer Analysis")
            
            with st.spinner(f"Analyzing {num_streamers} potential streamers..."):
                baseline_results = (win_pct, category_results, baseline_avg_cats)
                streamers = analyze_streamers(
                    league, your_team_df, opp_team_df, 
                    current_you, current_opp, baseline_results,
                    blend_weight, year, num_streamers
                )
            
            if streamers:
                # Top recommendations
                st.markdown("### 🌟 Top Recommendations")
                
                top_3 = streamers[:3]
                cols = st.columns(3)
                
                for i, player in enumerate(top_3):
                    with cols[i]:
                        delta_color = "#00FF88" if player["Δ Cats"] > 0 else "#FF4757" if player["Δ Cats"] < 0 else "#FFD93D"
                        border_color = delta_color
                        
                        st.markdown(f"""
                        <div style="background: linear-gradient(145deg, #252545, #1A1A2E); 
                                    border-radius: 12px; padding: 1.2rem; 
                                    border-left: 4px solid {border_color};">
                            <h4 style="margin: 0; color: white; font-family: Oswald;">{player['Player']}</h4>
                            <p style="color: #888; margin: 0.3rem 0; font-size: 0.9rem;">{player['Team']} • {player['Games']} games</p>
                            <div style="display: flex; justify-content: space-between; margin-top: 0.8rem;">
                                <div>
                                    <span style="color: #888; font-size: 0.8rem;">Δ CATS</span><br/>
                                    <span style="color: {delta_color}; font-size: 1.5rem; font-family: Oswald; font-weight: 600;">
                                        {player['Δ Cats']:+.2f}
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
                        
                        # Show category impacts
                        if player["Cat Impacts"]:
                            impacts_str = ", ".join([f"{'🟢' if v > 0 else '🔻'}{k}: {v:+.0f}%" for k, v in sorted(player["Cat Impacts"].items(), key=lambda x: abs(x[1]), reverse=True)[:3]])
                            st.caption(impacts_str)
                        
                        if player["Risks"]:
                            st.caption(f"⚠️ {', '.join(player['Risks'])}")
                
                # Full streamer table
                with st.expander("📋 All Analyzed Streamers"):
                    streamer_df = pd.DataFrame([{
                        "Player": p["Player"],
                        "Team": p["Team"],
                        "Games": p["Games"],
                        "Δ Cats": p["Δ Cats"],
                        "Exp Cats": p["Exp Cats"],
                        "Win %": p["Win %"],
                        "PTS": p["PTS"],
                        "REB": p["REB"],
                        "AST": p["AST"],
                        "Risks": ", ".join(p["Risks"]) if p["Risks"] else ""
                    } for p in streamers])
                    
                    st.dataframe(streamer_df, use_container_width=True, hide_index=True)
            
            st.success("✅ Simulation complete!")
            
        except Exception as e:
            st.error(f"❌ Error: {str(e)}")
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
                <p style="color: #FFD93D;">👈 Configure your settings in the sidebar and click <strong>RUN SIMULATION</strong></p>
            </div>
        </div>
        """, unsafe_allow_html=True)
        
        # Feature cards
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.markdown("""
            <div style="background: #1A1A2E; border-radius: 12px; padding: 1.5rem; height: 200px;">
                <h3 style="color: #00FF88; font-family: Oswald;">🎲 Monte Carlo</h3>
                <p style="color: #888; font-family: Roboto Condensed;">
                    Run thousands of simulations to estimate your true win probability, accounting for game-to-game variance.
                </p>
            </div>
            """, unsafe_allow_html=True)
        
        with col2:
            st.markdown("""
            <div style="background: #1A1A2E; border-radius: 12px; padding: 1.5rem; height: 200px;">
                <h3 style="color: #00D4FF; font-family: Oswald;">📊 Category Analysis</h3>
                <p style="color: #888; font-family: Roboto Condensed;">
                    See which categories are locks, which are swing categories, and where to focus streaming efforts.
                </p>
            </div>
            """, unsafe_allow_html=True)
        
        with col3:
            st.markdown("""
            <div style="background: #1A1A2E; border-radius: 12px; padding: 1.5rem; height: 200px;">
                <h3 style="color: #FF6B35; font-family: Oswald;">🔄 Streamer Impact</h3>
                <p style="color: #888; font-family: Roboto Condensed;">
                    Analyze free agents to find the best streaming options that maximize your expected categories won.
                </p>
            </div>
            """, unsafe_allow_html=True)


if __name__ == "__main__":
    main()