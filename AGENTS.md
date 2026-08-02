# AGENTS.md — guide for AI coding agents

This file orients an AI agent (Claude Code, etc.) working in this repo. Read it
before making changes. Human-facing setup lives in [README.md](README.md).

---

## ⚠️ MIGRATION IN PROGRESS — read this first

The repo now holds **two front ends**. Everything below this section describes the
**Streamlit app, which now lives in [legacy/](legacy/)** — every path it mentions
(`streamlit_app.py`, `styles.py`, `data.py`, …) is relative to `legacy/`, not the root.

```
legacy/          the Streamlit app — STILL THE LIVE SITE (Render), do not break it
app/             Next.js pages + app/api/live (the replacement)
components/      React components
lib/             probability.ts (the engine), league.ts, loadLeague.ts, useLiveTotals.ts
scripts/         build_data.py — exports public/data/league.json from the legacy engine
public/data/     generated JSON (checked in; regenerate with `npm run data`)
```

**Why:** Streamlit Community Cloud's badge covers the mobile header, and Render's free
tier is 0.1 CPU with a 15-minute spin-down. The Next.js version deploys to Vercel free,
where a static page has no cold start and no CPU ceiling.

**The Streamlit app moved as ONE unit, so no import changed** — the modules are still
siblings of each other. `render.yaml` does `cd legacy` first. If you touch that folder,
re-verify it boots (`cd legacy && streamlit run streamlit_app.py`).

### The architecture that makes the new version work

Data is split into two tiers, because a team's projected category total is
`mu = current_total + Σ(avg × games_left)` and `sd` depends only on the projection:

- **SLOW** (`scripts/build_data.py`, scheduled): player averages, games left, variances →
  `public/data/league.json`. ~47 KB for the whole league.
- **LIVE** (`app/api/live`, per request): current banked totals. One ESPN call. Current
  totals are certain, so they shift the mean and add **no** uncertainty — which is exactly
  why the expensive half is cacheable.

**All probability maths runs in the browser** (`lib/probability.ts`), from 56 numbers
(14 stats × mu/sd × 2 teams). Categories are independent normals, so per-category odds
are a closed form and the number of categories won is an exact Poisson-binomial DP — no
Monte Carlo. Validated against the Python it replaces: **0.44pp** worst disagreement vs a
200,000-sim run, and TS vs Python agree to **7.3e-8**. At **5 µs per full evaluation**,
every what-if (bench, streamer, trade) is instant with no server round trip.

### Traps already hit here — don't repeat them

- **Never guess ESPN stat ids.** A wrong id does not error, it reads as a column of
  **zeros**, silently turning a category loss into a tie (TW is 43, not 38 — 38 is
  triple-doubles; the scoreboard read 10-4-1 instead of 10-5-0). `build_data.py` derives
  them from espn-api's own `STATS_MAP` and fails loudly if one is missing.
- **`scoreByStat` values are objects** `{score, result, rank}`, not numbers.
- **ESPN's `matchupPeriodId` is not the app's period.** Playoff rounds span two scoring
  periods, so the app's "period 23" is ESPN matchupPeriodId 21. `app/api/live` resolves
  exact → league's `currentMatchupPeriod` → the team's latest, and reports which it used.
- **Wide tables must scroll inside `.table-scroll`**, never widen the page. When auditing
  overflow, exclude descendants of that box or you get false positives.
- **`current` and `projMu` in the snapshot are a MATCHED PAIR.** The live fetch replaces
  `current` but not the projection. Against a hand-made or stale snapshot that produces an
  impossible state — the FINAL score alongside games still to play — and every derived
  number turns to nonsense (it briefly made the streamer page recommend dropping Nikola
  Jokic). `?demo=1` freezes the snapshot and skips the fetch; use it whenever testing with
  a fabricated in-season fixture, and never compare a reading taken before the live fetch
  with one taken after.
