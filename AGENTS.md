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
| [streamlit_app.py](streamlit_app.py) | UI entry point. `main()`, sidebar, the six tabs, the Season Summary page, and the week/period viewer. Orchestrates everything. |
| [data.py](data.py) | ESPN connection, roster/matchup/box-score fetch, NBA schedule scraping, and **games-left counting** (injury-aware, IR-aware, 10-per-day cap). |
| [simulation.py](simulation.py) | Simulation engine: per-team category sim, matchup comparison, streamer analysis, bench strategy, league stats, playoff bracket. |
| [visualizations.py](visualizations.py) | Plotly charts + the scoreboard HTML. All chart colors live here. |
| [config.py](config.py) | Constants **and ESPN credentials** (league id, cookies, default team), plus category variance and NBA team maps. |
| [styles.py](styles.py) | The "Analyst Sheet" design system as one big CSS string (`CUSTOM_CSS`). |
| [.streamlit/config.toml](.streamlit/config.toml) | Streamlit's native light theme (must match `styles.py`). |
| [.streamlit/secrets.toml](.streamlit/secrets.toml) | Template only — real creds are in `config.py`. |
| `Old Models/` | The original single-file version. Historical reference; do not edit or import. |

## Run & verify

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Quick smoke test an agent can run without a browser (boots the app, checks health,
then stops):

```bash
streamlit run streamlit_app.py --server.headless true --server.port 8599 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8599/_stcore/health
pkill -f "port 8599"
```

`py_compile` every module you touch. The live simulation only fires when the user
clicks **RUN SIMULATION**, so a clean boot + health 200 is the most you can verify
headlessly; note that in your summary rather than claiming the full flow was tested.
The ESPN data path can be exercised directly in a script via
`data.connect_to_espn(...)` using the constants in `config.py`.

## Configuration — creds stay in code, not the UI

ESPN connection details (`ESPN_LEAGUE_ID`, `ESPN_S2`, `ESPN_SWID`,
`ESPN_SEASON_YEAR`, `DEFAULT_TEAM_NAME`, `DEFAULT_TEAM_ID`) live in
[config.py](config.py). **Do not add them back as sidebar inputs.** The sidebar only
asks *which team* and *which week* to view. `DEFAULT_TEAM_NAME` is currently
`"VJ Maxx"` (the league champion). Team names come from the API and are resolved to
an id with `data.resolve_team_id`.

## Design system — "Analyst Sheet" (do not drift from this)

Light, print-inspired, restrained. The owner explicitly dislikes flashy / "AI-slop"
looks and **emoji** — use none (Bootstrap Icons are fine; they render via the icon
font). Keep it calm.

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

**Navigation is a full-width two-tier top bar, not tabs** (`render_top_nav`), styled
as a **dark** site header (deep charcoal `#14161C` / `#1B1E26`) on the light page for
strong contrast — a deliberate exception to the otherwise-light Analyst Sheet. The
content full-bleeds to the viewport edges (negative-margin breakout in `styles.py`,
`.st-key-nav_*` keyed containers; content column is `max-width:100%` with a shared
`--page-pad` gutter). Streamlit's own header is hidden. Nav buttons are restyled as
muted text links that brighten on hover; the active page is white with a bright-cobalt
(`#5C93FF`) underline. Scope is tracked by `st.session_state.active_page`:

- **Season** (`SEASON_PAGES`): Season Summary · Season Stats · League Stats · Playoff
  Odds — independent of any week. Season Summary is the default landing (renders
  immediately, no data-load gate).
- **This Week** (`WEEK_PAGES`): a Week/Round picker (`week_sel`) + Matchup · Streamers
  · Bench — driven by the selected period.
- **Settings** — its own nav page (`render_settings`); there is **no sidebar**. All
  former sidebar options (team, sims, streamers, roster flags, untouchables,
  watchlist) live in `st.session_state` under `cfg_*` keys, seeded/re-registered
  every run by `init_settings()` so values survive page switches (Streamlit drops
  widget state when a widget isn't rendered — the self-assign trick prevents that).

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
4. **Verify before claiming done**: `py_compile`, boot + health check, and say
   plainly what you could and couldn't test (the full sim needs a button click).
5. Prefer **small, surgical edits**; this is a large single-file UI. Don't refactor
   broadly without being asked.
6. Don't touch `Old Models/`.

## Gotchas

- Empty DataFrames: offseason/completed weeks yield empty rosters and FA pools.
  Guard column access (see the `waiver_df.empty` check in `simulation.py`).
- `current_matchup_period_effective` returns a large nonsense period in the
  offseason; it's fine because Season Summary is the default and historical views
  pass explicit periods.
- Streamlit reruns top-to-bottom on every interaction; expensive fetches use
  `@st.cache_data` (`get_league_meta`). Keep new network calls cached.
