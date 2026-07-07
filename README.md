# Fantasy Basketball Win Percentage Simulator

A web-based **Monte Carlo simulation** tool for one ESPN Fantasy Basketball league
(head-to-head, category scoring). It pulls live data from ESPN, projects the rest of
a matchup week, and reports win probability, category breakdowns, streamer pickups,
bench decisions, standings, and playoff odds. Built with Streamlit + Plotly.

> Working on this repo as an AI agent? Start with **[AGENTS.md](AGENTS.md)**.

## Quick start

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

The app opens in your browser. ESPN connection details are **already set in the code**
(see Configuration) - the sidebar only asks which team and which week to view, then
you click **RUN SIMULATION**.

## Configuration

ESPN credentials and the default team live in [config.py](config.py) - not in the UI:

| Setting | Where |
|---------|-------|
| `ESPN_LEAGUE_ID`, `ESPN_SEASON_YEAR` | `config.py` |
| `ESPN_S2`, `ESPN_SWID` (browser cookies for a private league) | `config.py` |
| `DEFAULT_TEAM_NAME` (the team analyzed by default) | `config.py` |

To point the app at a different league, edit those constants. Get `espn_s2` / `SWID`
from your browser cookies on `espn.com` while logged into ESPN Fantasy (F12 →
Application → Cookies).

## How it works

1. **Connect** to ESPN and pull rosters, the box score for the selected period, and
   the league injury feed.
2. **Count games left** per player from the NBA schedule - injury-aware, IR-aware,
   and capped at 10 counted players per day (the league setting).
3. **Blend stats** - season averages combined with last-30-day form.
4. **Simulate** each remaining game with per-category variance to build thousands of
   projected weekly totals.
5. **Compare** across all 15 categories for win probability, category odds, and the
   most likely score.

Completed weeks have no games left, so they display as **final results** rather than
projections.

## The app

Sidebar picks the **team** and a **View** (Season Summary, any regular-season week, or
a playoff round). Tabs:

- **Matchup Analysis** - scoreboard, win probability, category breakdown, score distribution
- **Streamer Analysis** - best free-agent pickups to gain categories
- **Bench Strategy** - start/sit and roster decisions
- **My Season Stats** - season totals for your roster
- **League Stats** - standings and league-wide numbers
- **Playoff & Championship** - bracket seeding and title odds

When the season is over, the app opens on a **Season Summary** page (final standings
and champion); use the View dropdown to revisit any week.

## Category variance

Per-category game-to-game variance used by the simulation (higher = noisier), from
[config.py](config.py):

| Category | Variance |
|----------|----------|
| PTS, FGM, FGA, 3PM, 3PA | 0.7 |
| STL, BLK | 0.8 |
| REB, AST | 0.4 |
| TO | 0.5 |
| FTM, FTA | 0.2 |

## Design

The UI follows a light, print-inspired "Analyst Sheet" theme (graphite ink on warm
paper, a single cobalt accent, monospace figures). The palette is defined in
[styles.py](styles.py), [.streamlit/config.toml](.streamlit/config.toml), and
[visualizations.py](visualizations.py). See [AGENTS.md](AGENTS.md#design-system--analyst-sheet-do-not-drift-from-this)
for the tokens.

## Project layout

```
streamlit_app.py    UI, tabs, season summary, week viewer
data.py             ESPN + NBA schedule + games-left counting
simulation.py       simulation engine, streamers, bench, playoffs
visualizations.py   Plotly charts + scoreboard HTML
config.py           constants + ESPN credentials
styles.py           Analyst Sheet CSS
.streamlit/         theme (config.toml) + secrets template
```

## License

MIT - feel free to modify and share.
