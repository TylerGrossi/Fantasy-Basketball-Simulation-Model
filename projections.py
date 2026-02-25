"""
Fantasy Basketball Simulator - Advanced player projections (pace, matchup, EMA, multivariate).
Logic adapted from Old Models/player_projections.py.
"""

import time
import numpy as np
import pandas as pd

# NBA API: longer timeout and delay to avoid rate limits / read timeouts (stats.nba.com is flaky).
# stats.nba.com often blocks cloud/datacenter IPs (e.g. Streamlit Cloud); these headers help when allowed.
NBA_API_TIMEOUT = 90
NBA_API_DELAY = 1.0
NBA_API_RETRIES = 3
NBA_API_RETRY_DELAY = 2.0
NBA_API_HEADERS = {
    "Host": "stats.nba.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://stats.nba.com/",
    "Connection": "keep-alive",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}

# Stat names we simulate (counting stats from game log). DD = double-doubles (derived from PTS/REB/AST).
# TW = team wins; not a player stat, so not simulated here.
STATS_TO_SIM_NBA = ["PTS", "REB", "AST", "STL", "BLK", "TOV", "FGM", "FGA", "FTM", "FTA", "FG3M", "FG3A"]
# Our internal names (TO = TOV, 3PM = FG3M, 3PA = FG3A)
STATS_TO_SIM_OUR = ["PTS", "REB", "AST", "STL", "BLK", "TO", "FGM", "FGA", "FTM", "FTA", "3PM", "3PA"]
NBA_TO_OUR = {"TOV": "TO", "FG3M": "3PM", "FG3A": "3PA"}
OUR_TO_NBA = {"TO": "TOV", "3PM": "FG3M", "3PA": "FG3A"}

EMA_SPAN = 15
COUNTING_STATS_PACE = ["PTS", "REB", "AST", "STL", "BLK", "TO", "FGM", "FGA", "3PM"]
SCORING_STATS_DEF = ["PTS", "FGM", "3PM", "FTM"]


def _season_str(year: int) -> str:
    """e.g. 2026 -> '2025-26'."""
    return f"{year - 1}-{str(year)[-2:]}"


def get_team_win_pcts(year: int, error_list: list | None = None):
    """
    Fetch each NBA team's win percentage for the season. Used to simulate TW (team wins):
    each game counts as that team's win probability (e.g. 0.75 for a 75% team).
    Returns dict {team_abbrev: win_pct}, e.g. {"OKC": 0.75, "BOS": 0.82}.
    If all retries fail, appends error to error_list if provided.
    """
    from nba_api.stats.static import teams
    from nba_api.stats.endpoints import leaguestandings

    season = _season_str(year)
    last_err = None
    for attempt in range(NBA_API_RETRIES):
        try:
            time.sleep(NBA_API_DELAY if attempt == 0 else NBA_API_RETRY_DELAY)
            stand = leaguestandings.LeagueStandings(
                league_id="00",
                season=season,
                season_type="Regular Season",
                timeout=NBA_API_TIMEOUT,
                headers=NBA_API_HEADERS,
            )
            df = stand.get_data_frames()[0]
            if df is None or df.empty:
                continue
            team_list = teams.get_teams()
            id_to_abbrev = {t["id"]: t["abbreviation"] for t in team_list}
            out = {}
            tid_col = "TEAM_ID" if "TEAM_ID" in df.columns else "TeamID"
            for _, row in df.iterrows():
                tid = row[tid_col]
                abbrev = id_to_abbrev.get(tid)
                if abbrev is None:
                    continue
                if "WinPCT" in row.index and pd.notna(row.get("WinPCT")):
                    out[abbrev] = float(row["WinPCT"])
                else:
                    w = int(row.get("WINS", row.get("W", 0)))
                    l = int(row.get("LOSSES", row.get("L", 0)))
                    total = w + l
                    out[abbrev] = (w / total) if total > 0 else 0.5
            return out
        except Exception as e:
            last_err = e
    if error_list is not None and last_err is not None:
        error_list.append(f"Team win pcts: {last_err!r}")
    return {}


