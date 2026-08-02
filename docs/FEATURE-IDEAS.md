# Feature ideas

A backlog of things this app could do, drawn from what the established fantasy
basketball tools offer and filtered for what makes sense here: **one owner, one ESPN
head-to-head category league, all maths in the browser, Analyst Sheet aesthetic.**

Written 2026-08-01, revised the same day as items shipped. Nothing here is
committed work — it is a menu. Strike items out as they land.

The one exception to "one owner, one league" is **section H**, which is the idea of
opening the app to anybody with an ESPN league. It is documented, deliberately not
scheduled, and it is the only item that changes the premise every other item rests on.

## How to read the tags

| Tag | Meaning |
|-----|---------|
| `SHIPS TODAY` | Everything it needs is already in `public/data/league.json`. Pure front-end work. |
| `PIPELINE` | Needs new fields out of `scripts/build_data.py`. Still one scheduled export, no new infrastructure. |
| `NEW DATA` | Needs a source the project does not have yet (multi-season archive, per-game player logs at scale, live NBA schedule in the export). |
| `PLATFORM` | Changes what the app *is*, not what it shows. New infrastructure — a database, accounts, per-user data. Only section H. |

Effort is a rough t-shirt size for the front-end half.

---

## What already exists

So nothing below duplicates it. Eighteen routes: Home, Scoreboard, Matchup, Roster,
Streamers, Bench, Season Summary, Season Stats, League Stats, Schedule, Power Rankings,
Playoff Odds, Player Value, Player Card, Compare, Trade Simulator, Agent, Settings.
Parity with the Streamlit app is complete.

The engine already does: closed-form category probabilities, Poisson-binomial exact
score distribution, all-play records, luck, power rankings with rank history, playoff
and championship odds, streamer sweeps, bench decisions, and 9-cat player values with
30-day and 15-day trends.

**Shipped since this list was written** (2026-08-01, same day — the doc aged fast):

- **Trade Simulator rebuilt** as a two-panel board: both rosters visible and searchable,
  a per-team filter, live per-side value totals, and a result card pairing the verdict
  with the category shift. This closed **B4** and **D1** below, which are removed.
- **Category record vs the league**, before → after a trade, over the league's own 14
  scorable categories and each side's best ten — not the whole roster, which had let
  bench depth decide it. Separate from the season all-play on the standings page, and
  labelled so the two are not confused.
- **Buy Low / Sell High** on the Trade Simulator, with the league's top 20 by value held
  off the buy-low list — a slumping superstar is not a discount.
- **Injuries & missed games** on the Player Card: current diagnosis plus every absence
  this season, derived by diffing the game log against the team schedule.
- **Agent tooling**: `find_players` (filtered search that returns names) and
  `league_rosters`, a model picker with observed rate-limit state, and a stall watchdog.
- **Season History** (`/history`) — **A1** below, now shipped and removed from the list.
  Week-by-week all-play, the deserved record, and per-week "robbed / gifted" flags. Its
  season total independently reproduces the standings' 68.1% all-play, computed a
  completely different way, which is the check that the week-level numbers are right.

---

## The shortlist

If only three things get built, these are the ones. All are `SHIPS TODAY`, all use
`periodResults` — 22 weeks of final 14-stat totals for every team, which is the most
under-used asset in the export.

1. ~~**Weekly all-play**~~ — **shipped** at `/history`.
2. **Punt analysis** (B1) — the defining question of a category league, and nothing in the app answers it.
3. **League record book** (A3) — cheap, and it is the feature people actually come back for.

`/history` is now the natural home for A3 and A4: the page already loads
`periodResults` and reduces over it.

---

## A. Season history and recap

`periodResults` carries every team's final totals for all 22 scoring periods, and
`/history` now reads it. It supports this entire section with no pipeline work.

**Known shape trap, learned building A1:** a playoff round spans TWO scoring periods and
the export carries a row for each — this league's Round 2 appears as period 21 AND 22
with byte-identical totals. Counted naively it is a phantom extra week (it added a win
and 135 fake category comparisons). `dedupePlayoffEchoes` in `lib/history.ts` collapses
them on same-opponent-and-identical-vector; anything else reducing over `periodResults`
needs the same guard.

### A2. Season timeline `SHIPS TODAY` · M
A small-multiple chart per category: your weekly total vs the league median, across the
season. Answers "when did my rebounding fall off a cliff" — invisible in season totals.
Fits the no-charting-library rule; these are sparklines in inline SVG.

