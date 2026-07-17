# AGENTS.md — guide for AI coding agents

This file orients an AI agent (Claude Code, etc.) working in this repo. Read it
before making changes. Human-facing setup lives in [README.md](README.md).

## What this project is

A **Streamlit web app** that runs **Monte Carlo simulations** for an ESPN Fantasy
Basketball league (head-to-head, category scoring). It pulls live data from ESPN
via the `espn-api` package, projects the rest of a matchup week, and reports win
probability, category breakdowns, streamer pickups, bench decisions, league
standings, and playoff/championship odds.

Single owner, single league. It is a personal tool, not a product — favor clarity
and correctness over generality.

## Repo map

| File | Role |
|------|------|
| [streamlit_app.py](streamlit_app.py) | UI entry point. `main()`, the section nav (`render_top_nav` + `NAV_SECTIONS`), the per-page `if active_page == …` bodies, the Home landing, Season Summary, and Settings. Orchestrates everything. |
| [data.py](data.py) | ESPN connection, roster/matchup/box-score fetch, NBA schedule scraping, and **games-left counting** (injury-aware, IR-aware, 10-per-day cap). |
| [simulation.py](simulation.py) | Simulation engine: per-team category sim, matchup comparison, streamer analysis, bench strategy, league stats, playoff bracket. |
| [visualizations.py](visualizations.py) | Plotly charts + the scoreboard HTML. All chart colors live here. |
| [config.py](config.py) | Constants **and ESPN credentials** (league id, cookies, default team), plus category variance and NBA team maps. |
| [styles.py](styles.py) | The "Analyst Sheet" design system as one big CSS string (`CUSTOM_CSS`), including the fixed-header / centered-column layout shell. Light-only (no `DARK_CSS`). |
| [assets/icon_font.py](assets/icon_font.py) | **Self-hosted Bootstrap Icons** — the font subset to the ~37 glyphs the app uses, base64-embedded as `@font-face` (`ICON_FONT_CSS`, imported as `from assets.icon_font import …`). Injected separately so it can never render-block the layout. Regenerate with [assets/build_icon_font.py](assets/build_icon_font.py) if the icon set changes. |
| [assets/touch_icon.py](assets/touch_icon.py) | Base64 PNG of the basketball mark (`TOUCH_ICON_PNG_B64`), injected via `components.html` as an `apple-touch-icon` `<link>` so "Add to Home Screen" shows the app's logo instead of Streamlit's default. Regenerate the PNG with the Pillow snippet in its docstring/history if the mark changes. |
| [.streamlit/config.toml](.streamlit/config.toml) | Streamlit's native light theme (must match `styles.py`). |
| [.streamlit/secrets.toml](.streamlit/secrets.toml) | Template only — real creds are in `config.py`. |
| `Old Models/` | The original single-file version. Historical reference; do not edit or import. |

## Run & verify

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Quick smoke test an agent can run (boots the app, checks health, then stops):

```bash
streamlit run streamlit_app.py --server.headless true --server.port 8599 &
sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8599/_stcore/health
# stop it — on Windows `pkill` is unavailable; use PowerShell:
#   Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
#     ? { $_.CommandLine -like '*port 8599*' } | % { Stop-Process -Id $_.ProcessId -Force }
```

`py_compile` every module you touch. **For anything visual — the fixed header,
centered column, the left rail, table scroll, "does it fit without scrolling" —
verify in a real browser: Selenium is installed (`webdriver.Edge`, headless).**
Drive the running app, click nav buttons by text, and read geometry with
`execute_script` (element `getBoundingClientRect`, computed styles) or
`save_screenshot`; that is how the current layout was validated. Health 200 alone
only proves it booted. Note: ESPN's data-backed pages (champion/standings/matchup)
need the server-side fetch to succeed — in a sandbox without ESPN reachability the
default **Home** page renders but data pages stay empty, so measure on the page you
actually care about. The ESPN data path can also be exercised directly in a script
via `data.connect_to_espn(...)` using the constants in `config.py`.

