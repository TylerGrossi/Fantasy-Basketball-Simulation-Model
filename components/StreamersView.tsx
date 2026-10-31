"use client";

import { useEffect, useMemo, useState } from "react";
import type { AcquisitionSummary, LeagueData, Matchup } from "@/lib/league";
import { sideMoments } from "@/lib/league";
import { analyzeStreamers } from "@/lib/streamers";
import { makeOddsSimulator, type Odds, type SeasonContext, type SimPlayer } from "@/lib/playoffOdds";
import { categoryProbabilities } from "@/lib/probability";
import { dayLabel } from "@/lib/dates";
import { useMoveWindow } from "@/lib/useMoveWindow";
import { useLiveSides } from "@/lib/useLiveSides";
import { useSettings } from "@/lib/useSettings";
import LiveBadge from "./LiveBadge";
import PlayerLink from "./PlayerLink";
import FilterBar from "./FilterBar";
import MultiSelect from "./MultiSelect";
import SortableTable, { type SortCol, type SortRow } from "./SortableTable";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
  /**
   * This matchup's acquisitions, used of allowed — ESPN's "Matchup Acquisition Limit",
   * one per day of the matchup (6 in a six-day week, 7 in a normal one). Absent when the
   * export could not work it out.
   */
  acq?: AcquisitionSummary;
  /** Rosters, schedule and records for the playoff / title odds (lib/playoffOdds.ts). */
  season?: SeasonContext | null;
}

const SHOWN = ["PTS", "REB", "AST", "3PM", "STL", "BLK"];

// Every header explains itself on hover (owner, 2026-10-30).
const STREAMER_COLS: SortCol[] = [
  {
    key: "rank",
    label: "#",
    num: true,
    title: "Best move first: this week's Δ Cats plus the Season Δ Cats.",
  },
  { key: "add", label: "Add", title: "The free agent to pick up." },
  { key: "nba", label: "NBA", title: "His NBA team." },
  {
    key: "gl",
    label: "GL",
    num: true,
    title: "Games left: the games he can still play this week if you add him now.",
  },
  {
    key: "netGames",
    label: "Δ Games",
    num: true,
    title:
      "Change in games your lineup actually plays this week: his starts, minus the drop's, minus any starter he pushes to the bench on a full day.",
  },
  { key: "games", label: "Games", title: "The days he plays this week." },
  {
    key: "deltaCats",
    label: "Δ Cats",
    num: true,
    title:
      "This week only: how many more categories you are expected to win this matchup if you make the move. +0.30 = about a third of a category.",
  },
  {
    key: "season",
    label: "Season Δ Cats",
    num: true,
    title:
      "The rest of the regular season: how many more categories you are expected to win, in total over every week after this one, with the pickup on your roster instead of the drop. Negative = the drop is the better player, and you lose that much by letting him go.",
  },
  {
    key: "deltaWin",
    label: "Δ Win %",
    num: true,
    title: "Change in your chance of winning this week's matchup, in percentage points.",
  },
  {
    key: "dPlayoff",
    label: "Δ Playoff",
    num: true,
    title:
      "How much the move changes your playoff chance, in percentage points: this week's result and every week after it, with the pickup instead of the drop.",
  },
  {
    key: "dChamp",
    label: "Δ Champ",
    num: true,
    title: "How much the move changes your title chance, in percentage points.",
  },
  {
    key: "drop",
    label: "Drop",
    title: "Who to release to make room: the one that leaves you best off this week and for the season.",
  },
  {
    key: "value",
    label: "Value",
    num: true,
    title: "The pickup's season value, the same scale as the Roster and Player Value pages.",
  },
  ...SHOWN.map((s) => ({ key: s, label: s, num: true, title: `The pickup's ${s} per game.` })),
];