def get_league_team_stats(year: int, error_list: list | None = None):
    """
    Fetch league and per-team pace / DEF_RATING. Returns dict with
    league_avg_pace, league_avg_def_rtg, and teams: {abbrev: {"pace", "def_rtg"}}.
    If all retries fail, appends error to error_list if provided.
    """
    from nba_api.stats.static import teams
    from nba_api.stats.endpoints import leaguedashteamstats

    season = _season_str(year)
    last_err = None
    for attempt in range(NBA_API_RETRIES):
        try:
            time.sleep(NBA_API_DELAY if attempt == 0 else NBA_API_RETRY_DELAY)
            advanced = leaguedashteamstats.LeagueDashTeamStats(
                measure_type_detailed_defense="Advanced",
                season=season,
                timeout=NBA_API_TIMEOUT,
                headers=NBA_API_HEADERS,
            )
            df = advanced.get_data_frames()[0]
            if df is None or df.empty or "PACE" not in df.columns or "DEF_RATING" not in df.columns:
                continue
            team_list = teams.get_teams()
            id_to_abbrev = {t["id"]: t["abbreviation"] for t in team_list}

            league_avg_pace = df["PACE"].mean()
            league_avg_def_rtg = df["DEF_RATING"].mean()
            teams_map = {}
            for _, row in df.iterrows():
                tid = row["TEAM_ID"]
                abbrev = id_to_abbrev.get(tid)
                if abbrev:
                    teams_map[abbrev] = {"pace": float(row["PACE"]), "def_rtg": float(row["DEF_RATING"])}
            return {
                "league_avg_pace": league_avg_pace,
                "league_avg_def_rtg": league_avg_def_rtg,
                "teams": teams_map,
            }
        except Exception as e:
            last_err = e
            continue
    if error_list is not None and last_err is not None:
        error_list.append(f"League stats: {last_err!r}")
    return None


def get_player_id_by_name(name: str):
    """Resolve player name to NBA API player ID. Returns None if not found."""
    try:
        from nba_api.stats.static import players
        name_clean = (name or "").strip()
        if not name_clean:
            return None
        all_players = players.get_players()
        for p in all_players:
            if p["full_name"].lower() == name_clean.lower():
                return p["id"]
        for p in all_players:
            if name_clean.lower() in p["full_name"].lower():
                return p["id"]
        return None
    except Exception:
        return None


def get_player_game_log(player_id: int, year: int):
    """
    Fetch player game log for the season. Returns DataFrame with columns
    aligned to our stat names (PTS, REB, ..., TO, FGM, FGA, 3PM, 3PA, etc.).
    """
    from nba_api.stats.endpoints import playergamelog

    season = _season_str(year)
    for attempt in range(max(1, NBA_API_RETRIES - 1)):
        try:
            time.sleep(NBA_API_DELAY if attempt == 0 else NBA_API_RETRY_DELAY)
            log = playergamelog.PlayerGameLog(
                player_id=player_id,
                season=season,
                timeout=NBA_API_TIMEOUT,
                headers=NBA_API_HEADERS,
            )
            df = log.get_data_frames()[0]
            if df is None or df.empty:
                return pd.DataFrame()
            rename = {"TOV": "TO", "FG3M": "3PM", "FG3A": "3PA"}
            df = df.rename(columns=rename)
            cols = [c for c in STATS_TO_SIM_OUR if c in df.columns]
            if len(cols) < 10:
                return pd.DataFrame()
            df = df[cols].copy()
            for c in cols:
                df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
            return df
        except Exception:
            continue
    return pd.DataFrame()


def compute_ema_and_cov(game_log: pd.DataFrame, span: int = EMA_SPAN):
    """
    Chronological EMA (most recent at end) and covariance matrix.
    game_log should have columns STATS_TO_SIM_OUR. Returns (mean_series, cov_matrix as ndarray).
    """
    if game_log is None or game_log.empty or len(game_log) < 3:
        return None, None
    cols = [c for c in STATS_TO_SIM_OUR if c in game_log.columns]
    if len(cols) < 10:
        return None, None
    # Chronological order (oldest first) for EMA
    log = game_log[cols].iloc[::-1].reset_index(drop=True)
    ema = log.ewm(span=span, adjust=False).mean().iloc[-1]
    cov = log.cov()
    cov = cov.reindex(index=cols, columns=cols).fillna(0)
    # Ensure PSD and no NaN/Inf
    cov_arr = np.array(cov, dtype=float)
    cov_arr = np.nan_to_num(cov_arr, nan=0.0, posinf=0.0, neginf=0.0)
    eigenvalues = np.linalg.eigvalsh(cov_arr)
    if np.any(eigenvalues < 1e-6):
        cov_arr = cov_arr + (1e-5 - np.min(eigenvalues)) * np.eye(len(cols))
    return ema[cols], cov_arr


def apply_pace_def_adjustment(base_series: pd.Series, pace_factor: float, def_factor: float):
    """
    Apply pace and defensive rating multipliers (same logic as Old Models/player_projections.py).
    Pace affects counting stats; def affects scoring stats.
    """
    out = base_series.copy()
    for stat in COUNTING_STATS_PACE:
        if stat in out.index:
            out[stat] = out[stat] * pace_factor
    for stat in SCORING_STATS_DEF:
        if stat in out.index:
            out[stat] = out[stat] * def_factor
    return out


