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
        --nav-h: 3.9rem;           /* height of the fixed top bar */
        --content-max: 1180px;     /* centered content column width */
    }

    /* Hide anchor link icons and Streamlit header chrome */
    .stMarkdown a[href^="#"]::after,
    h1 a, h2 a, h3 a, h4 a, h5 a, h6 a,
    [data-testid="stHeaderActionElements"],
    .stMarkdown h1 a, .stMarkdown h2 a, .stMarkdown h3 a { display: none !important; }
    a.anchor-link { display: none !important; }

    /* Never let anything push a page-level horizontal scrollbar (e.g. when the
       window is resized narrow). Wide content scrolls inside its own container. */
    html, body { overflow-x: hidden; max-width: 100%; }
    .stApp { background: var(--paper); color: var(--ink); overflow-x: clip; }
    [data-testid="stAppViewContainer"], [data-testid="stMain"], section.main {
        overflow-x: clip;
    }
    /* Push the whole app (main + sidebar) below the fixed top bar. The bar itself
       is position:fixed, so it overlays this reserved band at the top. */
    [data-testid="stAppViewContainer"] { padding-top: var(--nav-h) !important; }
    /* Centered content column with a comfortable max width, so every page's
       content sits in the same centered lane. --page-pad is the side gutter. */
    .block-container {
        --page-pad: clamp(1rem, 4vw, 2.5rem);
        max-width: var(--content-max) !important;
        margin-left: auto !important;
        margin-right: auto !important;
        padding-top: 0.35rem !important;
        padding-bottom: 3rem !important;
        padding-left: var(--page-pad) !important;
        padding-right: var(--page-pad) !important;
    }

    /* Hide Streamlit's own chrome so the nav bar is the site header. The sidebar
       collapse control stays visible — it toggles the "This Week" left nav (the
       only way to reopen it once collapsed, e.g. on mobile). */
    [data-testid="stHeader"] { display: none !important; }
    [data-testid="stDecoration"] { display: none !important; }

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

    /* Season Summary metric row: match the champion card / standings width. */
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

    /* ================= Top navigation: sticky light site header ================= */
    /* Primary bar sticks to the very top of the viewport and spans the content
       column. It breaks out of the block-container's side gutter with matched
       negative margins + padding (NOT 100vw, which overflows past the scrollbar
       and causes a horizontal scrollbar when the page is windowed). */
    /* Fixed full-screen-width top bar. Because it's position:fixed it always spans
       the whole viewport (independent of the centered content column below) and
       stays pinned while scrolling. The app is padded down by --nav-h to clear it. */
    .st-key-nav_top {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 1000;
        height: var(--nav-h);
        background: var(--header-bg);
        padding: 0 var(--page-pad);
        border-bottom: 1px solid var(--line);
        box-shadow: 0 8px 20px rgba(20,16,10,0.05);   /* soft lift off content */
        box-sizing: border-box;
        /* Streamlit makes this a column flex; justify-content (main axis = vertical)
           is what vertically centers the nav row within the fixed-height bar. */
        display: flex;
        flex-direction: column;
        justify-content: center;
    }
    /* The nav row spans the full bar width (10 links + brand need the room; capping
       it at the narrow content column squishes the links together). */
    .st-key-nav_top [data-testid="stLayoutWrapper"],
    .st-key-nav_top > div:first-child { width: 100%; }
    .st-key-nav_top [data-testid="stHorizontalBlock"] { width: 100%; }
    .st-key-nav_top [data-testid="stMarkdownContainer"] p { margin: 0; }
    /* The brand's column shrinks to the text line, so the taller logo+wordmark
       overflows downward and its optical centre lands ~8px below the nav links.
       Nudge it up so the wordmark lines up with the links. */
    .nav-brand { transform: translateY(-8px); }

    /* Brand lockup: basketball mark + wordmark */
    .nav-brand { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
    .nav-brand svg { flex: none; display: block; width: 27px; height: 27px; }
    .nav-brand span {
        font-weight: 800; font-size: 1.18rem; letter-spacing: -0.01em; color: var(--ink);
    }

    .nav-scope-label {
        font-size: 0.62rem; letter-spacing: 0.14em; text-transform: uppercase;
        color: var(--ink-3); font-weight: 700; white-space: nowrap;
    }

    /* Primary nav links: muted text that darkens on hover; active = ink + cobalt underline */
    .st-key-nav_top .stButton > button {
        background: transparent !important;
        color: var(--ink-2) !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        padding: 0.45rem 0.1rem 0.5rem !important;
        font-weight: 600 !important;
    }
    .st-key-nav_top .stButton > button:hover {
        color: var(--ink) !important;
        background: transparent !important;
        transform: none !important;
        box-shadow: none !important;
    }
    .st-key-nav_top .stButton > button[kind="primary"],
    .st-key-nav_top .stButton [data-testid="stBaseButton-primary"] {
        color: var(--ink) !important;
        box-shadow: inset 0 -2px 0 var(--cobalt) !important;
    }
    .st-key-nav_top .stButton > button:focus-visible {
        outline: 2px solid var(--cobalt) !important; outline-offset: 2px;
    }
    .st-key-nav_top .stButton > button p {
        white-space: nowrap; font-size: 1.02rem;
    }

    /* -------- Responsive nav: one row that scrolls sideways, never wraps ------- */
    /* The nav must stay horizontal at every width (Streamlit otherwise stacks the
       columns on phones and squishes/overlaps them on tablets). */
    .st-key-nav_top [data-testid="stHorizontalBlock"] { flex-wrap: nowrap !important; }

    /* Below the desktop width, pack items to their natural size and let the row
       scroll horizontally (a swipeable tab bar on mobile). The scroll is contained
       inside the bar, so it never spills into a page-level horizontal scrollbar. */
    @media (max-width: 1180px) {
        .st-key-nav_top [data-testid="stHorizontalBlock"] {
            overflow-x: auto;
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
        }
        .st-key-nav_top [data-testid="stHorizontalBlock"]::-webkit-scrollbar { display: none; }
        .st-key-nav_top [data-testid="stColumn"] {
            flex: 0 0 auto !important;
            width: auto !important;
            min-width: max-content !important;
        }
        .st-key-nav_top .stButton > button {
            padding-left: 0.55rem !important;
            padding-right: 0.55rem !important;
        }
    }

    /* ============ Secondary "This Week" nav: vertical bar on the left ============ */
    /* Rendered into Streamlit's native sidebar (a sticky, full-height left rail)
       only while a week page is active. */
    [data-testid="stSidebar"] {
        background: var(--surface-2);
        border-right: 1px solid var(--line);
    }
    /* The collapse/close arrow is never useful here — the desktop rail is permanent
       and the mobile rail is inline — so hide it at all widths. */
    [data-testid="stSidebarCollapseButton"] { display: none !important; }
    /* Tablet/desktop: permanent left bar. Force it visible whenever it holds nav
       buttons (Streamlit can fail to create a reopen control after a collapse). */
    @media (min-width: 768px) {
        [data-testid="stSidebar"]:has(.stButton) {
            transform: none !important;
            visibility: visible !important;
            min-width: 240px !important;
            width: 240px !important;
        }
    }
    /* Phones: the rail becomes a compact horizontal sub-nav (Streamlit's mobile
       drawer toggle is unreliable, so a real drawer would trap the user). Because
       Streamlit makes the main section `position:absolute; inset:0` on mobile (it's
       the scroller), we can't stack in flow — so pin the rail as a FIXED sub-bar
       just under the header and reserve room for it in the content. */
    @media (max-width: 767px) {
        /* On mobile Streamlit makes stMain position:absolute, so the app container's
           --nav-h offset is ignored. Clear the fixed header via the block-container
           instead (week pages override this with extra room for the sub-bar below). */
        [data-testid="stMainBlockContainer"] { padding-top: calc(var(--nav-h) + 0.6rem) !important; }
        [data-testid="stSidebar"]:has(.stButton) {
            position: fixed !important;
            top: var(--nav-h) !important; left: 0 !important; right: 0 !important;
            width: 100% !important; min-width: 0 !important; max-width: none !important;
            height: auto !important;
            transform: none !important; visibility: visible !important;
            z-index: 900 !important;
            background: var(--surface-2) !important;
            border-right: none !important; border-bottom: 1px solid var(--line) !important;
        }
        [data-testid="stSidebar"] [data-testid="stSidebarContent"] { width: 100% !important; height: auto !important; }
        [data-testid="stSidebar"] [data-testid="stSidebarUserContent"] {
            padding: 0.4rem var(--page-pad) !important;
        }
        /* lay the week picker + page buttons in one horizontal, swipeable row */
        [data-testid="stSidebar"] [data-testid="stSidebarUserContent"] [data-testid="stVerticalBlock"] {
            flex-direction: row !important;
            align-items: center !important;
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
            gap: 0.4rem !important;
            scrollbar-width: none;
        }
        [data-testid="stSidebar"] [data-testid="stSidebarUserContent"] [data-testid="stVerticalBlock"]::-webkit-scrollbar { display: none; }
        [data-testid="stSidebar"] [data-testid="stSidebarUserContent"] [data-testid="stElementContainer"],
        [data-testid="stSidebar"] [data-testid="stSidebarUserContent"] [data-testid="stLayoutWrapper"] { flex: 0 0 auto !important; width: auto !important; }
        [data-testid="stSidebar"] .nav-scope-label { display: none !important; }
        [data-testid="stSidebar"] [data-baseweb="select"] { min-width: 160px; }
        [data-testid="stSidebar"] .stButton > button { white-space: nowrap; min-height: 44px; }
        /* drop the empty sidebar header row so the sub-bar hugs the top */
        [data-testid="stSidebar"] [data-testid="stSidebarHeader"] { display: none !important; padding: 0 !important; height: 0 !important; }
        /* reserve room for the fixed sub-bar (week pages only, via :has) */
        [data-testid="stAppViewContainer"]:has([data-testid="stSidebar"] .stButton) [data-testid="stMainBlockContainer"] {
            padding-top: calc(var(--nav-h) + 3.1rem) !important;
        }

        /* Compact the brand on small phones: icon only, so the nav links get room. */
        .nav-brand span { display: none; }
        /* Comfortable tap targets (>=44px) with a bit more breathing room. */
        .st-key-nav_top .stButton > button {
            min-height: 44px; padding-top: 0.55rem !important; padding-bottom: 0.55rem !important;
        }
        /* Season Summary metric tiles: two per row instead of four cramped columns. */
        .st-key-ss_metrics [data-testid="stHorizontalBlock"] { flex-wrap: wrap !important; }
        .st-key-ss_metrics [data-testid="stColumn"] {
            flex: 1 1 46% !important; min-width: 46% !important; width: 46% !important;
        }
    }
    [data-testid="stSidebar"] .nav-scope-label { display: block; margin: 0.2rem 0 0.6rem; }
    /* Week picker in the left rail */
    [data-testid="stSidebar"] [data-baseweb="select"] > div {
        background: var(--card) !important;
        border-radius: 8px !important;
        min-height: 2.1rem !important;
        font-family: var(--mono) !important;
        font-size: 0.8rem !important;
    }
    /* Vertical link buttons: left-aligned text, active = cobalt inset bar */
    [data-testid="stSidebar"] .stButton > button {
        background: transparent !important;
        color: var(--ink-2) !important;
        border: none !important;
        box-shadow: none !important;
        border-radius: 6px !important;
        padding: 0.5rem 0.7rem !important;
        font-weight: 600 !important;
        text-align: left !important;
        justify-content: flex-start !important;
    }
    [data-testid="stSidebar"] .stButton > button p {
        white-space: nowrap; font-size: 0.9rem; width: 100%; text-align: left;
    }
    [data-testid="stSidebar"] .stButton > button:hover {
        color: var(--ink) !important;
        background: var(--cobalt-soft) !important;
        transform: none !important;
        box-shadow: none !important;
    }
    [data-testid="stSidebar"] .stButton > button[kind="primary"],
    [data-testid="stSidebar"] .stButton [data-testid="stBaseButton-primary"] {
        color: var(--ink) !important;
        background: var(--cobalt-soft) !important;
        box-shadow: inset 3px 0 0 var(--cobalt) !important;
    }
    [data-testid="stSidebar"] .stButton > button:focus-visible {
        outline: 2px solid var(--cobalt) !important; outline-offset: 2px;
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
    /* Hide the spurious vertical scrollbar (it reserves ~12px and would force a
       phantom horizontal bar on tables that otherwise fit), but KEEP a slim
       horizontal one so genuinely wide tables (e.g. the 15-category stat sheets)
       can be scrolled to their last column instead of being cut off at the edge. */
    [data-testid="stDataFrame"] *::-webkit-scrollbar:vertical { width: 0 !important; }
    [data-testid="stDataFrame"] *::-webkit-scrollbar:horizontal { height: 10px !important; }
    [data-testid="stDataFrame"] *::-webkit-scrollbar-thumb {
        background: var(--line-strong) !important; border-radius: 5px !important;
    }
    [data-testid="stDataFrame"] *::-webkit-scrollbar-track { background: transparent !important; }

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
