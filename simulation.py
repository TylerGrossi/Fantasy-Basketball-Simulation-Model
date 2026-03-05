"""
Fantasy Basketball Simulator - Monte Carlo simulation, streamers, bench strategy, league stats.
"""

from collections import defaultdict
import numpy as np
import pandas as pd

from config import (
    CATEGORIES,
    CATEGORY_VARIANCE,
    NUMERIC_COLS,
    PLAYOFF_VARIANCE_MULTIPLIER,
    REGULAR_SEASON_VARIANCE_EARLY_WEEK,
    REGULAR_SEASON_VARIANCE_MID_WEEK,
    REGULAR_SEASON_VARIANCE_LATE_WEEK,
    STATUS_DISPLAY,
)
from data import (
    build_stat_df,
    add_games_left,
    add_games_in_week,
    is_player_injured,
    flatten_stat_dict,
    get_espn_injury_data,
)


def _get_matchup_variance_multiplier():
    """Variance by day: 1.45 Mon/Tue, 1.25 Wed–Fri, 1.0 Sat/Sun."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    eastern = ZoneInfo("America/New_York")
    weekday = datetime.now(eastern).weekday()  # 0=Mon, 6=Sun
    if weekday <= 1:  # Monday or Tuesday
        return REGULAR_SEASON_VARIANCE_EARLY_WEEK
    if weekday <= 4:  # Wednesday, Thursday, Friday
        return REGULAR_SEASON_VARIANCE_MID_WEEK
    return REGULAR_SEASON_VARIANCE_LATE_WEEK  # Saturday, Sunday


def simulate_team(team_df, sims=10000, variance_multiplier=1.0):
    """Monte Carlo simulation for team stats - Vectorized NumPy version for speed."""
    if team_df.empty:
        all_stats = list(CATEGORY_VARIANCE.keys()) + ["FG%", "FT%", "3P%"]
        return {stat: [0.0] * sims for stat in all_stats}

    stats_to_sim = list(CATEGORY_VARIANCE.keys())
    variance_vals = np.array([CATEGORY_VARIANCE[s] for s in stats_to_sim]) * variance_multiplier
    team_df_clean = team_df.fillna(0)
    means = team_df_clean[stats_to_sim].values
    games = team_df_clean["Games Left"].values.astype(int)
    totals = np.zeros((sims, len(stats_to_sim)))

    for p_idx in range(len(team_df_clean)):
        n_games = games[p_idx]
        if n_games <= 0:
            continue
        player_means = means[p_idx]
        player_stds = player_means * variance_vals
        random_vals = np.random.normal(
            loc=player_means,
            scale=player_stds,
            size=(sims, n_games, len(stats_to_sim))
        )
        totals += random_vals.sum(axis=1)

    results = {}
    for i, stat in enumerate(stats_to_sim):
        results[stat] = totals[:, i].tolist()

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
    """Add current week totals to simulated rest-of-week stats - Vectorized."""
    adjusted = {}
    for stat in sim:
        sim_arr = np.array(sim[stat])
        if stat in ["FG%", "FT%", "3P%"]:
            adjusted[stat] = np.zeros_like(sim_arr)
        else:
            adjusted[stat] = sim_arr + current.get(stat, 0)
    fgm, fga = adjusted["FGM"], adjusted["FGA"]
    ftm, fta = adjusted["FTM"], adjusted["FTA"]
    tpm, tpa = adjusted["3PM"], adjusted["3PA"]
    with np.errstate(divide='ignore', invalid='ignore'):
        adjusted["FG%"] = np.where(fga > 0, fgm / fga, 0)
        adjusted["FT%"] = np.where(fta > 0, ftm / fta, 0)
        adjusted["3P%"] = np.where(tpa > 0, tpm / tpa, 0)
    return {k: v.tolist() if isinstance(v, np.ndarray) else v for k, v in adjusted.items()}


def compare_matchups(sim1, sim2, categories):
    """Compare two teams across all simulations - Vectorized."""
    sims = len(sim1["FGM"])
    sim1_arr = {cat: np.array(sim1[cat]) for cat in categories}
    sim2_arr = {cat: np.array(sim2[cat]) for cat in categories}
    category_outcomes = {cat: {"you": 0, "opponent": 0, "tie": 0} for cat in categories}
    your_wins_per_sim = np.zeros(sims)
    opp_wins_per_sim = np.zeros(sims)

    for cat in categories:
        y_vals = sim1_arr[cat]
        o_vals = sim2_arr[cat]
        if cat == "TO":
            you_win = y_vals < o_vals
            opp_win = y_vals > o_vals
        else:
            you_win = y_vals > o_vals
            opp_win = y_vals < o_vals
        category_outcomes[cat]["you"] = int(you_win.sum())
        category_outcomes[cat]["opponent"] = int(opp_win.sum())
        category_outcomes[cat]["tie"] = int((~you_win & ~opp_win).sum())
        your_wins_per_sim += you_win.astype(int)
        opp_wins_per_sim += opp_win.astype(int)

    you_win_matchup = your_wins_per_sim > opp_wins_per_sim
    opp_win_matchup = opp_wins_per_sim > your_wins_per_sim
    tie_matchup = your_wins_per_sim == opp_wins_per_sim
    matchup_results = {
        "you": int(you_win_matchup.sum()),
        "opponent": int(opp_win_matchup.sum()),
        "tie": int(tie_matchup.sum())
    }
    outcome_counts = defaultdict(int)
    for y_w, o_w in zip(your_wins_per_sim.astype(int), opp_wins_per_sim.astype(int)):
        outcome_counts[(y_w, o_w)] += 1
    return matchup_results, category_outcomes, outcome_counts


def _evaluate_matchup(test_totals, opp_totals, opp_fgp, opp_ftp, opp_3pp,
                      stats_to_sim, baseline_avg_cats, baseline_cat_results, sims):
    """Helper: evaluate a matchup using vectorized operations."""
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
    avg_cats_won = your_wins.mean()
    net_cats = avg_cats_won - baseline_avg_cats
    win_pct = (your_wins > opp_wins).sum() / sims * 100
    cat_impacts = {}
    for cat in CATEGORIES:
        if cat in cat_results:
            base_win_rate = baseline_cat_results[cat]["you"] / sum(baseline_cat_results[cat].values())
            new_win_rate = cat_results[cat]["you"] / sims
            delta = (new_win_rate - base_win_rate) * 100
            if abs(delta) > 3:
                cat_impacts[cat] = delta
    return net_cats, avg_cats_won, win_pct, cat_impacts


def analyze_streamers(league, your_team_df, opp_team_df, current_totals_you, current_totals_opp,
                      baseline_results, blend_weight, year, num_streamers=20,
                      untouchables=None, has_open_roster_spot=False, manual_watchlist=None):
    """Analyze potential streamer pickups, considering who to drop."""
    baseline_win_pct, baseline_cat_results, baseline_avg_cats = baseline_results
    untouchables = untouchables or []
    untouchables_lower = [p.lower().strip() for p in untouchables]
    manual_watchlist = manual_watchlist or []
    watchlist_names_lower = {p.lower().strip() for p in manual_watchlist}
    droppable_players = your_team_df[
        ~your_team_df["Player"].str.lower().str.strip().isin(untouchables_lower)
    ].copy()
    free_agents = league.free_agents(size=min(200, num_streamers * 2))
    healthy_players = [p for p in free_agents if not is_player_injured(p)]
    if not healthy_players:
        return []
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
    waiver_df["_watchlist_sort"] = waiver_df["On Watchlist"].map({True: 0, False: 1})
    waiver_df = waiver_df.sort_values(["_watchlist_sort", "Games Left", "PTS"], ascending=[True, False, False])
    waiver_df = waiver_df.drop(columns=["_watchlist_sort"])
    streamers = waiver_df.head(num_streamers)
    if streamers.empty:
        return []
    streamer_sims = 2000
    stats_to_sim = list(CATEGORY_VARIANCE.keys())
    variance_vals = np.array([CATEGORY_VARIANCE[s] for s in stats_to_sim])
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
    for i, stat in enumerate(stats_to_sim):
        opp_totals[:, i] += current_totals_opp.get(stat, 0)
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
        streamer_means = np.array([streamer_row.get(s, 0) for s in stats_to_sim])
        streamer_stds = streamer_means * variance_vals
        streamer_games = int(streamer_row["Games Left"])
        if streamer_games > 0:
            streamer_contrib = np.random.normal(
                loc=streamer_means, scale=streamer_stds,
                size=(streamer_sims, streamer_games, len(stats_to_sim))
            ).sum(axis=1)
        else:
            streamer_contrib = np.zeros((streamer_sims, len(stats_to_sim)))
        if has_open_roster_spot:
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
            for i, stat in enumerate(stats_to_sim):
                test_totals[:, i] += current_totals_you.get(stat, 0)
            net_cats, exp_cats, win_pct, cat_impacts = _evaluate_matchup(
                test_totals, opp_totals, opp_fgp, opp_ftp, opp_3pp,
                stats_to_sim, baseline_avg_cats, baseline_cat_results, streamer_sims
            )
            best_drop = "(Open Spot)"
            best_net_cats = net_cats
            best_exp_cats = exp_cats
            best_win_pct = win_pct
            best_cat_impacts = cat_impacts
        for drop_idx, (_, drop_row) in enumerate(droppable_players.iterrows()):
            drop_player_name = drop_row["Player"]
            test_totals = np.zeros((streamer_sims, len(stats_to_sim)))
            for p_idx in range(len(your_df_clean)):
                if your_players[p_idx] == drop_player_name:
                    continue
                n_games = your_games[p_idx]
                if n_games <= 0:
                    continue
                player_means = your_means[p_idx]
                player_stds = player_means * variance_vals
                random_vals = np.random.normal(loc=player_means, scale=player_stds, size=(streamer_sims, n_games, len(stats_to_sim)))
                test_totals += random_vals.sum(axis=1)
            test_totals += streamer_contrib
            for i, stat in enumerate(stats_to_sim):
                test_totals[:, i] += current_totals_you.get(stat, 0)
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


def analyze_bench_strategy(your_team_df, opp_team_df, current_totals_you, current_totals_opp,
                           baseline_results, sims=3000):
    """Analyze whether benching all players today would improve win probability."""
    baseline_win_pct, baseline_cat_results, baseline_avg_cats = baseline_results
    stats_to_sim = list(CATEGORY_VARIANCE.keys())
    variance_vals = np.array([CATEGORY_VARIANCE[s] for s in stats_to_sim])
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
    for i, stat in enumerate(stats_to_sim):
        opp_totals[:, i] += current_totals_opp.get(stat, 0)
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
    for i, stat in enumerate(stats_to_sim):
        play_totals[:, i] += current_totals_you.get(stat, 0)
    bench_totals = np.zeros((sims, len(stats_to_sim)))
    for i, stat in enumerate(stats_to_sim):
        bench_totals[:, i] = current_totals_you.get(stat, 0)

    def evaluate_scenario(your_totals):
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
        you_win_matchup = (your_wins > (len(CATEGORIES) / 2)).sum()
        avg_cats_won = your_wins.mean()
        win_pct = you_win_matchup / sims * 100
        return {"win_pct": win_pct, "avg_cats": avg_cats_won, "cat_results": cat_results}

    play_results = evaluate_scenario(play_totals)
    bench_results = evaluate_scenario(bench_totals)
    play_better = play_results["avg_cats"] >= bench_results["avg_cats"]
    cats_diff = play_results["avg_cats"] - bench_results["avg_cats"]
    win_pct_diff = play_results["win_pct"] - bench_results["win_pct"]
    bench_helps_cats = []
    play_helps_cats = []
    for cat in CATEGORIES:
        play_cat_pct = play_results["cat_results"][cat]["win_pct"]
        bench_cat_pct = bench_results["cat_results"][cat]["win_pct"]
        diff = bench_cat_pct - play_cat_pct
        if diff > 5:
            bench_helps_cats.append((cat, diff))
        elif diff < -5:
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


def _build_projected_weekly_for_team(team, week, year, injury_data, blend_weight):
    """
    Build projected category totals for a team in a specific week.
    Uses season + last30 blend, injury-aware games in that week.
    Returns dict: category -> projected total (float).
    """
    roster = getattr(team, "roster", [])
    if not roster:
        return {cat: 0.0 for cat in CATEGORIES}
    team_name = getattr(team, "team_name", "Unknown")
    season_df = build_stat_df(roster, f"{year}_total", "Season", team_name, year)
    last30_df = build_stat_df(roster, f"{year}_last_30", "Last30", team_name, year)
    if season_df.empty:
        return {cat: 0.0 for cat in CATEGORIES}
    if last30_df.empty:
        merged = season_df.copy()
        for col in NUMERIC_COLS:
            merged[col] = merged[col] if col in merged.columns else 0.0
    else:
        merged = season_df.merge(last30_df, on=["Player", "NBA_Team"], how="outer", suffixes=("_season", "_30"))
        merged = merged.fillna(0)
        for col in NUMERIC_COLS:
            if f"{col}_30" in merged.columns and f"{col}_season" in merged.columns:
                merged[col] = merged[f"{col}_30"] * blend_weight + merged[f"{col}_season"] * (1 - blend_weight)
            elif f"{col}_season" in merged.columns:
                merged[col] = merged[f"{col}_season"]
            elif f"{col}_30" in merged.columns:
                merged[col] = merged[f"{col}_30"]
            else:
                merged[col] = 0.0
    merged = add_games_in_week(merged, roster, week, year, injury_data)
    merged = merged[merged["Games This Week"] > 0]
    if merged.empty:
        return {cat: 0.0 for cat in CATEGORIES}
    stats_to_sim = list(CATEGORY_VARIANCE.keys())
    proj = {}
    for stat in stats_to_sim:
        if stat in merged.columns:
            proj[stat] = float((merged[stat] * merged["Games This Week"]).sum())
        else:
            proj[stat] = 0.0
    fgm, fga = proj.get("FGM", 0), proj.get("FGA", 0)
    ftm, fta = proj.get("FTM", 0), proj.get("FTA", 0)
    tpm, tpa = proj.get("3PM", 0), proj.get("3PA", 0)
    proj["FG%"] = fgm / fga if fga > 0 else 0.0
    proj["FT%"] = ftm / fta if fta > 0 else 0.0
    proj["3P%"] = tpm / tpa if tpa > 0 else 0.0
    return proj


def _build_projected_for_all_teams(league, year, injury_data, blend_weight, remaining_weeks):
    """
    Build projected weekly stats for all teams for each remaining week.
    Returns: dict team_id -> {week -> {cat -> projected}}
    """
    injury_data = injury_data or {}
    result = {}
    for team in league.teams:
        tid = team.team_id
        result[tid] = {}
        for week in remaining_weeks:
            result[tid][week] = _build_projected_weekly_for_team(
                team, week, year, injury_data, blend_weight
            )
    return result


def _combine_projected_stats(proj1, proj2):
    """Combine two weeks of projected stats (for two-week playoff matchups)."""
    raw_stats = ["FGM", "FGA", "FTM", "FTA", "3PM", "3PA", "REB", "AST", "STL", "BLK", "TO", "PTS", "DD", "TW"]
    combined = {}
    for s in raw_stats:
        combined[s] = proj1.get(s, 0) + proj2.get(s, 0)
    fgm, fga = combined.get("FGM", 0), combined.get("FGA", 0)
    ftm, fta = combined.get("FTM", 0), combined.get("FTA", 0)
    tpm, tpa = combined.get("3PM", 0), combined.get("3PA", 0)
    combined["FG%"] = fgm / fga if fga > 0 else 0.0
    combined["FT%"] = ftm / fta if fta > 0 else 0.0
    combined["3P%"] = tpm / tpa if tpa > 0 else 0.0
    return combined


def _simulate_matchup_winner(home_id, away_id, proj_home, proj_away, variance_multiplier=1.0):
    """
    Simulate a single matchup outcome using category-by-category comparison.
    Draws from Normal(proj, variance*proj) for each team/category, then compares.
    variance_multiplier: scale variance (e.g. 1.4 for playoff = more upsets).
    Returns winner team_id (home_id or away_id).
    """
    stats_to_sim = list(CATEGORY_VARIANCE.keys())
    variance_vals = np.array([CATEGORY_VARIANCE[s] for s in stats_to_sim]) * variance_multiplier
    home_wins = 0
    away_wins = 0
    for i, stat in enumerate(stats_to_sim):
        m_h = proj_home.get(stat, 0)
        m_a = proj_away.get(stat, 0)
        std_h = max(0.01, abs(m_h) * variance_vals[i])
        std_a = max(0.01, abs(m_a) * variance_vals[i])
        draw_h = np.random.normal(m_h, std_h)
        draw_a = np.random.normal(m_a, std_a)
        if stat == "TO":
            if draw_h < draw_a:
                home_wins += 1
            elif draw_a < draw_h:
                away_wins += 1
        else:
            if draw_h > draw_a:
                home_wins += 1
            elif draw_a > draw_h:
                away_wins += 1
    if home_wins > away_wins:
        return home_id
    if away_wins > home_wins:
        return away_id
    return home_id if np.random.random() < 0.5 else away_id


def calculate_league_stats(league, year):
    """Calculate league-wide statistics including all-play records."""
    teams = league.teams
    current_week = league.currentMatchupPeriod
    num_completed_weeks = current_week - 1 if current_week > 1 else current_week
    all_play_records = {team.team_id: {"wins": 0, "losses": 0, "ties": 0} for team in teams}
    for week in range(1, num_completed_weeks + 1):
        try:
            boxscores = league.box_scores(matchup_period=week)
            weekly_stats = {}
            for matchup in boxscores:
                home_stats = flatten_stat_dict(matchup.home_stats)
                weekly_stats[matchup.home_team.team_id] = home_stats
                away_stats = flatten_stat_dict(matchup.away_stats)
                weekly_stats[matchup.away_team.team_id] = away_stats
            if not weekly_stats:
                continue
            team_ids = list(weekly_stats.keys())
            for team1_id in team_ids:
                for team2_id in team_ids:
                    if team1_id == team2_id:
                        continue
                    stats1 = weekly_stats.get(team1_id, {})
                    stats2 = weekly_stats.get(team2_id, {})
                    if not stats1 or not stats2:
                        continue
                    for cat in CATEGORIES:
                        val1 = stats1.get(cat, 0)
                        val2 = stats2.get(cat, 0)
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
                        if cat == "TO":
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
        except Exception:
            continue
    league_data = []
    for team in teams:
        tid = team.team_id
        ap = all_play_records[tid]
        ap_total = ap["wins"] + ap["losses"] + ap["ties"]
        ap_pct = ap["wins"] / ap_total if ap_total > 0 else 0
        actual_total = team.wins + team.losses + getattr(team, 'ties', 0)
        actual_pct = team.wins / actual_total if actual_total > 0 else 0
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
    return sorted(league_data, key=lambda x: x["standing"])


def simulate_playoff_probabilities(league, league_stats, year, sims=5000,
                                   playoff_teams=4, regular_season_weeks=19,
                                   record_override=None, blend_weight=0.7,
                                   injury_data=None):
    """
    Monte Carlo simulation for playoff and championship probabilities.
    Uses projected roster strength (season + last30 blend, injury-aware) and
    simulates category-by-category matchup outcomes (like weekly matchup sim).

    record_override: optional dict {team_id: (wins, losses, ties)} to override records
    blend_weight: weight for last30 vs season (default 0.7 = 70% last30)
    injury_data: from get_espn_injury_data(); fetched if None

    Returns:
        list of dicts with playoff_prob, seed_probs, championship_prob per team_id
    """
    teams = league.teams
    current_week = league.currentMatchupPeriod
    num_teams = len(teams)

    if injury_data is None:
        injury_data = get_espn_injury_data()

    team_id_to_name = {t["team_id"]: t["team_name"] for t in league_stats}
    team_id_to_record = {
        t["team_id"]: (t["actual_wins"], t["actual_losses"], t["actual_ties"])
        for t in league_stats
    }
    if record_override:
        for tid, rec in record_override.items():
            team_id_to_record[tid] = rec

    # Build schedule: week -> list of (home_id, away_id) matchups
    schedule_by_week = {}
    for week in range(1, regular_season_weeks + 1):
        try:
            matchups = league.scoreboard(matchupPeriod=week)
            for m in matchups:
                home_id = m.home_team if isinstance(m.home_team, int) else getattr(
                    m.home_team, "team_id", None
                )
                away_id = m.away_team if isinstance(m.away_team, int) else getattr(
                    m.away_team, "team_id", None
                )
                if home_id is None or away_id is None:
                    continue
                if week not in schedule_by_week:
                    schedule_by_week[week] = []
                schedule_by_week[week].append((home_id, away_id))
        except Exception:
            continue

    remaining_weeks = [w for w in range(current_week, regular_season_weeks + 1)
                       if w in schedule_by_week and schedule_by_week[w]]

    # Playoff matchups are two weeks each: semis = weeks 20-21, finals = weeks 22-23
    semis_weeks = (regular_season_weeks + 1, regular_season_weeks + 2)
    finals_weeks = (regular_season_weeks + 3, regular_season_weeks + 4)
    playoff_week_pairs = [semis_weeks, finals_weeks]
    all_weeks_for_proj = remaining_weeks + list(semis_weeks) + list(finals_weeks)

    # Build projected weekly stats for all teams (regular season + playoff weeks)
    projected = _build_projected_for_all_teams(
        league, year, injury_data, blend_weight, all_weeks_for_proj
    )

    # Tiebreaker: use all-play for standings tiebreak when records are equal
    strength_map = {t["team_id"]: max(0.01, t["all_play_pct"]) for t in league_stats}

    # Same day-of-week variance as weekly matchup (higher uncertainty early in week)
    matchup_variance = _get_matchup_variance_multiplier()

    team_ids = list(team_id_to_name.keys())
    playoff_count = {tid: 0 for tid in team_ids}
    seed_counts = {tid: {s: 0 for s in range(1, num_teams + 2)} for tid in team_ids}
    championship_count = {tid: 0 for tid in team_ids}

    for _ in range(sims):
        wins = {tid: team_id_to_record[tid][0] for tid in team_ids}
        losses = {tid: team_id_to_record[tid][1] for tid in team_ids}
        ties = {tid: team_id_to_record[tid][2] for tid in team_ids}

        # Simulate remaining regular season: category-by-category (Option B)
        for week in remaining_weeks:
            for home_id, away_id in schedule_by_week.get(week, []):
                proj_home = projected.get(home_id, {}).get(week, {})
                proj_away = projected.get(away_id, {}).get(week, {})
                winner = _simulate_matchup_winner(
                    home_id, away_id, proj_home, proj_away,
                    variance_multiplier=matchup_variance
                )
                if winner == home_id:
                    wins[home_id] += 1
                    losses[away_id] += 1
                else:
                    wins[away_id] += 1
                    losses[home_id] += 1

        # Final standings: sort by wins (then fewer losses, then all-play tiebreaker)
        def sort_key(tid):
            w, l, t = wins[tid], losses[tid], ties[tid]
            return (w, -l, strength_map.get(tid, 0))
        sorted_ids = sorted(team_ids, key=sort_key, reverse=True)

        for rank, tid in enumerate(sorted_ids, 1):
            seed_counts[tid][min(rank, num_teams + 1)] += 1
            if rank <= playoff_teams:
                playoff_count[tid] += 1

        # Simulate playoff bracket: two-week matchups, injury-aware, category-by-category
        playoff_bracket = sorted_ids[:playoff_teams]
        champ = _simulate_playoff_bracket_projected(
            playoff_bracket, projected, playoff_week_pairs,
            day_variance_multiplier=matchup_variance
        )
        if champ is not None:
            championship_count[champ] += 1

    total_sims = sims
    result = []
    for tid in team_ids:
        playoff_pct = playoff_count[tid] / total_sims * 100
        champ_pct = championship_count[tid] / total_sims * 100
        seed_probs = {}
        no_playoffs = 0
        for s in range(1, num_teams + 2):
            pct = seed_counts[tid][s] / total_sims * 100
            if s <= playoff_teams:
                seed_probs[s] = pct
            else:
                no_playoffs += pct
        seed_probs["no_playoffs"] = no_playoffs
        result.append({
            "team_id": tid,
            "team_name": team_id_to_name[tid],
            "playoff_prob": playoff_pct,
            "championship_prob": champ_pct,
            "seed_probs": seed_probs,
            "record": team_id_to_record[tid],
        })
    return result


def _simulate_playoff_bracket_projected(bracket, projected, playoff_week_pairs,
                                        day_variance_multiplier=1.0):
    """
    Simulate single-elimination bracket. Each round is a two-week matchup.
    playoff_week_pairs: [(semis_w1, semis_w2), (finals_w1, finals_w2)] e.g. [(20,21), (22,23)]
    day_variance_multiplier: from _get_matchup_variance_multiplier() - higher early in week.
    """
    if not bracket:
        return None
    if len(playoff_week_pairs) < 2:
        playoff_week_pairs = [(20, 21), (22, 23)]
    semis_w1, semis_w2 = playoff_week_pairs[0]
    finals_w1, finals_w2 = playoff_week_pairs[1]
    bracket_variance = PLAYOFF_VARIANCE_MULTIPLIER * day_variance_multiplier
    current = list(bracket)
    round_idx = 0
    while len(current) > 1:
        w1, w2 = (semis_w1, semis_w2) if round_idx == 0 else (finals_w1, finals_w2)
        next_round = []
        for i in range(0, len(current), 2):
            if i + 1 >= len(current):
                next_round.append(current[i])
                continue
            a, b = current[i], current[i + 1]
            proj_a_w1 = projected.get(a, {}).get(w1, {})
            proj_a_w2 = projected.get(a, {}).get(w2, {})
            proj_b_w1 = projected.get(b, {}).get(w1, {})
            proj_b_w2 = projected.get(b, {}).get(w2, {})
            proj_a = _combine_projected_stats(proj_a_w1, proj_a_w2)
            proj_b = _combine_projected_stats(proj_b_w1, proj_b_w2)
            winner = _simulate_matchup_winner(
                a, b, proj_a, proj_b,
                variance_multiplier=bracket_variance
            )
            next_round.append(winner)
        current = next_round
        round_idx += 1
    return current[0] if current else None
