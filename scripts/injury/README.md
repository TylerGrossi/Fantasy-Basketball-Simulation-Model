# Will They Play: the injury models

Each player's chance of playing each game left in the matchup week, shown on
`/will-they-play` (`components/WillTheyPlayView.tsx`, data contract `lib/availability.ts`).

## Two models

| Model | Used for | Reads |
|---|---|---|
| Game-day (`train.py`) | a game the NBA's official injury report covers | listed status, the player's and team's record when listed, injury type, minutes role, games missed, back-to-back habit |
| Look-ahead (`train_lookahead.py`) | a game no report covers yet | second night of a back-to-back, the player's rest habit on those, his availability record, games missed in a row |

Both are gradient-boosted trees with an isotonic calibration map learned on a held-out
season, so "60%" means about 60% of players in that spot played.

## Results (walk-forward by season, 2026-11-03)

Game-day, on Questionable / Doubtful / Probable listings: log loss 0.514 vs 0.554 for
"how often players with that status play", AUC 0.80 vs 0.72; better in all 6 test
seasons; calibrated within a few points in every band. Look-ahead: log loss 0.333 vs
0.510 for the player's own availability rate, AUC 0.85 vs 0.62 (second nights of
back-to-backs: 0.82 vs 0.60). Full numbers: `report.json`, `report_lookahead.json` in the
data folder.

Known limits: the look-ahead is tested ONE game ahead (it knows his status as of his
previous game), so several days out it is less certain than those numbers say; players
whose season ended early are under-represented (a roster span ends at a player's last
appearance), which is why ESPN's Out + expected return overrides it in `score.py`;
Embiid's second-night rest is under-predicted (64% predicted, 44% actual).

## Where the app uses it

The page, and the projections behind the win probability, Streamers, Bench, the planner and
crowded days - for players WITH DOUBT only (a listed or ESPN status, or any game under 85%).
See `applyAvailability` / `rowMoments` in `lib/league.ts`. Healthy players project as before.
The Agent reads the full file through its `will_they_play` tool (`lib/agentTools.ts`), so it
can answer "will X play Saturday?" or "who on my team is at risk?" from the same numbers.

## Sources at scoring time, and which wins

1. The official NBA injury report (latest of the day): a listed status beats everything.
2. ESPN's public injuries feed (`site.api.espn.com/.../nba/injuries`): an expected return
   date and note for every injured player. An ESPN-Out player not cleared by the report is
   0% before that date, the chained look-ahead from it. A player the export still has OUT
   but who is gone from this live feed is treated as returning ("Off ESPN's injury list").
   The fantasy API's own `expected_return_date` came back empty for every player, so it is
   not used.
3. The export's status and injury-aware game count (`nbaGamesLeft`): the fallback.

Later games are CHAINED from the first: each game's chance depends on whether he played
the one before (a played game resets his missed streak), so a returning player's odds
rise through the week instead of repeating today's.

## Where things live

- Raw data (not in git): `%LOCALAPPDATA%\fbbsim-injury-data\` - report PDFs, box score
  CSVs, `reports.csv`, `dataset.csv`, `roster_games.csv`, reports and trained models.
- Training environment (not in git): `%LOCALAPPDATA%\fbbsim-injury-venv\` (pandas,
  scikit-learn 1.9.1, pdfplumber, requests). Both live outside OneDrive on purpose.
- Shipped to the export (in git): `engine/injury/` - `model.pkl`, `model_lookahead.pkl`,
  `state.json` (every player's record through the training cutoff).
- Run in CI: `score.py`, a step in `.github/workflows/refresh-data.yml`, writes
  `public/data/availability.json`. Box scores since the cutoff sit in the Actions cache.

## Retrain (locally, e.g. monthly or each offseason)

```
V=%LOCALAPPDATA%\fbbsim-injury-venv\Scripts\python.exe
%V% scripts/injury/fetch_reports.py --delay 3     # new 5 PM reports only; POLITE - see below
%V% scripts/injury/fetch_boxscores.py             # new box scores only
%V% scripts/injury/parse_reports.py               # ~30 min
%V% scripts/injury/build_dataset.py               # ~15 min; also writes roster_games.csv
%V% scripts/injury/train.py                       # game-day model + report
%V% scripts/injury/train_lookahead.py             # look-ahead model + report
%V% scripts/injury/export_state.py                # -> engine/injury/
```

Then check the two reports, run `score.py` once locally, and commit `engine/injury/`.

## Traps already hit

- **The report host is behind Akamai.** Eight parallel downloads got the machine blocked
  for about an hour. `fetch_reports.py` is sequential with a pause and stops on the
  firewall page. Keep it that way.
- **File names changed in late December 2025**, from `05PM` to `05_00PM` (reports every 15
  minutes). Both are tried.
- **Leakage through "absent from the box".** A player who sat is usually missing from
  ESPN's box score, so any feature read from his own row tonight (home/away, playoffs,
  his team) secretly encodes the answer. The first evaluation looked near perfect (AUC
  0.988) because of exactly that. Every feature comes from the team's game or from games
  before the date.
- **Name matching** drops suffixes (Jimmy Butler III, Reggie Bullock Jr.) and maps renames
  (Enes Kanter -> Enes Freedom). A listed name ESPN never had is dropped, not labelled.