- **Never pass the whole `league` object to a client component.** Anything a server
  component hands a client component is serialised into the page payload. Passing `league`
  put the entire 258 KB export into the HTML of every interactive page — /player-value
  shipped **405 KB**, /scoreboard 314 KB, against 23 KB for a pure server page. Use
  `trimLeague(league, {...})` in `lib/loadLeague.ts` to declare what that page actually
  needs; it returns the same shape with the rest emptied, so component signatures don't
  change. Measured saving across the app: **2.08 MB, 62%**. Check with
  `curl -s <url> | wc -c` after adding any client component.
- **A probability is not an outcome.** Once the season is over, the bracket sim puts the
  two finalists near 50/50 — so the Playoffs page would read "51%" for the team that
  actually won. The Streamlit page sidestepped this by showing the real result instead.
  The Next version shows the model's numbers AND a banner naming the actual champion,
  because silently swapping in the outcome makes the model look prescient and silently
  showing 51% makes it look wrong. Watch for this anywhere a projection outlives the
  event it was projecting.
- **Never run `next dev` and `next build` against the same `.next`.** They clobber each
  other's chunks and you get `Cannot find module './331.js'` 500s on every page, which
  looks like a code bug and isn't. `rm -rf .next && npm run build`. Check for a stray dev
  server before starting another one — `EADDRINUSE` on 3000 means the old process is still
  serving stale code.
- **OneDrive produces the SAME symptoms with no second process involved.** The repo lives
  in a synced folder, and OneDrive dehydrates build output into cloud placeholders and drops
  files mid-build, so a server that started cleanly starts 500ing on every route with
  `Cannot find module './611.js'` or `ENOENT: routes-manifest.json`. Tell them apart by
  attributes, not by the message: `Get-ChildItem .next -Recurse -Force -File | ? Attributes
  -match ReparsePoint` — any hits mean OneDrive, not a stale build. `scripts/ensure-dist.mjs`
  (wired to `predev`/`prebuild`) pins `.next` as "always keep on this device" so this can't
  happen; it must pin the **directory**, since that is what new files inherit from. Don't
  "fix" it by moving distDir outside the project — Node resolves the `require('react/…')`
  calls Next emits from the output file's own directory, so every route 500s with
  `Cannot find module 'react/jsx-runtime'` instead. Just run `npm run dev`, never
  `npx next dev`, or the pin step is skipped.

### Phase status

Done: repo split, `build_data.py` (matchups, free agents, season-wide data), the TS
engine + cross-language tests, and **nine pages** — Scoreboard, Matchup, Roster,
Streamers, Bench, Season, Schedule, Rankings, Playoffs.

**Feature parity reached: 18 routes.** Home, Scoreboard, Matchup, Roster, Streamers,
Bench, Season, Season Stats, League Stats, Schedule, Rankings, Playoffs, Player Value,
Player Card, Compare, Trade, Agent, Settings — plus the desktop header (with Stats/Tools
dropdowns) and the full mobile pattern (no header; bottom icon bar + section sub-row +
This Week top sub-bar). The Agent chat page was the last gap; **parity is complete**.

### The Agent (`/agent`, `app/api/agent`)

Same design as the Streamlit assistant: **the LLM never does the basketball maths.** It
picks a tool, `lib/agentTools.ts` returns real numbers out of `league.json`, and Gemini
narrates a recommendation grounded in them. Tools ported one-for-one from the Python
(`lookup_player`, `list_players`, `compare_players`, `team_category_ranks`, `team_roster`,
`list_teams`, `power_rankings`, `web_search`), and the system instruction — including the
long trade-realism paragraph, which is what stops it proposing two-good-players for a
superstar — is carried over verbatim.

- **`lib/gemini.ts` talks REST over `fetch`; there is no SDK dependency.** The tool loop
  and the free-tier **model rotation** (`GEMINI_MODELS`, 429 → next model, every turn
  restarts at the top of the chain) are written out, mirroring `legacy/assistant.py`.
