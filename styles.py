"""
Fantasy Basketball Simulator - Custom CSS styles for Streamlit app.

Design system: "Analyst Sheet" - a light, print-inspired theme. Warm paper,
graphite ink, a single cobalt accent, clay reserved for warnings/opponent,
hairline rules, and monospace figures so numbers line up like a stat sheet.
"""

CUSTOM_CSS = """
<style>
    /* Bootstrap Icons are self-hosted (see assets/icon_font.py, injected separately). No CDN
       @import here — a leading @import is render-blocking, so a slow/blocked CDN would
       stop this whole stylesheet (nav, layout, chrome-hiding) from ever applying. */

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
        /* Side gutter. Declared at :root (not just .block-container) because CSS custom
           properties only inherit down the actual DOM tree — the sidebar is a SIBLING of
           .block-container (not a descendant), so a var(--page-pad) used inside it would
           silently resolve to nothing and break the whole padding shorthand (computes to
           0, not an error). This bit the This Week rail's mobile sub-bar padding once. */
        --page-pad: clamp(1rem, 4vw, 2.5rem);
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
       content sits in the same centered lane. --page-pad (the side gutter) is
       declared at :root, above — not here, see that comment for why. */
    .block-container {
        max-width: var(--content-max) !important;
        margin-left: auto !important;
        margin-right: auto !important;
        padding-top: 0.35rem !important;
        padding-bottom: 3rem !important;
        padding-left: var(--page-pad) !important;
        padding-right: var(--page-pad) !important;
    }

    /* ================= Page-change loading state ================= */
    /* Streamlit marks every element data-stale="true" during a rerun (e.g. navigating to
       a new page) and just fades it, leaving the PREVIOUS page's content half-visible -
       nav already shows the new active section, but the content below is a dimmed ghost
       of the old page, which reads as broken/mismatched rather than "loading". Dim it
       much further (near-invisible) and show a small centered spinner instead, so a slow
       page change reads as a clean loading state. A short transition-delay (not instant)
       matches Streamlit's own default behavior of not flashing this on fast reruns -
       only a page change that's actually slow enough to notice shows it.
       This only touches page CONTENT, not the nav bars, so navigation itself always stays
       crisp and clickable. */
    [data-testid="stMainBlockContainer"] [data-stale="true"] {
        opacity: 0.08 !important;
        transition: opacity 0.2s ease-in 0.25s !important;
    }
    [data-testid="stMain"]:has([data-stale="true"])::after {
        content: "";
        position: fixed; top: 50%; left: 50%;
        width: 34px; height: 34px; margin: -17px 0 0 -17px;
        border: 3px solid var(--line); border-top-color: var(--cobalt);
        border-radius: 50%;
        animation: fbb-spin 0.7s linear infinite;
        animation-delay: 0.25s;
        opacity: 0; animation-fill-mode: forwards;
        z-index: 2000;
    }
    @keyframes fbb-spin {
        0% { opacity: 0; transform: rotate(0deg); }
        1% { opacity: 1; }
        100% { opacity: 1; transform: rotate(360deg); }
    }

    /* Hide Streamlit's own chrome so the nav bar is the site header. The sidebar
       collapse control stays visible — it toggles the "This Week" left nav (the
       only way to reopen it once collapsed, e.g. on mobile). */
    [data-testid="stHeader"] { display: none !important; }
    [data-testid="stDecoration"] { display: none !important; }
    /* Hide Streamlit Community Cloud chrome: the main menu, the "Manage app" status widget,
       and the "Hosted with Streamlit" viewer badge in the bottom-right (only appears once
       deployed to Cloud — cannot be seen/verified from a local run). The badge's wrapping
       div/classnames are hashed and can change between Streamlit releases, so target it two
       ways: known testids/class-name fragments, AND (more durable) any container that holds
       a link to streamlit.io — hiding the actual `<a>` removes the visible badge even if a
       still-hidden empty wrapper div is left behind. Also hidden at every width, not just
       mobile, since the badge can appear on desktop too. */
    #MainMenu, footer, [data-testid="stStatusWidget"] { display: none !important; }
    [class*="viewerBadge" i], [class*="profileContainer" i], [data-testid="stAppDeployButton"],
    [data-testid*="Badge" i], [id*="streamlit-badge" i] { display: none !important; }
    a[href*="streamlit.io"] { display: none !important; }
    body > div:has(> a[href*="streamlit.io"]) { display: none !important; }

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

    /* ======= Home landing: DESKTOP and MOBILE are different layouts, on purpose =======
       Both are rendered server-side; CSS shows only the one matching the breakpoint, so
       there's no server-side width detection and no flash of the wrong layout. */
    .st-key-home_mobile { display: none; }
    @media (max-width: 767px) {
        .st-key-home_desktop { display: none !important; }
        .st-key-home_mobile { display: block; }
    }

    /* -------- Desktop: original 4-card layout (icon, title, desc, Open button) -------- */
    .st-key-home_links { max-width: 1040px; margin-left: auto; margin-right: auto; }
    .home-card {
        background: var(--card); border: 1px solid var(--line); border-radius: 12px;
        padding: 1rem; text-align: center; height: 152px; margin-bottom: 0.75rem;
        display: flex; flex-direction: column; justify-content: center;
    }
    .home-card-icon { color: var(--cobalt); font-size: 1.5rem; line-height: 1; }
    .home-card-title { font-weight: 700; color: var(--ink); margin-top: 0.45rem; }
    .home-card-desc { color: var(--ink-2); font-size: 0.84rem; margin-top: 0.3rem; }

    /* -------- Mobile: compact hero + 2-up icon-tile grid -------- */
    .home-hero { text-align: center; padding: 0.7rem 0.5rem 0.6rem; }
    .home-eyebrow {
        font-family: var(--sans); font-size: 0.68rem; letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--ink-2);
    }
    .home-title { font-size: 1.4rem !important; margin-top: 0.15rem; }
    .home-sub { color: var(--ink-2); margin: 0.4rem auto 0; font-size: 0.9rem; max-width: 560px; }
    .home-sub strong { color: var(--ink); }

    /* .st-key-home_tiles IS the vertical block holding the button element-containers —
       make it the grid directly (3-up phones, so 9 tiles fit in 3 rows without scrolling).
       Each tile is a single-tap button styled as a card, icon set per slug via `--home-ic`
       (embedded bi font). */
    .st-key-home_tiles {
        max-width: 900px; margin: 1.1rem auto 0; width: 100%;
        display: grid !important; grid-template-columns: repeat(3, 1fr); gap: 0.6rem !important;
    }
    .st-key-home_tiles > [data-testid="stElementContainer"] { width: 100% !important; }
    .st-key-home_tiles .stButton > button {
        background: var(--card) !important; border: 1px solid var(--line) !important;
        border-radius: 14px !important; color: var(--ink) !important; font-weight: 700 !important;
        display: flex !important; flex-direction: column; align-items: center; justify-content: center;
        /* clamp() against dvh (dynamic viewport height - accounts for mobile browser
           chrome like the address bar), not a fixed px: a height tuned to fill one
           specific test-window size overflows on shorter real screens (browser chrome
           eats into the visible height) and cuts off the bottom row. This scales with
           whatever's actually visible instead. */
        gap: 0.55rem; min-height: clamp(96px, 17dvh, 150px); padding: 0.9rem 0.5rem !important;
        box-shadow: 0 1px 2px rgba(27,29,34,0.04) !important;
    }
    .st-key-home_tiles .stButton > button::before {
        font-family: "bootstrap-icons"; content: var(--home-ic, "\\f5e6");
        color: var(--cobalt); font-size: 2rem; line-height: 1;
    }
    .st-key-home_tiles .stButton > button p { font-size: 0.88rem; line-height: 1.15; text-align: center; }
    .st-key-home_tiles .stButton > button:hover {
        border-color: var(--cobalt) !important; background: var(--card) !important;
        color: var(--ink) !important; transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(47,111,237,0.12) !important;
    }
    .st-key-hometile_ss  button { --home-ic: "\\f5e6"; }  /* trophy-fill */
    .st-key-hometile_cm  button { --home-ic: "\\f17a"; }  /* bar-chart-fill */
    .st-key-hometile_sst button { --home-ic: "\\f71c"; }  /* clipboard-data-fill */
    .st-key-hometile_ls  button { --home-ic: "\\f5aa"; }  /* table */
    .st-key-hometile_po  button { --home-ic: "\\f2ed"; }  /* diagram-3-fill */
    .st-key-hometile_sch button { --home-ic: "\\f214"; }  /* calendar3 */
    .st-key-hometile_pr  button { --home-ic: "\\f673"; }  /* graph-up-arrow */
    .st-key-hometile_pv  button { --home-ic: "\\f4d3"; }  /* person-badge */
    .st-key-hometile_ts  button { --home-ic: "\\f544"; }  /* shuffle */

    /* ================= Section navigation: light site header ================= */
    /* One control per section (This Week / Season / Tools + brand=Home + gear=Settings).
       Desktop: a fixed full-width top bar. Mobile: the top bar keeps only the brand and
       the sections move to a fixed bottom icon bar. A labeled sub-row exposes the pages
       inside the active multi-page section. The sidebar is retired. */
    :root { --bottomnav-h: 6.3rem; }

    /* The native sidebar is the "This Week" side rail — but only when it holds nav (i.e.
       on This Week pages). On every other page nothing renders into it, so hide the empty
       sidebar entirely. The collapse control is unreliable in Streamlit; hide it too. */
    [data-testid="stSidebar"]:not(:has(.stButton)) { display: none !important; }
    /* Hide the whole sidebar header row (it only holds the unreliable collapse arrow) at
       all widths — the rail is permanent, so there's nothing to collapse. */
    [data-testid="stSidebarHeader"],
    [data-testid="stSidebarCollapseButton"], [data-testid="collapsedControl"] { display: none !important; }

    /* Fixed full-viewport-width top bar (position:fixed spans the whole viewport
       regardless of the centered content column). The app is padded down by --nav-h. */
    .st-key-nav_top {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 1000;
        height: var(--nav-h);
        background: var(--header-bg);
        padding: 0;                      /* the inner row carries the page gutters */
        border-bottom: 1px solid var(--line);
        box-shadow: 0 8px 20px rgba(20,16,10,0.05);   /* soft lift off content */
        box-sizing: border-box;
        /* Streamlit makes this a column flex; justify-content (main axis = vertical)
           is what vertically centers the nav row within the fixed-height bar. */
        display: flex;
        flex-direction: column;
        justify-content: center;
    }
    .st-key-nav_top [data-testid="stLayoutWrapper"],
    .st-key-nav_top > div:first-child { width: 100%; }
    .st-key-nav_top [data-testid="stHorizontalBlock"] { width: 100%; }
    .st-key-nav_top [data-testid="stMarkdownContainer"] p { margin: 0; }

    /* The nav containers are position:fixed (or hidden), yet Streamlit still renders each as
       a flex item at the top of the main column — and the column's 16px `gap` then stacks up
       as empty space before the page content (one gap per nav container). Pull those wrappers
       out of the flex flow so they add zero gap. nav_top + nav_bottom are always fixed/hidden;
       nav_sub is in-flow only on mobile, so collapse it only on desktop. The apple-touch-icon
       injector (a zero-height components.html iframe) is invisible but is the same kind of
       flex item, so it's collapsed here too — otherwise it pushes everything below it down by
       a full gap and puts the This Week rail (fixed, top:0) out of alignment with the in-flow
       Season/Tools sub-row. */
    [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:has(.st-key-nav_top),
    [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:has(.st-key-nav_bottom),
    [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:has(.st-key-touch_icon_injector),
    [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:has(.st-key-css_injector),
    [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:has(.st-key-pv_gl_injector),
    [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:has([class*="st-key-mp_hide_"]) {
        position: absolute !important; height: 0 !important; margin: 0 !important; padding: 0 !important;
    }
    @media (min-width: 768px) {
        [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:has(.st-key-nav_sub) {
            position: absolute !important; height: 0 !important; margin: 0 !important; padding: 0 !important;
        }
    }

    /* ================= Page footer: minimal utility footer, every page ================= */
    /* A slim brand/source line + "back to top" - no link farm, this is a single-owner tool
       not a marketing site. On a short page (e.g. Home) it would otherwise land mid-page
       with dead space below it, which is the exact "content feels cut off" complaint this
       was added to fix - so the classic flexbox sticky-footer trick pushes it to the bottom
       of the viewport instead: the top-level vertical block gets a min-height matching the
       visible viewport (100vh minus the fixed top bar it's already padded below), and the
       footer's own wrapper gets margin-top:auto to soak up any leftover space. On a long
       page the block is already taller than that min-height, so this is a no-op there and
       the footer just sits right after the real content, same as a normal footer. */
    @media (min-width: 768px) {
        [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] {
            min-height: calc(100vh - var(--nav-h));
        }
        [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > *:has(.st-key-app_footer) {
            margin-top: auto;
        }
    }
    .st-key-app_footer {
        border-top: 1px solid var(--line); margin-top: 2.5rem; padding-top: 1rem;
    }
    .app-footer-inner {
        display: flex; align-items: center; justify-content: space-between;
        flex-wrap: wrap; gap: 0.5rem;
        max-width: var(--content-max); margin: 0 auto; padding: 0 var(--page-pad) 1rem;
    }
    .app-footer-brand {
        font-size: 0.78rem; color: var(--ink-3);
    }
    .app-footer-top {
        font-size: 0.78rem; color: var(--ink-2) !important; text-decoration: none !important;
        font-weight: 600;
    }
    .app-footer-top:hover { color: var(--cobalt) !important; }

    .nav-scope-label {
        font-size: 0.62rem; letter-spacing: 0.14em; text-transform: uppercase;
        color: var(--ink-3); font-weight: 700; white-space: nowrap;
    }

    /* -------- Section icons: inline SVG via CSS mask (no font, no CDN) --------
       Research-backed choice: a missing/slow icon font makes nav look broken (blank
       glyphs). These are inline SVG shapes painted with `background-color`, so they
       render instantly and can never fail to load. Each button gets its shape from a
       `--nav-ic` var; the mask paints it. The brand basketball is a full-colour
       background-image on its own `::before` (below) and is deliberately not listed
       here. */
    .st-key-navb_week button::before,     .st-key-navb_season button::before,
    .st-key-navb_tools button::before,    .st-key-navb_settings button::before,
    .st-key-navb_home button::before,     .st-key-navp_settings button::before,
    .st-key-navb_search button::before,   .st-key-navp_search button::before,
    .st-key-navb_assistant button::before, .st-key-navp_assistant button::before {
        content: ""; display: inline-block; flex: none;
        width: 1.05rem; height: 1.05rem;
        background-color: var(--cobalt);
        -webkit-mask: var(--nav-ic) center / contain no-repeat;
                mask: var(--nav-ic) center / contain no-repeat;
    }
    .st-key-navp_search button, .st-key-navb_search button { --nav-ic: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktc2VhcmNoIiB2aWV3Qm94PSIwIDAgMTYgMTYiPjxwYXRoIGQ9Ik0xMS43NDIgMTAuMzQ0YTYuNSA2LjUgMCAxIDAtMS4zOTcgMS4zOThoLS4wMDFxLjA0NC4wNi4wOTguMTE1bDMuODUgMy44NWExIDEgMCAwIDAgMS40MTUtMS40MTRsLTMuODUtMy44NWExIDEgMCAwIDAtLjExNS0uMXpNMTIgNi41YTUuNSA1LjUgMCAxIDEtMTEgMCA1LjUgNS41IDAgMCAxIDExIDAiLz48L3N2Zz4="); }
    .st-key-navp_assistant button, .st-key-navb_assistant button { --nav-ic: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktcm9ib3QiIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZD0iTTYgMTIuNWEuNS41IDAgMCAxIC41LS41aDNhLjUuNSAwIDAgMSAwIDFoLTNhLjUuNSAwIDAgMS0uNS0uNU0zIDguMDYyQzMgNi43NiA0LjIzNSA1Ljc2NSA1LjUzIDUuODg2YTI2LjYgMjYuNiAwIDAgMCA0Ljk0IDBDMTEuNzY1IDUuNzY1IDEzIDYuNzYgMTMgOC4wNjJ2MS4xNTdhLjkzLjkzIDAgMCAxLS43NjUuOTM1Yy0uODQ1LjE0Ny0yLjM0LjM0Ni00LjIzNS4zNDZzLTMuMzktLjItNC4yMzUtLjM0NkEuOTMuOTMgMCAwIDEgMyA5LjIxOXptNC41NDItLjgyN2EuMjUuMjUgMCAwIDAtLjIxNy4wNjhsLS45Mi45YTI1IDI1IDAgMCAxLTEuODcxLS4xODMuMjUuMjUgMCAwIDAtLjA2OC40OTVjLjU1LjA3NiAxLjIzMi4xNDkgMi4wMi4xOTNhLjI1LjI1IDAgMCAwIC4xODktLjA3MWwuNzU0LS43MzYuODQ3IDEuNzFhLjI1LjI1IDAgMCAwIC40MDQuMDYybC45MzItLjk3YTI1IDI1IDAgMCAwIDEuOTIyLS4xODguMjUuMjUgMCAwIDAtLjA2OC0uNDk1Yy0uNTM4LjA3NC0xLjIwNy4xNDUtMS45OC4xODlhLjI1LjI1IDAgMCAwLS4xNjYuMDc2bC0uNzU0Ljc4NS0uODQyLTEuN2EuMjUuMjUgMCAwIDAtLjE4Mi0uMTM1WiIvPjxwYXRoIGQ9Ik04LjUgMS44NjZhMSAxIDAgMSAwLTEgMFYzaC0yQTQuNSA0LjUgMCAwIDAgMSA3LjVWOGExIDEgMCAwIDAtMSAxdjJhMSAxIDAgMCAwIDEgMXYxYTIgMiAwIDAgMCAyIDJoMTBhMiAyIDAgMCAwIDItMnYtMWExIDEgMCAwIDAgMS0xVjlhMSAxIDAgMCAwLTEtMXYtLjVBNC41IDQuNSAwIDAgMCAxMC41IDNoLTJ6TTE0IDcuNVYxM2ExIDEgMCAwIDEtMSAxSDNhMSAxIDAgMCAxLTEtMVY3LjVBMy41IDMuNSAwIDAgMSA1LjUgNGg1QTMuNSAzLjUgMCAwIDEgMTQgNy41Ii8+PC9zdmc+"); }
    /* Search / AI = icon only in the desktop header: keep the label for screen readers
       but hide it visually. */
    .st-key-navp_search button p, .st-key-navp_assistant button p {
        position: absolute !important; width: 1px; height: 1px;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
    }
    .st-key-navp_search button::before,
    .st-key-navp_assistant button::before { font-size: 1.2rem; }

    /* -------- AI Assistant chat page: narrow, centered chat column (Claude/Gemini feel) -- */
    .st-key-assistant_page { max-width: 820px; margin: 0 auto; }
    /* Empty state: greeting + chips + composer are one group, vertically centered in the
       page (ChatGPT/Gemini style) instead of the composer being pinned to the bottom. The
       .asst-hero marker exists only before the first message, so this targets empty only. */
    .st-key-assistant_page:has(.asst-hero) {
        min-height: 74vh; display: flex; flex-direction: column; justify-content: center;
    }
    .asst-hero { text-align: center; padding: 0 1rem 0.5rem; }
    /* Inline composer (a form so Enter submits): a centered rounded chat bar that sits with
       the greeting (empty) or under the conversation, never stuck at the viewport bottom. */
    .st-key-agent_composer { max-width: 680px; width: 100%; margin: 0.5rem auto 0.3rem; }
    .st-key-agent_composer [data-testid="stForm"] {
        border: 1px solid var(--line) !important; border-radius: 22px !important;
        background: var(--card) !important; padding: 0.5rem 0.6rem 0.5rem 0.95rem !important;
        box-shadow: 0 6px 22px rgba(20,16,10,0.07) !important;
        transition: border-color 0.15s, box-shadow 0.15s;
    }
    .st-key-agent_composer [data-testid="stForm"]:focus-within {
        border-color: var(--cobalt) !important;
        box-shadow: 0 6px 22px rgba(37,99,235,0.15) !important;
    }
    .st-key-agent_composer [data-baseweb="base-input"],
    .st-key-agent_composer [data-baseweb="textarea"],
    .st-key-agent_composer input, .st-key-agent_composer textarea {
        background: transparent !important; border: none !important;
        font-family: var(--sans) !important; font-size: 1.02rem !important;
        color: var(--ink) !important;
    }
    /* Multi-line composer: wraps + grows with content (like Claude), then scrolls. */
    .st-key-agent_composer [data-baseweb="textarea"] { min-height: 0 !important; height: auto !important; }
    .st-key-agent_composer textarea {
        resize: none !important; field-sizing: content;
        min-height: 1.6rem !important; height: auto !important; max-height: 38vh !important;
        line-height: 1.5; padding: 0.15rem 0 !important;
    }
    /* hide the 'Press Enter to submit form' helper text */
    .st-key-agent_composer [data-testid="InputInstructions"],
    .st-key-agent_composer [class*="InputInstructions"] { display: none !important; }
    /* the Enter-to-submit JS injector takes no space */
    .st-key-agent_enter_js { height: 0 !important; min-height: 0 !important;
        margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
    .st-key-agent_enter_js iframe { height: 0 !important; display: block; }
    .st-key-agent_composer [data-testid="stFormSubmitButton"] button {
        background: var(--cobalt) !important; color: #fff !important; border: none !important;
        border-radius: 12px !important; font-weight: 600 !important; box-shadow: none !important;
    }
    .st-key-agent_composer [data-testid="stFormSubmitButton"] button:hover {
        filter: brightness(1.05); transform: none !important;
    }

    /* ===== Claude-style chat: white page, no avatars, clean message rows ===== */
    /* White background across the app view while the Agent page is open. */
    [data-testid="stApp"]:has(.st-key-assistant_page),
    [data-testid="stApp"]:has(.st-key-assistant_page) [data-testid="stMain"],
    [data-testid="stApp"]:has(.st-key-assistant_page) [data-testid="stMainBlockContainer"],
    [data-testid="stApp"]:has(.st-key-assistant_page) .st-key-nav_top {
        background: #ffffff !important;
    }
    /* Drop the red/yellow default chat avatars entirely (Claude shows none). */
    .st-key-assistant_page [data-testid="stChatMessageAvatarUser"],
    .st-key-assistant_page [data-testid="stChatMessageAvatarAssistant"] {
        display: none !important;
    }
    .st-key-assistant_page [data-testid="stChatMessage"] {
        background: transparent !important; border: none !important; box-shadow: none !important;
        padding: 0.1rem 0 !important; gap: 0 !important; margin: 0.1rem 0 !important;
    }
    /* Assistant turn: plain text, comfortable reading rhythm, full column width. */
    .st-key-assistant_page [data-testid="stChatMessage"]:has([data-testid="stChatMessageAvatarAssistant"]) [data-testid="stChatMessageContent"] {
        background: transparent !important; padding: 0.35rem 0.1rem 0.9rem !important;
        color: var(--ink) !important; line-height: 1.7;
    }
    /* User turn: a subtle rounded bubble, right-aligned and contained, like Claude. */
    .st-key-assistant_page [data-testid="stChatMessage"]:has([data-testid="stChatMessageAvatarUser"]) {
        justify-content: flex-end !important;
    }
    .st-key-assistant_page [data-testid="stChatMessage"]:has([data-testid="stChatMessageAvatarUser"]) [data-testid="stChatMessageContent"] {
        flex: 0 1 auto !important; width: auto !important; max-width: 80% !important;
        margin-left: auto !important; margin-right: 0 !important;
        background: #f4f2ee !important; border-radius: 16px !important;
        padding: 0.6rem 1rem !important; color: var(--ink) !important;
    }
    /* Once there are messages on screen, pin the composer as a fixed bottom bar so it stays
       put and the conversation scrolls above it - real-chatbot behavior. Keyed off the
       presence of chat messages (stable across reruns) rather than the fading hero. In the
       empty state (no messages) the composer stays in-flow, centered with the greeting. */
    .st-key-assistant_page:has([data-testid="stChatMessage"]) .st-key-agent_composer {
        position: fixed !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
        z-index: 60; width: 100% !important; max-width: none !important; margin: 0 !important;
        background: #ffffff !important; padding: 0.6rem 1rem 1.5rem !important;
        box-shadow: 0 -16px 24px 8px rgba(255, 255, 255, 0.96);
    }
    .st-key-assistant_page:has([data-testid="stChatMessage"]) .st-key-agent_composer [data-testid="stForm"] {
        max-width: 720px; margin: 0 auto;
    }
    /* room so the last message isn't hidden behind the fixed composer */
    .st-key-assistant_page:has([data-testid="stChatMessage"]) { padding-bottom: 8rem !important; }
    .asst-hero-badge {
        width: 56px; height: 56px; margin: 0 auto 0.9rem; border-radius: 16px;
        display: flex; align-items: center; justify-content: center;
        background: var(--cobalt); color: #fff; font-size: 1.65rem;
        box-shadow: 0 8px 24px rgba(37,99,235,0.28);
    }
    .asst-hero h1 { font-size: 1.7rem; font-weight: 800; margin: 0 0 0.45rem; color: var(--ink); }
    .asst-hero p { color: var(--ink-2); max-width: 560px; margin: 0 auto; line-height: 1.5; }
    /* suggestion chips + Clear: pill buttons instead of heavy full-width blue bars */
    .st-key-assistant_page [data-testid="stHorizontalBlock"] .stButton > button {
        border: 1px solid var(--line) !important; background: var(--card) !important;
        color: var(--ink) !important; border-radius: 999px !important;
        font-weight: 600 !important; font-size: 0.85rem !important;
        padding: 0.4rem 0.6rem !important; box-shadow: none !important;
    }
    .st-key-assistant_page [data-testid="stHorizontalBlock"] .stButton > button:hover {
        border-color: var(--cobalt) !important; color: var(--cobalt) !important;
        transform: none !important;
    }
    /* chat bubbles: a touch more breathing room */
    .st-key-assistant_page [data-testid="stChatMessage"] { padding: 0.35rem 0.2rem; }
    .st-key-navb_week button     { --nav-ic: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktY2FsZW5kYXItd2Vlay1maWxsIiB2aWV3Qm94PSIwIDAgMTYgMTYiPgogIDxwYXRoIGQ9Ik00IC41YS41LjUgMCAwIDAtMSAwVjFIMmEyIDIgMCAwIDAtMiAydjFoMTZWM2EyIDIgMCAwIDAtMi0yaC0xVi41YS41LjUgMCAwIDAtMSAwVjFINFYuNXpNMTYgMTRWNUgwdjlhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yek05LjUgN2gxYS41LjUgMCAwIDEgLjUuNXYxYS41LjUgMCAwIDEtLjUuNWgtMWEuNS41IDAgMCAxLS41LS41di0xYS41LjUgMCAwIDEgLjUtLjV6bTMgMGgxYS41LjUgMCAwIDEgLjUuNXYxYS41LjUgMCAwIDEtLjUuNWgtMWEuNS41IDAgMCAxLS41LS41di0xYS41LjUgMCAwIDEgLjUtLjV6TTIgMTAuNWEuNS41IDAgMCAxIC41LS41aDFhLjUuNSAwIDAgMSAuNS41djFhLjUuNSAwIDAgMS0uNS41aC0xYS41LjUgMCAwIDEtLjUtLjV2LTF6bTMuNS0uNWgxYS41LjUgMCAwIDEgLjUuNXYxYS41LjUgMCAwIDEtLjUuNWgtMWEuNS41IDAgMCAxLS41LS41di0xYS41LjUgMCAwIDEgLjUtLjV6Ii8+Cjwvc3ZnPg=="); }
    .st-key-navb_season button   { --nav-ic: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktdHJvcGh5LWZpbGwiIHZpZXdCb3g9IjAgMCAxNiAxNiI+CiAgPHBhdGggZD0iTTIuNS41QS41LjUgMCAwIDEgMyAwaDEwYS41LjUgMCAwIDEgLjUuNWMwIC41MzgtLjAxMiAxLjA1LS4wMzQgMS41MzZhMyAzIDAgMSAxLTEuMTMzIDUuODljLS43OSAxLjg2NS0xLjg3OCAyLjc3Ny0yLjgzMyAzLjAxMXYyLjE3M2wxLjQyNS4zNTZjLjE5NC4wNDguMzc3LjEzNS41MzcuMjU1TDEzLjMgMTUuMWEuNS41IDAgMCAxLS4zLjlIM2EuNS41IDAgMCAxLS4zLS45bDEuODM4LTEuMzc5Yy4xNi0uMTIuMzQzLS4yMDcuNTM3LS4yNTVMNi41IDEzLjExdi0yLjE3M2MtLjk1NS0uMjM0LTIuMDQzLTEuMTQ2LTIuODMzLTMuMDEyYTMgMyAwIDEgMS0xLjEzMi01Ljg5QTMzLjA3NiAzMy4wNzYgMCAwIDEgMi41LjV6bS4wOTkgMi41NGEyIDIgMCAwIDAgLjcyIDMuOTM1Yy0uMzMzLTEuMDUtLjU4OC0yLjM0Ni0uNzItMy45MzV6bTEwLjA4MyAzLjkzNWEyIDIgMCAwIDAgLjcyLTMuOTM1Yy0uMTMzIDEuNTktLjM4OCAyLjg4NS0uNzIgMy45MzV6Ii8+Cjwvc3ZnPg=="); }
    .st-key-navb_tools button    { --nav-ic: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktdG9vbHMiIHZpZXdCb3g9IjAgMCAxNiAxNiI+CiAgPHBhdGggZD0iTTEgMCAwIDFsMi4yIDMuMDgxYTEgMSAwIDAgMCAuODE1LjQxOWguMDdhMSAxIDAgMCAxIC43MDguMjkzbDIuNjc1IDIuNjc1LTIuNjE3IDIuNjU0QTMuMDAzIDMuMDAzIDAgMCAwIDAgMTNhMyAzIDAgMSAwIDUuODc4LS44NTFsMi42NTQtMi42MTcuOTY4Ljk2OC0uMzA1LjkxNGExIDEgMCAwIDAgLjI0MiAxLjAyM2wzLjI3IDMuMjdhLjk5Ny45OTcgMCAwIDAgMS40MTQgMGwxLjU4Ni0xLjU4NmEuOTk3Ljk5NyAwIDAgMCAwLTEuNDE0bC0zLjI3LTMuMjdhMSAxIDAgMCAwLTEuMDIzLS4yNDJMMTAuNSA5LjVsLS45Ni0uOTYgMi42OC0yLjY0M0EzLjAwNSAzLjAwNSAwIDAgMCAxNiAzYzAtLjI2OS0uMDM1LS41My0uMTAyLS43NzdsLTIuMTQgMi4xNDFMMTIgNGwtLjM2NC0xLjc1N0wxMy43NzcuMTAyYTMgMyAwIDAgMC0zLjY3NSAzLjY4TDcuNDYyIDYuNDYgNC43OTMgMy43OTNhMSAxIDAgMCAxLS4yOTMtLjcwN3YtLjA3MWExIDEgMCAwIDAtLjQxOS0uODE0TDEgMFptOS42NDYgMTAuNjQ2YS41LjUgMCAwIDEgLjcwOCAwbDIuOTE0IDIuOTE1YS41LjUgMCAwIDEtLjcwNy43MDdsLTIuOTE1LTIuOTE0YS41LjUgMCAwIDEgMC0uNzA4Wk0zIDExbC40NzEuMjQyLjUyOS4wMjYuMjg3LjQ0NS40NDUuMjg3LjAyNi41MjlMNSAxM2wtLjI0Mi40NzEtLjAyNi41MjktLjQ0NS4yODctLjI4Ny40NDUtLjUyOS4wMjZMMyAxNWwtLjQ3MS0uMjQyTDIgMTQuNzMybC0uMjg3LS40NDVMMS4yNjggMTRsLS4wMjYtLjUyOUwxIDEzbC4yNDItLjQ3MS4wMjYtLjUyOS40NDUtLjI4Ny4yODctLjQ0NS41MjktLjAyNkwzIDExWiIvPgo8L3N2Zz4="); }
    .st-key-navb_settings button, .st-key-navp_settings button { --nav-ic: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktZ2Vhci1maWxsIiB2aWV3Qm94PSIwIDAgMTYgMTYiPgogIDxwYXRoIGQ9Ik05LjQwNSAxLjA1Yy0uNDEzLTEuNC0yLjM5Ny0xLjQtMi44MSAwbC0uMS4zNGExLjQ2NCAxLjQ2NCAwIDAgMS0yLjEwNS44NzJsLS4zMS0uMTdjLTEuMjgzLS42OTgtMi42ODYuNzA1LTEuOTg3IDEuOTg3bC4xNjkuMzExYy40NDYuODIuMDIzIDEuODQxLS44NzIgMi4xMDVsLS4zNC4xYy0xLjQuNDEzLTEuNCAyLjM5NyAwIDIuODFsLjM0LjFhMS40NjQgMS40NjQgMCAwIDEgLjg3MiAyLjEwNWwtLjE3LjMxYy0uNjk4IDEuMjgzLjcwNSAyLjY4NiAxLjk4NyAxLjk4N2wuMzExLS4xNjlhMS40NjQgMS40NjQgMCAwIDEgMi4xMDUuODcybC4xLjM0Yy40MTMgMS40IDIuMzk3IDEuNCAyLjgxIDBsLjEtLjM0YTEuNDY0IDEuNDY0IDAgMCAxIDIuMTA1LS44NzJsLjMxLjE3YzEuMjgzLjY5OCAyLjY4Ni0uNzA1IDEuOTg3LTEuOTg3bC0uMTY5LS4zMTFhMS40NjQgMS40NjQgMCAwIDEgLjg3Mi0yLjEwNWwuMzQtLjFjMS40LS40MTMgMS40LTIuMzk3IDAtMi44MWwtLjM0LS4xYTEuNDY0IDEuNDY0IDAgMCAxLS44NzItMi4xMDVsLjE3LS4zMWMuNjk4LTEuMjgzLS43MDUtMi42ODYtMS45ODctMS45ODdsLS4zMTEuMTY5YTEuNDY0IDEuNDY0IDAgMCAxLTIuMTA1LS44NzJsLS4xLS4zNHpNOCAxMC45M2EyLjkyOSAyLjkyOSAwIDEgMSAwLTUuODYgMi45MjkgMi45MjkgMCAwIDEgMCA1Ljg1OHoiLz4KPC9zdmc+"); }
    .st-key-navb_home button      { --nav-ic: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iY3VycmVudENvbG9yIiBjbGFzcz0iYmkgYmktaG91c2UtZG9vci1maWxsIiB2aWV3Qm94PSIwIDAgMTYgMTYiPgogIDxwYXRoIGQ9Ik02LjUgMTQuNXYtMy41MDVjMC0uMjQ1LjI1LS40OTUuNS0uNDk1aDJjLjI1IDAgLjUuMjUuNS41djMuNWEuNS41IDAgMCAwIC41LjVoNGEuNS41IDAgMCAwIC41LS41di03YS41LjUgMCAwIDAtLjE0Ni0uMzU0TDEzIDUuNzkzVjIuNWEuNS41IDAgMCAwLS41LS41aC0xYS41LjUgMCAwIDAtLjUuNXYxLjI5M0w4LjM1NCAxLjE0NmEuNS41IDAgMCAwLS43MDggMGwtNiA2QS41LjUgMCAwIDAgMS41IDcuNXY3YS41LjUgMCAwIDAgLjUuNWg0YS41LjUgMCAwIDAgLjUtLjVaIi8+Cjwvc3ZnPg=="); }

    /* -------- Brand lockup (button = Home): basketball mark + wordmark -------- */
    .st-key-nav_brand button {
        display: inline-flex !important; align-items: center; gap: 10px;
        justify-content: flex-start !important;
        background: transparent !important; border: none !important;
        box-shadow: none !important; padding: 0.3rem 0 !important;
    }
    .st-key-nav_brand button:hover { transform: none !important; box-shadow: none !important; background: transparent !important; }
    .st-key-nav_brand button::before {
        content: ""; flex: none; width: 27px; height: 27px;
        background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0NSIgZmlsbD0iI0UwNkEzQiIgc3Ryb2tlPSIjMUIxRDIyIiBzdHJva2Utd2lkdGg9IjQiLz48cGF0aCBkPSJNNTAgNSBRNTAgNTAgNTAgOTUiIHN0cm9rZT0iIzFCMUQyMiIgc3Ryb2tlLXdpZHRoPSIzIiBmaWxsPSJub25lIi8+PHBhdGggZD0iTTUgNTAgUTUwIDUwIDk1IDUwIiBzdHJva2U9IiMxQjFEMjIiIHN0cm9rZS13aWR0aD0iMyIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xMyAyNiBRNTAgNDAgODcgMjYiIHN0cm9rZT0iIzFCMUQyMiIgc3Ryb2tlLXdpZHRoPSIyLjUiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNMTMgNzQgUTUwIDYwIDg3IDc0IiBzdHJva2U9IiMxQjFEMjIiIHN0cm9rZS13aWR0aD0iMi41IiBmaWxsPSJub25lIi8+PC9zdmc+");
        background-size: contain; background-repeat: no-repeat; background-position: center;
    }
    .st-key-nav_brand button p {
        font-weight: 800 !important; font-size: 1.18rem !important;
        letter-spacing: -0.01em; color: var(--ink) !important; white-space: nowrap;
    }

    /* -------- Primary section links: muted text, icon + label, active = ink + underline -------- */
    .st-key-nav_top .stButton > button {
        display: inline-flex !important; align-items: center; justify-content: center;
        gap: 7px;
        background: transparent !important;
        color: var(--ink-2) !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        padding: 0.45rem 0.3rem 0.5rem !important;
        font-weight: 600 !important;
    }
    .st-key-nav_top .stButton > button:hover {
        color: var(--ink) !important; background: transparent !important;
        transform: none !important; box-shadow: none !important;
    }
    .st-key-nav_top .stButton > button[kind="primary"],
    .st-key-nav_top .stButton [data-testid="stBaseButton-primary"] {
        color: var(--ink) !important;
        box-shadow: inset 0 -2px 0 var(--cobalt) !important;
    }
    /* the brand's "active" state shouldn't draw an underline (a logo isn't a tab).
       Kept more specific than the generic nav-primary underline rule above. */
    .st-key-nav_top .st-key-nav_brand button[kind="primary"] { box-shadow: none !important; }
    .st-key-nav_top .stButton > button:focus-visible {
        outline: 2px solid var(--cobalt) !important; outline-offset: 2px;
    }
    .st-key-nav_top .stButton > button p { white-space: nowrap; font-size: 1.0rem; }
    /* Settings = gear only: keep the label for screen readers but hide it visually. */
    .st-key-navp_settings button p {
        position: absolute !important; width: 1px; height: 1px;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
    }
    .st-key-navp_settings button::before { font-size: 1.2rem; }

    /* -------- Header dropdowns: "Stats" and "Tools" (st.popover) --------
       Each menu is wrapped in a container keyed `navmenu_<slug>` (+ `_active` when one of
       its pages is open). The trigger looks exactly like a nav link; the `_active` variant
       adds the cobalt underline. The panel (portaled to <body>) is a small sub-page menu. */
    [class*="st-key-navmenu_"] [data-testid="stPopover"] button {
        background: transparent !important; color: var(--ink-2) !important;
        border: none !important; border-radius: 0 !important; box-shadow: none !important;
        padding: 0.45rem 0.3rem 0.5rem !important; font-weight: 600 !important;
        white-space: nowrap;
    }
    [class*="st-key-navmenu_"] [data-testid="stPopover"] button p { font-size: 1.0rem; }
    [class*="st-key-navmenu_"] [data-testid="stPopover"] button:hover {
        color: var(--ink) !important; background: transparent !important;
        transform: none !important; box-shadow: none !important;
    }
    [class*="st-key-navmenu_"][class*="_active"] [data-testid="stPopover"] button {
        color: var(--ink) !important; box-shadow: inset 0 -2px 0 var(--cobalt) !important;
    }
    /* dropdown panel = a clean menu of the sub-pages. BaseWeb anchors it at the trigger's
       top (inside the fixed header); nudge it down so it drops *below* the bar. A soft
       shadow gives it depth since it floats over content, not just a hairline border. */
    [data-testid="stPopoverBody"] {
        background: var(--card) !important; border: 1px solid var(--line) !important;
        border-radius: 12px !important; padding: 0.4rem !important; min-width: 168px !important;
        margin-top: 3.1rem !important;
        box-shadow: 0 10px 28px rgba(20,16,10,0.14), 0 2px 6px rgba(20,16,10,0.06) !important;
    }
    [data-testid="stPopoverBody"] [data-testid="stVerticalBlock"] { gap: 0.15rem !important; }
    /* Dropdown items are page_links (navigation links), styled to read like menu rows. */
    [data-testid="stPopoverBody"] [data-testid="stPageLink"] a {
        padding: 0.4rem 0.6rem !important; border-radius: 8px !important;
        color: var(--ink-2) !important; font-weight: 600 !important;
        text-decoration: none !important;
    }
    [data-testid="stPopoverBody"] [data-testid="stPageLink"] a p { font-size: 1.0rem !important; }
    [data-testid="stPopoverBody"] [data-testid="stPageLink"] a:hover {
        background: var(--surface-2) !important; color: var(--ink) !important;
    }
    [data-testid="stPopoverBody"] [data-testid="stPageLink"] a[aria-current="page"] {
        color: var(--cobalt) !important;
    }
    /* The button itself only sizes to its text unless forced wide, so left-align on its
       label had nothing to align against inside the (wider, centered) popover panel. */
    [data-testid="stPopoverBody"] [data-testid="stElementContainer"],
    [data-testid="stPopoverBody"] .stButton { width: 100% !important; }
    [data-testid="stPopoverBody"] .stButton > button {
        background: transparent !important; color: var(--ink-2) !important;
        border: none !important; box-shadow: none !important; border-radius: 8px !important;
        text-align: left !important; justify-content: flex-start !important;
        font-weight: 600 !important; padding: 0.55rem 0.8rem !important;
        width: 100% !important;
        transition: background 0.12s ease, color 0.12s ease;
    }
    [data-testid="stPopoverBody"] .stButton > button p { text-align: left; width: 100%; margin: 0; }
    [data-testid="stPopoverBody"] .stButton > button:hover {
        color: var(--ink) !important; background: var(--surface-2) !important;
        transform: none !important; box-shadow: none !important;
    }
    /* Active page: soft cobalt fill + bold ink text — no left bar (clashes with the
       menu's rounded corners; that treatment is for vertical rails, not floating menus). */
    [data-testid="stPopoverBody"] .stButton > button[kind="primary"],
    [data-testid="stPopoverBody"] .stButton [data-testid="stBaseButton-primary"] {
        color: var(--ink) !important; background: var(--cobalt-soft) !important;
        box-shadow: none !important; font-weight: 700 !important;
    }
    /* Streamlit auto-focuses the open item on every popover open (not just real keyboard
       navigation), so the generic `.stButton > button:focus-visible` ring shows up as an
       empty box around whichever item happens to be first/active — with no fill behind it
       (that's only added for the active/kind=primary item), it reads as a stray outline.
       Hover + the active cobalt-soft fill already give plenty of feedback; drop the ring. */
    [data-testid="stPopoverBody"] .stButton > button:focus-visible {
        outline: none !important;
        box-shadow: none !important;
    }

    /* -------- One horizontal row, capped to the page's content width, items spread ------
       max-width + margin:auto + page gutters make the row line up exactly with the
       centered page content below; space-between spreads brand · links · gear across it. */
    .st-key-nav_top [data-testid="stHorizontalBlock"] {
        flex-wrap: nowrap !important;
        max-width: var(--content-max);
        margin-left: auto !important; margin-right: auto !important;
        padding: 0 var(--page-pad);
        box-sizing: border-box;
        justify-content: space-between;
        overflow-x: auto;
        scrollbar-width: thin;              /* visible affordance in windowed desktop */
        -webkit-overflow-scrolling: touch;
    }
    /* Each link sizes to its own text at every width (never squished) and the whole nav
       stays LEFT-CLUSTERED (no growing spacer) — it doesn't stretch across the bar. The
       row scrolls sideways only if the cluster is wider than the viewport. */
    .st-key-nav_top [data-testid="stColumn"] {
        flex: 0 0 auto !important; width: auto !important; min-width: max-content !important;
    }

    /* ============ "This Week" side rail (Streamlit's native sidebar) ============
       Rendered only on This Week pages: a permanent 230px LEFT RAIL on desktop, and a
       fixed horizontal SUB-BAR under the header on phones. Holds the Week/Round picker +
       Matchup / Streamers / Bench / Roster. (Empty sidebar on other pages is hidden above.) */
    [data-testid="stSidebar"] {
        background: var(--surface-2); border-right: 1px solid var(--line);
    }
    @media (min-width: 768px) {
        /* permanent rail — force visible even if a session got stuck collapsed */
        [data-testid="stSidebar"]:has(.stButton) {
            transform: none !important; visibility: visible !important;
            min-width: 230px !important; width: 230px !important;
        }
    }
    /* Base (desktop-rail) styling for the picker + link buttons. Must come BEFORE the
       @media(max-width:767px) block below: both target the same selectors at identical
       specificity (all !important), so source order decides the tie — putting the mobile
       overrides LAST is what makes them win on phones instead of these desktop-only rules. */
    [data-testid="stSidebar"] .nav-scope-label { display: block; margin: 0.2rem 0 0.6rem; }
    /* Scoreboard (navw_1) leads the This Week rail at every width. The "This Week" label
       keeps a lower order so it stays pinned above the reordered buttons on desktop. */
    [data-testid="stSidebar"] [data-testid="stElementContainer"]:has(.nav-scope-label) { order: -5 !important; }
    [data-testid="stSidebar"] [class*="st-key-navw_1"] { order: -1 !important; }
    [data-testid="stSidebar"] [data-baseweb="select"] > div {
        background: var(--card) !important; border-radius: 8px !important;
        min-height: 2.1rem !important; font-family: var(--mono) !important; font-size: 0.8rem !important;
    }
    /* rail links: left-aligned, muted; active = cobalt inset bar */
    [data-testid="stSidebar"] .stButton > button {
        background: transparent !important; color: var(--ink-2) !important;
        border: none !important; box-shadow: none !important; border-radius: 6px !important;
        padding: 0.5rem 0.7rem !important; font-weight: 600 !important;
        text-align: left !important; justify-content: flex-start !important;
    }
    [data-testid="stSidebar"] .stButton > button p { white-space: nowrap; font-size: 0.9rem; width: 100%; text-align: left; }
    [data-testid="stSidebar"] .stButton > button:hover {
        color: var(--ink) !important; background: var(--cobalt-soft) !important;
        transform: none !important; box-shadow: none !important;
    }
    [data-testid="stSidebar"] .stButton > button[kind="primary"],
    [data-testid="stSidebar"] .stButton [data-testid="stBaseButton-primary"] {
        color: var(--ink) !important; background: var(--cobalt-soft) !important;
        box-shadow: inset 3px 0 0 var(--cobalt) !important;
    }
    [data-testid="stSidebar"] .stButton > button:focus-visible {
        outline: 2px solid var(--cobalt) !important; outline-offset: 2px;
    }

    @media (max-width: 767px) {
        /* becomes a fixed sub-bar pinned at the very top (no header on mobile; Streamlit's
           mobile drawer toggle is unreliable), items laid out in one swipeable row */
        [data-testid="stSidebar"]:has(.stButton) {
            /* top:0.5rem, not 0 - matches [data-testid=stMainBlockContainer]'s own
               padding-top on mobile (below), which is what actually positions the
               in-flow Season/Tools sub-row. Fixed elements ignore that padding entirely,
               so at top:0 this rail sat 8px higher than the sub-row it's meant to align
               with (same height, different Y position - a taller/shorter box wasn't
               the bug, a fixed-vs-in-flow top offset was). */
            position: fixed !important; top: 0.5rem !important;
            left: 0 !important; right: 0 !important;
            width: 100% !important; min-width: 0 !important; max-width: none !important;
            height: auto !important; transform: none !important; visibility: visible !important;
            z-index: 900 !important;
            /* Same plain page background as the other mobile sub-bars (.st-key-nav_sub) —
               not the tinted --surface-2 the desktop rail uses (that's a vertical-rail cue
               that reads as "boxed" in a horizontal bar). */
            background: var(--paper) !important;
            border-right: none !important; border-bottom: 1px solid var(--line) !important;
        }
        /* stSidebarContent carries its OWN default 20px horizontal padding (Streamlit's
           base sidebar style) — zero it here so stSidebarUserContent's padding below is
           the ONLY side gutter, matching nav_sub's single layer of padding exactly
           (the two were stacking, offsetting This Week's row ~20px further right than
           the Season/Tools sub-row). */
        [data-testid="stSidebar"] [data-testid="stSidebarContent"] {
            width: 100% !important; height: auto !important; padding: 0 !important;
        }
        /* Match nav_sub's shape: no top padding, small bottom padding, same side gutter. */
        [data-testid="stSidebar"] [data-testid="stSidebarUserContent"] { padding: 0 var(--page-pad) 0.3rem !important; }
        [data-testid="stSidebar"] [data-testid="stSidebarUserContent"] [data-testid="stVerticalBlock"] {
            flex-direction: row !important; align-items: center !important; flex-wrap: nowrap !important;
            overflow-x: auto !important; gap: 0.4rem !important; scrollbar-width: none;
        }
        [data-testid="stSidebar"] [data-testid="stSidebarUserContent"] [data-testid="stVerticalBlock"]::-webkit-scrollbar { display: none; }
        [data-testid="stSidebar"] [data-testid="stElementContainer"],
        [data-testid="stSidebar"] [data-testid="stLayoutWrapper"] { flex: 0 0 auto !important; width: auto !important; }
        /* Hide the WHOLE wrapping element, not just the inner label text — a hidden
           inner div still leaves its stElementContainer occupying its own box (~16px),
           throwing off the row's start x vs. the Season/Tools sub-row. Same "invisible
           element still consumes flex space" gotcha as elsewhere in this file. */
        [data-testid="stSidebar"] [data-testid="stElementContainer"]:has(.nav-scope-label) {
            display: none !important;
        }
        [data-testid="stSidebar"] [data-baseweb="select"] { min-width: 150px; }
        /* No forced min-height — let it size the same as the Season/Tools sub-row
           (same button padding already), so the two bars match exactly. */
        [data-testid="stSidebar"] .stButton > button { white-space: nowrap; }
        [data-testid="stSidebar"] [data-testid="stSidebarHeader"] { display: none !important; padding: 0 !important; height: 0 !important; }
        /* This Week pages: reserve room for the fixed sub-bar (pinned at top:0.5rem, so
           its bottom edge sits 0.5rem lower than the old top:0 - clearance grows to match). */
        [data-testid="stAppViewContainer"]:has([data-testid="stSidebar"] .stButton) [data-testid="stMainBlockContainer"] {
            padding-top: 3.9rem !important;
        }
        /* Match the other mobile sub-bars (Season / Tools, .st-key-nav_sub): plain text
           tabs, no box, no left inset bar — just a cobalt underline when active. Overrides
           the desktop rail's left-aligned/inset-bar look, which only makes sense vertically. */
        [data-testid="stSidebar"] .stButton > button {
            padding: 0.3rem 0.55rem !important; border-radius: 0 !important;
            text-align: center !important; justify-content: center !important;
        }
        [data-testid="stSidebar"] .stButton > button p { font-size: 0.82rem; text-align: center; }
        [data-testid="stSidebar"] .stButton > button:hover { background: transparent !important; }
        [data-testid="stSidebar"] .stButton > button[kind="primary"],
        [data-testid="stSidebar"] .stButton [data-testid="stBaseButton-primary"] {
            background: transparent !important;
            box-shadow: inset 0 -2px 0 var(--cobalt) !important;
        }
        /* Lighten the week picker to match the flatter mobile look. */
        [data-testid="stSidebar"] [data-baseweb="select"] > div {
            border: none !important; background: transparent !important;
        }
        /* ---- Mobile-only rename + reorder of the This Week rail tabs ----
           On a phone the "current matchup" numbers view (internal page "Scoreboard",
           button navw_1) is the primary Matchup tab, and the full-simulation page
           (internal "Matchup", navw_0) is "Projections". Desktop keeps the real labels
           and order (these rules live inside the max-width:767px block). Text is swapped
           via a zero-sized label + ::after replacement; order is flipped so the renamed
           "Matchup" (navw_1) sits first. */
        [data-testid="stSidebar"] [class*="st-key-navw_1"] { order: -1 !important; }
        [data-testid="stSidebar"] [class*="st-key-navw_0"] .stButton > button p,
        [data-testid="stSidebar"] [class*="st-key-navw_1"] .stButton > button p {
            font-size: 0 !important;
        }
        [data-testid="stSidebar"] [class*="st-key-navw_0"] .stButton > button p::after {
            content: "Projections"; font-size: 0.82rem;
        }
        [data-testid="stSidebar"] [class*="st-key-navw_1"] .stButton > button p::after {
            content: "Matchup"; font-size: 0.82rem;
        }
    }

    /* ============ Mobile-only section sub-row: the active section's pages ============ */
    /* Secondary nav for phones (the header is a single flat row and has no room). Hidden
       on desktop — desktop reaches every page from the one header row. */
    @media (min-width: 768px) { .st-key-nav_sub { display: none !important; } }
    .st-key-nav_sub {
        border-bottom: 1px solid var(--line);
        margin-bottom: 0.9rem; padding-bottom: 0.3rem;
    }
    .st-key-nav_sub [data-testid="stHorizontalBlock"] {
        flex-wrap: nowrap !important; align-items: center;
        overflow-x: auto; scrollbar-width: thin; -webkit-overflow-scrolling: touch;
    }
    .st-key-nav_sub [data-testid="stColumn"] {
        flex: 0 0 auto !important; width: auto !important; min-width: max-content !important;
    }
    .st-key-nav_sub .stButton > button {
        background: transparent !important; color: var(--ink-2) !important;
        border: none !important; box-shadow: none !important; border-radius: 0 !important;
        padding: 0.3rem 0.55rem !important; font-weight: 600 !important;
    }
    .st-key-nav_sub .stButton > button p { white-space: nowrap; font-size: 0.82rem; }
    .st-key-nav_sub .stButton > button:hover {
        color: var(--ink) !important; background: transparent !important;
        transform: none !important; box-shadow: none !important;
    }
    /* Active = just a cobalt underline, no background/box */
    .st-key-nav_sub .stButton > button[kind="primary"],
    .st-key-nav_sub .stButton [data-testid="stBaseButton-primary"] {
        color: var(--ink) !important; background: transparent !important;
        box-shadow: inset 0 -2px 0 var(--cobalt) !important;
    }
    .st-key-nav_sub [data-baseweb="select"] > div {
        background: var(--card) !important; border-radius: 8px !important;
        min-height: 2.1rem !important; font-family: var(--mono) !important; font-size: 0.8rem !important;
    }
    .st-key-nav_sub [data-baseweb="select"] { min-width: 150px; }

    /* ================= Mobile bottom bar: one icon per section ================= */
    /* Desktop hides it; mobile shows a fixed bottom tab bar (icon over label). */
    @media (min-width: 768px) { .st-key-nav_bottom { display: none !important; } }
    @media (max-width: 767px) {
        /* No top header on mobile — navigation is the fixed bottom icon bar. The whole top
           bar is hidden; content starts near the top and only reserves room for the bottom
           bar (stMain is position:absolute on mobile, so pad the block container directly). */
        .st-key-nav_top { display: none !important; }
        [data-testid="stMainBlockContainer"] {
            padding-top: 0.5rem !important;
            padding-bottom: calc(var(--bottomnav-h) + 1rem) !important;
        }

        .st-key-nav_bottom {
            position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000;
            height: var(--bottomnav-h);
            background: var(--header-bg);
            border-top: 1px solid var(--line);
            box-shadow: 0 -6px 18px rgba(20,16,10,0.06);
            padding: 0 0.2rem; box-sizing: border-box;
            display: flex; align-items: stretch;
        }
        .st-key-nav_bottom [data-testid="stLayoutWrapper"],
        .st-key-nav_bottom > div:first-child { width: 100%; }
        .st-key-nav_bottom [data-testid="stHorizontalBlock"] {
            width: 100%; flex-wrap: nowrap !important; gap: 0 !important;
        }
        .st-key-nav_bottom [data-testid="stColumn"] { flex: 1 1 0 !important; min-width: 0 !important; }
        .st-key-nav_bottom .stButton > button {
            display: flex !important; flex-direction: column;
            align-items: center; justify-content: center; gap: 3px;
            min-height: var(--bottomnav-h); padding: 0.3rem 0 !important;
            background: transparent !important; color: var(--ink-3) !important;
            border: none !important; border-radius: 0 !important; box-shadow: none !important;
        }
        .st-key-nav_bottom .stButton > button:hover { transform: none !important; box-shadow: none !important; }
        /* bigger icons, muted until the section is active (mask icons: paint via background-color) */
        .st-key-nav_bottom .stButton > button::before {
            width: 1.5rem; height: 1.5rem; background-color: var(--ink-3);
        }
        .st-key-nav_bottom .stButton > button p {
            font-size: 0.6rem !important; font-weight: 600; white-space: nowrap; line-height: 1;
        }
        .st-key-nav_bottom .stButton > button[kind="primary"] { color: var(--cobalt) !important; }
        .st-key-nav_bottom .stButton > button[kind="primary"]::before { background-color: var(--cobalt) !important; }
        .st-key-nav_bottom .stButton > button[kind="primary"] p { color: var(--cobalt) !important; }

        /* Season Summary metric tiles: two per row instead of four cramped columns. */
        .st-key-ss_metrics [data-testid="stHorizontalBlock"] { flex-wrap: wrap !important; }
        .st-key-ss_metrics [data-testid="stColumn"] {
            flex: 1 1 46% !important; min-width: 46% !important; width: 46% !important;
        }
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

    /* Season Summary standings table: a plain HTML table (not the dataframe grid), so it
       doesn't inherit the dataframe scrollbar CSS below - give it the same visible
       horizontal scrollbar explicitly. Without one, a table wider than the phone screen
       just reads as silently cut off (no visible affordance that swiping scrolls it). */
    .ss-standings-scroll::-webkit-scrollbar { height: 10px; }
    .ss-standings-scroll::-webkit-scrollbar-thumb {
        background: var(--line-strong); border-radius: 5px;
    }
    .ss-standings-scroll::-webkit-scrollbar-track { background: transparent; }

    /* ======= Player Value: DESKTOP table vs MOBILE compact list (both rendered) =======
       A 20+ column sortable grid is unusable on a phone (endless horizontal scroll, the
       Value buried). Same both-rendered-CSS-toggle pattern as the Home layouts: desktop
       gets the filterable table, mobile gets a compact value list segmented by owner. */
    .st-key-pv_mobile { display: none; }
    @media (max-width: 767px) {
        .st-key-pv_desktop { display: none !important; }
        .st-key-pv_mobile { display: block; }
        /* Segmented owner switch: three tabs on ONE horizontal row that fill the width but
           never clip their label. The baseweb button-group is already a flex row; using
           flex-basis:auto (flex:1 1 auto) sizes each tab from its TEXT first, then grows to
           share the row - so "Free Agents" keeps its full width instead of being squeezed
           into an equal third and ellipsized. Force the inner label visible (no clip). */
        /* Mobile Player Value controls: two dropdowns (value basis + owner) and the injury
           toggle on ONE row. The st-key-pv_ctrl class sits directly ON the stVerticalBlock
           (already display:flex), so flip THAT to a row; its three direct children are the
           two selectbox containers and the toggle container. The selectboxes share the
           width (flex:1); the toggle stays compact on the right. */
        .st-key-pv_ctrl {
            flex-direction: row !important; align-items: center !important;
            flex-wrap: nowrap !important; gap: 0.4rem !important; margin-bottom: 0.75rem !important;
        }
        /* Two equal-width dropdowns + compact toggle. A smaller label font (and tight inner
           padding) is what actually lets "Free Agents" fit its box without ellipsis. */
        .st-key-pv_ctrl > [class*="st-key-pv_valuemode"],
        .st-key-pv_ctrl > [class*="st-key-pv_seg"] { flex: 1 1 0 !important; min-width: 0 !important; }
        .st-key-pv_ctrl > [class*="st-key-pv_show_injured"] { flex: 0 0 auto !important; width: auto !important; }
        .st-key-pv_valuemode [data-baseweb="select"],
        .st-key-pv_seg [data-baseweb="select"] { min-width: 0 !important; }
        .st-key-pv_valuemode [data-baseweb="select"] *,
        .st-key-pv_seg [data-baseweb="select"] * { font-size: 0.8rem !important; }
        .st-key-pv_valuemode [data-baseweb="select"] > div,
        .st-key-pv_seg [data-baseweb="select"] > div { min-height: 2.3rem !important; padding-left: 0.3rem !important; }
        /* Reclaim room: hide the injury help "?" icon on mobile (its label already reads
           "Injured", and the tooltip is desktop-hover only anyway). */
        .st-key-pv_show_injured [data-testid="stTooltipIcon"] { display: none !important; }
        /* Kill the big empty band at the top of the (heading-less) Player Value page:
           pull the first control row up under the Tools sub-row. */
        .st-key-pv_mobile { margin-top: -1.9rem !important; }
        /* Smaller toggle switch + tighter label so it fits beside the two dropdowns. */
        .st-key-pv_show_injured [data-testid="stCheckbox"] label > div:first-child {
            transform: scale(0.8); transform-origin: center;
        }
        .st-key-pv_show_injured [data-testid="stCheckbox"] label { gap: 0.15rem !important; }
        .st-key-pv_show_injured [data-testid="stWidgetLabel"] p { font-size: 0.72rem !important; white-space: nowrap; }
    }
    /* The compact list itself (raw HTML, so it renders the same on desktop preview too,
       but the container is hidden there). Each row is a native <details> disclosure. */
    .pv-list { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--card); }
    .pv-item { border-bottom: 1px solid var(--line-2); }
    .pv-item:last-child { border-bottom: none; }
    .pv-item[open] { background: var(--surface-2); }
    .pv-sum {
        position: relative; display: flex; align-items: center; gap: 0.5rem;
        padding: 0.5rem 0.7rem; cursor: pointer; list-style: none; overflow: hidden;
    }
    .pv-sum::-webkit-details-marker { display: none; }
    .pv-fill { position: absolute; left: 0; top: 0; bottom: 0; opacity: 0.14; z-index: 0; }
    .pv-sum > span:not(.pv-fill), .pv-detail { position: relative; z-index: 1; }
    .pv-rank { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); min-width: 1.5rem; }
    .pv-name {
        flex: 1 1 auto; min-width: 0; font-weight: 600; color: var(--ink); font-size: 0.9rem;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pv-meta { color: var(--ink-3); font-size: 0.64rem; white-space: nowrap; }
    .pv-val { font-family: var(--mono); font-weight: 700; font-size: 0.92rem; min-width: 2.8rem; text-align: right; }
    .pv-trend { font-size: 0.68rem; min-width: 0.9rem; text-align: center; }
    .pv-trend.up { color: var(--good); }
    .pv-trend.down { color: var(--bad); }
    .pv-trend.flat { color: var(--ink-3); }
    /* Expanded ESPN-style player card: headshot + identity header, a stat-tile grid, then
       percentage and trend rows. */
    .pv-detail { padding: 0.5rem 0.7rem 0.7rem; }
    .pv-card { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.6rem; }
    .pv-shot {
        flex: 0 0 auto; width: 58px; height: 58px; border-radius: 50%;
        background-size: cover; background-position: top center;
        background-color: var(--surface-2); border: 1px solid var(--line);
    }
    .pv-chead { min-width: 0; }
    .pv-cname { font-family: system-ui, 'Segoe UI', sans-serif; font-weight: 700; font-size: 1rem; color: var(--ink); line-height: 1.1; }
    /* Team - position line, with the OUT / FA badges inline on the same row. */
    .pv-csub {
        display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem;
        font-family: system-ui, sans-serif; font-size: 0.72rem; color: var(--ink-2); margin-top: 0.2rem;
    }
    .pv-statgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.35rem; }
    .pv-stat {
        display: flex; flex-direction: column; align-items: center;
        background: var(--card); border: 1px solid var(--line-2); border-radius: 6px; padding: 0.3rem 0.1rem;
    }
    .pv-stat-l { font-family: system-ui, sans-serif; font-size: 0.56rem; color: var(--ink-3); letter-spacing: 0.03em; }
    .pv-stat-v { font-family: var(--mono); font-weight: 700; font-size: 0.82rem; color: var(--ink); margin-top: 0.1rem; }
    .pv-cardrow { display: flex; gap: 0.9rem; font-family: var(--mono); font-size: 0.72rem; color: var(--ink); padding-top: 0.15rem; }
    .pv-cardrow b { color: var(--ink-3); font-weight: 600; }
    /* Availability badge + FA chip on the summary row. */
    .pv-badge {
        flex: 0 0 auto; font-family: system-ui, sans-serif; font-weight: 700; font-size: 0.56rem;
        letter-spacing: 0.03em; padding: 0.08rem 0.34rem; border-radius: 999px; white-space: nowrap;
    }
    .pv-badge.out { background: rgba(192, 57, 43, 0.14); color: var(--bad); }
    .pv-badge.day { background: rgba(224, 106, 59, 0.16); color: var(--clay); }
    .pv-fa {
        flex: 0 0 auto; font-family: system-ui, sans-serif; font-weight: 700; font-size: 0.54rem;
        letter-spacing: 0.04em; padding: 0.06rem 0.3rem; border-radius: 4px; white-space: nowrap;
        background: var(--cobalt-soft); color: var(--cobalt);
    }
    /* Desktop Player Value: the same player cards as mobile, stacked ONE PER ROW (full
       width), each its own bordered card (pv_desktop is hidden on phones, so this never
       touches the mobile single-column list). */
    .st-key-pv_desktop .pv-list {
        display: flex; flex-direction: column; gap: 0.5rem;
        border: none; background: none; border-radius: 0;
    }
    .st-key-pv_desktop .pv-item {
        border: 1px solid var(--line) !important; border-radius: 10px;
        background: var(--card); overflow: hidden;
    }
    /* Keep the desktop injury toggle's label on one line so the filter row never wraps. */
    .st-key-pv_show_injured_d [data-testid="stWidgetLabel"] p { white-space: nowrap; }
    /* With one full-width card per row, the desktop has room for a larger card: a bigger
       summary row, a larger headshot/name, all eight stat tiles on ONE row, and bigger
       figures + game-log text. */
    .st-key-pv_desktop .pv-sum { padding: 0.6rem 1.1rem; }
    .st-key-pv_desktop .pv-name { font-size: 1.02rem; }
    .st-key-pv_desktop .pv-val { font-size: 1.05rem; min-width: 3.2rem; }
    .st-key-pv_desktop .pv-rank { font-size: 0.8rem; min-width: 2rem; }
    .st-key-pv_desktop .pv-detail { padding: 0.5rem 1.1rem 1rem; }
    .st-key-pv_desktop .pv-card { gap: 1rem; margin-bottom: 0.9rem; }
    .st-key-pv_desktop .pv-shot { width: 88px; height: 88px; }
    .st-key-pv_desktop .pv-cname { font-size: 1.35rem; }
    .st-key-pv_desktop .pv-csub { font-size: 0.82rem; margin-top: 0.3rem; }
    .st-key-pv_desktop .pv-statgrid { grid-template-columns: repeat(8, 1fr); gap: 0.5rem; margin-bottom: 0.7rem; }
    .st-key-pv_desktop .pv-stat { padding: 0.55rem 0.2rem; border-radius: 8px; }
    .st-key-pv_desktop .pv-stat-l { font-size: 0.64rem; }
    .st-key-pv_desktop .pv-stat-v { font-size: 1.15rem; margin-top: 0.2rem; }
    .st-key-pv_desktop .pv-gl { margin-top: 0.7rem; padding-top: 0.6rem; }
    .st-key-pv_desktop .pv-gl-sum { font-size: 0.82rem; }
    .st-key-pv_desktop .pv-gl-tbl { font-size: 0.78rem; }
    .st-key-pv_desktop .pv-gl-tbl th { font-size: 0.62rem; padding: 4px 10px; }
    .st-key-pv_desktop .pv-gl-tbl td { padding: 4px 10px; }
    /* Team-position line: meta text can shrink; the OUT/FA badges keep their own nowrap
       flex group so they always sit side-by-side (gapped), never stacked/overlapping. */
    .pv-cmeta { flex: 0 1 auto; min-width: 0; }
    .pv-badges { display: inline-flex; align-items: center; gap: 0.3rem; flex: 0 0 auto; }
    /* Per-card "Last 10 games" disclosure + table. */
    .pv-gl { margin-top: 0.55rem; border-top: 1px solid var(--line-2); padding-top: 0.45rem; }
    .pv-gl-sum {
        cursor: pointer; list-style: none; font-family: system-ui, sans-serif;
        font-size: 0.72rem; font-weight: 600; color: var(--cobalt);
    }
    .pv-gl-sum::-webkit-details-marker { display: none; }
    /* Chevron drawn from two borders (no font glyph, so it can't render as a box): points
       right when closed, rotates down when the log opens. */
    .pv-gl-sum::before {
        content: ""; display: inline-block; width: 0.36rem; height: 0.36rem;
        border-right: 2px solid currentColor; border-bottom: 2px solid currentColor;
        transform: rotate(-45deg); transform-origin: center;
        margin-right: 0.5rem; position: relative; top: -2px; transition: transform .15s;
    }
    .pv-gl[open] .pv-gl-sum::before { transform: rotate(45deg); top: -3px; }
    .pv-gl-body { margin-top: 0.4rem; overflow-x: auto; }
    .pv-gl-tbl { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 0.64rem; }
    .pv-gl-tbl th {
        color: var(--ink-3); font-weight: 600; text-align: right; padding: 2px 5px;
        text-transform: uppercase; font-size: 0.55rem; white-space: nowrap;
    }
    .pv-gl-tbl td { color: var(--ink); text-align: right; padding: 2px 5px; white-space: nowrap; border-top: 1px solid var(--line-2); }
    .pv-gl-tbl th:first-child, .pv-gl-tbl td:first-child,
    .pv-gl-tbl th:nth-child(2), .pv-gl-tbl td:nth-child(2) { text-align: left; }
    .pv-gl-tbl td.pv-gl-w { color: var(--good); font-weight: 600; }
    .pv-gl-tbl td.pv-gl-l { color: var(--bad); font-weight: 600; }

    /* -------- Compare two players: head-to-head with diverging bars from the center ----
       [A value] [A bar >|] LABEL [|< B bar] [B value]. Base sizes are the desktop (roomy)
       version; the @media(max-width:767px) block near the bottom shrinks it for phones. */
    .st-key-pv_cmp_pickers { max-width: 920px; margin: 0 auto; }
    .pv-cmp { max-width: 920px; margin: 0.6rem auto 0; }
    .pv-cmp-head { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
    .pv-cmp-player { text-align: center; min-width: 0; }
    .pv-cmp-player .pv-shot { margin: 0 auto 0.5rem; width: 96px; height: 96px; }
    .pv-cmp-name {
        font-family: system-ui, 'Segoe UI', sans-serif; font-weight: 700; font-size: 1.4rem;
        color: var(--ink); line-height: 1.15; overflow-wrap: anywhere;
    }
    .pv-cmp-sub { justify-content: center; font-size: 0.8rem; }
    .pv-cmp-row {
        display: grid; grid-template-columns: 3.7rem 1fr auto 1fr 3.7rem; align-items: center;
        gap: 0.9rem; padding: 0.6rem 0; border-top: 1px solid var(--line-2);
    }
    .pv-cmp-a { text-align: right; font-family: var(--mono); font-weight: 700; font-size: 1.15rem; color: var(--ink); white-space: nowrap; }
    .pv-cmp-b { text-align: left; font-family: var(--mono); font-weight: 700; font-size: 1.15rem; color: var(--ink); white-space: nowrap; }
    .pv-cmp-lbl {
        text-align: center; font-family: system-ui, sans-serif; font-size: 0.68rem;
        letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); min-width: 3.6rem;
    }
    .pv-cmp-win { color: var(--good) !important; }
    .pv-cmp-bar { height: 10px; border-radius: 5px; background: var(--surface-2); display: flex; overflow: hidden; }
    .pv-cmp-bar-a { justify-content: flex-end; }   /* A fill hugs the center label, grows left */
    .pv-cmp-bar-b { justify-content: flex-start; } /* B fill hugs the center label, grows right */
    .pv-cmp-fill { height: 100%; border-radius: 5px; }
    .pv-cmp-bar-a .pv-cmp-fill { background: var(--cobalt); }
    .pv-cmp-bar-b .pv-cmp-fill { background: var(--clay); }
    .pv-cmp-logs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem 2rem; margin-top: 1rem; }
    .pv-cmp-logs .pv-gl-tbl { font-size: 0.72rem; }
    @media (max-width: 767px) {
        /* Drop the page heading on phones (the "Compare" nav tab already labels it) and
           pull the pickers up under the Tools sub-row so there's no empty band. */
        .st-key-pv_cmp_title { display: none !important; }
        .st-key-pv_cmp_pickers { margin-top: -1.9rem !important; }
        .pv-cmp-player .pv-shot { width: 68px; height: 68px; }
        .pv-cmp-name { font-size: 1rem; }
        .pv-cmp-sub { font-size: 0.72rem; }
        .pv-cmp-row { grid-template-columns: 2.9rem 1fr auto 1fr 2.9rem; gap: 0.4rem; padding: 0.4rem 0; }
        .pv-cmp-a, .pv-cmp-b { font-size: 0.88rem; }
        .pv-cmp-lbl { font-size: 0.56rem; min-width: 2.6rem; }
        .pv-cmp-bar { height: 7px; }
        .pv-cmp-logs { grid-template-columns: 1fr; }
        .pv-cmp-logs .pv-gl-tbl { font-size: 0.64rem; }
    }

    /* -------- Player Search: full one-player profile -------- */
    .st-key-pd_search { max-width: 860px; margin: 0 auto; }
    .pd { max-width: 860px; margin: 0.6rem auto 0; }
    /* Identity header: headshot + name, full team - # - position, availability + owner. */
    .pd-head { display: flex; align-items: center; gap: 1.3rem; margin-bottom: 0.9rem; }
    .pd-head .pv-shot { flex: 0 0 auto; width: 100px; height: 100px; }
    .pd-id { min-width: 0; }
    .pd-name { font-family: system-ui, 'Segoe UI', sans-serif; font-weight: 800; font-size: 1.7rem; color: var(--ink); line-height: 1.1; overflow-wrap: anywhere; }
    .pd-team { font-family: system-ui, sans-serif; font-size: 0.95rem; color: var(--ink-2); margin-top: 0.25rem; }
    .pd-status {
        display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem;
        font-family: system-ui, sans-serif; font-size: 0.8rem; color: var(--ink-2); margin-top: 0.35rem;
    }
    .pd-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 0.15rem; }
    .pd-dot.ok { background: var(--good); } .pd-dot.out { background: var(--bad); } .pd-dot.day { background: var(--clay); }
    .pd-owner { color: var(--ink-3); } .pd-owner b { color: var(--ink); }
    /* Bio facts row (label over value), between hairlines. */
    .pd-bio {
        display: flex; flex-wrap: wrap; gap: 1.1rem 2.2rem; padding: 0.8rem 0.1rem; margin-bottom: 1.1rem;
        border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
    }
    .pd-bio-f { display: flex; flex-direction: column; }
    .pd-bl { font-family: system-ui, sans-serif; font-size: 0.58rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }
    .pd-bv { font-family: system-ui, sans-serif; font-size: 0.9rem; font-weight: 600; color: var(--ink); margin-top: 0.15rem; }
    /* Value tiles (kept). */
    .pd-values { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; margin-bottom: 1.1rem; }
    .pd-vtile {
        display: flex; flex-direction: column; align-items: center; text-align: center;
        background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 0.7rem 0.4rem;
    }
    .pd-vl { font-family: system-ui, sans-serif; font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
    .pd-vv { font-family: var(--mono); font-weight: 700; font-size: 1.5rem; margin: 0.1rem 0; }
    .pd-vr { font-family: var(--mono); font-size: 0.66rem; color: var(--ink-3); }
    /* Section header + clean two-column season-averages sheet (no tiles). */
    .pd-sec { font-family: system-ui, sans-serif; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); margin: 0.2rem 0 0.4rem; }
    .pd-sec span { color: var(--ink-3); font-weight: 500; letter-spacing: 0; text-transform: none; font-size: 0.72rem; }
    .pd-stats { display: grid; grid-template-columns: 1fr 1fr; column-gap: 2.6rem; margin-bottom: 1.1rem; }
    .pd-stat { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; padding: 0.5rem 0.15rem; border-bottom: 1px solid var(--line-2); }
    .pd-sl { font-family: system-ui, sans-serif; font-size: 0.82rem; color: var(--ink-2); }
    .pd-sv { font-family: var(--mono); font-weight: 700; font-size: 0.98rem; color: var(--ink); }
    @media (max-width: 767px) {
        .pd-head { gap: 0.9rem; }
        .pd-head .pv-shot { width: 78px; height: 78px; }
        .pd-name { font-size: 1.3rem; }
        .pd-vv { font-size: 1.3rem; }
        .pd-stats { grid-template-columns: 1fr; column-gap: 0; }
    }

    /* -------- Matchup header: team · Week/Round picker · team, always ONE line -------
       Streamlit's blanket mobile rule stacks stColumns to 100% width (one per row); this
       row is explicitly kept horizontal at every width, with each team name truncated by
       ellipsis (not wrapped) so a long name can't blow out the row height. */
    .st-key-matchup_header [data-testid="stHorizontalBlock"] { flex-wrap: nowrap !important; }
    .st-key-matchup_header [data-testid="stColumn"] { width: auto !important; min-width: 0 !important; }
    /* Picker gets its own full-width row (centered) — its text doesn't ellipsis-safely
       truncate, so it needs room free of any neighbor. Team names sit in a second row
       below, each now getting ~50% of the width instead of splitting it with the picker. */
    .st-key-matchup_header [data-baseweb="select"] { max-width: 260px; margin: 0 auto 0.5rem; }
    .st-key-matchup_header h3.mh-name {
        margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .st-key-matchup_header h3.mh-name-right { text-align: right; }
    .st-key-matchup_header [data-baseweb="select"] > div {
        background: transparent !important; border: none !important;
    }
    .st-key-matchup_header [data-baseweb="select"] input,
    .st-key-matchup_header [data-baseweb="select"] > div > div {
        color: var(--cobalt) !important; font-weight: 700 !important; text-align: center;
        font-size: 1.08rem !important;
    }
    /* The date-range caption under the header is dropped on mobile — too much small
       text clutter on a narrow screen; the date range still shows in the table below. */
    @media (max-width: 767px) { .st-key-matchup_caption { display: none !important; } }

    /* Matchup "Key Metrics": desktop keeps the original 5-across st.metric row (incl.
       Simulations); mobile drops Simulations and shows the remaining 4 as plain
       st.metric cards, 2x2 (the existing mobile stMetric wrap rule below handles the
       2-up layout) - same both-rendered-CSS-toggles-visibility pattern as
       .st-key-home_desktop/_mobile. */
    .st-key-matchup_metrics_mobile { display: none; }
    @media (max-width: 767px) {
        .st-key-matchup_metrics_desktop { display: none !important; }
        /* flex, not block: this container's children (two st.columns rows) rely on
           Streamlit's own flex `gap` for spacing between them - `gap` is a no-op on a
           block container, which was silently collapsing all spacing between the rows
           to zero (the reported "overlapping" cards). */
        .st-key-matchup_metrics_mobile { display: flex !important; flex-direction: column; }
    }

    /* Season Stats "Team Season Totals": desktop keeps the 4x2 st.metric card grid;
       mobile gets a compact strip instead - 8 full 116px-tall bordered cards pushed the
       actual content (the player tables) well below the fold on a phone. */
    .st-key-ss_totals_mobile { display: none; }
    @media (max-width: 767px) {
        .st-key-ss_totals_desktop { display: none !important; }
        .st-key-ss_totals_mobile { display: block; }
    }
    .ss-strip {
        display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 1.2rem;
        background: var(--card); border: 1px solid var(--line); border-radius: 10px;
        padding: 0.2rem 0.9rem; margin-bottom: 0.5rem;
    }
    /* Season Stats player tables: desktop keeps both tables (Season Totals + Per Game
       Average) stacked with one "Show" stat-group picker; mobile shows only one table
       at a time (default Per Game) via its own "View" picker next to "Show" - two full
       tables stacked was too much scrolling on a phone. display:flex (not block) here
       for the same reason as .st-key-matchup_metrics_mobile above: these containers'
       children rely on Streamlit's own flex `gap` for spacing, which is a no-op once a
       container is display:block. */
    .st-key-ss_tables_mobile { display: none; }
    @media (max-width: 767px) {
        .st-key-ss_tables_desktop { display: none !important; }
        .st-key-ss_tables_mobile { display: flex !important; flex-direction: column; }
        /* The blanket mobile rule below stacks every st.columns row to one column per
           row (100% width) - override just this one, so "View" and "Show" stay side by
           side as asked ("a dropdown to the left of the show dropdown"), not stacked. */
        .st-key-ss_picker_row [data-testid="stHorizontalBlock"] { flex-wrap: nowrap !important; gap: 0.6rem !important; }
        .st-key-ss_picker_row [data-testid="stColumn"] {
            width: 50% !important; flex: 1 1 50% !important; min-width: 0 !important;
        }
    }
    .ss-strip-item {
        display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;
        padding: 0.55rem 0; border-bottom: 1px solid var(--line-2);
    }
    .ss-strip-item:nth-last-child(-n+2) { border-bottom: none; }
    .ss-strip-label { color: var(--ink-2); font-size: 0.76rem; min-width: 0; }
    .ss-strip-value {
        font-family: var(--mono); font-variant-numeric: tabular-nums;
        font-weight: 700; color: var(--ink); font-size: 0.9rem; white-space: nowrap;
    }
    /* League-rank chip next to each season total (e.g. "#1"). */
    .ss-strip-rank {
        margin-left: 0.4rem; font-family: var(--mono); font-weight: 600;
        font-size: 0.66rem; color: var(--ink-3);
    }
    /* Desktop totals cards show the league rank as the metric's (color-off) delta line.
       Streamlit still draws an up/down arrow glyph there even for a plain rank string -
       drop it, so "#10 of 10" doesn't read as "up". */
    .st-key-ss_totals_desktop [data-testid="stMetricDelta"] svg { display: none; }
    .st-key-ss_totals_desktop [data-testid="stMetricDelta"] { gap: 0; }

    /* Top Contributors leader cards: a responsive grid - TWO per row on phones, four on
       desktop - instead of Streamlit columns (which collapse to one-per-row on mobile).
       Order: Points/FGM, Rebounds/Assists, Steals/Blocks, 3PM/DD. The `> div` rule zeroes
       _leader_card's own inline margin-bottom so the grid `gap` is the only spacing. */
    .leader-grid {
        display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; margin-top: 0.2rem;
    }
    @media (min-width: 768px) { .leader-grid { grid-template-columns: repeat(4, 1fr); } }
    .leader-grid > div { margin-bottom: 0 !important; height: 100%; }

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
        /* Any row of st.metric tiles (Season Stats, League Stats, etc.) wraps 2-up instead
           of stacking one-per-screen — same treatment as the Season Summary metric row. More
           specific than the blanket column rule above, so it wins despite both !important. */
        [data-testid="stHorizontalBlock"]:has([data-testid="stMetric"]) { flex-wrap: wrap !important; }
        [data-testid="stHorizontalBlock"]:has([data-testid="stMetric"]) [data-testid="stColumn"] {
            flex: 1 1 46% !important; width: 46% !important; min-width: 46% !important;
        }
        .dataframe { font-size: 0.75rem !important; }
        .dataframe th, .dataframe td { padding: 4px 6px !important; }
        .js-plotly-plot { max-width: 100% !important; }
        /* Scoreboard header (team names + W-L-T score): the "sb-name" spans already
           truncate with an ellipsis instead of wrapping (min-width:0 on their flex
           parent + white-space:nowrap in visualizations.py), but still shrink the type
           so a long team name gets more characters before it has to truncate. */
        .scoreboard-header { gap: 0.35rem !important; }
        .sb-name { font-size: 1rem !important; }
        .sb-score-main { font-size: 1.7rem !important; }
        .sb-score-sub { font-size: 0.85rem !important; margin-left: 0.5rem !important; }
        .st-key-matchup_header h3.mh-name { font-size: 0.92rem !important; }
        .st-key-matchup_header [data-baseweb="select"] input,
        .st-key-matchup_header [data-baseweb="select"] > div > div { font-size: 0.9rem !important; }
    }
    @media screen and (max-width: 480px) {
        .main-header { font-size: 1.2rem !important; }
        .win-pct { font-size: 2rem; }
        .hide-mobile { display: none !important; }
        .dataframe { font-size: 0.66rem !important; }
        .stButton > button { padding: 0.5rem 1rem !important; font-size: 0.9rem !important; }
        .sb-name { font-size: 0.9rem !important; }
        .sb-score-main { font-size: 1.4rem !important; }
        .sb-score-sub { font-size: 0.72rem !important; margin-left: 0.35rem !important; }
        .st-key-matchup_header h3.mh-name { font-size: 0.78rem !important; }
        .st-key-matchup_header h3.mh-name .bi { font-size: 0.85em; }
        .st-key-matchup_header [data-baseweb="select"] input,
        .st-key-matchup_header [data-baseweb="select"] > div > div { font-size: 0.78rem !important; }
    }
</style>
"""
