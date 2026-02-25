import pandas as pd
import numpy as np
import time
from nba_api.stats.static import players, teams
from nba_api.stats.endpoints import playergamelog, leaguedashteamstats



# --- 1. Setup & API Calls ---

# Get Player ID (Tyrese Maxey)
player_dict = players.get_players()
maxey = [player for player in player_dict if player['full_name'] == 'Anthony Edwards'][0]
maxey_id = maxey['id']

# Get Team ID (Indiana Pacers)
team_dict = teams.get_teams()
pacers = [team for team in team_dict if team['full_name'] == 'Portland Trail Blazers'][0]
pacers_id = pacers['id']

print(f"Fetching data for Tyrese Maxey (ID: {maxey_id}) vs Indiana Pacers (ID: {pacers_id})...")

# Fetch Maxey's Game Logs for the current season
# Adding a sleep to respect NBA API rate limits
time.sleep(1)
gamelog_endpoint = playergamelog.PlayerGameLog(player_id=maxey_id, season='2025-26')
maxey_logs = gamelog_endpoint.get_data_frames()[0]

# Fetch Advanced Team Stats to get Pace and Def Rating
time.sleep(1)
advanced_stats_endpoint = leaguedashteamstats.LeagueDashTeamStats(
    measure_type_detailed_defense='Advanced', 
    season='2025-26'
)
team_advanced = advanced_stats_endpoint.get_data_frames()[0]

# --- 2. Extract Variables ---

# League Averages
league_avg_pace = team_advanced['PACE'].mean()
league_avg_def_rtg = team_advanced['DEF_RATING'].mean()

# Pacers Stats
pacers_stats = team_advanced[team_advanced['TEAM_ID'] == pacers_id].iloc[0]
pacers_pace = pacers_stats['PACE']
pacers_def_rtg = pacers_stats['DEF_RATING']

print(f"League Avg Pace: {league_avg_pace:.1f} | Pacers Pace: {pacers_pace:.1f}")
print(f"League Avg Def Rtg: {league_avg_def_rtg:.1f} | Pacers Def Rtg: {pacers_def_rtg:.1f}\n")

# --- 3. Process Player Game Logs ---

# Reverse logs so the most recent game is at the bottom (needed for chronological EMA)
maxey_logs = maxey_logs.iloc[::-1].reset_index(drop=True)

stats_to_project = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FGM', 'FGA', 'FTM', 'FTA', 'FG3M']
stats_to_sim = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FGM', 'FGA', 'FTM', 'FTA', 'FG3M']

# Calculate Base Projection (EMA span=15)
ema_stats = maxey_logs[stats_to_project].ewm(span=15, adjust=False).mean().iloc[-1]

# --- 4. Apply Matchup Multipliers ---

pace_factor = pacers_pace / league_avg_pace
# For Defensive Rating, a higher number means worse defense (more points allowed). 
# If the Pacers allow more points than average, the def_factor will be > 1.0 (a positive boost).
def_factor = pacers_def_rtg / league_avg_def_rtg 

matchup_proj = ema_stats.copy()

# Pace affects counting stats opportunities
counting_stats = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FGM', 'FGA', 'FG3M']
for stat in counting_stats:
    matchup_proj[stat] = matchup_proj[stat] * pace_factor
    
# Defense affects scoring efficiency and volume
scoring_stats = ['PTS', 'FGM', 'FG3M', 'FTM']
for stat in scoring_stats:
    matchup_proj[stat] = matchup_proj[stat] * def_factor

# --- 5. Probabilistic Variance (Monte Carlo) ---

# Calculate the covariance matrix from the player's actual game logs
cov_matrix = maxey_logs[stats_to_sim].cov()

# Extract the adjusted mean values as an array
mean_array = matchup_proj[stats_to_sim].values

# Run the Monte Carlo simulation (10,000 runs)
num_simulations = 10000
simulated_games = np.random.multivariate_normal(mean_array, cov_matrix, num_simulations)

# Convert negative stats to 0 (cannot have negative points/rebounds) and round to whole numbers
simulated_games = np.clip(np.round(simulated_games), a_min=0, a_max=None)
sim_df = pd.DataFrame(simulated_games, columns=stats_to_sim)

def generate_variance_report(sim_df):
    """
    Takes the simulated game results and calculates expected values, 
    variance, volatility (CV), and confidence intervals (Floor/Ceiling).
    """
    summary_stats = pd.DataFrame({
        'Expected': sim_df.mean(),
        'Variance': sim_df.var(),
        'Std Dev': sim_df.std(),
        'Floor (5th Pct)': sim_df.quantile(0.05),
        'Ceiling (95th Pct)': sim_df.quantile(0.95)
    })

    # Add Coefficient of Variation (CV = Std Dev / Mean)
    summary_stats['CV (%)'] = (summary_stats['Std Dev'] / (summary_stats['Expected'] + 1e-9)) * 100
    summary_stats = summary_stats[['Expected', 'Floor (5th Pct)', 'Ceiling (95th Pct)', 'Std Dev', 'Variance', 'CV (%)']]
    
    return summary_stats.round(2)

# --- 6. Output Results ---

print("=== TYRESE MAXEY PROJECTIONS VS. INDIANA PACERS ===")
print("\n1. BASE PROJECTION (15-Game EMA):")
print(ema_stats[stats_to_sim].round(1).to_string())

print(f"\n2. MATCHUP ADJUSTED (Pace Factor: {pace_factor:.3f}, Def Factor: {def_factor:.3f}):")
print(matchup_proj[stats_to_sim].round(1).to_string())

print("\n3. MONTE CARLO SIMULATION RESULTS (10,000 Runs - Expected Averages):")
print(sim_df.mean().round(1).to_string())

print("\n4. PROBABILISTIC OUTCOMES (Implied Odds):")
print(f"Chance of 25+ Points: {(sim_df['PTS'] >= 25).mean() * 100:.1f}%")
print(f"Chance of 8+ Assists: {(sim_df['AST'] >= 8).mean() * 100:.1f}%")
print(f"Chance of Double-Double (PTS/AST): {((sim_df['PTS'] >= 10) & (sim_df['AST'] >= 10)).mean() * 100:.1f}%")

print("\n5. STATISTICAL VARIANCE & CONFIDENCE INTERVALS:")
variance_report = generate_variance_report(sim_df)
print(variance_report.to_string())