## Configuration — creds stay in code, not the UI

ESPN connection details (`ESPN_LEAGUE_ID`, `ESPN_S2`, `ESPN_SWID`,
`ESPN_SEASON_YEAR`, `DEFAULT_TEAM_NAME`, `DEFAULT_TEAM_ID`) live in
[config.py](config.py). **Do not add them back as UI inputs.** *Which team* is chosen
on the **Settings** page and *which week* in the **This Week** left rail — never the
creds. `DEFAULT_TEAM_NAME` is currently `"VJ Maxx"` (the league champion). Team names
come from the API and are resolved to an id with `data.resolve_team_id`.

## Design system — "Analyst Sheet" (do not drift from this)

Light, print-inspired, restrained. The owner explicitly dislikes flashy / "AI-slop"
looks and **emoji** — use none (Bootstrap Icons are fine; they render via the
self-hosted embedded font in [assets/icon_font.py](assets/icon_font.py), not a CDN). Keep it calm.

| Token | Value | Use |
|-------|-------|-----|
| Paper / Card / Surface-2 | `#F4F3EF` / `#FCFBF8` / `#F1EFE9` | backgrounds |
| Ink / Ink-2 / Ink-3 | `#1B1D22` / `#6A6E79` / `#9A9DA6` | text |
| Line | `#DEDBD3` | hairline borders |
| Cobalt | `#2F6FED` | primary accent; **your team** |
| Clay | `#E06A3B` | secondary/warnings; **opponent** |
| Good / Bad | `#2E7D46` / `#C0392B` | won / lost a category |

Type: system grotesk (`system-ui, 'Segoe UI', Helvetica, Arial`) for text, and
**monospace tabular figures** (`ui-monospace, Consolas`) for every number. Rules:
hairline dividers, no gradients on data, no uppercase shouting, no rainbow icons
(all `.bi` are forced to one cobalt via CSS), no emoji.

When you change colors, change them in **all three** places that carry the palette:
`styles.py` (CSS), `.streamlit/config.toml` (Streamlit theme), and
`visualizations.py` (Plotly). Two-series chart colors (you vs. opponent) were
validated for colorblind separation — keep that in mind if you re-hue them.

## Current product state (season is over)

The 2025–26 season ended **April 5, 2026** (`SEASON_END_DATE`, the last playoff
scoring date). Because of that:

- Completed weeks have 0 games left, so the pipeline shows **final box-score results**
  (no forward simulation — `simulate_team` returns zeros on an empty roster).
- Manual watchlist / untouchables sidebar defaults are intentionally **empty** (offseason).
- The **Matchup Optimization** tab was removed (not useful now).

### Layout shell (`styles.py`, verified with Selenium)

**Desktop and mobile navigation deliberately differ** ("a website is not a phone app").
`render_top_nav` renders three Streamlit containers; CSS shows the right ones per width.