- **Gemini's SSE separator is `\r\n\r\n`, not `\n\n`.** Splitting on `\n\n` matches
  nothing, every event stays in the buffer, and the stream looks empty — which surfaces as
  "no model could be reached" while the API is answering perfectly. Cost an hour; split on
  `/\r?\n\r?\n/`.
- **Gemini 3 requires `thoughtSignature` to be echoed back.** The part carrying a function
  call comes with an opaque signature, and the follow-up request is rejected without it.
  Never rebuild a model part by hand — push the part object through untouched.
- **Google Search grounding cannot be combined with function declarations** in one
  request, so `web_search` runs as its own isolated grounded call underneath a tool the
  chat sees as ordinary.
- **The route is STATELESS**: the client posts the whole conversation each turn. Serverless
  has nowhere to keep a live chat object. Tool calls are not carried across turns, only
  the visible messages.
- The key is `GEMINI_API_KEY` (server-only, written by `npm run env` from
  `legacy/config_secrets.py`). Without it every other page still works and `/agent` says
  what is missing rather than failing on send.
- Replies render through `components/Markdown.tsx`, a small renderer that emits React
  **elements**. Do not swap in a markdown-to-HTML library: model output is untrusted, and
  `dangerouslySetInnerHTML` would make every reply an injection surface.

The **Tools** pages (Player Card, Player Value, Compare, Power Rankings, Playoff Odds,
Trade Simulator) were re-matched to their Streamlit originals: Player Value is the ranked
`.pv-list` card list (value bar, trend chip, expandable ESPN-style card) with the same six
filters, Player Card has the bio header and value tiles, Compare has the diverging-bar
head-to-head, and Trade has Buy Low / Sell High plus the all-play record and the
before/after category table. Shared helpers live in `lib/playerPool.ts` (status mapping,
headshot, 9-cat aggregates) — port of the legacy `_player_status` / `_team_agg` /
`_cat9_record` family; keep the four views reading from it rather than re-deriving.

**The per-player "Last 10 games" log and the Player Card bio are fetched CLIENT-SIDE**
(`components/GameLog.tsx`, `usePlayerBio`) from ESPN's public CORS-enabled
`site.web.api.espn.com` endpoints, on open, with a module-level cache — exactly the
trade-off `_PV_GAMELOG_SCRIPT` made in Streamlit. Pre-fetching them into the export would
be ~290 extra ESPN round trips per build for detail almost nobody opens. For the same
reason the Player Value cards only MOUNT their body once the row is opened; rendering all
289 cards up front added ~80 KB of HTML for nothing.

**The nav is SEASONAL.** `navFor(seasonOver)` in `lib/nav.ts` drops every href in
`IN_SEASON_ONLY` (currently `/playoffs`) from the desktop dropdowns and the mobile
sub-row once the season is over, and Home swaps its fourth card from Playoff Odds to
Power Rankings — a forecast page has nothing to forecast in July, and a permanent link to
one is how a 50/50 number gets read as a verdict on a finished bracket. The **route stays
reachable**, and `sectionFor` deliberately still uses the UNFILTERED sections so a direct
visit to /playoffs in the offseason keeps its Tools sub-row. `seasonOver` reaches the
client `Nav` as a **boolean prop from the root layout** (`app/layout.tsx` is now `async`
and calls `loadLeague`) — never the league object, which would land in the payload of
every page. The statically prerendered pages bake the flag in at build time, so
**regenerate the export and rebuild together** (`npm run data && npm run build`).

**"Add to Home Screen" is configured in TWO places that must stay in sync.** Android reads
`app/manifest.ts` (`short_name` is the label under the icon, `name` only shows in install
prompts); **iOS reads neither the manifest's name nor `<title>`** — it takes the label from
`apple-mobile-web-app-title`, set via `metadata.appleWebApp.title` in `app/layout.tsx`, and
the icon from `app/apple-icon.png`. Both currently say **"FBB Sim"** while the browser tab
keeps the full title. Icons are generated by `scripts/make_icons.py` (180 for Apple, 192/512
for the manifest), a port of `legacy/assets/make_touch_icon.py` — keep its two constraints:
opaque background and a generous safe margin, because iOS applies its own squircle mask and
a design sitting flush to the edge gets cropped.

