"""
Template for config_secrets.py — copy this file to config_secrets.py and fill in your own
values. config_secrets.py is gitignored so your real credentials are never committed.

    cp config_secrets.example.py config_secrets.py   # then edit config_secrets.py
"""

# ESPN auth cookies. Log in to fantasy.espn.com, open DevTools -> Application -> Cookies,
# and copy the values of the `espn_s2` and `SWID` cookies.
ESPN_S2 = "your-espn_s2-cookie-here"
ESPN_SWID = "{your-SWID-cookie-here}"

# Gemini API key — create a free key at https://aistudio.google.com (Get API key).
GEMINI_API_KEY = "your-gemini-api-key-here"