- **`nav_top`** — a `position: fixed; top/left/right:0` full-viewport top bar
  (`height: var(--nav-h)` = `3.9rem`, z-index 1000). On **desktop** it is a **single flat
  row**: the **brand button = Home** (basketball SVG `::before` + wordmark), then a plain
  **text link per page** (from `FLAT_NAV`, *no icons*), then **Settings = a gear icon**
  (only header icon; label visually hidden for a11y). The nav **row is capped to
  `var(--content-max)` + `margin:auto` + `--page-pad` gutters (so it lines up exactly with
  the centered page content) and uses `justify-content: space-between`** — brand at the
  content's left edge, gear at the right, links spread between. Columns are `min-width:max-content`
  so links never squish; `overflow-x:auto` scrolls sideways only if too wide.
  Current header order: **Season Summary · Current Matchup · Schedule · Stats▾ · Tools▾**.
  `FLAT_NAV` does **not** include the This Week pages — "Current Matchup" (→ Matchup,
  highlighted for any `WEEK_PAGES` page) enters the side rail. A `FLAT_NAV` item is either
  `("link", label, page)` or a **dropdown** `("menu", label, ((sub-label, page), …))`:
  **"Stats"** (Season / League) and **"Tools"** (Power Rankings / Playoff Odds / Trade
  Analyzer) are `st.popover`s styled to look like nav links. Each is wrapped in a container
  keyed `navmenu_<slug>` (+`_active` when one of its pages is open → cobalt underline; CSS
  matches `[class*="st-key-navmenu_"]`). The panel is nudged down (`stPopoverBody{margin-top}`)
  so it drops **below** the fixed header instead of overlapping it. On **mobile** CSS hides
  every column except the brand. App pushed below the bar by `padding-top: var(--nav-h)`.
  Muted links darken on hover; active page = ink + cobalt underline (brand exempted).
- **Gap gotcha (fixed):** the nav containers (`nav_top`, `nav_bottom`, `nav_sub`) are
  `position:fixed`/hidden but Streamlit still renders each as a flex item at the top of the
  main column, so the column's 16px `gap` stacked ~64px of empty space before the page
  content. Fix: pull those wrappers out of flow —
  `stMainBlockContainer > stVerticalBlock > *:has(.st-key-nav_top|.st-key-nav_bottom)` (and
  `:has(.st-key-nav_sub)` on desktop only, since nav_sub is in-flow on mobile) get
  `position:absolute; height:0`. Don't reintroduce a fixed/hidden nav container as a plain
  in-flow block or the gap returns.
- **The "This Week" side rail** — Streamlit's **native sidebar**, rendered *only* on
  `WEEK_PAGES` (Matchup/Scoreboard/Streamers/Bench/Roster), holding just those five page links (no
  picker — see below). On **desktop** it's a permanent **230px left rail**; on **mobile** CSS
  turns it into a **fixed sub-bar under the header**. The empty sidebar on other pages is
  hidden (`:not(:has(.stButton)){display:none}`); the unreliable collapse control /
  `stSidebarHeader` is hidden at all widths. `initial_sidebar_state="auto"`.
- **`nav_bottom`** — a `position: fixed; bottom:0` **mobile-only bottom icon bar**, one
  icon-over-label per section (`NAV_SECTIONS`: Home · This Week · Season · Tools · Settings).
  Hidden `@media (min-width:768px)`.
- **`nav_sub`** — a **mobile-only** labeled sub-row for the **Season / Tools** sub-pages (This
  Week uses the side rail instead). Hidden `@media (min-width:768px)` — desktop reaches those
  pages as top-level links. **No second header row on desktop besides the This Week rail.**

**The Week/Round picker (`week_sel`) lives in the matchup header row itself**, not the side
rail and not the top bar. `main()` renders `st.container(key="matchup_header")` as **two
rows** (team names don't need to share a line with the picker — the picker's own text, e.g.
"Playoffs - Round 2", doesn't ellipsis-truncate safely, so it gets a full-width row to
itself; team names get their own row below with far more room each): row 1 is
`st.selectbox(..., key="week_sel", label_visibility="collapsed")` alone, centered; row 2 is
`st.columns([1, 1])` with your team name (`h3.mh-name`, ellipsis-truncated) and the
opponent's (`h3.mh-name.mh-name-right`). CSS (`.st-key-matchup_header`) forces the team-name
row to stay horizontal at every width (overriding Streamlit's blanket mobile
column-stacking). `render_top_nav` still reads `week_sel` from `st.session_state` via a
self-assign so it survives runs where the picker isn't rendered (i.e. any non-`WEEK_PAGES`
page). Don't re-add a second `week_sel` widget in the rail — one widget per key per run. The
date-range caption below the header (`st.container(key="matchup_caption")`) is hidden
`@media (max-width:767px)` — too much small text on a phone; the date range still shows in
the results below.