def get_pace_def_factors_for_opponent(opponent_abbrev: str, league_stats: dict):
    """Return (pace_factor, def_factor) for a given opponent. Uses 1.0 if missing."""
    if not league_stats or not opponent_abbrev:
        return 1.0, 1.0
    teams = league_stats.get("teams") or {}
    opp = teams.get(opponent_abbrev.upper())
    if not opp:
        return 1.0, 1.0
    lap = league_stats["league_avg_pace"]
    lad = league_stats["league_avg_def_rtg"]
    pace_factor = opp["pace"] / lap if lap and lap > 0 else 1.0
    def_factor = opp["def_rtg"] / lad if lad and lad > 0 else 1.0
    return pace_factor, def_factor


def simulate_player_games_multivariate(
    mean_vec: np.ndarray,
    cov_matrix: np.ndarray,
    n_games: int,
    sims: int,
    stat_order: list,
) -> np.ndarray:
    """
    Simulate n_games per sim using multivariate normal. Returns array shape (sims, n_games, n_stats)
    (per-game stats, non-negative and rounded).
    """
    if n_games <= 0:
        return np.zeros((sims, 0, len(stat_order)))
    n_stats = len(stat_order)
    try:
        draws = np.random.multivariate_normal(mean_vec, cov_matrix, size=(sims * n_games))
    except Exception:
        scale = np.sqrt(np.diag(cov_matrix).clip(1e-6))
        draws = np.random.normal(mean_vec, scale, size=(sims * n_games, n_stats))
    draws = np.clip(np.round(draws), 0, None)
    return draws.reshape(sims, n_games, n_stats)


def project_player_with_nba_api(
    player_name: str,
    nba_team_abbrev: str,
    games_left: int,
    year: int,
    league_stats: dict,
    sims: int,
) -> dict | None:
    """
    Use NBA API game log + pace/def (when available) to produce simulated rest-of-week totals.
    Returns dict of stat -> list of length sims (same keys as simulate_team output), or None to fall back.
    DD = double-doubles (derived from per-game PTS/REB/AST). TW = team wins (not a player stat; set to 0).
    """
    if games_left <= 0:
        return None
    player_id = get_player_id_by_name(player_name)
    if player_id is None:
        return None
    game_log = get_player_game_log(player_id, year)
    mean_series, cov_matrix = compute_ema_and_cov(game_log)
    if mean_series is None or cov_matrix is None:
        return None
    pace_factor = 1.0
    def_factor = 1.0
    if league_stats:
        pass  # Could pass list of opponent abbrevs per game for matchup adjustment
    adjusted = apply_pace_def_adjustment(mean_series, pace_factor, def_factor)
    stat_order = [c for c in STATS_TO_SIM_OUR if c in adjusted.index]
    mean_vec = adjusted[stat_order].values.astype(float)
    cov_sub = cov_matrix[: len(stat_order), : len(stat_order)]
    if cov_sub.shape[0] != len(stat_order):
        cov_sub = np.diag(np.maximum(mean_vec * 0.3, 1e-6))

    per_game = simulate_player_games_multivariate(
        mean_vec, cov_sub, games_left, sims, stat_order
    )
    totals = per_game.sum(axis=1)
    out = {}
    for i, stat in enumerate(stat_order):
        out[stat] = totals[:, i].tolist()

    # DD = double-doubles from per-game PTS, REB, AST (two of three >= 10).
    # TW = team wins; not a player-level stat, so we do not simulate it here (0).
    if "PTS" in stat_order and "REB" in stat_order and "AST" in stat_order:
        i_pts = stat_order.index("PTS")
        i_reb = stat_order.index("REB")
        i_ast = stat_order.index("AST")
        pts_g = per_game[:, :, i_pts]
        reb_g = per_game[:, :, i_reb]
        ast_g = per_game[:, :, i_ast]
        dd_per_game = ((pts_g >= 10).astype(int) + (reb_g >= 10).astype(int) + (ast_g >= 10).astype(int)) >= 2
        out["DD"] = dd_per_game.sum(axis=1).tolist()
    else:
        out["DD"] = [0.0] * sims
    out["TW"] = [0.0] * sims  # TW = team wins; not simulated at player level

    # Percentages from totals
    fgm = totals[:, stat_order.index("FGM")] if "FGM" in stat_order else 0
    fga = totals[:, stat_order.index("FGA")] if "FGA" in stat_order else 1
    ftm = totals[:, stat_order.index("FTM")] if "FTM" in stat_order else 0
    fta = totals[:, stat_order.index("FTA")] if "FTA" in stat_order else 1
    tpm = totals[:, stat_order.index("3PM")] if "3PM" in stat_order else 0
    tpa = totals[:, stat_order.index("3PA")] if "3PA" in stat_order else 1
    with np.errstate(divide="ignore", invalid="ignore"):
        out["FG%"] = np.where(fga > 0, fgm / fga, 0).tolist()
        out["FT%"] = np.where(fta > 0, ftm / fta, 0).tolist()
        out["3P%"] = np.where(tpa > 0, tpm / tpa, 0).tolist()
    return out
