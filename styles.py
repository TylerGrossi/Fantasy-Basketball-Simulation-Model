"""
Fantasy Basketball Simulator - Custom CSS styles for Streamlit app.

Design system: "Analyst Sheet" - a light, print-inspired theme. Warm paper,
graphite ink, a single cobalt accent, clay reserved for warnings/opponent,
hairline rules, and monospace figures so numbers line up like a stat sheet.
"""

CUSTOM_CSS = """
<style>
    @import url('https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css');

    :root {
        --paper:        #F4F3EF;
        --card:         #FCFBF8;
        --surface-2:    #F1EFE9;
        --ink:          #1B1D22;
        --ink-2:        #6A6E79;
        --ink-3:        #9A9DA6;
        --line:         #DEDBD3;
        --line-strong:  #C9C5BB;
        --cobalt:       #2F6FED;
        --cobalt-soft:  rgba(47, 111, 237, 0.10);
        --clay:         #E06A3B;
        --good:         #2E7D46;
        --bad:          #C0392B;
        --line-2:       #EAE8E1;
        --row-highlight:#EEF3FF;
        --header-bg:    #FFFFFF;
        --sans: system-ui, 'Segoe UI', Helvetica, Arial, sans-serif;
        --mono: ui-monospace, 'SF Mono', 'Consolas', 'Liberation Mono', monospace;
    }

    /* Hide anchor link icons and Streamlit header chrome */
    .stMarkdown a[href^="#"]::after,
    h1 a, h2 a, h3 a, h4 a, h5 a, h6 a,
    [data-testid="stHeaderActionElements"],
    .stMarkdown h1 a, .stMarkdown h2 a, .stMarkdown h3 a { display: none !important; }
    a.anchor-link { display: none !important; }

    .stApp { background: var(--paper); color: var(--ink); overflow-x: clip; }
    /* Full-width content column; --page-pad is the shared side gutter the nav
       bleeds past. Children inherit --page-pad for the full-bleed math. */
    .block-container {
        --page-pad: clamp(1rem, 4vw, 2.5rem);
        max-width: 100% !important;
        padding-top: 0 !important;
        padding-bottom: 3rem !important;
        padding-left: var(--page-pad) !important;
        padding-right: var(--page-pad) !important;
    }

    /* Hide Streamlit's own chrome so the nav bar is the site header */
    [data-testid="stHeader"] { display: none !important; }
    [data-testid="stDecoration"] { display: none !important; }
    [data-testid="stSidebarCollapsedControl"] { display: none !important; }

    html, body, [class*="css"], .stMarkdown, p, span, label, div {
        font-family: var(--sans);
    }

    /* -------- Typography: quiet, tight grotesk. No uppercase shouting. -------- */
    h1, h2, h3, h4, h5, h6 {
        font-family: var(--sans) !important;
        color: var(--ink);
        letter-spacing: -0.012em;
        text-transform: none;
        font-weight: 700;
    }
    h2 { font-size: 1.35rem !important; margin-top: 0.4rem; }
    h3 { font-size: 1.08rem !important; color: var(--ink); }
    h4 {
        font-size: 0.72rem !important;
        letter-spacing: 0.12em !important;
        text-transform: uppercase !important;
        color: var(--ink-2) !important;
        font-weight: 700;
    }

    .main-header {
        font-family: var(--sans) !important;
        color: var(--ink) !important;
        background: none !important;
        -webkit-text-fill-color: currentColor !important;
        font-size: 2.2rem !important;
        font-weight: 800;
        letter-spacing: -0.02em;
        text-transform: none;
        text-align: center;
        padding: 0.25rem 0;
        margin: 0;
    }

    /* Bootstrap icons: one calm accent instead of a rainbow. Inline colors are
       overridden so every section header reads as one system. */
    .stMarkdown .bi, h1 .bi, h2 .bi, h3 .bi, h4 .bi, .bi[class] {
        color: var(--cobalt) !important;
        font-size: 0.85em;
        opacity: 0.9;
    }

    /* -------- Number / stat cards -------- */
    .stat-card, .mobile-card, .streamer-card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 1.1rem 1.2rem;
        box-shadow: 0 1px 2px rgba(27, 29, 34, 0.04);
    }
    .streamer-card { border-left: 3px solid var(--cobalt); border-radius: 8px; }
    .streamer-card.positive { border-left-color: var(--good); }
    .streamer-card.negative { border-left-color: var(--bad); }
    .mobile-card { border-left: 3px solid var(--cobalt); }

    .win-pct {
        font-family: var(--mono);
        font-size: 3.2rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        text-align: center;
        letter-spacing: -0.02em;
    }
    .win-pct.winning { color: var(--good); }
    .win-pct.losing  { color: var(--bad); }

    .category-row {
        display: flex; justify-content: space-between;
        padding: 0.5rem 0; border-bottom: 1px solid var(--line);
    }

    .swing-badge {
        background: var(--clay); color: #FFFFFF;
        padding: 2px 8px; border-radius: 4px;
        font-size: 0.66rem; font-weight: 700; letter-spacing: 0.06em;
        text-transform: uppercase; font-family: var(--sans);
    }

    /* -------- Sidebar -------- */
    [data-testid="stSidebar"] {
        background: var(--surface-2);
        border-right: 1px solid var(--line);
    }
    [data-testid="stSidebar"] h1, [data-testid="stSidebar"] h2 { color: var(--ink); }
    [data-testid="stSidebar"] hr { border-color: var(--line); margin: 0.9rem 0; }

    /* -------- Inputs -------- */
    [data-baseweb="input"] input,
    [data-baseweb="textarea"] textarea,
    .stTextInput input, .stNumberInput input, .stTextArea textarea {
        font-family: var(--mono) !important;
        background: var(--card) !important;
        color: var(--ink) !important;
        border-radius: 7px !important;
    }
    [data-baseweb="base-input"] { border-radius: 7px; }
    /* Selectbox value text + control follows the theme (visible in dark mode) */
    [data-baseweb="select"] > div {
        background: var(--card) !important;
        border-color: var(--line) !important;
    }
    [data-baseweb="select"] > div > div,
    [data-baseweb="select"] input,
    [data-baseweb="select"] svg { color: var(--ink) !important; fill: var(--ink-2) !important; }

    /* Widget labels + option text follow the theme (readable in dark mode) */
    [data-testid="stWidgetLabel"] p,
    [data-testid="stWidgetLabel"] label,
    .stCheckbox label p, [role="radiogroup"] label p,
    [data-testid="stTickBarMin"], [data-testid="stTickBarMax"] {
        color: var(--ink) !important;
    }
    [data-testid="stThumbValue"] { color: var(--cobalt) !important; }
    /* Checkbox box border visible on dark */
    [data-baseweb="checkbox"] div:first-child { border-color: var(--line-strong) !important; }
    /* Slider rail track */
    [data-testid="stSlider"] [data-baseweb="slider"] div[role="slider"] { background: var(--cobalt); }

    /* -------- Buttons: solid cobalt, no gradient, no uppercase -------- */
    .stButton > button {
        background: var(--cobalt) !important;
        color: #FFFFFF !important;
        font-family: var(--sans) !important;
        font-weight: 600 !important;
        text-transform: none !important;
        letter-spacing: 0.01em !important;
        border: none !important;
        padding: 0.65rem 1.4rem !important;
        border-radius: 8px !important;
        transition: background 0.15s ease, transform 0.15s ease !important;
    }
    .stButton > button:hover {
        background: #255FD6 !important;
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(47, 111, 237, 0.25) !important;
    }
    .stButton > button:focus-visible { outline: 2px solid var(--cobalt); outline-offset: 2px; }

    /* Season Summary metric row: match the champion card / standings width */
    .st-key-ss_metrics { max-width: 960px; margin-left: auto; margin-right: auto; }

    /* Home landing: quick-link cards */
    .st-key-home_links { max-width: 1040px; margin-left: auto; margin-right: auto; }
    .home-card {
        background: var(--card); border: 1px solid var(--line); border-radius: 12px;
        padding: 1rem; text-align: center; height: 152px; margin-bottom: 0.75rem;
        display: flex; flex-direction: column; justify-content: center;
    }
    .home-card-icon { color: var(--cobalt); font-size: 1.5rem; line-height: 1; }
    .home-card-title { font-weight: 700; color: var(--ink); margin-top: 0.45rem; }
    .home-card-desc { color: var(--ink-2); font-size: 0.84rem; margin-top: 0.3rem; }

    /* ================= Top navigation: light two-tier site header ================= */
    /* Full-bleed: span the entire viewport width symmetrically, regardless of the
       centered content container or scrollbar (stApp clips the x-overflow). Width is
       forced with !important because Streamlit otherwise pins these blocks to the
       content-box width, which leaves the header short of the right viewport edge. */
    .st-key-nav_top, .st-key-nav_sub {
        width: 100vw !important;
        max-width: 100vw !important;
        margin-left: calc(50% - 50vw) !important;
        margin-right: calc(50% - 50vw) !important;
        padding-left: var(--page-pad);
        padding-right: var(--page-pad);
        border-radius: 0;
        box-sizing: border-box;
    }
    .st-key-nav_top [data-testid="stMarkdownContainer"] p,
    .st-key-nav_sub [data-testid="stMarkdownContainer"] p { margin: 0; }
    .st-key-nav_top {
        background: var(--header-bg);     /* reads clearly on the page ground */
        padding-top: 0.6rem;
        padding-bottom: 0.4rem;
        margin-bottom: 1.5rem;
        border-bottom: 1px solid var(--line);
        box-shadow: 0 8px 20px rgba(20,16,10,0.05);   /* soft lift off content */
    }
    .st-key-nav_sub {
        background: var(--surface-2);
        border-bottom: 1px solid var(--line);
        padding-top: 0.3rem;
        padding-bottom: 0.45rem;
        margin-top: -1.5rem;               /* pull flush against the primary bar */
        margin-bottom: 1.5rem;
        box-shadow: 0 8px 20px rgba(20,16,10,0.05);
    }

    /* Brand lockup: basketball mark + wordmark */
    /* Streamlit bottom-anchors markdown columns; lift brand + pill to the link center */
    .nav-brand, .nav-team-wrap { transform: translateY(-8px); }
    .nav-brand { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
    .nav-brand svg { flex: none; display: block; }
    .nav-brand span {
        font-weight: 800; font-size: 1rem; letter-spacing: -0.01em; color: var(--ink);
    }

    /* Team chip on the right */
    .nav-team-wrap { text-align: right; }
    .nav-team-pill {
        display: inline-flex; align-items: center; gap: 6px;
        font-family: var(--mono); font-size: 0.78rem; font-weight: 600; color: var(--ink);
        background: var(--card); border: 1px solid var(--line-strong);
        border-radius: 999px; padding: 0.28rem 0.85rem; white-space: nowrap;
    }
    .nav-team-pill::before {
        content: ""; width: 7px; height: 7px; border-radius: 50%;
        background: var(--cobalt); flex: none;
    }

    .nav-scope-label {
        font-size: 0.62rem; letter-spacing: 0.14em; text-transform: uppercase;
        color: var(--ink-3); font-weight: 700; white-space: nowrap;
    }

    /* Nav links: muted text that darkens on hover; active = ink + cobalt underline */
    .st-key-nav_top .stButton > button,
    .st-key-nav_sub .stButton > button {
        background: transparent !important;
        color: var(--ink-2) !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        padding: 0.45rem 0.1rem 0.5rem !important;
        font-weight: 600 !important;
    }
    .st-key-nav_top .stButton > button:hover,
    .st-key-nav_sub .stButton > button:hover {
        color: var(--ink) !important;
        background: transparent !important;
        transform: none !important;
        box-shadow: none !important;
    }
    .st-key-nav_top .stButton > button[kind="primary"],
    .st-key-nav_sub .stButton > button[kind="primary"],
    .st-key-nav_top .stButton [data-testid="stBaseButton-primary"],
    .st-key-nav_sub .stButton [data-testid="stBaseButton-primary"] {
        color: var(--ink) !important;
        box-shadow: inset 0 -2px 0 var(--cobalt) !important;
    }
    .st-key-nav_top .stButton > button:focus-visible,
    .st-key-nav_sub .stButton > button:focus-visible {
        outline: 2px solid var(--cobalt) !important; outline-offset: 2px;
    }
    .st-key-nav_top .stButton > button p,
    .st-key-nav_sub .stButton > button p {
        white-space: nowrap; font-size: 0.9rem;
    }

    /* Compact mono week picker in the sub-bar */
    .st-key-nav_sub [data-baseweb="select"] > div {
        background: var(--card) !important;
        border-radius: 8px !important;
        min-height: 2.1rem !important;
        font-family: var(--mono) !important;
        font-size: 0.8rem !important;
    }

    /* -------- Responsive nav: one row that scrolls sideways, never wraps ------- */
    /* The nav must stay horizontal at every width (Streamlit otherwise stacks the
       columns on phones and squishes/overlaps them on tablets). */
    .st-key-nav_top [data-testid="stHorizontalBlock"],
    .st-key-nav_sub [data-testid="stHorizontalBlock"] { flex-wrap: nowrap !important; }

    /* Below the desktop width, pack items to their natural size and let the row
       scroll horizontally (a swipeable tab bar on mobile). */
    @media (max-width: 1180px) {
        .st-key-nav_top [data-testid="stHorizontalBlock"],
        .st-key-nav_sub [data-testid="stHorizontalBlock"] {
            overflow-x: auto;
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
        }
        .st-key-nav_top [data-testid="stHorizontalBlock"]::-webkit-scrollbar,
        .st-key-nav_sub [data-testid="stHorizontalBlock"]::-webkit-scrollbar { display: none; }
        .st-key-nav_top [data-testid="stColumn"],
        .st-key-nav_sub [data-testid="stColumn"] {
            flex: 0 0 auto !important;
            width: auto !important;
            min-width: max-content !important;
        }
        .st-key-nav_top .stButton > button,
        .st-key-nav_sub .stButton > button {
            padding-left: 0.55rem !important;
            padding-right: 0.55rem !important;
        }
        /* Give the picker a sensible fixed width so it doesn't collapse. */
        .st-key-nav_sub [data-baseweb="select"] { min-width: 190px; }
    }

    /* -------- Tabs: underline the active one, cobalt -------- */
    [data-testid="stTabs"] [data-baseweb="tab-list"] {
        gap: 2px; border-bottom: 1px solid var(--line);
    }
    [data-testid="stTabs"] [data-baseweb="tab"] {
        font-family: var(--sans); font-weight: 600; font-size: 0.9rem;
        color: var(--ink-2); background: transparent; border-radius: 6px 6px 0 0;
        padding: 0.5rem 0.9rem;
    }
    [data-testid="stTabs"] [aria-selected="true"] {
        color: var(--ink) !important;
        background: var(--cobalt-soft);
        box-shadow: inset 0 -2px 0 var(--cobalt);
    }
    [data-testid="stTabs"] [data-baseweb="tab-highlight"],
    [data-testid="stTabs"] [data-baseweb="tab-border"] { background: transparent; }

    /* -------- Progress -------- */
    .stProgress > div > div { background: var(--cobalt) !important; }
    .stProgress > div > div > div { background: var(--surface-2) !important; }

    /* -------- Metrics: mono figures, hairline card, equal height -------- */
    [data-testid="stMetric"] {
        background: var(--card); border: 1px solid var(--line);
        border-radius: 10px; padding: 0.7rem 0.6rem; text-align: center;
        /* Fixed floor so cards without a delta line match the one that has it */
        min-height: 116px; height: 100%;
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 0.35rem;
        overflow: hidden;
    }
    /* Stretch metric columns so every card in the row is the same height */
    [data-testid="stHorizontalBlock"]:has([data-testid="stMetric"]) { align-items: stretch; }
    [data-testid="stHorizontalBlock"]:has([data-testid="stMetric"]) [data-testid="stColumn"] > div,
    [data-testid="stHorizontalBlock"]:has([data-testid="stMetric"]) [data-testid="stVerticalBlock"] {
        height: 100%;
    }
    [data-testid="stMetric"] > div {
        display: flex; flex-direction: column; align-items: center; gap: 0.35rem; width: 100%;
    }
    [data-testid="stMetricValue"] {
        font-family: var(--mono) !important; font-variant-numeric: tabular-nums;
        font-size: 1.7rem !important; font-weight: 700; color: var(--ink);
        display: flex; justify-content: center; width: 100%;
    }
    [data-testid="stMetricLabel"] {
        display: flex; justify-content: center; align-items: flex-start; width: 100%;
        text-transform: uppercase; letter-spacing: 0.03em;
        font-size: 0.66rem !important; color: var(--ink-2);
        min-height: 2.1em;
    }
    /* Let long team-name labels wrap and stay centered instead of overflowing */
    [data-testid="stMetricLabel"] * {
        white-space: normal !important;
        overflow-wrap: anywhere; word-break: break-word;
        text-align: center; line-height: 1.15; max-width: 100%;
    }
    [data-testid="stMetricDelta"] { font-size: 0.82rem !important; font-family: var(--mono); }

    /* -------- Expander -------- */
    .streamlit-expanderHeader, [data-testid="stExpander"] summary {
        font-family: var(--sans) !important; font-weight: 600 !important;
        text-transform: none !important;
    }
    [data-testid="stExpander"] {
        border: 1px solid var(--line); border-radius: 10px; background: var(--card);
    }

    /* -------- Tables / dataframes: monospace, hairline -------- */
    .dataframe, [data-testid="stDataFrame"] {
        font-family: var(--mono) !important;
        font-variant-numeric: tabular-nums;
    }
    [data-testid="stDataFrame"] { border-radius: 8px; }
    /* Tables are sized to fit their content, so hide the grid's scrollbars. A stray
       vertical scrollbar reserves ~12px, which in turn forces a spurious horizontal
       one; hiding them removes the reserved gutter so neither bar appears. */
    [data-testid="stDataFrame"] *::-webkit-scrollbar { width: 0 !important; height: 0 !important; background: transparent !important; }
    [data-testid="stDataFrame"] * { scrollbar-width: none !important; }

    /* -------- Alerts: light, hairline, rounded -------- */
    .stAlert, [data-testid="stAlert"] {
        border-radius: 10px !important; overflow: hidden !important; padding: 0 !important;
        border: 1px solid var(--line) !important; background: var(--card) !important;
        color: var(--ink) !important;
    }
    .stAlert > div, [data-testid="stAlert"] > div {
        margin: 0 !important; border: none !important; border-radius: 0 !important;
        padding: 0.7rem 1rem !important; color: var(--ink) !important;
    }
    .stAlert > div > div, [data-testid="stAlert"] > div > div {
        margin: 0 !important; border-radius: 0 !important;
    }

    .scoreboard-table { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }

    /* ========================================================================
       RESPONSIVE
       ======================================================================== */
    @media screen and (max-width: 992px) {
        .main-header { font-size: 1.7rem !important; }
        [data-testid="stMetricValue"] { font-size: 1.35rem !important; }
    }
    @media screen and (max-width: 768px) {
        .main-header { font-size: 1.4rem !important; }
        h2 { font-size: 1.15rem !important; }
        h3 { font-size: 1rem !important; }
        .win-pct { font-size: 2.3rem; }
        [data-testid="stMetricValue"] { font-size: 1.2rem !important; }
        .stat-card { padding: 0.9rem; }
        [data-testid="column"] { width: 100% !important; flex: 1 1 100% !important; }
        .dataframe { font-size: 0.75rem !important; }
        .dataframe th, .dataframe td { padding: 4px 6px !important; }
        .js-plotly-plot { max-width: 100% !important; }
        .scoreboard-table table { font-size: 0.72rem; }
        .scoreboard-table th, .scoreboard-table td { padding: 4px 3px !important; }
    }
    @media screen and (max-width: 480px) {
        .main-header { font-size: 1.2rem !important; }
        .win-pct { font-size: 2rem; }
        .hide-mobile { display: none !important; }
        .dataframe { font-size: 0.66rem !important; }
        .stButton > button { padding: 0.5rem 1rem !important; font-size: 0.9rem !important; }
    }
</style>
"""


# Dark theme: redefine the palette tokens. Because components (and the inline HTML)
# are styled through var(--token), this single override flips the whole app.
DARK_CSS = """
<style>
    :root {
        --paper:        #14161B;
        --card:         #1C1F26;
        --surface-2:    #232732;
        --ink:          #EAECEF;
        --ink-2:        #A0A6B0;
        --ink-3:        #757C88;
        --line:         #2E333D;
        --line-strong:  #3A404B;
        --cobalt:       #5C93FF;
        --cobalt-soft:  rgba(92, 147, 255, 0.16);
        --clay:         #F0955E;
        --good:         #46C56E;
        --bad:          #F0616E;
        --line-2:       #262B34;
        --row-highlight:rgba(92, 147, 255, 0.14);
        --header-bg:    #1C1F26;
    }
    /* Native dataframe grid follows the OS scheme; nudge it dark for consistency */
    [data-testid="stDataFrame"] { color-scheme: dark; }
</style>
"""
