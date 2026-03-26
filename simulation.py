"""
Fantasy Basketball Simulator - Monte Carlo simulation, streamers, bench strategy, league stats.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
import numpy as np
import pandas as pd

from config import (
    CATEGORIES,
    CATEGORY_VARIANCE,
    MAX_PLAYERS_PER_DAY,
    NUMERIC_COLS,
    PLAYOFF_MONTE_CARLO_CAP,
    PLAYOFF_VARIANCE_MULTIPLIER,
    REGULAR_SEASON_VARIANCE_EARLY_WEEK,
    REGULAR_SEASON_VARIANCE_MID_WEEK,
    REGULAR_SEASON_VARIANCE_LATE_WEEK,
    STATUS_DISPLAY,
    STREAMER_PICKUP_MONTE_CARLO_SIMS,
)
from data import (
    build_stat_df,
    add_games_left,
    add_games_in_week,
    blend_season_last30,
    get_team_schedule,
    get_team_schedule_game_labels,
    is_player_injured,
    filter_schedule_for_roster_player_injury,
    player_stashed_on_ir,
    flatten_stat_dict,
    get_espn_injury_data,
    add_games_left_with_injury,
    prefetch_team_schedules_for_rosters,
)


def _to_calendar_date(x):
    """Coerce ESPN / pandas / numpy / [y,m,d] shapes to datetime.date."""
    if x is None:
        return None
    if isinstance(x, datetime):
        return x.date()
    if isinstance(x, date):
        return x
    if isinstance(x, pd.Timestamp):
        try:
            return x.date()
        except Exception:
            return None
    if isinstance(x, (list, tuple)):
        if len(x) == 0:
            return None
        if len(x) >= 3:
            try:
                return date(int(x[0]), int(x[1]), int(x[2]))
            except (ValueError, TypeError):
                pass
        return _to_calendar_date(x[0])
    try:
        if isinstance(x, np.datetime64):
            return pd.Timestamp(x).date()
    except Exception:
        pass
    try:
        if hasattr(x, "date") and callable(x.date) and not isinstance(x, date):
            return x.date()
    except Exception:
        pass
    return None


def _unwrap_window_bound(val, which_end=False):
    """If UI passes [start, end] in one value, take first or last; else coerce to date."""
    if isinstance(val, (list, tuple)) and len(val) > 0:
        pick = val[-1] if which_end else val[0]
        return _to_calendar_date(pick)
    return _to_calendar_date(val)


def _coerce_schedule_bundle(raw_labels, start_d, end_d):
    """
    Return (set of dates in window, dict date -> opponent label).
    Defensive against stale cache or non-dict payloads from the schedule API path.
    """
    start_d = _to_calendar_date(start_d)
    end_d = _to_calendar_date(end_d)
    if start_d is None or end_d is None:
        return set(), {}
    if not isinstance(raw_labels, dict):
        raw_labels = {}
    labels_out = {}
    sched = set()
    for k, v in raw_labels.items():
        kd = _to_calendar_date(k)
        if kd is None:
            continue
        labels_out[kd] = v if isinstance(v, str) else (str(v) if v is not None else "")
        if start_d <= kd <= end_d:
            sched.add(kd)
    lbl_window = {d: labels_out[d] for d in sched}
    return sched, lbl_window


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


def _strict_weekly_matchup_win_prob(outcome_counts):
    """
    P(you win the matchup) matching the main matchup gauge: share of sims where
    your category wins > opponent's (ties excluded). outcome_counts maps (yw, ow) -> count.
    """
    total = sum(outcome_counts.values())
    if total <= 0:
        return None
    return sum(c for (yw, ow), c in outcome_counts.items() if yw > ow) / total


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
                      untouchables=None, has_open_roster_spot=False, manual_watchlist=None,
                      week_span=1, period_end_date=None, game_window_start=None, game_window_end=None):
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
    prefetch_team_schedules_for_rosters(healthy_players)
    player_status_map = {}
    for p in healthy_players:
        raw = getattr(p, "injuryStatus", None) or ""
        display = STATUS_DISPLAY.get(str(raw).upper().strip(), "") if raw else ""
        if display:
            player_status_map[p.name] = display
    fa_season = build_stat_df(healthy_players, f"{year}_total", "Season", "Waiver", year)
    fa_last30 = build_stat_df(healthy_players, f"{year}_last_30", "Last30", "Waiver", year)
    fa_season = add_games_left(
        fa_season, week_span, period_end_date, game_window_start, game_window_end,
    )
    fa_last30 = add_games_left(
        fa_last30, week_span, period_end_date, game_window_start, game_window_end,
    )
    merged = blend_season_last30(fa_season, fa_last30, blend_weight)
    rows = []
    for _, r in merged.iterrows():
        g = r.get("Games Left", 0)
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
            out[col] = r.get(col, 0)
        rows.append(out)
    waiver_df = pd.DataFrame(rows)
    waiver_df["_watchlist_sort"] = waiver_df["On Watchlist"].map({True: 0, False: 1})
    waiver_df = waiver_df.sort_values(["_watchlist_sort", "Games Left", "PTS"], ascending=[True, False, False])
    waiver_df = waiver_df.drop(columns=["_watchlist_sort"])
    streamers = waiver_df.head(num_streamers)
    if streamers.empty:
        return []
    streamer_sims = int(STREAMER_PICKUP_MONTE_CARLO_SIMS)
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
    merged = blend_season_last30(season_df, last30_df, blend_weight)
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
    Returns (winner_id, loser_id, is_tie). If is_tie, winner_id and loser_id are both set
    (caller should add 1 to ties for both teams).
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
        return (home_id, away_id, False)
    if away_wins > home_wins:
        return (away_id, home_id, False)
    return (home_id, away_id, True)


def _compute_playoff_matchup_win_prob(team_a, team_b, current_a, current_b,
                                       year, injury_data, blend_weight,
                                       period_end_date=None, sims=5000,
                                       game_window_start=None, game_window_end=None):
    """
    Compute win probability for a live playoff matchup by combining current accumulated
    scores with projected remaining stats, then running category-by-category Monte Carlo.
    Returns: probability that team_a wins the matchup (float 0-1).
    game_window_start/end: optional inclusive NBA dates for games left (e.g. full semi window).
    """
    variance_multiplier = _get_matchup_variance_multiplier()

    def _build_team_df(team_obj):
        roster = getattr(team_obj, "roster", [])
        if not roster:
            return pd.DataFrame()
        name = getattr(team_obj, "team_name", "Unknown")
        season_df = build_stat_df(roster, f"{year}_total", "Season", name, year)
        last30_df = build_stat_df(roster, f"{year}_last_30", "Last30", name, year)
        if season_df.empty:
            return pd.DataFrame()
        merged = blend_season_last30(season_df, last30_df, blend_weight)
        merged = add_games_left_with_injury(
            merged, roster, injury_data,
            period_end_date=period_end_date,
            window_start=game_window_start,
            window_end=game_window_end,
        )
        return merged

    df_a = _build_team_df(team_a)
    df_b = _build_team_df(team_b)

    sim_a = simulate_team(df_a, sims=sims, variance_multiplier=variance_multiplier)
    sim_b = simulate_team(df_b, sims=sims, variance_multiplier=variance_multiplier)

    sim_a = add_current_to_sim(current_a, sim_a)
    sim_b = add_current_to_sim(current_b, sim_b)

    matchup_results, _, _ = compare_matchups(sim_a, sim_b, CATEGORIES)
    total = sum(matchup_results.values())
    if total == 0:
        return 0.5
    return (matchup_results["you"] + 0.5 * matchup_results["tie"]) / total


def _playoff_team_ids_ordered(league_stats, playoff_teams=4):
    """Best standing first (ESPN standing: lower is better)."""
    return [t["team_id"] for t in sorted(league_stats, key=lambda x: x["standing"])[:playoff_teams]]


def current_matchup_period_effective(league, regular_season_weeks=19, playoff_weeks_per_round=2):
    """
    Resolve current matchup period from scoringPeriodId -> matchup_ids when available.
    This handles ESPN states where currentMatchupPeriod can lag the active scoring period.
    """
    cw = int(getattr(league, "currentMatchupPeriod", 0) or 0)
    sp = int(getattr(league, "scoringPeriodId", 0) or 0)
    rs = int(regular_season_weeks)
    plen = max(1, int(playoff_weeks_per_round))
    if sp > 0:
        if sp <= rs:
            return sp
        # Two-week playoff rounds represented by matchup-period *start* id:
        # rs+1..rs+plen -> rs+1, next block -> rs+1+plen, etc.
        round_idx = (sp - rs - 1) // plen
        return rs + 1 + round_idx * plen
    mids = getattr(league, "matchup_ids", {}) or {}
    if not isinstance(mids, dict):
        return cw
    try:
        sp_s = str(sp)
        for mp, scoring_ids in mids.items():
            vals = {str(x) for x in (scoring_ids or [])}
            if sp_s in vals:
                return int(mp)
    except Exception:
        return cw
    return cw


def _infer_semifinal_pairs_standard(seed_order_ids):
    """4-team bracket: 1 vs 4, 2 vs 3."""
    if len(seed_order_ids) < 4:
        return []
    s1, s2, s3, s4 = seed_order_ids[0], seed_order_ids[1], seed_order_ids[2], seed_order_ids[3]
    return [(s1, s4), (s2, s3)]


def _extract_pairs_from_playoff_boxscores(league, period, playoff_id_set):
    pairs = []
    try:
        for m in league.box_scores(matchup_period=period):
            h = m.home_team.team_id
            a = m.away_team.team_id
            if h in playoff_id_set and a in playoff_id_set:
                pairs.append((h, a))
    except Exception:
        return []
    # Deduplicate
    seen = set()
    out = []
    for p in pairs:
        key = tuple(sorted(p))
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def resolve_projected_finals_opponent_from_other_semi(
    league,
    team_id,
    year,
    league_stats,
    injury_data,
    blend_weight,
    playoff_teams=4,
    regular_season_weeks=19,
    semi_window_start=None,
    semi_window_end=None,
    sims=3000,
):
    """
    For a finals lookahead: pick the *other* semifinal (not yours), project who wins,
    and return that team as the projected finals opponent.

    Bracket: uses ESPN box scores for playoff weeks when available; otherwise 1v4 / 2v3
    by regular-season standing among the top ``playoff_teams``.
    """
    if injury_data is None:
        injury_data = get_espn_injury_data()

    ordered = _playoff_team_ids_ordered(league_stats, playoff_teams)
    playoff_set = set(ordered)
    if len(ordered) < 4 or team_id not in playoff_set:
        return None

    team_obj_map = {t.team_id: t for t in league.teams}
    pairs = []

    cw = current_matchup_period_effective(league)
    for period in sorted({regular_season_weeks + 1, regular_season_weeks + 2, cw}):
        got = _extract_pairs_from_playoff_boxscores(league, period, playoff_set)
        if len(got) >= 2:
            pairs = got[:2]
            break

    if len(pairs) < 2:
        pairs = _infer_semifinal_pairs_standard(ordered)

    if len(pairs) < 2:
        return None

    user_pair = None
    for p in pairs:
        if team_id in p:
            user_pair = tuple(sorted(p))
            break
    if user_pair is None:
        return None

    other = None
    for p in pairs:
        if tuple(sorted(p)) != user_pair:
            other = p
            break
    if other is None:
        return None

    h_id, a_id = other[0], other[1]
    home_obj = team_obj_map.get(h_id)
    away_obj = team_obj_map.get(a_id)
    if not home_obj or not away_obj:
        return None

    # Live totals for other semi if that matchup exists in box scores
    stat_keys = ["FGM", "FGA", "FTM", "FTA", "3PM", "3PA", "REB", "AST", "STL", "BLK", "TO", "PTS", "DD", "TW"]
    current_home = {k: 0 for k in stat_keys}
    current_away = {k: 0 for k in stat_keys}
    for period in sorted({regular_season_weeks + 1, regular_season_weeks + 2, cw}):
        found = False
        try:
            for m in league.box_scores(matchup_period=period):
                ids = {m.home_team.team_id, m.away_team.team_id}
                if ids == {h_id, a_id}:
                    hs = flatten_stat_dict(m.home_stats)
                    aws = flatten_stat_dict(m.away_stats)
                    current_home = {k: hs.get(k, 0) for k in stat_keys}
                    current_away = {k: aws.get(k, 0) for k in stat_keys}
                    found = True
                    break
        except Exception:
            continue
        if found:
            break

    gws, gwe = semi_window_start, semi_window_end
    home_prob = _compute_playoff_matchup_win_prob(
        home_obj, away_obj, current_home, current_away,
        year, injury_data, blend_weight,
        period_end_date=semi_window_end if isinstance(semi_window_end, date) else None,
        sims=min(sims, 4000),
        game_window_start=gws if isinstance(gws, date) else None,
        game_window_end=gwe if isinstance(gwe, date) else None,
    )

    if home_prob >= 0.5:
        fav_id, fav_obj = h_id, home_obj
        fav_prob = home_prob
        dog_name = away_obj.team_name
    else:
        fav_id, fav_obj = a_id, away_obj
        fav_prob = 1.0 - home_prob
        dog_name = home_obj.team_name

    home_name = home_obj.team_name
    away_name = away_obj.team_name
    note = (
        f"Other semi: **{home_name}** vs **{away_name}**. "
        f"Projected finals opponent **{fav_obj.team_name}** "
        f"({fav_prob * 100:.0f}% to win that semi vs {dog_name})."
    )

    return {
        "opp_team_id": fav_id,
        "opp_team_obj": fav_obj,
        "opp_team_name": fav_obj.team_name,
        "other_semi_home_id": h_id,
        "other_semi_away_id": a_id,
        "favorite_win_prob": fav_prob,
        "note": note,
    }


def calculate_league_stats(league, year):
    """Calculate league-wide statistics including all-play records."""
    teams = league.teams
    current_week = current_matchup_period_effective(league)
    all_play_records = {team.team_id: {"wins": 0, "losses": 0, "ties": 0} for team in teams}

    # Prefer ESPN's real matchup-period keys; avoids looping phantom periods when
    # currentMatchupPeriod/scoringPeriodId are out-of-band values.
    matchup_ids = getattr(league, "matchup_ids", {}) or {}
    period_keys = []
    try:
        period_keys = sorted(
            int(k) for k in matchup_ids.keys()
            if int(k) < current_week
        )
    except Exception:
        period_keys = []
    if not period_keys:
        num_completed_weeks = current_week - 1 if current_week > 1 else current_week
        period_keys = list(range(1, num_completed_weeks + 1))

    for week in period_keys:
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
            # Skip periods that clearly have no played stats yet.
            if not any(
                any(abs(float(s.get(k, 0) or 0)) > 0 for k in ["FGM", "FGA", "FTM", "FTA", "3PM", "3PA", "PTS"])
                for s in weekly_stats.values()
            ):
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
        ap_pct = (ap["wins"] + 0.5 * ap["ties"]) / ap_total if ap_total > 0 else 0
        actual_total = team.wins + team.losses + getattr(team, 'ties', 0)
        actual_pct = (team.wins + 0.5 * getattr(team, 'ties', 0)) / actual_total if actual_total > 0 else 0
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


def _regular_season_matchup_periods_from_league(league, fallback=19):
    """ESPN `reg_season_count` / matchupPeriodCount — last regular-season matchup period id."""
    s = getattr(league, "settings", None)
    if s is not None:
        n = getattr(s, "reg_season_count", None)
        if n is not None and int(n) > 0:
            return int(n)
    return int(fallback)


def _playoff_weeks_per_round_from_league(league, fallback=2):
    """ESPN `playoffMatchupPeriodLength` (weeks per playoff round); default 2 for most H2H leagues."""
    s = getattr(league, "settings", None)
    if s is not None:
        n = getattr(s, "playoff_matchup_period_length", None)
        if n is not None and int(n) > 0:
            return int(n)
    return int(fallback)


def playoff_matchup_round_one_based(current_matchup_period, reg_season_periods, weeks_per_playoff_round):
    """
    Playoff round number for display/logic: 1 = first playoff round (e.g. semis), 2 = finals (4-team bracket).
    Uses the league's regular-season length and playoff matchup length from ESPN settings.
    """
    if current_matchup_period <= reg_season_periods:
        return 0
    off = current_matchup_period - reg_season_periods
    w = max(1, int(weeks_per_playoff_round))
    return (off - 1) // w + 1


def _projected_stats_for_matchup_window(projected, team_id, week_a, week_b):
    """Combine one or two matchup periods; if both are the same (1-week playoff round), do not double-count."""
    pa = projected.get(team_id, {}).get(week_a, {})
    if week_a == week_b:
        return pa
    pb = projected.get(team_id, {}).get(week_b, {})
    return _combine_projected_stats(pa, pb)


def _raw_schedule_matchups_for_period(league, matchup_period):
    """Unparsed schedule rows for one ESPN matchup period (includes playoffMatchupType)."""
    try:
        req = getattr(league, "espn_request", None)
        if req is None:
            return []
        resp = req.league_get(params={"view": "mSchedule"})
        if isinstance(resp, list) and resp:
            data = resp[0]
        else:
            data = resp
        if not isinstance(data, dict):
            return []
        sched = data.get("schedule") or []
    except Exception:
        return []
    return [m for m in sched if m.get("matchupPeriodId") == matchup_period]


def _team_ids_from_raw_schedule_matchup(m):
    h = m.get("home") or {}
    a = m.get("away") or {}
    hid = h.get("teamId")
    aid = a.get("teamId")
    if hid is None and isinstance(h.get("team"), dict):
        hid = h["team"].get("teamId")
    if aid is None and isinstance(a.get("team"), dict):
        aid = a["team"].get("teamId")
    return hid, aid


def _playoff_matchup_type_label(m):
    parts = []
    for key in (
        "playoffMatchupType",
        "matchupType",
        "type",
        "bracketType",
        "playoffTierType",
    ):
        v = m.get(key)
        if v is not None:
            parts.append(str(v).upper())
    return " ".join(parts)


def _is_explicit_losers_or_consolation_playoff_matchup(m):
    """True if ESPN marks this as losers / consolation / 3rd-place path."""
    label = _playoff_matchup_type_label(m)
    if not label:
        return False
    return any(
        x in label
        for x in (
            "LOSER",
            "CONSOLATION",
            "THIRD",
            "3RD",
            "PLACEMENT",
            "TOILET",
        )
    )


def _is_explicit_winners_bracket_playoff_matchup(m):
    label = _playoff_matchup_type_label(m)
    return "WINNER" in label and "LOSER" not in label


def _winners_bracket_top4_pairs(league, matchup_period, playoff_team_set):
    """
    H2H among top-4 seeds that are not explicitly losers/consolation bracket.
    Mirrors ESPN 'Winner's bracket' column.
    """
    pairs = []
    for m in _raw_schedule_matchups_for_period(league, matchup_period):
        if _is_explicit_losers_or_consolation_playoff_matchup(m):
            continue
        hid, aid = _team_ids_from_raw_schedule_matchup(m)
        if not hid or not aid:
            continue
        if hid not in playoff_team_set or aid not in playoff_team_set:
            continue
        pairs.append((hid, aid))
    return pairs


def _winner_for_team_pair_scoreboard(league, matchup_period, home_id, away_id):
    """Resolve winner using league.scoreboard Matchup (category totals)."""
    try:
        matchups = league.scoreboard(matchupPeriod=matchup_period)
    except Exception:
        return None
    for m in matchups:
        hid = m.home_team.team_id if hasattr(m.home_team, "team_id") else m.home_team
        aid = m.away_team.team_id if hasattr(m.away_team, "team_id") else m.away_team
        if {hid, aid} != {home_id, away_id}:
            continue
        return _matchup_winner_team_id_h2h(m, hid, aid)
    return None


def _championship_finalists_from_winners_bracket_schedule(
    league, playoff_team_set, regular_season_weeks, playoff_weeks_per_round, current_matchup_period,
):
    """
    Championship = the single top-4 H2H on the winners bracket for this scoring window.
    Losers / consolation / 3rd-place games are excluded via schedule playoffMatchupType.
    If ESPN does not tag types, we require exactly one undifferentiated top-4 pairing.
    """
    rs = regular_season_weeks
    plen = max(1, int(playoff_weeks_per_round))
    finals_first = rs + plen + 1
    for period in range(finals_first, int(current_matchup_period) + 1):
        raw_list = _raw_schedule_matchups_for_period(league, period)
        candidates = []
        for m in raw_list:
            if _is_explicit_losers_or_consolation_playoff_matchup(m):
                continue
            hid, aid = _team_ids_from_raw_schedule_matchup(m)
            if not hid or not aid:
                continue
            if hid not in playoff_team_set or aid not in playoff_team_set:
                continue
            candidates.append((m, hid, aid))
        if not candidates:
            continue
        winners_tagged = [(m, h, a) for m, h, a in candidates if _is_explicit_winners_bracket_playoff_matchup(m)]
        use_rows = winners_tagged if winners_tagged else candidates
        pair_keys = {frozenset({h, a}) for _, h, a in use_rows}
        if len(pair_keys) == 1:
            return next(iter(pair_keys))
        if len(pair_keys) == 2:
            # No ESPN bracket tags: 3rd-place is the two semifinal losers; title = both winners
            sw = _finalist_ids_from_semifinal_winners(
                league, playoff_team_set, regular_season_weeks, playoff_weeks_per_round
            )
            if sw is not None and len(sw) == 2 and sw in pair_keys:
                return sw
    return None


def _matchup_winner_team_id_h2h(m, home_id, away_id):
    """Best-effort winner team_id from ESPN Matchup (category H2H)."""
    w = getattr(m, "winner", None)
    if isinstance(w, int) and w in (home_id, away_id):
        return w
    if isinstance(w, str):
        if w.isdigit():
            wid = int(w)
            if wid in (home_id, away_id):
                return wid
        u = w.upper()
        if u in ("HOME", "HOME_WIN"):
            return home_id
        if u in ("AWAY", "AWAY_WIN"):
            return away_id
    hw = getattr(m, "home_team_live_score", None)
    aw = getattr(m, "away_team_live_score", None)
    if hw is not None and aw is not None:
        if hw > aw:
            return home_id
        if aw > hw:
            return away_id

    def _cat_wins(cats):
        if not cats:
            return None
        n = 0
        for v in cats.values():
            if not isinstance(v, dict):
                continue
            r = str(v.get("result", "")).upper()
            if r == "WIN" or r == "W":
                n += 1
        return n

    hc = getattr(m, "home_team_cats", None) or {}
    ac = getattr(m, "away_team_cats", None) or {}
    nh, na = _cat_wins(hc), _cat_wins(ac)
    if nh is not None and na is not None and nh != na:
        return home_id if nh > na else away_id
    return None


def _finalist_ids_from_semifinal_winners(league, playoff_team_set, regular_season_weeks, playoff_weeks_per_round):
    """
    For a 4-team bracket, the two winners-bracket semifinal winners advance.
    Prefer mSchedule (winner's bracket only); fall back to scoreboard.
    """
    if len(playoff_team_set) < 4:
        return None
    rs = regular_season_weeks
    plen = max(1, int(playoff_weeks_per_round))
    semis_last = rs + plen
    for period in range(semis_last, rs, -1):
        pairs = _winners_bracket_top4_pairs(league, period, playoff_team_set)
        if len(pairs) == 2:
            winners = []
            for hid, aid in pairs:
                w = _winner_for_team_pair_scoreboard(league, period, hid, aid)
                if w is None:
                    winners = None
                    break
                winners.append(w)
            if winners and len(winners) == 2 and winners[0] != winners[1]:
                return frozenset(winners)
            continue
        try:
            matchups = league.scoreboard(matchupPeriod=period)
        except Exception:
            continue
        semis_games = []
        for m in matchups:
            hid = m.home_team.team_id if hasattr(m.home_team, "team_id") else m.home_team
            aid = m.away_team.team_id if hasattr(m.away_team, "team_id") else m.away_team
            if hid in playoff_team_set and aid in playoff_team_set:
                semis_games.append((m, hid, aid))
        if len(semis_games) != 2:
            continue
        winners = []
        for m, hid, aid in semis_games:
            wid = _matchup_winner_team_id_h2h(m, hid, aid)
            if wid is None:
                winners = None
                break
            winners.append(wid)
        if winners and len(winners) == 2 and winners[0] != winners[1]:
            return frozenset(winners)
    return None


def _resolve_championship_finalist_ids(
    league,
    bracket_pairs,
    league_stats,
    playoff_team_set,
    playoff_round_one_based,
    regular_season_weeks,
    playoff_weeks_per_round,
    current_matchup_period,
):
    """
    During finals (playoff round 2), return the two championship participants.
    1) ESPN mSchedule winners-bracket row for the championship period (excludes 3rd-place).
    2) Winners-bracket semifinal winners.
    3) Box-score / seed fallbacks.
    """
    if playoff_round_one_based < 2 or not playoff_team_set:
        return None
    from_wb = _championship_finalists_from_winners_bracket_schedule(
        league,
        playoff_team_set,
        regular_season_weeks,
        playoff_weeks_per_round,
        current_matchup_period,
    )
    if from_wb is not None and len(from_wb) == 2:
        return from_wb
    from_semis = _finalist_ids_from_semifinal_winners(
        league, playoff_team_set, regular_season_weeks, playoff_weeks_per_round
    )
    if from_semis is not None and len(from_semis) == 2:
        return from_semis

    standing_map = {t["team_id"]: t["standing"] for t in league_stats}
    if bracket_pairs:
        if len(bracket_pairs) == 1:
            return frozenset(bracket_pairs[0])
        def _pair_seed_sum(pair):
            return standing_map.get(pair[0], 999) + standing_map.get(pair[1], 999)
        best = min(bracket_pairs, key=_pair_seed_sum)
        return frozenset(best)
    playoff_rows = [t for t in league_stats if t["team_id"] in playoff_team_set]
    playoff_rows.sort(key=lambda x: x["standing"])
    if len(playoff_rows) >= 2:
        return frozenset({playoff_rows[0]["team_id"], playoff_rows[1]["team_id"]})
    return None


def simulate_playoff_probabilities(league, league_stats, year, sims=5000,
                                   playoff_teams=4, regular_season_weeks=19,
                                   record_override=None, blend_weight=0.7,
                                   injury_data=None,
                                   current_week_matchup_outcomes=None,
                                   period_end_date=None,
                                   precomputed_projected=None,
                                   return_projected=False):
    """
    Monte Carlo simulation for playoff and championship probabilities.
    Uses: current standings + current week matchup probabilities (if provided) + rest of season simulation.

    record_override: optional dict {team_id: (wins, losses, ties)} to override records
    blend_weight: weight for last30 vs season (default 0.7 = 70% last30)
    regular_season_weeks: fallback if league.settings.reg_season_count is missing; otherwise ESPN wins.
    injury_data: from get_espn_injury_data(); fetched if None
    current_week_matchup_outcomes: optional (user_team_id, opp_team_id, outcome_counts) where
        outcome_counts is {(user_cat_wins, opp_cat_wins): count} from compare_matchups.
        When provided, samples from this distribution for the current week instead of simulating.
    precomputed_projected: if set, skips rebuilding weekly projections (reuse from a prior run).
    return_projected: if True, return (results, projected) for follow-up sims.
    Iteration count is min(sims, PLAYOFF_MONTE_CARLO_CAP).

    Returns:
        list of dicts with playoff_prob, seed_probs, championship_prob per team_id,
        or (that list, projected dict) when return_projected is True.
        Each row includes championship_finalist_team_ids when applicable.
    """
    teams = league.teams
    current_week = current_matchup_period_effective(league)
    num_teams = len(teams)
    # Keep playoff round mapping aligned with this app's fixed ESPN-period model:
    # regular season = 1..19, round 1 = 20-21, round 2 (finals) = 22-23.
    playoff_weeks_per_round = 2

    if injury_data is None:
        injury_data = get_espn_injury_data()

    effective_sims = min(int(sims), int(PLAYOFF_MONTE_CARLO_CAP))

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
    current_week_matchups = schedule_by_week.get(current_week, [])
    future_weeks = [w for w in remaining_weeks if w != current_week]

    # Build outcome distribution for user's current week matchup (if provided)
    # outcome_list: [(user_w, user_l, user_t, prob), ...] - one entry per (yw, ow) outcome
    # When record_override is used, we use that instead (override encodes current week result)
    current_week_user_outcomes = None
    user_matchup_pair = None
    override_team_ids = set(record_override.keys()) if record_override else set()
    if current_week_matchup_outcomes and not override_team_ids:
        user_tid, opp_tid, outcome_counts = current_week_matchup_outcomes
        total = sum(outcome_counts.values())
        if total > 0:
            outcome_list = []
            for (yw, ow), count in outcome_counts.items():
                prob = count / total
                if yw > ow:
                    outcome_list.append((1, 0, 0, prob))
                elif yw < ow:
                    outcome_list.append((0, 1, 0, prob))
                else:
                    outcome_list.append((0, 0, 1, prob))
            current_week_user_outcomes = outcome_list
            user_matchup_pair = frozenset({user_tid, opp_tid})

    # Playoff rounds from ESPN settings (length per round + where RS ends)
    rs = regular_season_weeks
    plen = playoff_weeks_per_round
    semis_weeks = (rs + 1, rs + plen)
    finals_weeks = (rs + plen + 1, rs + 2 * plen)
    playoff_week_pairs = [semis_weeks, finals_weeks]
    all_weeks_for_proj = remaining_weeks + list(semis_weeks) + list(finals_weeks)

    # Build projected weekly stats for all teams (regular season + playoff weeks)
    if precomputed_projected is not None:
        projected = precomputed_projected
    else:
        projected = _build_projected_for_all_teams(
            league, year, injury_data, blend_weight, all_weeks_for_proj
        )

    # Tiebreaker: use all-play for standings tiebreak when records are equal
    strength_map = {t["team_id"]: max(0.01, t["all_play_pct"]) for t in league_stats}

    # Same day-of-week variance as weekly matchup (higher uncertainty early in week)
    matchup_variance = _get_matchup_variance_multiplier()

    # When we're already in the playoffs, extract win probabilities for the live matchup
    # and fetch the actual ESPN bracket so pairings match reality (not just standings order).
    current_playoff_round_idx = None
    current_playoff_pair_probs = None
    actual_playoff_bracket = None
    playoff_bracket_pairs = []
    championship_finalist_team_ids = None
    if current_week > regular_season_weeks:
        playoff_round_1based = playoff_matchup_round_one_based(
            current_week, regular_season_weeks, playoff_weeks_per_round
        )
        # 0-based for bracket sim: round 1 (semis) -> 0, round 2 (finals) -> 1
        current_playoff_round_idx = max(0, playoff_round_1based - 1)

        # Determine which teams are actually in the playoffs based on final regular season standings
        playoff_team_set = set()
        strength = {t["team_id"]: max(0.01, t["all_play_pct"]) for t in league_stats}
        def _standing_key(tid):
            r = team_id_to_record[tid]
            total = r[0] + r[1] + r[2]
            wp = (r[0] + 0.5 * r[2]) / total if total > 0 else 0
            return (wp, strength.get(tid, 0))
        all_by_standing = sorted(team_id_to_record.keys(), key=_standing_key, reverse=True)
        playoff_team_set = set(all_by_standing[:playoff_teams])

        # Fetch actual ESPN playoff matchups and compute live win probabilities for ALL of them.
        # This ensures every bracket matchup uses current scores + remaining projections,
        # not just the user's matchup.
        team_obj_map = {t.team_id: t for t in league.teams}
        try:
            playoff_boxscores = league.box_scores(matchup_period=current_week)
            bracket_pairs = []
            current_playoff_pair_probs = {}
            for m in playoff_boxscores:
                home_id = m.home_team.team_id if hasattr(m.home_team, "team_id") else None
                away_id = m.away_team.team_id if hasattr(m.away_team, "team_id") else None
                if (home_id is None or away_id is None
                        or home_id not in playoff_team_set or away_id not in playoff_team_set):
                    continue
                bracket_pairs.append((home_id, away_id))

                # For the user's matchup, use the pre-computed detailed outcome distribution
                if (current_week_matchup_outcomes and not override_team_ids
                        and set([home_id, away_id]) == set([current_week_matchup_outcomes[0],
                                                            current_week_matchup_outcomes[1]])):
                    user_tid, opp_tid, oc = current_week_matchup_outcomes
                    total_oc = sum(oc.values())
                    if total_oc > 0:
                        user_wins_oc = sum(cnt for (yw, ow), cnt in oc.items() if yw > ow)
                        user_ties_oc = sum(cnt for (yw, ow), cnt in oc.items() if yw == ow)
                        user_prob = (user_wins_oc + 0.5 * user_ties_oc) / total_oc
                        current_playoff_pair_probs[user_tid] = user_prob
                        current_playoff_pair_probs[opp_tid] = 1.0 - user_prob
                    continue

                # For other playoff matchups, compute win probability from current scores + projections
                home_totals = flatten_stat_dict(m.home_stats)
                away_totals = flatten_stat_dict(m.away_stats)
                current_home = {k: home_totals.get(k, 0) for k in
                                ["FGM","FGA","FTM","FTA","3PM","3PA","REB","AST","STL","BLK","TO","PTS","DD","TW"]}
                current_away = {k: away_totals.get(k, 0) for k in
                                ["FGM","FGA","FTM","FTA","3PM","3PA","REB","AST","STL","BLK","TO","PTS","DD","TW"]}
                home_obj = team_obj_map.get(home_id)
                away_obj = team_obj_map.get(away_id)
                if home_obj and away_obj:
                    home_prob = _compute_playoff_matchup_win_prob(
                        home_obj, away_obj, current_home, current_away,
                        year, injury_data, blend_weight,
                        period_end_date=period_end_date, sims=min(effective_sims, 2000)
                    )
                    current_playoff_pair_probs[home_id] = home_prob
                    current_playoff_pair_probs[away_id] = 1.0 - home_prob

            if bracket_pairs:
                actual_playoff_bracket = []
                for h, a in bracket_pairs:
                    actual_playoff_bracket.extend([h, a])
            if not current_playoff_pair_probs:
                current_playoff_pair_probs = None
            playoff_bracket_pairs = list(bracket_pairs)
        except Exception:
            pass

        championship_finalist_team_ids = _resolve_championship_finalist_ids(
            league,
            playoff_bracket_pairs,
            league_stats,
            playoff_team_set,
            playoff_round_1based,
            regular_season_weeks,
            playoff_weeks_per_round,
            current_week,
        )
        # Finals (2nd playoff round): the title matchup is the user's live H2H. Schedule inference can
        # mis-pick the finalists when ESPN runs championship + 3rd-place (or untagged consolation) in the same period.
        if (
            playoff_round_1based >= 2
            and current_week_matchup_outcomes is not None
        ):
            ut, ot, _ = current_week_matchup_outcomes
            ut_i, ot_i = int(ut), int(ot)
            if ut_i in playoff_team_set and ot_i in playoff_team_set:
                championship_finalist_team_ids = frozenset({ut_i, ot_i})

    team_ids = list(team_id_to_name.keys())
    playoff_count = {tid: 0 for tid in team_ids}
    seed_counts = {tid: {s: 0 for s in range(1, num_teams + 2)} for tid in team_ids}
    championship_count = {tid: 0.0 for tid in team_ids}
    advance_count = {tid: 0 for tid in team_ids}

    # Finals: winning this matchup is winning the title — use weekly win % (same as matchup tab), no bracket MC.
    finals_skip_bracket_championship = False
    p_user_championship = None
    user_champ_tid = opp_champ_tid = None
    if (
        current_week > regular_season_weeks
        and current_playoff_round_idx == 1
        and championship_finalist_team_ids is not None
        and len(championship_finalist_team_ids) == 2
        and current_week_matchup_outcomes is not None
        and not override_team_ids
    ):
        ut, ot, oc = current_week_matchup_outcomes
        cf = frozenset(int(x) for x in championship_finalist_team_ids)
        if cf == frozenset({int(ut), int(ot)}):
            p_user_championship = _strict_weekly_matchup_win_prob(oc)
            if p_user_championship is not None:
                user_champ_tid, opp_champ_tid = int(ut), int(ot)
                finals_skip_bracket_championship = True

    for _ in range(effective_sims):
        wins = {tid: team_id_to_record[tid][0] for tid in team_ids}
        losses = {tid: team_id_to_record[tid][1] for tid in team_ids}
        ties = {tid: team_id_to_record[tid][2] for tid in team_ids}

        # Current week: use matchup outcome distribution for user's matchup, or apply record_override, or simulate
        if current_week_matchups:
            for home_id, away_id in current_week_matchups:
                pair = frozenset({home_id, away_id})
                # When record_override is used: override already includes current week; add opponent's result
                if override_team_ids and (home_id in override_team_ids or away_id in override_team_ids):
                    overridden = home_id if home_id in override_team_ids else away_id
                    opponent = away_id if overridden == home_id else home_id
                    if record_override and overridden in record_override:
                        ov = record_override[overridden]
                        # orig from league_stats (before override) - use league_stats
                        orig_from_league = next(
                            ((t["actual_wins"], t["actual_losses"], t["actual_ties"])
                             for t in league_stats if t["team_id"] == overridden),
                            (0, 0, 0)
                        )
                        diff = (ov[0] - orig_from_league[0], ov[1] - orig_from_league[1], ov[2] - orig_from_league[2])
                        # Opponent gets complementary: if overridden won (+1,0,0), opp gets (0,1,0)
                        wins[opponent] += diff[1]
                        losses[opponent] += diff[0]
                        ties[opponent] += diff[2]
                    continue
                if user_matchup_pair is not None and pair == user_matchup_pair:
                    # Sample from outcome distribution (user is first in pair if user_tid < opp_tid, etc.)
                    probs = [o[3] for o in current_week_user_outcomes]
                    idx = np.random.choice(len(current_week_user_outcomes), p=probs)
                    uw, ul, ut = current_week_user_outcomes[idx][:3]
                    # Map user/opp based on (home_id, away_id) vs (user_tid, opp_tid)
                    user_tid, opp_tid = current_week_matchup_outcomes[0], current_week_matchup_outcomes[1]
                    if home_id == user_tid:
                        wins[home_id] += uw
                        losses[home_id] += ul
                        ties[home_id] += ut
                        wins[away_id] += ul
                        losses[away_id] += uw
                        ties[away_id] += ut
                    else:
                        wins[away_id] += uw
                        losses[away_id] += ul
                        ties[away_id] += ut
                        wins[home_id] += ul
                        losses[home_id] += uw
                        ties[home_id] += ut
                else:
                    proj_home = projected.get(home_id, {}).get(current_week, {})
                    proj_away = projected.get(away_id, {}).get(current_week, {})
                    winner_id, loser_id, is_tie = _simulate_matchup_winner(
                        home_id, away_id, proj_home, proj_away,
                        variance_multiplier=matchup_variance
                    )
                    if is_tie:
                        ties[home_id] += 1
                        ties[away_id] += 1
                    else:
                        wins[winner_id] += 1
                        losses[loser_id] += 1

        # Future weeks: simulate all matchups
        for week in future_weeks:
            for home_id, away_id in schedule_by_week.get(week, []):
                proj_home = projected.get(home_id, {}).get(week, {})
                proj_away = projected.get(away_id, {}).get(week, {})
                winner_id, loser_id, is_tie = _simulate_matchup_winner(
                    home_id, away_id, proj_home, proj_away,
                    variance_multiplier=matchup_variance
                )
                if is_tie:
                    ties[home_id] += 1
                    ties[away_id] += 1
                else:
                    wins[winner_id] += 1
                    losses[loser_id] += 1

        # Final standings: sort by win percentage = (W + 0.5*T) / total games, then all-play tiebreaker
        def sort_key(tid):
            w, l, t = wins[tid], losses[tid], ties[tid]
            total = w + l + t
            win_pct = (w + 0.5 * t) / total if total > 0 else 0
            return (win_pct, strength_map.get(tid, 0))
        sorted_ids = sorted(team_ids, key=sort_key, reverse=True)

        for rank, tid in enumerate(sorted_ids, 1):
            seed_counts[tid][min(rank, num_teams + 1)] += 1
            if rank <= playoff_teams:
                playoff_count[tid] += 1

        # Simulate playoff bracket: two-week matchups, injury-aware, category-by-category
        # When already in playoffs, use actual ESPN bracket pairings (1v4, 2v3 etc.)
        # and start from the current round so the correct week projections are used.
        if actual_playoff_bracket is not None:
            playoff_bracket = actual_playoff_bracket
            bracket_starting_round = current_playoff_round_idx if current_playoff_round_idx is not None else 0
        else:
            playoff_bracket = sorted_ids[:playoff_teams]
            bracket_starting_round = 0
        if finals_skip_bracket_championship:
            championship_count[user_champ_tid] += p_user_championship
            championship_count[opp_champ_tid] += 1.0 - p_user_championship
            advance_count[user_champ_tid] += 1
            advance_count[opp_champ_tid] += 1
        else:
            champ, round_advancers = _simulate_playoff_bracket_projected(
                playoff_bracket, projected, playoff_week_pairs,
                day_variance_multiplier=matchup_variance,
                current_round_idx=current_playoff_round_idx,
                current_pair_probs=current_playoff_pair_probs,
                starting_round=bracket_starting_round
            )
            if champ is not None:
                championship_count[champ] += 1.0
            if round_advancers:
                for tid in round_advancers[0]:
                    advance_count[tid] += 1

    total_sims = effective_sims
    in_playoffs = current_week > regular_season_weeks
    result = []
    for tid in team_ids:
        playoff_pct = playoff_count[tid] / total_sims * 100
        champ_pct = championship_count[tid] / total_sims * 100
        advance_pct = advance_count[tid] / total_sims * 100
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
            "advance_prob": advance_pct,
            "in_playoffs": in_playoffs,
            "seed_probs": seed_probs,
            "record": team_id_to_record[tid],
            "championship_finalist_team_ids": championship_finalist_team_ids,
        })
    if return_projected:
        return result, projected
    return result


def _simulate_playoff_bracket_projected(bracket, projected, playoff_week_pairs,
                                        day_variance_multiplier=1.0,
                                        current_round_idx=None, current_pair_probs=None,
                                        starting_round=0):
    """
    Simulate single-elimination bracket. Each round is a two-week matchup.
    playoff_week_pairs: [(semis_w1, semis_w2), (finals_w1, finals_w2)] e.g. [(20,21), (22,23)]
    day_variance_multiplier: from _get_matchup_variance_multiplier() - higher early in week.
    current_round_idx: 0-based index of the round currently in progress (0=semis, 1=finals).
    current_pair_probs: dict {team_id: prob_of_winning} for the live matchup in current_round_idx.
        When provided, the live matchup is sampled from these probabilities instead of being
        projected from stats, ensuring the current week's sim results feed into bracket odds.
    starting_round: 0 = start from semis (4 teams), 1 = start from finals (2 teams).
        When already in finals, pass starting_round=1 so it uses finals-week projections.
    """
    if not bracket:
        return None, []
    if len(playoff_week_pairs) < 2:
        playoff_week_pairs = [(20, 21), (22, 23)]
    semis_w1, semis_w2 = playoff_week_pairs[0]
    finals_w1, finals_w2 = playoff_week_pairs[1]
    bracket_variance = PLAYOFF_VARIANCE_MULTIPLIER * day_variance_multiplier
    current = list(bracket)
    round_idx = starting_round
    round_advancers = []
    while len(current) > 1:
        w1, w2 = (semis_w1, semis_w2) if round_idx == 0 else (finals_w1, finals_w2)
        next_round = []
        for i in range(0, len(current), 2):
            if i + 1 >= len(current):
                next_round.append(current[i])
                continue
            a, b = current[i], current[i + 1]
            # For the live matchup in the current round, use the provided win probability
            # instead of projecting from stats — this feeds the current week sim into bracket odds.
            if (current_round_idx is not None and round_idx == current_round_idx
                    and current_pair_probs is not None
                    and a in current_pair_probs and b in current_pair_probs):
                prob_a = current_pair_probs[a]
                advancing = a if np.random.random() < prob_a else b
            else:
                proj_a = _projected_stats_for_matchup_window(projected, a, w1, w2)
                proj_b = _projected_stats_for_matchup_window(projected, b, w1, w2)
                winner_id, loser_id, is_tie = _simulate_matchup_winner(
                    a, b, proj_a, proj_b,
                    variance_multiplier=bracket_variance
                )
                advancing = winner_id if not is_tie else (a if np.random.random() < 0.5 else b)
            next_round.append(advancing)
        round_advancers.append(set(next_round))
        current = next_round
        round_idx += 1
    return (current[0] if current else None), round_advancers


# =============================================================================
# MATCHUP OPTIMIZATION
# =============================================================================

def _compute_cat_results_from_totals(test_totals, opp_totals, opp_fgp, opp_ftp, opp_3pp, stats_to_sim):
    """Compute per-category simulation win counts from raw total arrays."""
    with np.errstate(divide='ignore', invalid='ignore'):
        your_fgp = np.where(
            test_totals[:, stats_to_sim.index("FGA")] > 0,
            test_totals[:, stats_to_sim.index("FGM")] / test_totals[:, stats_to_sim.index("FGA")], 0
        )
        your_ftp = np.where(
            test_totals[:, stats_to_sim.index("FTA")] > 0,
            test_totals[:, stats_to_sim.index("FTM")] / test_totals[:, stats_to_sim.index("FTA")], 0
        )
        your_3pp = np.where(
            test_totals[:, stats_to_sim.index("3PA")] > 0,
            test_totals[:, stats_to_sim.index("3PM")] / test_totals[:, stats_to_sim.index("3PA")], 0
        )
    cat_results = {}
    for cat in CATEGORIES:
        if cat == "FG%":
            y, o = your_fgp, opp_fgp
        elif cat == "FT%":
            y, o = your_ftp, opp_ftp
        elif cat == "3P%":
            y, o = your_3pp, opp_3pp
        else:
            cat_idx = stats_to_sim.index(cat) if cat in stats_to_sim else None
            if cat_idx is None:
                continue
            y = test_totals[:, cat_idx]
            o = opp_totals[:, cat_idx]
        if cat == "TO":
            yw, ow = y < o, y > o
        else:
            yw, ow = y > o, y < o
        cat_results[cat] = {
            "you": int(yw.sum()),
            "opponent": int(ow.sum()),
            "tie": int((~yw & ~ow).sum()),
        }
    return cat_results


def optimize_waiver_adds(
    league, your_team_df, opp_team_df, current_you, current_opp,
    baseline_results, blend_weight, year, max_adds,
    untouchables=None, has_open_roster_spot=False,
    week_span=1, period_end_date=None,
    game_window_start=None, game_window_end=None,
    num_candidates=40, sims=1500,
):
    """
    Greedy step-by-step waiver optimization to maximize win percentage.

    At each step the single best add/drop combo is found and applied.
    Returns a list of step dicts — one per add used — with win% at each stage.
    The team simulation is pre-decomposed into per-player contribution arrays so
    each (waiver, drop) evaluation is just vector addition/subtraction: O(sims×stats).
    """
    baseline_win_pct, baseline_cat_results, baseline_avg_cats = baseline_results
    if max_adds <= 0 or num_candidates <= 0:
        return []

    untouchables = untouchables or []
    untouchables_lower = {p.lower().strip() for p in untouchables}

    stats_to_sim = list(CATEGORY_VARIANCE.keys())
    variance_vals = np.array([CATEGORY_VARIANCE[s] for s in stats_to_sim])

    # ------------------------------------------------------------------
    # Build blended waiver pool
    # ------------------------------------------------------------------
    free_agents = league.free_agents(size=min(400, num_candidates * 6))
    healthy_fas = [p for p in free_agents if not is_player_injured(p)]
    if not healthy_fas:
        return []

    fa_season = build_stat_df(healthy_fas, f"{year}_total", "Season", "Waiver", year)
    fa_last30 = build_stat_df(healthy_fas, f"{year}_last_30", "Last30", "Waiver", year)
    fa_season = add_games_left(
        fa_season, week_span, period_end_date, game_window_start, game_window_end,
    )
    fa_last30 = add_games_left(
        fa_last30, week_span, period_end_date, game_window_start, game_window_end,
    )
    merged_fa = blend_season_last30(fa_season, fa_last30, blend_weight)

    waiver_rows = []
    for _, r in merged_fa.iterrows():
        g = r.get("Games Left", 0)
        if g <= 0:
            continue
        out = {"Player": r["Player"], "NBA_Team": r["NBA_Team"], "Games Left": g, "Team": "Waiver"}
        for col in NUMERIC_COLS:
            out[col] = r.get(col, 0)
        waiver_rows.append(out)

    if not waiver_rows:
        return []

    all_waivers_df = pd.DataFrame(waiver_rows).sort_values(
        ["Games Left", "PTS"], ascending=[False, False]
    )
    top_candidates = all_waivers_df.head(num_candidates)

    # ------------------------------------------------------------------
    # Pre-compute opponent totals (fixed for all steps)
    # ------------------------------------------------------------------
    opp_df_clean = opp_team_df.fillna(0)
    opp_means_arr = opp_df_clean[stats_to_sim].values
    opp_games_arr = opp_df_clean["Games Left"].values.astype(int)
    opp_totals = np.zeros((sims, len(stats_to_sim)))
    for p_idx in range(len(opp_df_clean)):
        n_games = opp_games_arr[p_idx]
        if n_games <= 0:
            continue
        pm = opp_means_arr[p_idx]
        ps = pm * variance_vals
        opp_totals += np.random.normal(loc=pm, scale=ps, size=(sims, n_games, len(stats_to_sim))).sum(axis=1)
    for i, stat in enumerate(stats_to_sim):
        opp_totals[:, i] += current_opp.get(stat, 0)

    with np.errstate(divide='ignore', invalid='ignore'):
        opp_fgp = np.where(opp_totals[:, stats_to_sim.index("FGA")] > 0,
                           opp_totals[:, stats_to_sim.index("FGM")] / opp_totals[:, stats_to_sim.index("FGA")], 0)
        opp_ftp = np.where(opp_totals[:, stats_to_sim.index("FTA")] > 0,
                           opp_totals[:, stats_to_sim.index("FTM")] / opp_totals[:, stats_to_sim.index("FTA")], 0)
        opp_3pp = np.where(opp_totals[:, stats_to_sim.index("3PA")] > 0,
                           opp_totals[:, stats_to_sim.index("3PM")] / opp_totals[:, stats_to_sim.index("3PA")], 0)

    # ------------------------------------------------------------------
    # Pre-compute waiver candidate contribution arrays (fixed for all steps)
    # ------------------------------------------------------------------
    waiver_contribs = {}
    waiver_meta = {}
    for _, row in top_candidates.iterrows():
        games = int(row["Games Left"])
        wm = np.array([row.get(s, 0) for s in stats_to_sim])
        ws = wm * variance_vals
        if games > 0:
            waiver_contribs[row["Player"]] = np.random.normal(
                loc=wm, scale=ws, size=(sims, games, len(stats_to_sim))
            ).sum(axis=1)
        else:
            waiver_contribs[row["Player"]] = np.zeros((sims, len(stats_to_sim)))
        waiver_meta[row["Player"]] = {
            "NBA_Team": row["NBA_Team"],
            "Games Left": games,
            "PTS": round(row.get("PTS", 0), 1),
            "REB": round(row.get("REB", 0), 1),
            "AST": round(row.get("AST", 0), 1),
            "3PM": round(row.get("3PM", 0), 1),
        }

    # ------------------------------------------------------------------
    # Mutable optimization state
    # ------------------------------------------------------------------
    current_team_df = your_team_df.copy()
    current_win_pct = baseline_win_pct
    current_avg_cats = baseline_avg_cats
    current_cat_results = baseline_cat_results
    has_open = has_open_roster_spot
    added_players: set = set()

    # Current-week accumulated stats offset (shape: (stats,) — broadcasts over sims axis)
    cur_you_offsets = np.array([current_you.get(s, 0) for s in stats_to_sim])

    steps = []

    for step_num in range(1, max_adds + 1):
        # Candidates not yet added this optimization run
        available = [n for n in top_candidates["Player"].tolist()
                     if n not in added_players and n in waiver_contribs]
        if not available:
            break

        # ------- Recompute per-player simulation arrays for current team -------
        team_clean = current_team_df.fillna(0)
        team_means = team_clean[stats_to_sim].values
        team_games = team_clean["Games Left"].values.astype(int)
        team_players_arr = team_clean["Player"].values

        # Players that can be dropped (not untouchable, not recently added)
        untouchables_step = untouchables_lower | {p.lower().strip() for p in added_players}
        droppable_names = set(
            team_clean.loc[
                ~team_clean["Player"].str.lower().str.strip().isin(untouchables_step),
                "Player",
            ].values
        )

        if not droppable_names and not has_open:
            break

        player_sims_dict: dict = {}
        for p_idx in range(len(team_clean)):
            n_games = team_games[p_idx]
            name = team_players_arr[p_idx]
            if n_games <= 0:
                player_sims_dict[name] = np.zeros((sims, len(stats_to_sim)))
            else:
                pm = team_means[p_idx]
                ps = pm * variance_vals
                player_sims_dict[name] = np.random.normal(
                    loc=pm, scale=ps, size=(sims, n_games, len(stats_to_sim))
                ).sum(axis=1)

        # Team base = sum of all future contributions + current-week accumulated stats
        team_base = np.zeros((sims, len(stats_to_sim)))
        for pcontrib in player_sims_dict.values():
            team_base += pcontrib
        team_base += cur_you_offsets  # broadcast: (sims, stats) + (stats,)

        # ------- Search over all (waiver, drop) combos -------
        best: dict | None = None
        best_score = float("-inf")

        for waiver_name in available:
            waiver_contrib = waiver_contribs[waiver_name]

            # Option A: use an open roster spot (no drop required)
            if has_open:
                test = team_base + waiver_contrib
                net_cats, exp_cats, wp, cat_impacts = _evaluate_matchup(
                    test, opp_totals, opp_fgp, opp_ftp, opp_3pp,
                    stats_to_sim, current_avg_cats, current_cat_results, sims,
                )
                if net_cats > best_score:
                    best_score = net_cats
                    best = {
                        "add": waiver_name, "drop": "(Open Spot)",
                        "win_pct": wp, "exp_cats": exp_cats,
                        "delta_cats": net_cats, "cat_impacts": cat_impacts,
                        "test_totals": test,
                    }

            # Option B: drop one of the droppable players
            for drop_name in droppable_names:
                drop_contrib = player_sims_dict.get(drop_name, np.zeros((sims, len(stats_to_sim))))
                test = team_base - drop_contrib + waiver_contrib
                net_cats, exp_cats, wp, cat_impacts = _evaluate_matchup(
                    test, opp_totals, opp_fgp, opp_ftp, opp_3pp,
                    stats_to_sim, current_avg_cats, current_cat_results, sims,
                )
                if net_cats > best_score:
                    best_score = net_cats
                    best = {
                        "add": waiver_name, "drop": drop_name,
                        "win_pct": wp, "exp_cats": exp_cats,
                        "delta_cats": net_cats, "cat_impacts": cat_impacts,
                        "test_totals": test,
                    }

        if best is None:
            break

        meta = waiver_meta.get(best["add"], {})
        steps.append({
            "step": step_num,
            "add": best["add"],
            "add_team": meta.get("NBA_Team", ""),
            "add_games": meta.get("Games Left", 0),
            "add_pts": meta.get("PTS", 0),
            "add_reb": meta.get("REB", 0),
            "add_ast": meta.get("AST", 0),
            "add_3pm": meta.get("3PM", 0),
            "drop": best["drop"],
            "win_pct": best["win_pct"],
            "delta_win_pct": best["win_pct"] - current_win_pct,
            "cumulative_delta": best["win_pct"] - baseline_win_pct,
            "exp_cats": best["exp_cats"],
            "cat_impacts": best["cat_impacts"],
        })

        # ------- Apply the change to team state -------
        team_name_val = your_team_df["Team"].iloc[0] if len(your_team_df) > 0 else "Your Team"
        if best["drop"] == "(Open Spot)":
            new_row_df = all_waivers_df[all_waivers_df["Player"] == best["add"]].head(1).copy()
            if not new_row_df.empty:
                new_row_df["Team"] = team_name_val
                current_team_df = pd.concat([current_team_df, new_row_df], ignore_index=True)
            has_open = False
        else:
            current_team_df = current_team_df[current_team_df["Player"] != best["drop"]].copy()
            new_row_df = all_waivers_df[all_waivers_df["Player"] == best["add"]].head(1).copy()
            if not new_row_df.empty:
                new_row_df["Team"] = team_name_val
                current_team_df = pd.concat([current_team_df, new_row_df], ignore_index=True)

        added_players.add(best["add"])
        current_win_pct = best["win_pct"]
        current_avg_cats = best["exp_cats"]

        # Update baseline cat_results so next step's cat_impacts are vs current best state
        current_cat_results = _compute_cat_results_from_totals(
            best["test_totals"], opp_totals, opp_fgp, opp_ftp, opp_3pp, stats_to_sim
        )

    return steps


def _games_in_window_from(sched_set, from_day, end_d):
    from_day = _to_calendar_date(from_day)
    end_d = _to_calendar_date(end_d)
    if from_day is None or end_d is None:
        return 0
    if not isinstance(sched_set, set):
        sched_set = {_to_calendar_date(x) for x in sched_set if _to_calendar_date(x)}
    return sum(1 for d in sched_set if d is not None and from_day <= d <= end_d)


def _segment_end_exclusive(seg_until, end_d):
    end_d = _to_calendar_date(end_d)
    if end_d is None:
        return None
    u = _to_calendar_date(seg_until) if seg_until is not None else None
    return u if u is not None else end_d + timedelta(days=1)


def _segment_covers_day(seg, day, end_d):
    day = _to_calendar_date(day)
    end_d = _to_calendar_date(end_d)
    if day is None or end_d is None:
        return False
    frm = _to_calendar_date(seg["from"])
    if frm is None:
        return False
    end_excl = _segment_end_exclusive(seg["until"], end_d)
    if end_excl is None:
        return False
    return frm <= day < end_excl


def _sched_has_game(seg, day):
    """True if segment's NBA team plays on this calendar day."""
    day = _to_calendar_date(day)
    if day is None:
        return False
    s = seg.get("sched")
    if isinstance(s, dict):
        for k in s:
            if _to_calendar_date(k) == day:
                return True
        return False
    if isinstance(s, set):
        return day in s
    for x in s or []:
        if _to_calendar_date(x) == day:
            return True
    return False