**The Settings gear + mobile bottom icons are inline SVG, not the icon font** (deliberately).
Each gets a monochrome Bootstrap-Icons SVG as a `--nav-ic` data-URI and CSS `mask` paints it
with `background-color` (`.st-key-navb_* / .st-key-navp_settings button::before`); the brand
is a full-colour SVG `background-image`. Bulletproof: renders instantly, zero font/network
dependency. (The **desktop flat links carry no icons** — per the owner, icons are a mobile
pattern.) Earlier the nav used icon-font glyphs; when the CDN `@import` was slow/blocked, the
whole stylesheet was render-blocked and the header — brand, icons, label-hidden gear — vanished
behind Streamlit's default blue decoration bar.

**Icons elsewhere** (section headers, cards) still use `<i class="bi …">`, now backed by
the **self-hosted embedded font** in [assets/icon_font.py](assets/icon_font.py) — no CDN `@import`. Never
re-add a leading `@import url(cdn)`; a leading `@import` is render-blocking. If you use a new
`bi-*` class, regenerate the subset ([assets/build_icon_font.py](assets/build_icon_font.py)) so the glyph is included.

**The native sidebar is used only for the This Week rail** (above) — it is force-hidden on
every other page, so don't render unrelated widgets into it.

**Content is a centred column.** `.block-container` is `max-width: var(--content-max)`
(`1180px`) with `margin: auto`. The nav bars span full width (fixed positioning breaks out
of the centered column). `:root` knobs: `--nav-h`, `--content-max`, and `--bottomnav-h`.

**No horizontal scroll.** `html, body { overflow-x: hidden }`; Streamlit scroll containers
carry `overflow-x: clip`. Do **not** size the bar with `100vw` — it overflows past the
scrollbar. The top-bar row is `flex-wrap: nowrap` + `overflow-x: auto`, so a
narrow/windowed header **scrolls sideways** instead of wrapping. Wide dataframes scroll
inside their own box: the vertical scrollbar is hidden but a **slim horizontal scrollbar
is kept** so 15-category stat sheets can reach their last column.

