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

# Pasting long values into a hosting dashboard (Render, etc.) often appends a stray newline
# or surrounding whitespace. ESPN sends these as HTTP cookie header values, which cannot
# contain newlines ("Invalid header value"), so strip every credential defensively.
ESPN_S2 = ESPN_S2.strip()
ESPN_SWID = ESPN_SWID.strip()
GEMINI_API_KEY = GEMINI_API_KEY.strip()

# =============================================================================
# ESPN connection - non-secret identifiers (the auth cookies are in config_secrets.py).
# The sidebar only asks which team to analyze.
# =============================================================================
# 2026-27: "Connell 2026-2027 Fantasy" (8 teams), switched over 2026-10-19 after the draft.
ESPN_LEAGUE_ID = 1330923505
ESPN_SEASON_YEAR = 2027

# The previous league ("RIP THIBS", 2025-26, team VJ Maxx). Its season is now HISTORY:
# it lives in public/data/career.json (scripts/build_history.py finds every league by SWID)
# and its last full export is archived at public/data/archive/league-2026.json.
PREVIOUS_LEAGUE_ID = 267469544
PREVIOUS_SEASON_YEAR = 2026

# The draft league — the same league as above since the 2026-27 switch. Kept as its own
# setting because the Draft Guide/Recap (scripts/build_draft.py, app/api/draft) read it.
DRAFT_LEAGUE_ID = ESPN_LEAGUE_ID
DRAFT_SEASON_YEAR = ESPN_SEASON_YEAR

# =============================================================================
# 2026-27 calendar, read off ESPN (2026-10-19): scoring day n = opening night + (n-1),
# verified against all 174 days of the NBA schedule ESPN publishes. Matchups run Mon-Sun
# (week 1 starts on opening night, a Tuesday). The All-Star break (Feb 19-24) makes week
# 18 a two-week matchup. Playoff rounds are two weeks each (matchups 20 and 21; the app
# calls them periods 20-21 and 22-23). The fantasy season ends on scoring day 167.
# =============================================================================
from datetime import date as _date, timedelta as _td

SEASON_OPENING_DATE = _date(2026, 10, 20)
SEASON_END_DATE = _date(2027, 4, 4)            # last playoff scoring day (day 167)
ALL_STAR_DOUBLE_WEEK = 18                      # the regular-season matchup that spans 2 weeks
PLAYOFF_SCORING_DATES = (
    (_date(2027, 3, 8), _date(2027, 3, 21)),   # playoff round 1 (two-week scoring)
    (_date(2027, 3, 22), _date(2027, 4, 4)),   # playoff round 2
)


def regular_week_dates(week):
    """(start, end) of regular-season matchup `week` (1-19) in the 2026-27 calendar."""
    first_monday = _date(2026, 10, 26)
    if week <= 1:
        return SEASON_OPENING_DATE, first_monday - _td(days=1)
    start = first_monday + _td(days=7 * (week - 2))
    if week > ALL_STAR_DOUBLE_WEEK:
        start += _td(days=7)
    end = start + _td(days=13 if week == ALL_STAR_DOUBLE_WEEK else 6)
    return start, end