The Playoff Odds table itself has three shapes and all three are live code: regular
season (seed columns `#1*`–`#4*`, No Playoffs, Playoff % + American odds), bracket
underway (Advance % / Champ %, rows filtered to teams still alive), and finals set
(collapses to the two finalists under a "Championship" heading, as the Streamlit page
did). Only the last one is reachable from the real offseason export — to exercise the
other two, swap in a synthetic export (see the fixture note below).

Settings are real, not decorative: the team choice is a COOKIE (`lib/team.ts`) because
every page resolves the team while server-rendering — localStorage would arrive too late
and the first paint would show the wrong team. Protected players and the open-spot flag
are localStorage (`lib/useSettings.ts`), which is what makes them survive a restart; the
Streamlit version kept them in server session state and a free-tier spin-down wiped them
every 15 minutes.

**Season-wide data is computed by the LEGACY module, not reimplemented.**
`build_season()` in `build_data.py` imports `streamlit_app` (works outside a Streamlit
runtime — `st.*` calls no-op with warnings) and calls `get_season_stats`,
`get_power_rankings`, `get_team_schedule_data` and `get_playoff_probabilities`. Those are
hundreds of lines of verified all-play / bracket logic and a second copy would drift. It
is imported lazily and every step is guarded, so a failure degrades to "no season data"
rather than losing the matchup export. Costs ~13s (playoff sim is ~6s of it).

**`LeagueData.season` is the YEAR; `LeagueData.seasonData` is the season-wide object.**
They collided on the first attempt — don't merge them.

**Testing in the offseason:** the season is over, so every live path sits in its empty
state against real data. `scripts/`-adjacent helper `fixture.py` (in the agent scratchpad,
not committed) swaps `public/data/league.json` between the real export and a synthetic
mid-week fixture. **Always view a fixture with `?demo=1`** — see the matched-pair trap
above.

**Streamers runs entirely client-side** (`lib/streamers.ts`): every (pick up, drop) pair
is moment arithmetic plus the Poisson-binomial DP, so a 1,274-scenario sweep takes 13.5ms
and re-runs instantly on every toggle. Verified against an independent Python
implementation on the real league data: identical top-10 pickups AND drops, baseline
agreeing to 1.1e-7.

**Bench** (`lib/bench.ts`) reuses the same subtraction: play-all vs bench-all, plus a
per-player "what if they sat" column the Streamlit version never had (it only did the
all-or-nothing form). "Sit" means the player misses ALL remaining games in the window —
the export carries games-left over the whole window, not a per-day schedule, so a literal
"bench today" is not expressible with this data.

**Caveat that applies to BOTH Streamers and Bench:** the analysis optimises THIS MATCHUP ONLY.
A player with no games left this week costs nothing to drop, so the engine will happily
suggest dropping a star who is resting. That is correct for the objective it is given and
wrong for the season — which is what the "Protect from dropping" chips are for. Consider
persisting them (localStorage) rather than resetting each visit.

---

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
| [visualizations.py](visualizations.py) | **All charts, as inline SVG / HTML-CSS — no charting library.** Five charts (win-probability gauge, category analysis, score distribution, championship probability, rank trend) plus the scoreboard HTML. Each returns a **string** for `st.markdown(..., unsafe_allow_html=True)`. Colors come from the `var(--*)` custom properties in `styles.py`. |
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