def _counted_starts_total(roster_entries, window_day_set, cap):
    """
    Fantasy starts that actually count: each day min(# of rostered NBA games, cap).
    Aligns with the per-day start cap (MAX_PLAYERS_PER_DAY); lineup selection in
    add_games_left_with_injury uses PTS to pick who counts when over the cap.
    """
    if not roster_entries or not window_day_set:
        return 0
    counts = defaultdict(int)
    for p in roster_entries:
        sched = p.get("sched") or ()
        if isinstance(sched, dict):
            for k in sched:
                kd = _to_calendar_date(k)
                if kd in window_day_set:
                    counts[kd] += 1
        else:
            for x in sched:
                kd = _to_calendar_date(x)
                if kd in window_day_set:
                    counts[kd] += 1
    return sum(min(counts.get(d, 0), cap) for d in sorted(window_day_set))


def _roster_entry_from_fa(fa):
    return {
        "name": fa["name"],
        "team": fa["team"],
        "sched": fa["sched"],
        "labels": fa.get("labels") or {},
    }


def _build_streaming_grid_df(segments, window_days, daily_start_cap=MAX_PLAYERS_PER_DAY):
    """Wide table: Player, Tm, one column per date, opponent labels; last row = games per day."""
    days = [_to_calendar_date(d) for d in (window_days or [])]
    days = [d for d in days if d is not None]
    if not days:
        return pd.DataFrame(), 0
    end_d = days[-1]
    date_headers = [d.strftime("%d-%b") for d in days]
    segs_sorted = sorted(
        segments,
        key=lambda s: (_to_calendar_date(s["from"]) or date.min, s["player"]),
    )
    rows = []
    for seg in segs_sorted:
        row = {
            "Player": seg.get("display_player") or seg["player"],
            "Tm": seg["team"],
        }
        for d, col in zip(days, date_headers):
            if _segment_covers_day(seg, d, end_d):
                lbl = seg.get("labels") or {}
                opp = None
                if isinstance(lbl, dict):
                    if d in lbl:
                        opp = lbl.get(d)
                    else:
                        for k, v in lbl.items():
                            if _to_calendar_date(k) == d:
                                opp = v
                                break
                row[col] = (opp if opp else "●") if _sched_has_game(seg, d) else ""
            else:
                row[col] = ""
        rows.append(row)
    total_row = {"Player": "Games / day", "Tm": ""}
    daily_totals = []
    for d, col in zip(days, date_headers):
        n = sum(
            1
            for seg in segs_sorted
            if _segment_covers_day(seg, d, end_d) and _sched_has_game(seg, d)
        )
        total_row[col] = n
        daily_totals.append(n)
    rows.append(total_row)
    cap_row = {"Player": f"Countable starts (≤{daily_start_cap}/day)", "Tm": ""}
    waste_row = {"Player": "Over cap (bench)", "Tm": ""}
    for col, n in zip(date_headers, daily_totals):
        cap_row[col] = min(n, daily_start_cap)
        waste_row[col] = max(0, n - daily_start_cap)
    rows.append(cap_row)
    rows.append(waste_row)
    df = pd.DataFrame(rows)
    total_raw = int(sum(daily_totals))
    total_counted = int(sum(min(n, daily_start_cap) for n in daily_totals))
    return df, total_raw, total_counted


