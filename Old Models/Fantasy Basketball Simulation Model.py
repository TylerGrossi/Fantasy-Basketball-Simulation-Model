"""
🏀 Fantasy Basketball Win Percentage Simulation V4
==================================================

This script models your fantasy basketball team's projected chance of winning
a weekly head-to-head matchup using Monte Carlo simulations.

USAGE:
    python fantasy_basketball_simulation.py

CONFIGURATION:
    Update the CONFIG section below with your ESPN league credentials and team ID.

KEY FEATURES:
    - Automatic ESPN API data input
    - Game-by-game Monte Carlo simulation (restored from V1)
    - Correct variance factors for realistic projections
    - Current week totals integration
    - Streamer impact analysis
"""

import pandas as pd
import numpy as np
import random
import requests
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from espn_api.basketball import League

# =============================================================================
# CONFIGURATION - UPDATE THESE VALUES
# =============================================================================

CONFIG = {
    "league_id": 267469544,
    "year": 2026,
    "espn_s2": "AEBSyUk%2FmdLqOc%2BSzyDjGNUS5ikQCnK8FvvsGLMAu7mVyKgLRXAa6q6s9eaLrXj3rPzfOoB9H%2BIukXFCBnnSjLEjnSmOIiRzuXP8bEZGpYrVN4FJ5OgT3FuHfRmKV0SrwKJRbyjW0Irlz%2BTyk2QCsg5eTa7GtgXJ8sxXaF9MVhjc9ielluRUU%2FbGcCrpIAOhAzkbklw4Gs2UsEBHdWXzgMO6TUWJjzFN5afsaby20y9ONU5rz6r1J27VWoC5YgUiR3NpH%2F4hpyMf0xXvJUGv9fSI5lt6%2BskojM22lBfr2DwJgA%3D%3D",
    "swid": "{D7E89394-85F1-4264-831E-481F3B4157D4}",
    "team_id": 6,  # Your fantasy team ID
    "blend_weight": 0.7,  # 70% last 30 days, 30% season
    "sim_count": 10000,  # Number of Monte Carlo simulations
    "streamers_to_test": 20,  # Number of free agents to analyze
}

# V1's exact variance factors for simulation
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

INJURED_STATUSES = {"OUT", "INJURY_RESERVE", "SSPD"}

# ESPN team slug mapping
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

def connect_to_espn():
    """Connect to ESPN Fantasy Basketball API"""
    league = League(
        league_id=CONFIG["league_id"],
        year=CONFIG["year"],
        espn_s2=CONFIG["espn_s2"],
        swid=CONFIG["swid"]
    )
    print(f"🔥 ESPN Connection successful!")
    print(f"   League: {league.settings.name}")
    return league


def get_matchup_info(league):
    """Auto-detect current matchup and opponent"""
    team_id = CONFIG["team_id"]
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
    
    print(f"📆 Current Week: {current_week}")
    print(f"🏀 Matchup: {your_team_obj.team_name} vs {opp_team_obj.team_name}")
    
    return your_team_obj, opp_team_obj, matchup


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


def build_stat_df(roster, period_key, label, fantasy_team_name):
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
# SIMULATION FUNCTIONS (V1 MECHANICS)
# =============================================================================