When you change colors, change them in the **two** places that carry the palette:
`styles.py` (CSS) and `.streamlit/config.toml` (Streamlit theme). `visualizations.py`
used to be a third, because Plotly couldn't read CSS variables; now that the charts are
plain SVG/HTML they use `var(--cobalt)` etc. directly, so they follow `styles.py`
automatically. (A few literals remain at the top of the file for `create_scoreboard_vertical`
and opacity blends.) Two-series chart colors (you vs. opponent) were validated for
colorblind separation — keep that in mind if you re-hue them.

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
  W-L-T) then one stacked row **per category** (your value · category label + margin · a
  lead bar · opponent value), the pattern ESPN/Yahoo fantasy apps use — no
  horizontal scrolling needed at any width. **The bar shows the MARGIN, not the magnitude
  split.** It used to be `you / (you + opp)`, which sits near 50/50 for every category no
  matter what — on a real 10-5 matchup the bars spanned only 38.7–56.5% while the true
  margins ran +0.9% to −45%, so the only graphic on the page was flat exactly where the data
  was most varied. Each bar now diverges from a centre line by the relative margin
  `(you − opp) / mean`, normalised to the biggest margin in that matchup (floored at 10%, so
  an all-close week doesn't render hairline leads as dramatic full-width bars), with the
  signed margin printed beside the category — one decimal below 10%, none above, because on a
  category won by 0.9% the precision is the whole point. TO's sign is flipped so *fewer*
  turnovers reads as a lead. Ratio categories print as `48.7%`, not `0.4868`. Category order
  deliberately stays ESPN's (owner choice over sorting by margin), so a row is where you
  expect it. The `week_sel` Week/Round picker lives in the
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

### Performance (measured — don't undo these)

The app is deliberately built to avoid three costs that were each measured in a real
browser / against live ESPN. See **Gotchas** for the traps involved.

0. **All HTTP goes through one pooled session — `data.HTTP`, never `requests.get`.**
   This was the single biggest win in the app and the actual reason the deployed version
   crawled while localhost felt instant. `requests.get(...)` builds a fresh Session →
   HTTPAdapter → PoolManager → **SSLContext** every call, and creating that SSLContext
   reloads the CA bundle from disk at **~0.25s of CPU each**. `espn-api` calls bare
   `requests.get()` for every endpoint, so the app paid it dozens of times per page.
   Profiling the playoff warm-up: **13.1s of its 22.8s of CPU was inside
   `load_verify_locations`**, versus 0.5s for the Monte Carlo it was supposed to be doing.
   `data.py` now owns one pooled `requests.Session` and swaps a `_PooledRequests` shim
   into `espn_api.requests.espn_requests.requests` so espn-api uses it too (a shim, not a
   plain Session, so any other `requests` attribute it reaches for still resolves).
   Measured: 12 sequential ESPN calls **7.45s → 0.48s**; whole warm-up CPU **22.8s →
   3.2s**; `connect_to_espn` **2.0s → 0.93s**. On 0.1 CPU that is ~228s of saturated CPU
   down to ~32s. **Never reintroduce a bare `requests.get`.**
1. **No charting library.** Streamlit's Plotly integration downloaded a **4.87 MB** JS
   chunk the first time any chart page opened and spent **~1s of main-thread script**
   re-rendering figures on every visit. Replacing all five charts with inline SVG /
   HTML-CSS took the app from **10.7 MB → 5.7 MB** of JS, first Matchup open from
   **2.28s → 1.33s**, and its browser script time from **996ms → 200ms**. Don't reintroduce
   `plotly`, `altair`, or `st.line_chart`/`st.bar_chart` (those pull ~1 MB of Vega) — add a
   function to `visualizations.py` instead.
2. **Closed-form Monte Carlo.** See the block comment above `_draw_player_totals` in
   [simulation.py](simulation.py). A sum of independent normals is normal, so a player's
   n-game total is one draw, not n. `simulate_team` is **~40x** faster (385ms → 10ms at
   10k sims) with a statistically identical distribution. `analyze_streamers` also
   simulates each roster player **once** and subtracts the dropped player's contribution,
   instead of re-simulating the whole roster per (streamer × drop) pair — that was
   `O(streamers × droppables × players)` draws, ~200M random values for a normal league.
3. **Fragments + 0ms press feedback.** The five widget-dense, navigation-free pages
   (`render_settings`, `render_player_value`, `render_player_compare`,
   `render_player_search`, `render_trade_simulator`) are `@st.fragment`, so a widget change
   reruns only that page rather than the whole script + all ~20 nav buttons. And the
   press-state block at the very **end** of `styles.py` makes every nav control acknowledge
   a tap in the same frame, instead of waiting for the server to send back
   `type="primary"`.

4. **All box-score fetches are cached.** `league.box_scores(matchup_period=N)` is a live
   ESPN round trip measured at **~450ms**, and it used to sit uncached on the This Week hot
   path — every rerun of Matchup / Scoreboard / Roster / Bench / Streamers paid it again,
   which is why those pages never got faster on a second visit while Schedule (already
   cached) dropped to ~0.03s. **`get_box_scores_cached(period)` in
   [streamlit_app.py](streamlit_app.py) is now the single entry point**; it picks the TTL
   from whether that period is still being played — `LIVE_BOX_SCORE_TTL` (90s) while live,
   3600s once final, since a completed week never changes. `get_matchup_info` takes the
   result via its `boxscores=` argument. Tab switches went **1.05s → 0.71s** (Current
   Matchup), **1.33s → 0.80s** (Matchup), **1.36s → 0.84s** (Roster), verified identical
   output across every period. `simulation.py` reaches the same cache through
   `set_box_scores_fetcher` (a module-level hook — importing the cache directly would be a
   circular import), falling back to a direct fetch if none is installed.

   Don't call `league.box_scores(...)` directly in new code — use `get_box_scores_cached`,
   or `_box_scores(league, period)` from inside `simulation.py`.

5. **Background warming is paced, not bursty.** `warm_caches` pre-fetches on a daemon
   thread, which competes with the user's clicks for the *same* CPU budget. On 0.1 CPU a
   back-to-back burst of heavy work makes every tab switch during it feel broken.
   `WARM_STEP_PAUSE` yields between steps, each step is individually guarded so one
   failure can't skip the rest, and the expensive playoff bracket runs last. The pause is
   a genuine trade (it delays warm completion, so an early click on an unreached page pays
   full cost) and its benefit **cannot be reproduced on a multi-core dev box** — tune it
   against the deployed app, not locally.

Also worth knowing: [render.yaml](render.yaml) deploys to Render's **free** plan — 0.1 CPU,
512 MB, spins down after ~15 min idle with a 30–60s cold start. Every CPU-bound number
above is roughly an order of magnitude worse there than measured locally, and a warmed
session already sits around 300 MB of the 512 MB cap.

**When the deployed app feels slow but localhost doesn't, suspect CPU contention, not the
code path you're looking at.** Localhost has spare cores that absorb background work
invisibly; 0.1 CPU does not. The two things that actually mattered here were (a) wasted
CPU per network call, and (b) a background thread monopolising the budget — neither of
which shows up in a local wall-clock measurement. Profile for **CPU time**
(`psutil.Process().cpu_times()`, `cProfile` sorted by `tottime`), not wall time.

One known remaining cost: the first script run of a process spends **~370ms** building the
102 KB `CUSTOM_CSS` markdown element (subsequent reruns are ~2ms — Streamlit's ForwardMsg
cache dedupes it). That's ~3.7s of a cold start on 0.1 CPU. It could be moved to
`enableStaticServing` + a `<link>`, but that trades a one-time cost for a flash of
unstyled content on every fresh load — and per the header notes above, a stylesheet that
isn't there at first paint is exactly how the layout shell broke before. Not obviously
worth it; measure before changing.

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
- **Cached box scores hold references to the cached `League`'s Team objects.**
  `matchup.home_team` / `away_team` *are* the objects from `league.teams` (espn-api swaps
  the ids for the real Team objects), which is why `opp_team_obj.roster` works. Both caches
  are `@st.cache_resource`, so if `get_league_cached` were rebuilt while a box-score entry
  was still alive, the opponent object could come from the previous `League` instance. In
  practice that just means an opponent roster as stale as the cache window already allows,
  and it predates the current caching, but keep the TTLs aligned (or shorter on the box
  scores) if you change them — don't give box scores a *longer* TTL than the League.
- **Numpy is SLOWER than stdlib for scalar draws.** Vectorizing looks like it should always
  win, and for arrays it does — but `_simulate_matchup_winner` is a *scalar* path called tens
  of thousands of times by the playoff bracket, and rewriting its 14-category loop as one
  vectorized array draw measured **slower** (41µs vs 33µs per call): setting up arrays of 14
  elements costs more than the 28 scalar draws it saved. What actually worked was keeping the
  loop and swapping `np.random.normal` for stdlib **`random.gauss`** (plus hoisting the stat
  list / variance factors to module scope as plain Python floats): **33µs → 12µs**. At high
  call counts on tiny data, per-call overhead is the whole story — measure, don't assume.
- **Restart the server after editing an imported module.** Streamlit hot-reloads the main
  script, but a changed function in `visualizations.py` / `simulation.py` can keep serving the
  **old** code from `sys.modules`. A CSS/markup fix that "didn't take effect" is usually this,
  not a broken selector — kill the process and re-run before debugging anything else.
- **Selenium `driver.get()` starts a NEW Streamlit session**, which resets `st.session_state`
  by design. Any test of state persistence (settings surviving a page switch, the `week_sel`
  self-assign) **must** navigate with client-side nav clicks instead, or it will report a
  false failure. This produced a bogus "settings don't persist" result while testing the
  `render_settings` fragment; via nav clicks it persists correctly.
- **Charts have degenerate cases now that the season is over.** A completed week has exactly
  one possible outcome, so the score-distribution chart gets a single 100% bar — without a
  `max-width` on the column it stretched into one giant block across the whole container.
  Every chart in `visualizations.py` also needs an explicit empty-input branch (they all
  return a short "no data" `<p>`). Check both when adding one.
- **`:has(.st-key-x)` + `@st.fragment` = the whole page gets absolutely positioned.** The
  gap-collapse rule in `styles.py` absolutely-positions any direct child of the main column
  that *contains* a given key. `render_player_search` renders a `pv_gl_injector` container,
  which was in that list — so the moment that page became a fragment, **everything** moved
  under one wrapper, that wrapper matched `:has(.st-key-pv_gl_injector)` (descendant!), and
  the entire Player Card page became `position:absolute; height:0`, rendering shifted right
  and out of flow. Fix: the rule now uses the **child combinator**, `:has(> .st-key-x)`,
  which only ever matches the keyed container's own wrapper. Keep it that way — a
  descendant `:has()` in a rule that repositions its subject is a trap waiting for the next
  re-nesting.
- **`html, body { overflow-x: hidden }` hides inner overflow from an overflow check.**
  `document.documentElement.scrollWidth - window.innerWidth` reported **0** on every page
  while blocks inside were 1878px wide inside a 1180px column — the clip on html/body
  swallowed it. To actually catch this, compare each element's `getBoundingClientRect()`
  against the **block container's** width, and test at a **wide viewport** (~1900px); at
  1440px the bug was invisible because the overflowing wrapper still fit on screen.
- **Only fragment a page that doesn't navigate.** `st.switch_page` / `_go_page` from inside an
  `@st.fragment` doesn't work, which is why `render_schedule` (it calls `_go_page("Matchup")`)
  and `render_assistant` (`st.rerun()`) are deliberately **not** fragments, and
  `render_home`'s tiles aren't either. Grep the function for `_go_page|switch_page|st.rerun`
  before decorating it. Pages with no widgets at all (Season Summary, Power Rankings) gain
  nothing from a fragment — they'd never rerun independently.
- **Streamlit's own default padding stacks with yours:** `[data-testid="stSidebarContent"]`
  ships a default `20px` horizontal padding that has nothing to do with any rule in
  `styles.py` — it stacked with our own `stSidebarUserContent` padding and offset the This
  Week rail's mobile row ~20-36px further right than the visually-identical Season/Tools
  sub-row. When two nested Streamlit-native containers both look like plausible "add padding
  here" targets, check the computed style of *both*, not just the one your own rule targets.
