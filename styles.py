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
    .st-key-navb_home button::before,     .st-key-navp_settings button::before {
        content: ""; display: inline-block; flex: none;
        width: 1.05rem; height: 1.05rem;
        background-color: var(--cobalt);
        -webkit-mask: var(--nav-ic) center / contain no-repeat;
                mask: var(--nav-ic) center / contain no-repeat;
    }
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