# =============================================================================
# Gemini (Google AI Studio) - powers the free-tier AI Assistant page. The API key lives in
# config_secrets.py; the model list below is not secret.
# =============================================================================
# Fallback chain: each Gemini model has its own free-tier daily/RPM quota. When one is
# exhausted (HTTP 429) the assistant rotates to the next, so a heavy day doesn't take the
# chatbot offline. Ordered quality-first, ending with the 500-req/day lite as a big safety
# net (~560 free requests/day total across the chain). All IDs verified against the key.
GEMINI_MODELS = [
    # Every flagship is 20 requests/DAY and 5/minute on the free tier — the whole chain
    # is worth ~1080 requests a day, and the top of it is worth 80. Heavy days land on
    # the lites, which is why their order matters as much as the flagships'.
    "gemini-3.6-flash",        # primary: newest/best flash (20 RPD, 5 RPM)
    "gemini-3.5-flash",        # (20 RPD, 5 RPM)
    "gemini-2.5-flash",        # (20 RPD, 5 RPM)
    # Ordered by "cost when it answers", not by version — and kept IDENTICAL to
    # DEFAULT_MODELS in lib/gemini.ts, since make_env.py copies this list into the web
    # app's .env.local. A 429 from an exhausted model costs ~0.15s to discover; a slow
    # model costs its full latency on EVERY round-trip of the turn, so the slow one goes
    # last. `gemini-3-flash-preview` was third and measured ~13s per call, which is what
    # made a turn take half a minute once the flagship quota was spent.
    # Caps below are READ OFF the AI Studio rate-limit dashboard, not guessed. The lites
    # are NOT interchangeable: 2.5-flash-lite is a 20/day model like the flagships, so it
    # sits after the two genuine 500/day workhorses rather than beside them.
    "gemini-3.5-flash-lite",   # workhorse: 500 RPD, 15 RPM
    "gemini-3.1-flash-lite",   # workhorse: 500 RPD, 15 RPM
    "gemini-2.5-flash-lite",   # only 20 RPD, 10 RPM — a safety net, not a workhorse
    "gemini-3-flash-preview",  # last resort: 20 RPD and ~13s/call, the slowest measured
]  # ~1100 free requests/day total; each turn resets to the top (assistant.py), so a busy
   # model is retried next turn and per-minute load is spread across the whole chain.
GEMINI_MODEL = GEMINI_MODELS[0]  # kept for any single-model reference

# Team analyzed by default (pre-selected in the sidebar dropdown).
DEFAULT_TEAM_NAME = "Team Grossi"   # 2026-27 league (was "VJ Maxx", id 6, in 2025-26)
DEFAULT_TEAM_ID = 8

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

# The win-probability model's uncertainty constants. All three are MEASURED from the
# 2025-26 box scores by scripts/measure_variance.mjs (2026-10-21) — rerun it on a newer
# archive and paste its output here rather than hand-tuning. They replaced hand-picked
# factors that had FTM/FTA at 0.2 (measured ~0.67) and FGM/FGA/PTS at 0.7 (~0.35).

# Per-game noise, as a coefficient of variation: a player's week total over g games has
# variance g * (avg * cv)^2.
CATEGORY_VARIANCE = {
    "FGM": 0.40, "FGA": 0.31,
    "FTM": 0.69, "FTA": 0.65,
    "3PM": 0.70, "3PA": 0.45,
    "REB": 0.43, "AST": 0.51,
    "STL": 0.90, "BLK": 1.03,
    "TO": 0.65, "PTS": 0.38,
    "DD": 1.27, "TW": 0.78
}

# How wrong the projected AVERAGE itself is, as a CV. A wrong average is wrong in every
# game, so it adds (g * avg * err)^2 — growing with games^2, not games. The web model
# (build_data.py player_moments, lib/league.ts playerMoments) uses it; the Python Monte
# Carlo in simulation.py does not.
PROJECTION_ERROR = {
    "FGM": 0.10, "FGA": 0.07,
    "FTM": 0.13, "FTA": 0.13,
    "3PM": 0.16, "3PA": 0.08,
    "REB": 0.09, "AST": 0.12,
    "STL": 0.17, "BLK": 0.21,
    "TO": 0.14, "PTS": 0.09,
    "DD": 0.26, "TW": 0.18
}

CATEGORIES = ["FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%",
              "REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW"]

