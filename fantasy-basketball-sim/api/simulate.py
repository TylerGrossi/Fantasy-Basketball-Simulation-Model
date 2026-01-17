"""
Fantasy Basketball Monte Carlo Simulation API
Vercel Serverless Function (Python)
"""

from http.server import BaseHTTPRequestHandler
import json
import random
from collections import defaultdict
from datetime import datetime, timedelta
import urllib.request
import urllib.error

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
# HELPER FUNCTIONS
# =============================================================================

def safe_num(x):
    try:
        return float(x)
    except:
        return 0.0


def normalize_team(t):
    if t is None:
        return None
    t = str(t).upper().strip()
    return TEAM_FIXES.get(t, t)


def flatten_stat_dict(d):
    if not d:
        return {}
    return {k: (v.get("value", v) if isinstance(v, dict) else v) for k, v in d.items()}


# =============================================================================
# ESPN API FUNCTIONS (using espn_api library)
# =============================================================================

def connect_to_espn(config):
    """Connect to ESPN using the espn_api library"""
    from espn_api.basketball import League
    
    league = League(
        league_id=int(config["league_id"]),
        year=int(config.get("year", 2026)),
        espn_s2=config["espn_s2"],
        swid=config["swid"]
    )
    return league


def get_matchup_info(league, team_id):
    """Get current matchup information"""
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
    """Get current week totals"""
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


def filter_injured(roster):
    """Filter out injured players"""
    return [p for p in roster if p.injuryStatus not in INJURED_STATUSES]