def plan_waiver_adds_by_date(
    league,
    roster,
    year,
    max_adds,
    untouchables=None,
    has_open_roster_spot=False,
    game_window_start=None,
    game_window_end=None,
    blend_weight=0.7,
    max_starts_per_day=None,
    injury_data=None,
    trust_return_dates=True,
):
    """
    Greedy date-based streaming plan: each move maximizes **counted** roster starts in the
    matchup window, where each day only the first max_starts_per_day NBA games count (league
    cap). That spreads value across light days instead of stacking “wasted” games on heavy days.

    Roster schedules respect injuries: IR-stashed players contribute no games until activated;
    other non-active players only get games on/after expected return when trust_return_dates
    is True (same idea as Games Left / injury feed).

    Returns a dict:
      moves: list of step dicts (add_date, add, drop, metrics, action_text)
      grid: DataFrame (roster timeline × dates + daily totals / countable / over-cap rows)
      total_games: raw sum of player-games (uncapped per day)
      counted_starts: sum over days of min(games_that_day, max_starts_per_day)
      window_days: list of dates
    """
    cap = max_starts_per_day if max_starts_per_day is not None else MAX_PLAYERS_PER_DAY
    empty = {
        "moves": [],
        "grid": pd.DataFrame(),
        "total_games": 0,
        "counted_starts": 0,
        "window_days": [],
        "max_starts_per_day": cap,
    }
    if max_adds <= 0:
        return empty
    untouchables = untouchables or []
    untouchables_lower = {p.lower().strip() for p in untouchables}

    today = date.today()
    start_d = _unwrap_window_bound(game_window_start, which_end=False)
    if start_d is None:
        start_d = today
    end_d = _unwrap_window_bound(game_window_end, which_end=True)
    if end_d is None:
        end_d = start_d + timedelta(days=13)
    if end_d < start_d:
        return empty
    window_days = [start_d + timedelta(days=i) for i in range((end_d - start_d).days + 1)]

    free_agents = league.free_agents(size=400)
    healthy_fas = [p for p in free_agents if not is_player_injured(p)]
    if not healthy_fas:
        return empty
    fa_season = build_stat_df(healthy_fas, f"{year}_total", "Season", "Waiver", year)
    fa_last30 = build_stat_df(healthy_fas, f"{year}_last_30", "Last30", "Waiver", year)
    fa_blend = blend_season_last30(fa_season, fa_last30, blend_weight)
    fa_score_map = {}
    if not fa_blend.empty:
        for _, r in fa_blend.iterrows():
            fa_score_map[r["Player"]] = (
                float(r.get("PTS", 0))
                + 0.8 * float(r.get("REB", 0))
                + 1.0 * float(r.get("AST", 0))
                + 1.2 * float(r.get("STL", 0))
                + 1.2 * float(r.get("BLK", 0))
                + 0.8 * float(r.get("3PM", 0))
            )

    injury_data = injury_data or {}

    def window_slice_for_team(team_abbrev):
        raw = get_team_schedule_game_labels(team_abbrev)
        return _coerce_schedule_bundle(raw, start_d, end_d)

    segments = []
    roster_state = []
    for p in roster:
        team = getattr(p, "proTeam", None)
        if not team:
            continue
        sched, lbl = window_slice_for_team(team)
        sched, lbl = filter_schedule_for_roster_player_injury(
            p, sched, lbl, injury_data=injury_data, trust_return_dates=trust_return_dates
        )
        display_name = f"{p.name} (IR)" if player_stashed_on_ir(p) else p.name
        roster_state.append({
            "name": p.name,
            "team": team,
            "sched": sched,
            "labels": lbl,
        })
        segments.append({
            "player": p.name,
            "display_player": display_name,
            "team": team,
            "sched": sched,
            "labels": lbl,
            "from": start_d,
            "until": None,
        })

    fa_state = []
    seen_names = set()
    for p in healthy_fas:
        if p.name in seen_names:
            continue
        seen_names.add(p.name)
        team = getattr(p, "proTeam", None)
        if not team:
            continue
        sched, lbl = window_slice_for_team(team)
        if not sched:
            continue
        fa_state.append({
            "name": p.name,
            "team": team,
            "sched": sched,
            "labels": lbl,
            "score": float(fa_score_map.get(p.name, 0)),
        })

    def player_gap_days(player, from_day):
        from_day = _to_calendar_date(from_day)
        if from_day is None:
            return 99
        future = sorted(
            d for d in player["sched"] if _to_calendar_date(d) and _to_calendar_date(d) >= from_day
        )
        if not future:
            return 99
        return (future[0] - from_day).days

    steps = []
    open_spot = bool(has_open_roster_spot)
    window_day_set = set(window_days)

    for step_num in range(1, max_adds + 1):
        if not fa_state:
            break
        roster_names = {p["name"] for p in roster_state}
        best = None
        best_key = None
        base_counted = _counted_starts_total(roster_state, window_day_set, cap)

        for day in window_days:
            for fa in fa_state:
                if fa["name"] in roster_names:
                    continue
                fa_games = _games_in_window_from(fa["sched"], day, end_d)
                fa_entry = _roster_entry_from_fa(fa)
                if open_spot:
                    trial = roster_state + [fa_entry]
                    new_counted = _counted_starts_total(trial, window_day_set, cap)
                    delta_counted = new_counted - base_counted
                    net = fa_games
                    drop_name = "(Open Spot)"
                    drop_gap = 0
                    drop_plays = 0
                    key = (delta_counted, net, fa["score"], 999, 0)
                    if best_key is None or key > best_key:
                        best_key = key
                        best = (day, fa, drop_name, drop_gap, drop_plays, net, delta_counted)
                    continue
                droppable = [
                    p for p in roster_state
                    if p["name"].lower().strip() not in untouchables_lower
                ]
                for rp in droppable:
                    drop_games = _games_in_window_from(rp["sched"], day, end_d)
                    net = fa_games - drop_games
                    trial = [p for p in roster_state if p["name"] != rp["name"]] + [fa_entry]
                    new_counted = _counted_starts_total(trial, window_day_set, cap)
                    delta_counted = new_counted - base_counted
                    gap = player_gap_days(rp, day)
                    drop_plays = 1 if day in rp["sched"] else 0
                    key = (delta_counted, net, fa["score"], gap, -drop_plays)
                    if best_key is None or key > best_key:
                        best_key = key
                        best = (day, fa, rp["name"], gap, drop_plays, net, delta_counted)

        if best is None:
            break

        day, best_add, drop_name, drop_gap, drop_plays, net_games, delta_counted = best
        if delta_counted <= 0:
            break
        next_day = day + timedelta(days=1)

        if drop_name != "(Open Spot)":
            roster_state = [p for p in roster_state if p["name"] != drop_name]
            for seg in segments:
                if seg["player"] == drop_name and seg["until"] is None:
                    seg["until"] = day
                    break
        else:
            open_spot = False

        roster_state.append({
            "name": best_add["name"],
            "team": best_add["team"],
            "sched": best_add["sched"],
            "labels": best_add["labels"],
        })
        segments.append({
            "player": best_add["name"],
            "display_player": best_add["name"],
            "team": best_add["team"],
            "sched": best_add["sched"],
            "labels": best_add["labels"],
            "from": day,
            "until": None,
        })

        games_rest = sum(1 for d in best_add["sched"] if d >= day)
        date_s = day.strftime("%b %d")
        if drop_name == "(Open Spot)":
            action_text = f"Add {best_add['name']} on {date_s} (open roster spot)"
        else:
            action_text = f"Add {best_add['name']} on {date_s}, drop {drop_name}"

        steps.append({
            "step": step_num,
            "add_date": day,
            "add": best_add["name"],
            "add_team": best_add["team"],
            "plays_on_add_day": int(day in best_add["sched"]),
            "back_to_back": bool(day in best_add["sched"] and next_day in best_add["sched"]),
            "games_rest_window": games_rest,
            "drop": drop_name,
            "drop_gap_days": drop_gap if drop_name != "(Open Spot)" else 0,
            "net_games_in_window": net_games,
            "counted_starts_delta": int(delta_counted),
            "action_text": action_text,
        })

    grid_df, total_games, counted_starts = _build_streaming_grid_df(
        segments, window_days, daily_start_cap=cap
    )
    return {
        "moves": steps,
        "grid": grid_df,
        "total_games": total_games,
        "counted_starts": counted_starts,
        "window_days": window_days,
        "max_starts_per_day": cap,
    }