def simulate_team(team_df, sims=None):
    """
    V1's exact simulation logic:
    - Simulates each player's stats GAME BY GAME
    - Uses Gaussian distribution with per-game mean and variance
    - Calculates percentages from cumulative totals
    """
    if sims is None:
        sims = CONFIG["sim_count"]
    
    results = defaultdict(list)
    all_stats = list(CATEGORY_VARIANCE.keys()) + ["FG%", "FT%", "3P%"]
    
    for _ in range(sims):
        totals = defaultdict(float)
        
        for _, row in team_df.iterrows():
            row = row.fillna(0)
            # KEY: Loop for EACH GAME LEFT (V1's core mechanic)
            for _ in range(int(row["Games Left"])):
                for stat in CATEGORY_VARIANCE:
                    mean = row[stat]
                    std_dev = mean * CATEGORY_VARIANCE[stat]
                    totals[stat] += random.gauss(mean, std_dev)
        
        # Calculate percentages from cumulative totals
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
    
    # Recalculate percentages
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
    outcome_counts = defaultdict(int)  # Track specific score outcomes
    
    for i in range(sims):
        your_wins = opp_wins = 0
        for cat in categories:
            y_val, o_val = sim1[cat][i], sim2[cat][i]
            
            if cat == "TO":  # Lower is better
                if y_val < o_val:
                    your_wins += 1
                    category_outcomes[cat]["you"] += 1
                elif y_val > o_val:
                    opp_wins += 1
                    category_outcomes[cat]["opponent"] += 1
                else:
                    category_outcomes[cat]["tie"] += 1
            else:  # Higher is better (including FGA)
                if y_val > o_val:
                    your_wins += 1
                    category_outcomes[cat]["you"] += 1
                elif y_val < o_val:
                    opp_wins += 1
                    category_outcomes[cat]["opponent"] += 1
                else:
                    category_outcomes[cat]["tie"] += 1
        
        # Track the score outcome
        outcome_counts[(your_wins, opp_wins)] += 1
        
        if your_wins > opp_wins:
            matchup_results["you"] += 1
        elif opp_wins > your_wins:
            matchup_results["opponent"] += 1
        else:
            matchup_results["tie"] += 1
    
    return matchup_results, category_outcomes, outcome_counts


# =============================================================================
# OUTPUT FUNCTIONS
# =============================================================================