**Responsive (phones / iPads).** Breakpoint is **767px** — iPad portrait (768) gets the
**desktop** treatment (flat text header, no bottom bar; verified with deviceMetrics 768).
At `<=767px` there is **no top header at all** — `.st-key-nav_top { display:none }`; all
navigation is the fixed **bottom icon bar** + `nav_sub` + the This Week rail (which becomes a
fixed sub-bar pinned at `top:0`, since there's no header above it). Streamlit makes `stMain`
`position:absolute` on mobile, so offsets go on `stMainBlockContainer` padding: `top:0.5rem`
normally, `top:3.4rem` on This Week pages (clear the sub-bar, via `:has(sidebar .stButton)`),
`bottom: --bottomnav-h + 1rem` (clear the bottom bar). Season Summary metric tiles wrap 2-up.
**Before changing responsive CSS, read the `mobile-responsive-ux` skill** (navigation
patterns, the Selenium device-emulation audit, and these Streamlit gotchas).

Scope is tracked by `st.session_state.active_page`. Desktop links come from `FLAT_NAV`;
the mobile bottom bar / sub-row use `NAV_SECTIONS` (`_section_for_page` maps a page to its
section, `_section_landing` gives the page a section opens to):

- **Home** is the default landing (`render_home`) — **desktop and mobile are different
  layouts, rendered simultaneously, shown/hidden by CSS breakpoint** (no server-side width
  detection, no flash of the wrong layout): `.st-key-home_desktop` (hidden `<=767px`) is the
  original hero + **4-card layout** (icon, title, description, separate "Open" button,
  `.home-card`); `.st-key-home_mobile` (shown only `<=767px`) is a compact hero + a **2-up
  grid of single-tap icon tiles** (`.st-key-home_tiles` is the grid — each tile is one
  `st.button` styled as a card, icon set by slug via `--home-ic`), tuned to fit one phone
  screen without scrolling. No data-load gate; reached by the brand (desktop) or the Home
  bottom-bar icon (mobile).
- **This Week** (`WEEK_PAGES`): Matchup · **Scoreboard** · Streamers · Bench · Roster, reached
  from the side rail (entered via "Current Matchup"). **Scoreboard** is the current-week
  category comparison, moved out of the Matchup page into its own page (owner request — a
  15-column wide table doesn't work well on a phone) and redesigned **vertically**:
  `visualizations.create_scoreboard_vertical` renders a hero row (team names + big overall
  W-L-T) then one stacked row **per category** (your value · category label · a two-tone
  cobalt/clay lead bar · opponent value), the pattern ESPN/Yahoo fantasy apps use — no
  horizontal scrolling needed at any width. The `week_sel` Week/Round picker lives in the
  matchup header row (the "Playoffs - Round N" dropdown between the two team names), kept
  alive across page switches by a self-assign so its state survives runs where that row isn't
  rendered.
- **Season Summary** has its own page (`render_season_summary`) but is **not in any nav
  section/grouping** — reachable only via the desktop header link (`FLAT_NAV`, first item)
  and the Home page tiles (both desktop and mobile). It shows a single **"YYYY–YY Season
  Complete"** heading, champion card, four metric tiles, and the standings table, tuned to
  fit one 1080p screen; the header link only appears once the season is over.
- **Season** (`SEASON_PAGES`, *mobile grouping*): Season Stats · League Stats · **Schedule**
  (deliberately does **not** include Season Summary — owner request: keep it off the Season
  bottom-nav section, reachable from Home instead).
- **Tools** (`TOOLS_PAGES`, *mobile grouping*): Power Rankings · **Playoff Odds** · Trade
  Analyzer. Note the mobile sections **intentionally differ from the desktop dropdowns** (by
  request): on mobile Schedule lives under Season and Playoff Odds under Tools; on desktop
  Schedule is a top-level link and Playoff Odds is in the Tools dropdown. `SEASON_PAGES` /
  `TOOLS_PAGES` are used *only* by `NAV_SECTIONS` (mobile), so they can diverge from `FLAT_NAV`.
- **Settings** — the gear (`render_settings`). App options (team, sims, streamers, roster
  flags, untouchables, watchlist) live in `st.session_state` under `cfg_*` keys,
  seeded/re-registered every run by `init_settings()` so values survive page switches
  (Streamlit drops widget state when a widget isn't rendered — the self-assign prevents that).

The app is **light-only** — the dark-mode toggle and `DARK_CSS` were removed (per
web-dev feedback). `styles.py` carries a single palette, `.streamlit/config.toml`
matches, and `visualizations._pal()` always returns the light chart palette.

There is no "RUN SIMULATION" button; navigation drives everything. The ESPN `League`
object is cached with `@st.cache_resource` (`get_league_cached`); injury data and
league stats are `@st.cache_data`. Page bodies are `if active_page == "...":` blocks
(converted from the old `with tab_x:`). Known rough edge: the shared matchup compute
still runs for non-summary season pages, so a brief progress bar can flash on them.

## Domain notes

- **Categories** (ESPN-specific, 15): FGM, FGA, FG%, FT%, 3PM, 3PA, 3P%, REB, AST,
  STL, BLK, TO, DD (double-doubles), PTS, TW. Lower TO is better.
- **Matchup periods**: regular weeks are periods 1–19; playoffs are two-week
  matchups. `resolve_view_window` maps a period to its NBA date range. Playoff-round
  period mapping is best-effort (a round may span two internal period ids).
- **Games-left counting** respects the league's 10-counted-players-per-day cap, IR
  stashing, and injury statuses / return dates (`config.INJURED_STATUSES`,
  `trust_return_dates`).

## Working agreements (what the owner wants from you)

1. **Match the Analyst Sheet aesthetic** and the no-emoji rule on anything you add.
2. **Keep ESPN creds in `config.py`**, never in the UI.
3. When the season context matters, remember it's **over** — new UI should degrade
   gracefully to final results / standings, not assume a live matchup.
4. **Verify before claiming done**: `py_compile`, boot + health check, and — for any
   visual/layout change — drive it in headless Selenium (Edge) and measure, don't
   eyeball. Say plainly what you could and couldn't test (ESPN data pages may be empty
   in a sandbox).
5. Prefer **small, surgical edits**; this is a large single-file UI. Don't refactor
   broadly without being asked.
6. Don't touch `Old Models/`.

## Gotchas

- Empty DataFrames: offseason/completed weeks yield empty rosters and FA pools.
  Guard column access (see the `waiver_df.empty` check in `simulation.py`).
- `current_matchup_period_effective` returns a large nonsense period in the
  offseason; it's fine because Home/Season Summary don't rely on it and historical
  views pass explicit periods.
- Streamlit reruns top-to-bottom on every interaction; expensive fetches use
  `@st.cache_data` (`get_league_meta`). Keep new network calls cached.
- Streamlit 1.52 wraps each top-level block in a tight `stLayoutWrapper`, and it can
  fail to render a sidebar reopen control after a collapse — both bit the header/rail
  work. Prefer `position: fixed` for the bar and the `:has()` force-show for the rail
  over fighting those quirks.
- CSS selectors here target Streamlit `data-testid`s and emotion classes, which can
  shift on Streamlit upgrades. After bumping Streamlit, re-verify the layout shell.
- **GAP gotcha, extended:** any `st.markdown`/`st.container`/`components.html` call that
  renders a real-but-invisible DOM element at the top level of the main column — even
  something as innocuous as `st.markdown(CUSTOM_CSS, ...)` injecting a `<style>` tag, or a
  `with st.spinner(...):` block whose content later disappears — still counts as a flex item
  and still consumes the column's 16px `gap`. Two prior instances of this: (1) the CSS/font
  injection markdown calls themselves (fixed by wrapping both in
  `st.container(key="css_injector")`); (2) the shared "Loading from ESPN…" / "Loading matchup
  data…" spinners + progress bar that run even for Season Stats/League Stats, which don't use
  their output (fixed with a conditional key, `mp_hide_N` on non-`WEEK_PAGES` vs `mp_live_N`
  on `WEEK_PAGES`, so the progress UI stays visible where it's genuinely useful but collapses
  to zero everywhere else). All of these keys are matched by the same always-collapse rule in
  `styles.py` (`*:has(.st-key-nav_top | .st-key-nav_bottom | .st-key-touch_icon_injector |
  .st-key-css_injector | [class*="st-key-mp_hide_"])`). **If you add a new
  `st.markdown`/`st.empty`/`st.spinner`/`components.html` call outside any page's visible
  content — especially near the top of `main()` — wrap it in a keyed container and add that
  key to this rule, or it will silently push every page's content down.**
- `st.markdown(..., unsafe_allow_html=True)` **cannot run `<script>` tags** — they're
  inserted via `innerHTML`, which browsers never execute. To inject `<head>` changes (e.g.
  the apple-touch-icon in `main()`), use `st.components.v1.html(...)`: it renders a
  same-origin iframe whose script can reach the real page via `window.parent.document`.
- **Indented multi-line f-strings inside a loop can silently break `st.markdown` HTML:**
  CommonMark treats 4+ leading spaces on a line as an **indented code block** — a single
  multi-line indented HTML f-string passed to `st.markdown(unsafe_allow_html=True)` renders
  fine (seen throughout `visualizations.py`), but **concatenating many such indented
  templates in a loop** (as `create_scoreboard_vertical` first did, one block per stat
  category) made every iteration *after the first* render as literal escaped text instead of
  HTML — no error, just wrong-looking output. Fix: build loop-repeated HTML as a **single
  line per iteration** (chained `f'...'` string concatenation, no embedded newlines/leading
  spaces), not a multi-line indented `f"""..."""` per row. If you're generating repeated HTML
  fragments in a loop for `st.markdown`, keep them on one line each.
- **CSS cascade-order trap in the This Week rail block:** the desktop (unscoped) rail button/
  select rules and the `@media (max-width: 767px)` mobile overrides target the *identical*
  selectors at *identical* specificity (both `!important`) — when that happens, **source
  order** breaks the tie, not the media query. The desktop rules must appear *before* the
  mobile block in `styles.py`, or the desktop styling (tinted background, boxed active state,
  bordered select) silently wins on phones too, even though the mobile block looks like it
  should override. If you add another `!important` rule pair like this, check which one is
  declared last in the file — that's the one that actually applies at every width.
- **`render_sortable_table` sizes every column to fit its own content**, not the
  `"small"/"medium"/"large"` presets (those are fixed buckets — "small" was still much wider
  than a 1-2 digit "Rank" column needs). `st.column_config`'s `width` accepts an **exact
  integer pixel value** in this Streamlit version (`ColumnWidth = Literal["small","medium",
  "large"] | int` — confirmed via `inspect.signature`/the `ColumnWidth` type, not just docs),
  so `_fit_width(header, series)` computes `max(header_len, content_len) * px_per_char + pad`
  per column, clamped to `[48, 420]`px. Don't revert to the size presets — they aren't truly
  content-based. The grid `height` calc also had a **bug**, not just cosmetics: the old
  `(rows + 1) * 35 + 22` overshoot (a full extra row of headroom, meant to avoid a double
  scrollbar) rendered as a **visible blank row** at the bottom of every table; it's now
  `rows * 35 + 32` (a small buffer, not a whole extra row).
- **Dead-CSS-class trap:** `visualizations.create_scoreboard`'s outer table `<div>` never
  actually carried `class="scoreboard-table"` even though `styles.py` had mobile-shrink rules
  written for that exact class — they silently did nothing until the class was added to the
  HTML. When you add a CSS class rule for a specific piece of raw-HTML output (anything built
  with an f-string in `visualizations.py` or the inline HTML in `streamlit_app.py`), grep the
  emitting code to confirm the class is actually in the string you think it's in — CSS with no
  matching selector fails silently, with no error anywhere.
- **CSS custom properties don't cross DOM branches:** `--page-pad` (the side gutter) is
  declared at `:root` for exactly this reason — it was originally scoped inside
  `.block-container` only, which broke `var(--page-pad)` anywhere in the This Week rail,
  since `[data-testid="stSidebar"]` is a **sibling** of `.block-container` (under
  `stAppViewContainer`), not a descendant. A custom property only inherits down the actual
  DOM tree from wherever it's declared — matching a CSS *selector* elsewhere doesn't
  "export" the variable to unrelated parts of the page. Used inside a shorthand
  (`padding: 0 var(--page-pad) 0.3rem`), an unresolvable var makes the **whole declaration**
  invalid, silently computing to `0` — no console warning. If you introduce a new
  `--custom-property`, declare it at `:root` unless you're certain every place that reads it
  is a genuine descendant of where you're declaring it.
- **Streamlit's own default padding stacks with yours:** `[data-testid="stSidebarContent"]`
  ships a default `20px` horizontal padding that has nothing to do with any rule in
  `styles.py` — it stacked with our own `stSidebarUserContent` padding and offset the This
  Week rail's mobile row ~20-36px further right than the visually-identical Season/Tools
  sub-row. When two nested Streamlit-native containers both look like plausible "add padding
  here" targets, check the computed style of *both*, not just the one your own rule targets.
