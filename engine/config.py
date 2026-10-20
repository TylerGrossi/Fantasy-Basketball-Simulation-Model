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