# Correlation of the per-category margins (your total minus your opponent's), rows and
# columns in CATEGORIES order. The categories are NOT independent: FGM, FGA, PTS, 3PM and
# 3PA move together, and counting them as five separate coin flips made one hot quarter
# swing the live win probability 20+ points. lib/probability.ts draws them jointly.
CATEGORY_CORRELATION = [
    [ 1.00, 0.78, 0.63,-0.02, 0.25, 0.28, 0.08, 0.21, 0.11, 0.11, 0.06, 0.10, 0.07, 0.94, 0.07],  # FGM
    [ 0.78, 1.00, 0.02,-0.00, 0.19, 0.39,-0.05, 0.30, 0.14, 0.10, 0.06, 0.10, 0.10, 0.75,-0.04],  # FGA
    [ 0.63, 0.02, 1.00,-0.04, 0.16,-0.03, 0.19,-0.03, 0.00, 0.05, 0.01, 0.04,-0.01, 0.57, 0.17],  # FG%
    [-0.02,-0.00,-0.04, 1.00,-0.00, 0.02,-0.02,-0.00, 0.01,-0.07, 0.02, 0.02, 0.00, 0.04,-0.01],  # FT%
    [ 0.25, 0.19, 0.16,-0.00, 1.00, 0.42, 0.78, 0.03, 0.03,-0.00, 0.02, 0.04, 0.02, 0.29, 0.04],  # 3PM
    [ 0.28, 0.39,-0.03, 0.02, 0.42, 1.00,-0.20, 0.07, 0.06, 0.03, 0.03, 0.03, 0.02, 0.32, 0.01],  # 3PA
    [ 0.08,-0.05, 0.19,-0.02, 0.78,-0.20, 1.00,-0.02,-0.00,-0.02, 0.00, 0.03, 0.01, 0.11, 0.03],  # 3P%
    [ 0.21, 0.30,-0.03,-0.00, 0.03, 0.07,-0.02, 1.00, 0.18, 0.04, 0.09, 0.15, 0.18, 0.23, 0.03],  # REB
    [ 0.11, 0.14, 0.00, 0.01, 0.03, 0.06,-0.00, 0.18, 1.00, 0.02, 0.01, 0.10, 0.07, 0.13, 0.06],  # AST
    [ 0.11, 0.10, 0.05,-0.07,-0.00, 0.03,-0.02, 0.04, 0.02, 1.00, 0.02, 0.09, 0.03, 0.10, 0.02],  # STL
    [ 0.06, 0.06, 0.01, 0.02, 0.02, 0.03, 0.00, 0.09, 0.01, 0.02, 1.00, 0.02, 0.02, 0.07, 0.05],  # BLK
    [ 0.10, 0.10, 0.04, 0.02, 0.04, 0.03, 0.03, 0.15, 0.10, 0.09, 0.02, 1.00, 0.02, 0.13,-0.03],  # TO
    [ 0.07, 0.10,-0.01, 0.00, 0.02, 0.02, 0.01, 0.18, 0.07, 0.03, 0.02, 0.02, 1.00, 0.06, 0.06],  # DD
    [ 0.94, 0.75, 0.57, 0.04, 0.29, 0.32, 0.11, 0.23, 0.13, 0.10, 0.07, 0.13, 0.06, 1.00, 0.06],  # PTS
    [ 0.07,-0.04, 0.17,-0.01, 0.04, 0.01, 0.03, 0.03, 0.06, 0.02, 0.05,-0.03, 0.06, 0.06, 1.00],  # TW
]

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
    # LAL is "lal", NOT "la" - the short form 400s, which silently emptied every Lakers
    # player's opponent list (_team_schedule_labels swallows a non-200 and returns {}).
    # Every slug in this map was verified against the schedule endpoint; the other odd
    # ones ("gs", "no", "ny", "sa", "pho", "wsh", "utah") are all genuinely correct.
    "HOU": "hou", "IND": "ind", "LAC": "lac", "LAL": "lal", "MEM": "mem",
    "MIA": "mia", "MIL": "mil", "MIN": "min", "NOP": "no", "NYK": "ny",
    "OKC": "okc", "ORL": "orl", "PHI": "phi", "PHX": "pho", "POR": "por",
    "SAC": "sac", "SAS": "sa", "TOR": "tor", "UTA": "utah", "WAS": "wsh"
}

TEAM_FIXES = {"PHL": "PHI", "PHO": "PHX", "GS": "GSW", "WSH": "WAS",
              "NO": "NOP", "SA": "SAS", "NY": "NYK",
              # ESPN's site-API schedule endpoint uses "UTAH" (4 letters) for Utah's own
              # abbreviation, unlike every other team and unlike the fantasy API's "UTA" -
              # left unmapped, a Jazz player's OWN schedule fetch could never match its
              # home team against either competitor, so every game silently dropped out
              # of _team_schedule_labels (scripts/build_data.py) and the recap showed no
              # opponents for any Utah player.
              "UTAH": "UTA"}