export default function StreamersView({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
  acq,
  season,
}: Props) {
  // Live totals + each side's projection minus the games those totals already count.
  const { live, you, opp } = useLiveSides(league, matchup, isHome, teamId, liveEnabled);
  // Persisted in localStorage so protected players and the open-spot flag survive a
  // reload — in the Streamlit version these lived in server session state and were lost
  // whenever the host spun down.
  const [settings, updateSettings] = useSettings();
  const openSpot = settings.hasOpenSpot;
  const untouchable = useMemo(
    () => new Set(settings.untouchables),
    [settings.untouchables]
  );

  const youMoments = useMemo(() => sideMoments(you, live.you), [you, live.you]);
  const oppMoments = useMemo(() => sideMoments(opp, live.opp), [opp, live.opp]);

  // Today, ESPN's roster lock and the days a move made now still affects — shared with
  // the Week Planner (lib/useMoveWindow.ts).
  const { today, rosterLocked, dates: moveDates, teams, slots } = useMoveWindow(
    league,
    live.gameLeft
  );
  /*
   * The games a pickup made NOW could still play: later days, plus today's only while
   * the day is unlocked. Before the first tip-off no game today has started, so every
   * game today is still addable.
   */
  const gameDates = (nbaTeam: string): string[] =>
    Object.keys(league.weekSchedule?.teams[nbaTeam] ?? {})
      .filter((d) => !today || d > today || (d === today && !rosterLocked))
      .sort();
  const pickupLeague = useMemo(() => {
    // Anyone already on either live roster is not a free agent any more, whatever the
    // export (which can be hours old) says.
    const taken = new Set([...(live.youToday ?? []), ...(live.oppToday ?? [])].map((t) => t.name));
    const pool = league.freeAgents.filter((fa) => !taken.has(fa.name));
    if (!today || !league.weekSchedule) return { ...league, freeAgents: pool };
    return {
      ...league,
      freeAgents: pool.map((fa) =>
        league.weekSchedule!.teams[fa.nbaTeam]
          ? { ...fa, gamesLeft: Math.min(fa.gamesLeft, gameDates(fa.nbaTeam).length) }
          : fa
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, today, rosterLocked, live.youToday, live.oppToday]);
  /*
   * The days a move made now affects, for the day-by-day lineup (lib/streamers.ts
   * DailyLineup): the rest of the week, starting today while the roster is unlocked and
   * tomorrow once it is.
   */
  const daily = useMemo(
    () => (league.weekSchedule ? { dates: moveDates, teams, slots } : undefined),
    [league.weekSchedule, moveDates, teams, slots]
  );

  /*
   * The rest of the season, so a drop is charged for every week after this one (see
   * SeasonHorizon in lib/streamers.ts). 3.5 games is a typical NBA week.
   */
  const horizon = useMemo(
    () => ({
      weeks: Math.max(0, (league.regularSeasonWeeks ?? 0) - league.period),
      gamesPerWeek: 3.5,
    }),
    [league.regularSeasonWeeks, league.period]
  );
  /*
   * Never a drop: players you protected, and anyone in an IR slot — dropping him frees
   * an IR spot, not a bench spot, so there is still nowhere to put the pickup.
   */
  const noDrop = useMemo(() => {
    const out = new Set(untouchable);
    for (const t of live.youToday ?? []) if (t.slot === 13) out.add(t.name);
    return out;
  }, [untouchable, live.youToday]);

  // Recomputed on every toggle, in milliseconds, with no server round trip. This is the
  // whole point of moving the maths client-side.
  const { baseline, results } = useMemo(
    () =>
      analyzeStreamers(pickupLeague, you.players, youMoments, oppMoments, {
        hasOpenSpot: openSpot,
        untouchables: noDrop,
        daily,
        horizon,
      }),
    [pickupLeague, you.players, youMoments, oppMoments, openSpot, noDrop, daily, horizon]
  );
  const addsLeft = acq ? Math.max(0, acq.max - acq.used) : null;

  /*
   * GAME DATE filter (owner, 2026-10-29): keep only pickups who play on EVERY picked day —
   * Fri + Sun finds the players who cover both nights. Options are the days a move made
   * now can still affect; a picked day that has since passed or locked drops out.
   */
  const [pickedDays, setPickedDays] = useState<string[]>([]);
  const dayOptions = moveDates.filter((d) =>
    Object.values(league.weekSchedule?.teams ?? {}).some((t) => t[d])
  );
  const activeDays = pickedDays.filter((d) => dayOptions.includes(d));
  const onDays = activeDays.length
    ? results.filter((r) => {
        const plays = new Set(gameDates(r.add.nbaTeam));
        return activeDays.every((d) => plays.has(d));
      })
    : results;
  const shown = onDays;

  /*
   * PLAYOFF / TITLE ODDS per move (lib/playoffOdds.ts). The simulator is built once per
   * roster set; the baseline and each move are then ~10ms apiece, run in small batches
   * after paint so the table appears at once and the odds fill in over about a second.
   */
  const sim = useMemo(
    () => (season ? makeOddsSimulator(league, season, teamId) : null),
    [season, league, teamId]
  );
  const simPlayer = (name: string, avg: number[], value?: number): SimPlayer =>
    season?.players[name] ?? { v: avg, value: value ?? 0 };
  const [odds, setOdds] = useState<{ base: Odds; byMove: Map<string, Odds> } | null>(null);
  const moveKey = (r: (typeof results)[number]) => `${r.add.name}|${r.drop?.name ?? ""}`;
  useEffect(() => {
    if (!sim) return;
    let alive = true;
    const mine = you.players.map((p) => simPlayer(p.name, p.avg, p.value));
    const base = sim(mine, categoryProbabilities(league, youMoments, oppMoments));
    const byMove = new Map<string, Odds>();
    setOdds({ base, byMove: new Map(byMove) });
    let i = 0;
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const step = () => {
      if (!alive) return;
      for (const end = Math.min(results.length, i + 8); i < end; i++) {
        const r = results[i];
        const roster = [
          ...you.players
            .filter((p) => p.name !== r.drop?.name)
            .map((p) => simPlayer(p.name, p.avg, p.value)),
          simPlayer(r.add.name, r.add.avg, r.add.value),
        ];
        byMove.set(moveKey(r), sim(roster, categoryProbabilities(league, r.weekMoments, oppMoments)));
      }
      setOdds({ base, byMove: new Map(byMove) });
      if (i < results.length) timer = setTimeout(step, 0);
    };
    timer = setTimeout(step, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, results, you.players, oppMoments, youMoments]);
  // The change this model's simulation measures for the move, in percentage points.
  const shownOdds = (r: (typeof results)[number]) => {
    const o = odds?.byMove.get(moveKey(r));
    if (!o || !odds) return null;
    const dP = o.playoff - odds.base.playoff;
    const dC = o.champ - odds.base.champ;
    return { dP, dC };
  };

  const anyGamesLeft = pickupLeague.freeAgents.some((f) => f.gamesLeft > 0);

  function toggleUntouchable(name: string) {
    const next = new Set(settings.untouchables);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    updateSettings({ untouchables: [...next] });
  }

  return (
    <>
      <LiveBadge {...live} generatedAt={league.generatedAt} />

      {!anyGamesLeft ? (
        <p className="caption">
          No free agent has games remaining in this matchup window, so there is nothing to
          stream. {league.seasonOver ? "The season is over." : ""}
        </p>
      ) : (
        <>
          <FilterBar className="controls">
            <MultiSelect
              label="Game date"
              options={dayOptions.map(dayLabel)}
              selected={activeDays.map(dayLabel)}
              onChange={(labels) =>
                setPickedDays(dayOptions.filter((d) => labels.includes(dayLabel(d))))
              }
            />
            <label className="check">
              <input
                type="checkbox"
                checked={openSpot}
                onChange={(e) => updateSettings({ hasOpenSpot: e.target.checked })}
              />
              I have an open roster spot
            </label>

            <span className="caption" style={{ margin: 0 }}>
              Baseline: {baseline.expectedCats.toFixed(1)} expected cats ·{" "}
              {(baseline.win * 100).toFixed(0)}% win
              {season?.baseline &&
                ` · ${season.baseline.playoff.toFixed(1)}% playoffs · ${season.baseline.champ.toFixed(1)}% title`}
            </span>
            {acq && (
              <span
                className="caption"
                style={{ margin: 0, color: addsLeft === 0 ? "var(--bad)" : undefined }}
              >
                Adds: {acq.used} of {acq.max} used this week
                {addsLeft === 0 ? " — none left" : ""}
              </span>
            )}
            {rosterLocked && (
              <span className="caption" style={{ margin: 0 }}>
                Today&rsquo;s games have started, so a move made now counts from tomorrow.
              </span>
            )}
          </FilterBar>

          {/* About ten rows tall, scrolling inside itself (owner, 2026-10-20): the full
              candidate list made this section the longest on the one-page matchup. The
              header row stays pinned while the rows scroll under it. Sortable on every
              column; opens on Net, the order analyzeStreamers ranks by, and # keeps
              that rank whatever the current sort. */}
          {activeDays.length > 0 && onDays.length === 0 && (
            <p className="caption">
              No free agent plays on all of {activeDays.map(dayLabel).join(", ")}.
            </p>
          )}
          <SortableTable
            scrollClassName="st-scroll"
            defaultKey="dPlayoff"
            cols={STREAMER_COLS}
            rows={shown.map((r, i): SortRow => {
              // Net games your lineup gains — the count the Δ Cats maths used: the
              // pickup's started games, less the drop's and any starter he benches.
              const netGames = r.netGames;
              const signed = (v: number, dp: number) => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;
              const iso = gameDates(r.add.nbaTeam);
              const dates = iso.map(dayLabel).join(" · ") || "-";
              return {
                id: r.add.name,
                cells: {
                  rank: { sort: i + 1, text: String(i + 1) },
                  add: { sort: r.add.name, text: r.add.name, node: <PlayerLink name={r.add.name} /> },
                  nba: { sort: r.add.nbaTeam, text: r.add.nbaTeam },
                  gl: { sort: r.add.gamesLeft, text: String(r.add.gamesLeft) },
                  netGames: {
                    sort: netGames,
                    // Whole games with the day-by-day lineup; one decimal only on the
                    // fallback (no week schedule), where a drop's games can be fractional.
                    text: `${netGames > 0 ? "+" : ""}${
                      Number.isInteger(netGames) ? netGames : netGames.toFixed(1)
                    }`,
                    color: netGames > 0 ? "var(--good)" : netGames < 0 ? "var(--bad)" : "var(--ink-3)",
                  },
                  games: {
                    // By the dates themselves (earliest schedule first), not the
                    // "Wed 10/21" labels, which would sort by weekday name.
                    sort: iso.join(" ") || "~",
                    text: dates,
                    node: <span style={{ whiteSpace: "nowrap" }}>{dates}</span>,
                  },
                  ...(() => {
                    const o = shownOdds(r);
                    const tone = (d: number) =>
                      d > 0.05 ? "var(--good)" : d < -0.05 ? "var(--bad)" : "var(--ink-3)";
                    if (!o) {
                      const wait = { sort: -Infinity, text: "…", color: "var(--ink-3)" };
                      return { dPlayoff: wait, dChamp: wait };
                    }
                    // Only the change (owner, 2026-10-30); your current odds are in the
                    // header line above the table.
                    return {
                      dPlayoff: { sort: o.dP, text: signed(o.dP, 1), color: tone(o.dP) },
                      dChamp: { sort: o.dC, text: signed(o.dC, 1), color: tone(o.dC) },
                    };
                  })(),
                  deltaCats: {
                    sort: r.deltaCats,
                    text: signed(r.deltaCats, 2),
                    color: r.deltaCats > 0 ? "var(--good)" : "var(--ink-3)",
                  },
                  // Shown as a GAIN, same sign as Δ Cats, so Net is simply the sum of the two.
                  season: {
                    sort: -r.seasonCost,
                    text: r.drop ? signed(-r.seasonCost, 2) : "—",
                    color: r.seasonCost < 0 ? "var(--good)" : r.seasonCost > 0 ? "var(--bad)" : "var(--ink-3)",
                  },
                  deltaWin: {
                    sort: r.deltaWinPct,
                    text: signed(r.deltaWinPct, 1),
                    color: r.deltaWinPct > 0 ? "var(--good)" : "var(--ink-3)",
                  },
                  drop: {
                    sort: r.drop?.name ?? "",
                    text: r.drop?.name ?? "open spot",
                    node: r.drop ? undefined : <em>open spot</em>,
                  },
                  value:
                    typeof r.add.value === "number"
                      ? {
                          sort: r.add.value,
                          text: `${r.add.value > 0 ? "+" : ""}${r.add.value.toFixed(1)}`,
                          color: r.add.value > 0 ? "var(--good)" : r.add.value < 0 ? "var(--bad)" : undefined,
                        }
                      : { sort: -Infinity, text: "—" },
                  ...Object.fromEntries(
                    SHOWN.map((s) => {
                      const v = r.add.avg[league.stats.indexOf(s)];
                      return [s, { sort: v, text: v.toFixed(1) }];
                    })
                  ),
                },
              };
            })}
          />

          <h2>Protect from dropping</h2>
          <p className="caption">
            Click a player to exclude them from drop suggestions. Recalculates instantly.
          </p>
          <div className="chips">
            {/* Best first by value (owner, 2026-10-29): the players you are most likely to
                protect lead the list. */}
            {[...you.players].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).map((p) => (
              <button
                key={p.name}
                type="button"
                className={`chip ${untouchable.has(p.name) ? "chip-on" : ""}`}
                onClick={() => toggleUntouchable(p.name)}
                aria-pressed={untouchable.has(p.name)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