### A3. League record book `SHIPS TODAY` · S
Highest weekly total in every category and who owns it, biggest blowout, closest
matchup, longest win streak, most categories won in a week, worst week. This is the
core of [League Legacy](https://leaguelegacy.io/features/fantasy-league-history) and
[Fantasy Record Book](https://fantasyrecordbook.com/features), and it is a couple of
reductions over `periodResults`.

### A4. Manager awards `SHIPS TODAY` · S
Derived superlatives: luckiest and unluckiest (already computed), most consistent
(lowest week-to-week variance), best closer (record in the last five weeks), most
one-sided (average margin). Cheap, and it is what makes a recap shareable.

### A5. Head-to-head history `SHIPS TODAY` · S
Every meeting with a given opponent this season, the category splits, and the aggregate.
Natural extension of the Tale of the Tape already on the Matchup recap.

---

## B. Category strategy

This is the territory of [Basketball Monster](https://basketballmonster.com/) (Team
Analysis, Trade Analysis, Punting) and
[Hashtag Basketball](https://hashtagbasketball.com/). It is the biggest genuine gap in
this app: it models matchups extremely well and says nothing about *build*.

### B1. Punt analysis `SHIPS TODAY` · M
Which categories did you effectively punt, and what would your record have been under
each punt build? Recompute the season's matchups ignoring category *k* and report the
record. Punting is the central strategic decision in a 9-cat league —
[every guide](https://www.rotoballer.com/fantasy-basketball-punting-guide-strategies-values-sleepers-2025-2026/1712272)
opens with it — and the app currently has no view of it.

### B2. Team category strength `SHIPS TODAY` · S
Z-score per category against the league, as a diverging bar. Basketball Monster's Team
Analysis in one screen: where you are strong, where you are weak, and how balanced.

### B3. Punt-aware player values `SHIPS TODAY` · M
The existing 9-cat value assumes you want all nine. Recompute value excluding punted
categories, so Player Value and Trade Simulator rank players for *your* build. This is
the feature that makes B1 actionable rather than trivia.

---

## C. Schedule and streaming

The genre standard — [SportsWZRD](https://www.sportswzrd.com/tools/nba-schedule-analyzer),
FanScout, Hashtag all ship a schedule grid, because
[game count is the biggest weekly lever](https://athlonsports.com/fantasy/nba-schedule-maximize-fantasy-games-played)
in category leagues.

### C1. NBA schedule grid `PIPELINE` · M
All 30 teams by day for a chosen week, colour-coded, sorted by game count. `legacy/data.py`
already scrapes team schedules (`get_team_schedule`, `prefetch_team_schedules_for_rosters`)
for games-left counting — the grid is exporting what it already fetches.

### C2. Back-to-back and rest flags `PIPELINE` · S
Falls out of C1. Useful on Streamers, where a 4-game week with two back-to-backs is not
the same as a clean 4-game week.

### C3. Playoff-week planner `PIPELINE` · M
Which of your players have the most games in the playoff weeks specifically. Matters
disproportionately and is easy to overlook during the regular season.

---

## D. Player tools

### D2. Player consistency `NEW DATA` · M
Game-to-game volatility, not just the average — a 20-point floor is worth more in H2H
than a boom-bust 20-point mean. The Player Card already pulls per-game logs from ESPN
client-side, so the data path exists; doing it for the whole pool needs ~290 requests,
which argues for a pipeline job rather than the browser.

### D3. Usage shift after an injury `NEW DATA` · L
Basketball Monster's "Usage Monster": when a starter goes down, who absorbs the touches.
The highest-value waiver signal there is, and the hardest to source here.

---

## E. Draft prep for next season

The season is over, so this is the timely category.

### E1. Draft board with tiers `SHIPS TODAY` · M
Rank the pool by 9-cat value with tier breaks at the natural gaps. Optionally
punt-aware once B3 exists.

### E2. Keeper value `NEW DATA` · S
Value against draft cost. Needs draft position data, which is not in the export.

---

## F. Recap and sharing

### F1. Auto-written season recap `SHIPS TODAY` · S
The app already has `lib/gemini.ts` and an Agent page. Point it at the recap data and
have it write the league newsletter — the whole product of
[Recap My League](https://www.recapmyleague.com/). Given the awards in A4 and the record
book in A3, the inputs already exist.

### F2. Shareable recap card `SHIPS TODAY` · S
A single self-contained image or page summarising the season for one team. Pairs with
A3/A4.

---

## G. The structural gap

### G1. Multi-season history `NEW DATA` · L
Everything in section A is scoped to one season because the export is overwritten each
run. Archiving `league.json` per season — even just committing a dated copy — turns the
record book into a real one, and it is the thing every league-history product is
actually selling. **Cheapest possible version: keep a dated copy of the export at the
end of each season.** Worth doing before next season starts, because the data cannot be
recovered afterwards.

---

## H. Open it to anybody `PLATFORM` · XL

**Status: documented, not scheduled.** Recorded 2026-08-02 so the shape is written down
before anything is built. Nothing in this section should be started as a side effect of
another task.

The idea: anyone arrives, connects their own ESPN league, picks their team, and gets the
analytics this app already computes — power rankings, category probabilities, playoff
odds, player values, the Agent. Accounts hang off that, and everything per-person
(saved chats, settings, favourite team) hangs off the account.

This inverts the premise at the top of this file. Every other item here assumes **one
owner, one league**; those assumptions are load-bearing in the code, and this section is
the work of removing them. It is a rewrite of the data layer, not a feature.

### H1. Per-league data on demand

**The big one — everything else is easy next to it.** Today
[scripts/build_data.py](../scripts/build_data.py) runs on a schedule with the credentials
in [config.py](../config.py) and writes ONE static `public/data/league.json`; every page
reads that file. There is no code path that fetches a league the build didn't know about.

Multi-tenant means fetching and computing per league, at request time, with a cache —
new server work, a per-league cache keyed by league + season, and a story for the first
visit (a cold league is a slow ESPN crawl, not a file read). The simulation maths stays
in the browser, which is the one thing that makes this tractable: the server fetches and
shapes, it doesn't simulate.

### H2. Connecting a league

Two tiers, and the split matters because it decides how much of this needs accounts:

- **Public leagues** need only a league ID. No login, no credentials, nothing stored —
  paste an ID, see the analytics. This alone is a real product and the natural first
  milestone.
- **Private leagues** need the user's `SWID` and `espn_s2` cookies. Those are **real
  credentials to someone's ESPN account**, not an API key scoped to fantasy. Accepting
  them means encryption at rest, a plain explanation of what they are and how to revoke
  them, and never logging them. Do not build this tier casually. ESPN has no public,
  documented fantasy API and no OAuth for this — there is no clean way to ask for
  narrower access.

### H3. Accounts

Auth.js with Google sign-in over a hosted Postgres (Neon, Supabase, Vercel Postgres).
Straightforward on its own — the effort here is not the auth, it is that everything
currently stored per-browser becomes per-user: the team choice is a cookie
([lib/team.ts](../lib/team.ts)), the display settings are localStorage
([lib/useSettings.ts](../lib/useSettings.ts)). Those move to rows.

### H4. Saved chats

`users → chats → messages`, with a history rail on the Agent page and "New chat" where
Clear now sits. Cheap **once H3 exists**; see the note below for the version that needs
none of this.

### H5. What a second user costs

Not a feature, but the thing that decides whether this ships:

- **Gemini.** One shared server key on a free tier that is already rate-limited for one
  person (see the rate-limit handling in [ModelBar](../components/ModelBar.tsx)).
  Real users need per-user quotas, a paid key, or bring-your-own-key.
- **Hosting.** [render.yaml](../render.yaml) is Render free — 0.1 CPU, 15-minute
  spin-down. Vercel's free tier has an ephemeral filesystem, so nothing can be written
  to disk and any persistence needs the database from H3 regardless.
- **ESPN.** Many users means many crawls of an undocumented endpoint. Cache hard, and
  expect to be rate-limited eventually.

### Suggested order, if it ever starts

1. Public leagues, no login (H1 + the public half of H2). Proves the data layer, which
   is the only genuinely hard part, and is useful on its own.
2. Accounts + saved leagues + saved chats (H3, H4).
3. Private leagues (the credential half of H2), last, once there is something worth
   handing credentials over for.

**Not blocked on any of this:** saving chats to `localStorage` with a history rail is an
afternoon's work, needs no account and no database, and the UI it produces is the same
one H4 would use — only the storage swaps. If saved chats are the actual want, do that
and leave this section alone.

---

## Deliberately not recommended

- **Live draft tools.** ESPN's own draft room is where the draft happens; competing with it is a lot of work for one night a year.
- **League chat / messaging.** Sleeper's strength, and pointless for a single-owner analysis tool.
- **Points-league features.** This league is head-to-head categories. Supporting both would compromise the maths that makes the app fast.
- **A charting library.** See the performance notes in AGENTS.md — Plotly cost 4.87 MB and was removed on purpose. Every chart idea above is inline SVG.

---

## Sources

- [Basketball Monster](https://basketballmonster.com/) — Team Analysis, Trade Analysis, Projected Standings, Schedule Analyzer, Matchup Monster, Usage Monster
- [Hashtag Basketball](https://hashtagbasketball.com/) — rankings, trade analyzer, schedule analysis, premium league tools
- [Sleeper feature list](https://support.sleeper.com/en/articles/1951583-what-are-sleeper-s-unique-features) — GameDay experience, contextual box scores, custom playoffs
- [League Legacy](https://leaguelegacy.io/features/fantasy-league-history) — league history hub, record book, weekly newsletters
- [Fantasy Record Book](https://fantasyrecordbook.com/features) — per-season breakdowns, trophy case, career milestones
- [Recap My League](https://www.recapmyleague.com/) — AI-written season recaps, superlatives, schedule-luck breakdown
- [SportsWZRD schedule analyzer](https://www.sportswzrd.com/tools/nba-schedule-analyzer) — NBA schedule grid, back-to-backs, rest days
- [RotoBaller punting guide](https://www.rotoballer.com/fantasy-basketball-punting-guide-strategies-values-sleepers-2025-2026/1712272) — punt-build strategy
- [Athlon: schedule strategy](https://athlonsports.com/fantasy/nba-schedule-maximize-fantasy-games-played) — why game count dominates weekly category leagues