def print_results(matchup_results, category_results, outcome_counts, your_sim, opp_sim):
    """Print simulation results in V1's exact format"""
    
    # Matchup Win Summary (V1 format)
    print("🏀 Matchup Win Summary:")
    total = sum(matchup_results.values())
    print(f"      You: {matchup_results['you']} ({matchup_results['you']/total*100:.1f}%)")
    print(f" Opponent: {matchup_results['opponent']} ({matchup_results['opponent']/total*100:.1f}%)")
    
    # Top 3 Most Likely Outcomes
    print("\n🎯 Most Likely Outcomes:")
    sorted_outcomes = sorted(outcome_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    for (your_w, opp_w), count in sorted_outcomes:
        pct = count / total * 100
        print(f"   {your_w}-{opp_w}: {pct:.1f}%")
    
    # Category breakdown (V1 format)
    print("\n📊 Category Win % with Projected Totals (with Swing & Confidence Intervals):")
    
    swing_cats = []
    you_wins = 0
    
    for cat in CATEGORIES:
        outcome = category_results[cat]
        total_cat = sum(outcome.values())
        you_pct = outcome["you"] / total_cat
        opp_pct = outcome["opponent"] / total_cat
        
        y_proj = np.mean(your_sim[cat])
        o_proj = np.mean(opp_sim[cat])
        y_ci = (np.percentile(your_sim[cat], 10), np.percentile(your_sim[cat], 90))
        o_ci = (np.percentile(opp_sim[cat], 10), np.percentile(opp_sim[cat], 90))
        
        is_swing = abs(you_pct - opp_pct) <= 0.15
        if is_swing:
            swing_cats.append(cat)
        
        # Determine projected winner
        if cat == "TO":  # Lower is better
            if y_proj < o_proj:
                you_wins += 1
        else:  # Higher is better (including FGA)
            if y_proj > o_proj:
                you_wins += 1
        
        # V1's exact format
        swing_tag = " ⭐" if is_swing else ""
        if "%" in cat:
            print(f"{cat:>4}: You {you_pct:.1%} | Opponent {opp_pct:.1%}{swing_tag}  "
                  f"→ Projected: You {y_proj:.3f} | Opponent {o_proj:.3f} "
                  f"| CI: You {y_ci[0]:.2f}–{y_ci[1]:.2f} | Opp {o_ci[0]:.2f}–{o_ci[1]:.2f}")
        else:
            print(f"{cat:>4}: You {you_pct:.1%} | Opponent {opp_pct:.1%}{swing_tag}  "
                  f"→ Projected: You {y_proj:.1f} | Opponent {o_proj:.1f} "
                  f"| CI: You {y_ci[0]:.2f}–{y_ci[1]:.2f} | Opp {o_ci[0]:.2f}–{o_ci[1]:.2f}")
    
    print(f"\n📈 Projected Score: {you_wins} - {len(CATEGORIES) - you_wins}")
    
    if swing_cats:
        print("\n🎯 Swing Categories to Stream For:")
        for cat in swing_cats:
            print(f"• {cat}")
    
    return you_wins


def analyze_streamers(league, your_team_df, opp_team_df, current_totals_you, current_totals_opp, baseline_results):
    """Analyze potential streamer pickups focused on maximizing categories won"""
    
    print("\n" + "="*70)
    print("📊 STREAMER IMPACT ANALYSIS")
    print("="*70)
    
    # Unpack baseline results
    baseline_win_pct, baseline_cat_results, baseline_avg_cats = baseline_results
    
    free_agents = league.free_agents(size=150)
    
    fa_season = build_stat_df(free_agents, "2026_total", "Season", "Waiver")
    fa_last30 = build_stat_df(free_agents, "2026_last_30", "Last30", "Waiver")
    
    fa_season = add_games_left(fa_season)
    fa_last30 = add_games_left(fa_last30)
    
    # Blend waiver stats
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
                out[col] = r[c30] * CONFIG["blend_weight"] + r[csea] * (1 - CONFIG["blend_weight"])
            else:
                out[col] = r.get(c30, r.get(csea, 0))
        rows.append(out)
    
    waiver_df = pd.DataFrame(rows).sort_values(["Games Left", "PTS"], ascending=[False, False])
    streamers = waiver_df.head(CONFIG["streamers_to_test"])
    
    print(f"\nTesting {len(streamers)} free agents...")
    print(f"Baseline: {baseline_avg_cats:.2f} expected categories won\n")
    
    # Run baseline simulation with reduced count for comparison
    streamer_sims = 2000
    base_sim_raw = simulate_team(your_team_df, sims=streamer_sims)
    base_sim = add_current_to_sim(current_totals_you, base_sim_raw)
    opp_sim_raw = simulate_team(opp_team_df, sims=streamer_sims)
    opp_sim = add_current_to_sim(current_totals_opp, opp_sim_raw)
    
    results = []
    for _, row in streamers.iterrows():
        test_team = pd.concat([your_team_df, pd.DataFrame([row])], ignore_index=True)
        test_sim_raw = simulate_team(test_team, sims=streamer_sims)
        test_sim = add_current_to_sim(current_totals_you, test_sim_raw)
        
        result, cat_results, outcome_counts = compare_matchups(test_sim, opp_sim, CATEGORIES)
        
        # Calculate expected categories won
        total_sims = sum(result.values())
        avg_cats_won = sum(your_w * count for (your_w, opp_w), count in outcome_counts.items()) / total_sims
        cats_gained = avg_cats_won - baseline_avg_cats
        
        win_pct = result["you"] / total_sims * 100
        
        # Find which swing categories this player helps flip
        cat_flips = []
        for cat in CATEGORIES:
            base_win_rate = baseline_cat_results[cat]["you"] / sum(baseline_cat_results[cat].values())
            new_win_rate = cat_results[cat]["you"] / sum(cat_results[cat].values())
            delta = (new_win_rate - base_win_rate) * 100
            
            # Show categories where player makes >3% difference
            if abs(delta) > 3:
                tag = "🟢" if delta > 0 else "🔻"
                cat_flips.append((delta, f"{tag}{cat}: {delta:+.0f}%"))
        
        # Sort by impact and take top 3
        top_flips = [x[1] for x in sorted(cat_flips, key=lambda x: abs(x[0]), reverse=True)[:3]]
        
        # Risk tags
        risk_tags = []
        if row.get("FGA", 0) > 12:
            risk_tags.append("🧨 High FGA")
        if row.get("TO", 0) > 2:
            risk_tags.append("🧨 TO")
        if row.get("FG%", 1.0) < 0.42:
            risk_tags.append("📉 FG%")
        
        results.append({
            "Player": row["Player"],
            "Games": int(row["Games Left"]),
            "Δ Cats": round(cats_gained, 2),
            "Exp Cats": round(avg_cats_won, 2),
            "Win %": round(win_pct, 1),
            "Cat Impacts": ", ".join(top_flips) if top_flips else "—",
            "Risks": ", ".join(risk_tags) if risk_tags else ""
        })
    
    # Sort by expected categories gained (not win %)
    results_df = pd.DataFrame(results).sort_values("Δ Cats", ascending=False)
    
    # Print header
    print(f"{'Player':<20} {'Games':<6} {'Δ Cats':<8} {'Exp Cats':<10} {'Win %':<8} {'Category Impacts':<40} {'Risks'}")
    print("-" * 140)
    
    for _, r in results_df.iterrows():
        delta_str = f"{r['Δ Cats']:+.2f}" if r['Δ Cats'] != 0 else "0.00"
        print(f"{r['Player']:<20} {r['Games']:<6} {delta_str:<8} {r['Exp Cats']:<10.2f} {r['Win %']:<8.1f} "
              f"{r['Cat Impacts']:<40} {r['Risks']}")


# =============================================================================
# MAIN FUNCTION
# =============================================================================

def main():
    # Connect to ESPN
    league = connect_to_espn()
    
    # Get matchup info
    your_team_obj, opp_team_obj, matchup = get_matchup_info(league)
    your_team_name = your_team_obj.team_name
    opp_team_name = opp_team_obj.team_name
    
    # Get current totals
    current_you, current_opp = get_current_totals(matchup, CONFIG["team_id"])
    
    # Build player stats
    print("\n📥 Loading player stats from ESPN...")
    your_filtered = filter_injured(your_team_obj.roster)
    opp_filtered = filter_injured(opp_team_obj.roster)
    
    your_season = build_stat_df(your_filtered, "2026_total", "Season", your_team_name)
    your_last30 = build_stat_df(your_filtered, "2026_last_30", "Last30", your_team_name)
    opp_season = build_stat_df(opp_filtered, "2026_total", "Season", opp_team_name)
    opp_last30 = build_stat_df(opp_filtered, "2026_last_30", "Last30", opp_team_name)
    
    # Add games left
    print("📅 Fetching NBA schedules...")
    your_season = add_games_left(your_season)
    your_last30 = add_games_left(your_last30)
    opp_season = add_games_left(opp_season)
    opp_last30 = add_games_left(opp_last30)
    
    # Blend stats
    season_df = pd.concat([your_season, opp_season], ignore_index=True)
    last30_df = pd.concat([your_last30, opp_last30], ignore_index=True)
    
    merged = pd.merge(last30_df, season_df, on="Player", suffixes=("_30", "_season"))
    for col in NUMERIC_COLS:
        merged[col] = merged[f"{col}_30"] * CONFIG["blend_weight"] + merged[f"{col}_season"] * (1 - CONFIG["blend_weight"])
    
    merged["Games Left"] = merged["Games Left_30"]
    merged["Team"] = merged["Team_30"]
    
    your_team_df = merged[merged["Team"] == your_team_name].copy()
    opp_team_df = merged[merged["Team"] == opp_team_name].copy()
    
    your_team_df = your_team_df[your_team_df["Games Left"] > 0]
    opp_team_df = opp_team_df[opp_team_df["Games Left"] > 0]
    
    print(f"✅ {your_team_name}: {len(your_team_df)} players with games left")
    print(f"✅ {opp_team_name}: {len(opp_team_df)} players with games left")
    
    # Run simulation
    print(f"\n🎲 Running {CONFIG['sim_count']:,} Monte Carlo simulations...\n")
    
    your_sim_raw = simulate_team(your_team_df)
    opp_sim_raw = simulate_team(opp_team_df)
    
    your_sim = add_current_to_sim(current_you, your_sim_raw)
    opp_sim = add_current_to_sim(current_opp, opp_sim_raw)
    
    matchup_results, category_results, outcome_counts = compare_matchups(your_sim, opp_sim, CATEGORIES)
    
    # Print results
    print_results(matchup_results, category_results, outcome_counts, your_sim, opp_sim)
    
    # Calculate baseline expected categories won
    total_sims = sum(matchup_results.values())
    baseline_avg_cats = sum(your_w * count for (your_w, opp_w), count in outcome_counts.items()) / total_sims
    baseline_win_pct = matchup_results["you"] / total_sims * 100
    
    # Package baseline results for streamer analysis
    baseline_results = (baseline_win_pct, category_results, baseline_avg_cats)
    
    # Analyze streamers
    analyze_streamers(league, your_team_df, opp_team_df, current_you, current_opp, baseline_results)
    
    print("\n✅ Simulation complete!")


if __name__ == "__main__":
    main()