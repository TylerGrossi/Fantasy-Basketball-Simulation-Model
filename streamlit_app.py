"""
🏀 Fantasy Basketball Win Percentage Simulation - Streamlit App
================================================================
A web-based Monte Carlo simulation tool for ESPN Fantasy Basketball
"""

import streamlit as st
import pandas as pd
import numpy as np
from datetime import datetime
from zoneinfo import ZoneInfo

from config import CATEGORIES, NUMERIC_COLS
from data import (
    connect_to_espn,
    get_matchup_info,
    get_current_totals,
    build_stat_df,
    add_games_left,
    filter_injured,
    flatten_stat_dict,
)
from simulation import (
    simulate_team,
    add_current_to_sim,
    compare_matchups,
    analyze_streamers,
    analyze_bench_strategy,
    calculate_league_stats,
)
from visualizations import (
    create_scoreboard,
    create_win_probability_gauge,
    create_category_chart,
    create_outcome_distribution,
)
from styles import CUSTOM_CSS

# Must be the first Streamlit command
st.set_page_config(
    page_title="Fantasy Basketball Simulator",
    page_icon="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%23FF6B35' stroke='%23000' stroke-width='2'/><path d='M50 5 Q50 50 50 95' stroke='%23000' stroke-width='2' fill='none'/><path d='M5 50 Q50 50 95 50' stroke='%23000' stroke-width='2' fill='none'/><path d='M15 20 Q50 35 85 20' stroke='%23000' stroke-width='2' fill='none'/><path d='M15 80 Q50 65 85 80' stroke='%23000' stroke-width='2' fill='none'/></svg>",
    layout="wide",
    initial_sidebar_state="expanded"
)
st.markdown(CUSTOM_CSS, unsafe_allow_html=True)


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