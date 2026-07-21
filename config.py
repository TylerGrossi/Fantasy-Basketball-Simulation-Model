"""
Fantasy Basketball Simulator - Configuration and constants.
"""

# Secrets (ESPN auth cookies + Gemini API key) are NOT committed to git. Two ways to
# supply them:
#   - LOCAL dev: config_secrets.py (copy config_secrets.example.py -> config_secrets.py).
#   - DEPLOYMENT (Render, etc.): set environment variables ESPN_S2, ESPN_SWID,
#     GEMINI_API_KEY in the host's dashboard (no file needed).
try:
    from config_secrets import ESPN_S2, ESPN_SWID, GEMINI_API_KEY
except ImportError:
    import os
    ESPN_S2 = os.environ.get("ESPN_S2", "")
    ESPN_SWID = os.environ.get("ESPN_SWID", "")
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
    if not (ESPN_S2 and ESPN_SWID and GEMINI_API_KEY):
        raise RuntimeError(
            "Credentials not found. Local dev: copy config_secrets.example.py to "
            "config_secrets.py and fill it in. Deployment (Render/etc.): set the ESPN_S2, "
            "ESPN_SWID, and GEMINI_API_KEY environment variables."
        )

# =============================================================================
# ESPN connection - non-secret identifiers (the auth cookies are in config_secrets.py).
# The sidebar only asks which team to analyze.
# =============================================================================
ESPN_LEAGUE_ID = 267469544
ESPN_SEASON_YEAR = 2026

# =============================================================================
# Gemini (Google AI Studio) - powers the free-tier AI Assistant page. The API key lives in
# config_secrets.py; the model list below is not secret.
# =============================================================================
# Fallback chain: each Gemini model has its own free-tier daily/RPM quota. When one is
# exhausted (HTTP 429) the assistant rotates to the next, so a heavy day doesn't take the
# chatbot offline. Ordered quality-first, ending with the 500-req/day lite as a big safety
# net (~560 free requests/day total across the chain). All IDs verified against the key.
GEMINI_MODELS = [
    "gemini-3.6-flash",        # primary: newest/best flash (~20/day)
    "gemini-3.5-flash",        # (~20/day)
    "gemini-3-flash-preview",  # (~20/day)
    "gemini-2.5-flash",        # (~20/day)
    "gemini-3.5-flash-lite",   # workhorse fallback, newest lite (~500/day)
    "gemini-3.1-flash-lite",   # workhorse fallback (~500/day)
    "gemini-2.5-flash-lite",   # extra safety net (~20/day)
]  # ~1100 free requests/day total; each turn resets to the top (assistant.py), so a busy
   # model is retried next turn and per-minute load is spread across the whole chain.
GEMINI_MODEL = GEMINI_MODELS[0]  # kept for any single-model reference

# Team analyzed by default (pre-selected in the sidebar dropdown).
DEFAULT_TEAM_NAME = "VJ Maxx"
DEFAULT_TEAM_ID = 6

# Maximum players whose stats can count on any single day (league setting)
MAX_PLAYERS_PER_DAY = 10

# Roster limits: 13 active spots, 3 IR. When IR player returns healthy, a drop is required.
MAX_ROSTER_SIZE = 13
MAX_IR = 3

# Playoff matchups are two weeks each; increase variance so upsets can happen
PLAYOFF_VARIANCE_MULTIPLIER = 1.4

# Playoff / seed / championship Monte Carlo: marginal gain past ~8k sims, very slow in UI
PLAYOFF_MONTE_CARLO_CAP = 8000

# Streamer tab: "if this week W vs L" playoff deltas (reuses projected stats; lower sims is enough)
STREAMER_RECORD_PLAYOFF_SIMS = 2500

# Per-streamer pickup vs drop matchup Monte Carlo (each streamer × drop candidate)
STREAMER_PICKUP_MONTE_CARLO_SIMS = 1200

# Regular season: variance by day of week (more uncertainty early in week)
REGULAR_SEASON_VARIANCE_EARLY_WEEK = 1.45   # Monday/Tuesday
REGULAR_SEASON_VARIANCE_MID_WEEK = 1.25     # Wednesday–Friday
REGULAR_SEASON_VARIANCE_LATE_WEEK = 1.0     # Saturday/Sunday

# Category variance for Monte Carlo simulation (higher = more game-to-game variance)
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