def build_player_stats(roster, period_key, team_name):
    """Build player stats from ESPN roster data"""
    players = []
    
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
        
        players.append({
            "Player": p.name,
            "NBA_Team": p.proTeam,
            "Team": team_name,
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
    
    return players


# =============================================================================
# SCHEDULE FUNCTIONS
# =============================================================================

def get_team_schedule(team_abbrev):
    """Get NBA team schedule from ESPN API"""
    if team_abbrev is None:
        return []
    
    team_abbrev = normalize_team(team_abbrev)
    if team_abbrev not in NBA_TEAM_MAP:
        return []
    
    slug = NBA_TEAM_MAP[team_abbrev]
    url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{slug}/schedule"
    
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
        
        dates = []
        for event in data.get("events", []):
            try:
                date_str = event["date"]
                # Parse ISO format date
                if "T" in date_str:
                    dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                else:
                    dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
                dates.append(dt.date())
            except:
                pass
        return dates
    except:
        return []


def count_games_left(team_abbrev):
    """Count games remaining this week"""
    today = datetime.now().date()
    # Week ends on Sunday
    days_until_sunday = 6 - today.weekday()
    if days_until_sunday < 0:
        days_until_sunday = 0
    end_of_week = today + timedelta(days=days_until_sunday)
    
    sched = get_team_schedule(team_abbrev)
    return sum(1 for g in sched if today <= g <= end_of_week)


def add_games_left(players):
    """Add games left to player list"""
    for p in players:
        p["Games Left"] = count_games_left(p.get("NBA_Team"))
    return players


# =============================================================================
# SIMULATION FUNCTIONS
# =============================================================================

def blend_stats(season_players, last30_players, blend_weight=0.7):
    """Blend season and last 30 day stats"""
    # Create lookup by player name
    season_lookup = {p["Player"]: p for p in season_players}
    last30_lookup = {p["Player"]: p for p in last30_players}
    
    blended = []
    for name in last30_lookup:
        if name not in season_lookup:
            continue
        
        l30 = last30_lookup[name]
        sea = season_lookup[name]
        
        player = {
            "Player": name,
            "NBA_Team": l30.get("NBA_Team"),
            "Team": l30.get("Team"),
            "Games Left": l30.get("Games Left", 0),
        }
        
        for col in NUMERIC_COLS:
            v30 = l30.get(col, 0)
            vsea = sea.get(col, 0)
            player[col] = v30 * blend_weight + vsea * (1 - blend_weight)
        
        if player["Games Left"] > 0:
            blended.append(player)
    
    return blended


def simulate_team(players, sims=10000):
    """Monte Carlo simulation for a team"""
    results = defaultdict(list)
    all_stats = list(CATEGORY_VARIANCE.keys()) + ["FG%", "FT%", "3P%"]
    
    for _ in range(sims):
        totals = defaultdict(float)
        
        for player in players:
            games_left = int(player.get("Games Left", 0))
            for _ in range(games_left):
                for stat in CATEGORY_VARIANCE:
                    mean = player.get(stat, 0)
                    std_dev = mean * CATEGORY_VARIANCE[stat]
                    totals[stat] += random.gauss(mean, std_dev)
        
        # Calculate percentages
        totals["FG%"] = totals["FGM"] / totals["FGA"] if totals["FGA"] > 0 else 0
        totals["FT%"] = totals["FTM"] / totals["FTA"] if totals["FTA"] > 0 else 0
        totals["3P%"] = totals["3PM"] / totals["3PA"] if totals["3PA"] > 0 else 0
        
        for stat in all_stats:
            results[stat].append(totals[stat])
    
    return dict(results)


def add_current_to_sim(current, sim):
    """Add current totals to simulation results"""
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
        
        tpm = adjusted["3PM"][i]
        tpa = adjusted["3PA"][i]
        adjusted["3P%"][i] = tpm / tpa if tpa > 0 else 0
    
    return dict(adjusted)


def compare_matchups(sim1, sim2, categories):
    """Compare two teams across simulations"""
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


def analyze_streamers(league, your_players, opp_players, current_you, current_opp, 
                      baseline_cat_results, baseline_avg_cats, streamers_to_test=20):
    """Analyze potential streamers"""
    free_agents = league.free_agents(size=150)
    
    # Build free agent stats
    fa_season = build_player_stats(free_agents, "2026_total", "Waiver")
    fa_last30 = build_player_stats(free_agents, "2026_last_30", "Waiver")
    
    fa_season = add_games_left(fa_season)
    fa_last30 = add_games_left(fa_last30)
    
    # Blend and filter
    fa_blended = blend_stats(fa_season, fa_last30, 0.7)
    fa_blended = sorted(fa_blended, key=lambda x: (-x.get("Games Left", 0), -x.get("PTS", 0)))
    streamers = fa_blended[:streamers_to_test]
    
    # Simulate opponent once
    opp_sim_raw = simulate_team(opp_players, sims=2000)
    opp_sim = add_current_to_sim(current_opp, opp_sim_raw)
    
    results = []
    for player in streamers:
        test_team = your_players + [player]
        test_sim_raw = simulate_team(test_team, sims=2000)
        test_sim = add_current_to_sim(current_you, test_sim_raw)
        
        result, cat_results, outcome_counts = compare_matchups(test_sim, opp_sim, CATEGORIES)
        
        total_sims = sum(result.values())
        avg_cats_won = sum(your_w * count for (your_w, opp_w), count in outcome_counts.items()) / total_sims
        cats_gained = avg_cats_won - baseline_avg_cats
        win_pct = result["you"] / total_sims * 100
        
        # Find category impacts
        cat_flips = []
        for cat in CATEGORIES:
            base_win_rate = baseline_cat_results[cat]["you"] / sum(baseline_cat_results[cat].values())
            new_win_rate = cat_results[cat]["you"] / sum(cat_results[cat].values())
            delta = (new_win_rate - base_win_rate) * 100
            
            if abs(delta) > 3:
                tag = "🟢" if delta > 0 else "🔻"
                cat_flips.append((delta, f"{tag}{cat}: {delta:+.0f}%"))
        
        top_flips = [x[1] for x in sorted(cat_flips, key=lambda x: abs(x[0]), reverse=True)[:3]]
        
        # Risk tags
        risks = []
        if player.get("FGA", 0) > 12:
            risks.append("🧨 High FGA")
        if player.get("TO", 0) > 2:
            risks.append("🧨 TO")
        if player.get("FG%", 1.0) < 0.42:
            risks.append("📉 FG%")
        
        results.append({
            "player": player["Player"],
            "games": int(player.get("Games Left", 0)),
            "delta_cats": round(cats_gained, 2),
            "exp_cats": round(avg_cats_won, 2),
            "win_pct": round(win_pct, 1),
            "cat_impacts": ", ".join(top_flips) if top_flips else "",
            "risks": ", ".join(risks) if risks else ""
        })
    
    return sorted(results, key=lambda x: -x["delta_cats"])


def percentile(arr, p):
    """Calculate percentile of array"""
    sorted_arr = sorted(arr)
    idx = int(len(sorted_arr) * p / 100)
    return sorted_arr[min(idx, len(sorted_arr) - 1)]


def mean(arr):
    """Calculate mean of array"""
    return sum(arr) / len(arr) if arr else 0


# =============================================================================
# MAIN HANDLER
# =============================================================================

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            config = json.loads(post_data.decode('utf-8'))
            
            # Validate required fields
            required = ["league_id", "espn_s2", "swid", "team_id"]
            for field in required:
                if not config.get(field):
                    self.send_error_response(f"Missing required field: {field}")
                    return
            
            team_id = int(config["team_id"])
            sim_count = int(config.get("sim_count", 10000))
            streamers_to_test = int(config.get("streamers_to_test", 20))
            
            # Connect to ESPN
            league = connect_to_espn(config)
            
            # Get matchup info
            your_team_obj, opp_team_obj, matchup, current_week = get_matchup_info(league, team_id)
            
            # Get current totals
            current_you, current_opp = get_current_totals(matchup, team_id)
            
            # Build player stats
            your_filtered = filter_injured(your_team_obj.roster)
            opp_filtered = filter_injured(opp_team_obj.roster)
            
            your_season = build_player_stats(your_filtered, "2026_total", your_team_obj.team_name)
            your_last30 = build_player_stats(your_filtered, "2026_last_30", your_team_obj.team_name)
            opp_season = build_player_stats(opp_filtered, "2026_total", opp_team_obj.team_name)
            opp_last30 = build_player_stats(opp_filtered, "2026_last_30", opp_team_obj.team_name)
            
            # Add games left
            your_season = add_games_left(your_season)
            your_last30 = add_games_left(your_last30)
            opp_season = add_games_left(opp_season)
            opp_last30 = add_games_left(opp_last30)
            
            # Blend stats
            your_players = blend_stats(your_season, your_last30, 0.7)
            opp_players = blend_stats(opp_season, opp_last30, 0.7)
            
            # Run simulation
            your_sim_raw = simulate_team(your_players, sims=sim_count)
            opp_sim_raw = simulate_team(opp_players, sims=sim_count)
            
            your_sim = add_current_to_sim(current_you, your_sim_raw)
            opp_sim = add_current_to_sim(current_opp, opp_sim_raw)
            
            matchup_results, category_results, outcome_counts = compare_matchups(your_sim, opp_sim, CATEGORIES)
            
            # Calculate projected score
            total_sims = sum(matchup_results.values())
            you_wins = 0
            for cat in CATEGORIES:
                y_proj = mean(your_sim[cat])
                o_proj = mean(opp_sim[cat])
                if cat == "TO":
                    if y_proj < o_proj:
                        you_wins += 1
                else:
                    if y_proj > o_proj:
                        you_wins += 1
            
            # Top outcomes
            sorted_outcomes = sorted(outcome_counts.items(), key=lambda x: x[1], reverse=True)[:5]
            top_outcomes = [
                {"score": f"{y}-{o}", "probability": count / total_sims * 100}
                for (y, o), count in sorted_outcomes
            ]
            
            # Category details
            categories = []
            swing_categories = []
            for cat in CATEGORIES:
                outcome = category_results[cat]
                total_cat = sum(outcome.values())
                you_pct = outcome["you"] / total_cat * 100
                opp_pct = outcome["opponent"] / total_cat * 100
                
                is_swing = abs(you_pct - opp_pct) <= 15
                if is_swing:
                    swing_categories.append(cat)
                
                categories.append({
                    "name": cat,
                    "outcomes": outcome,
                    "projections": {
                        "you": mean(your_sim[cat]),
                        "opp": mean(opp_sim[cat])
                    }
                })
            
            # Expected categories
            baseline_avg_cats = sum(your_w * count for (your_w, opp_w), count in outcome_counts.items()) / total_sims
            
            # Analyze streamers
            streamers = analyze_streamers(
                league, your_players, opp_players, current_you, current_opp,
                category_results, baseline_avg_cats, streamers_to_test
            )
            
            # Build response
            response = {
                "matchup": {
                    "your_team": your_team_obj.team_name,
                    "opponent_team": opp_team_obj.team_name,
                    "week": current_week
                },
                "matchup_results": matchup_results,
                "projected_score": {
                    "you": you_wins,
                    "opponent": len(CATEGORIES) - you_wins
                },
                "top_outcomes": top_outcomes,
                "categories": categories,
                "swing_categories": swing_categories,
                "baseline_cats": baseline_avg_cats,
                "streamers": streamers
            }
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode('utf-8'))
            
        except Exception as e:
            self.send_error_response(str(e))
    
    def send_error_response(self, message):
        self.send_response(500)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode('utf-8'))
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
