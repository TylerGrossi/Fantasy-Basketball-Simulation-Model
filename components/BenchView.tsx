"use client";

import { useMemo } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import { sideMoments } from "@/lib/league";
import { analyzeBench } from "@/lib/bench";
import { useLiveSides, useProjectedSides } from "@/lib/useLiveSides";
import type { CrowdedDay } from "@/lib/crowdedDays";
import { useCrowdedDays } from "@/lib/useCrowdedDays";
import { useMoveWindow } from "@/lib/useMoveWindow";
import { dayLabel } from "@/lib/dates";
import LiveBadge from "./LiveBadge";
import PlayerLink from "./PlayerLink";
import RecLine from "./RecLine";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
  /** Your players' ESPN eligible slots, for the crowded-day lineup check. */
  eligibility?: Record<string, string[]>;
}

export default function BenchView({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
  eligibility,
}: Props) {
  // Live totals + each side's projection minus the games those totals already count.
  const { live, you, opp } = useLiveSides(league, matchup, isHome, teamId, liveEnabled);

  const youMoments = useMemo(() => sideMoments(you, live.you), [you, live.you]);
  const oppMoments = useMemo(() => sideMoments(opp, live.opp), [opp, live.opp]);

  // Play vs sit reads the WIN PROBABILITY's sides (your Bench lineup, his ESPN lineup on
  // crowded days), so "Play scenario" is the same number as the gauge. The crowded-day
  // analysis below keeps the export baseline it re-seats from.
  const projected = useProjectedSides(league, matchup, isHome, teamId, liveEnabled);
  const projYou = useMemo(() => sideMoments(projected.you, live.you), [projected.you, live.you]);
  const projOpp = useMemo(() => sideMoments(projected.opp, live.opp), [projected.opp, live.opp]);
  const analysis = useMemo(
    () => analyzeBench(league, projected.you.players, projYou, projOpp, live.you),
    [league, projected.you.players, projYou, projOpp, live.you]
  );

  // Crowded days (owner, 2026-11-03): nights more players have a game than there are
  // starting slots — who to sit, and what each game is worth (lib/crowdedDays.ts).
  const win = useMoveWindow(league, live.gameLeft);
  const crowded = useCrowdedDays(
    league,
    you.players,
    youMoments,
    oppMoments,
    live.youToday,
    live.gameLeft,
    eligibility
  );

  const hasGamesLeft = you.players.some((p) => p.gamesLeft > 0);

  if (!hasGamesLeft) {
    return (
      <>
        <LiveBadge {...live} generatedAt={league.generatedAt} />
        <p className="caption">
          No games remain for your roster in this matchup window, so there is nothing to
          start or sit. {league.seasonOver ? "The season is over." : ""}
        </p>
      </>
    );
  }

  const { playAll, benchAll, benchAllBetter } = analysis;
  const catsDiff = playAll.expectedCats - benchAll.expectedCats;
  const winDiff = (playAll.win - benchAll.win) * 100;

  /*
   * THE OLD (Streamlit) LAYOUT, by request (owner, 2026-10-20): one decision — play the
   * rest of the week, or sit everyone and bank what you have — then the two scenarios
   * side by side, which categories each one helps, and the per-category comparison. Same
   * numbers as before (lib/bench.ts). The folded-away "sit one player" table was removed
   * (owner, 2026-10-21).
   */
  const rows = league.categories.map((cat, i) => {
    const play = (playAll.categoryProbs[i] ?? 0) * 100;
    const bench = (benchAll.categoryProbs[i] ?? 0) * 100;
    return { cat, play, bench, diff: bench - play };
  });
  // The old thresholds: a choice "helps" a category when it moves it by over 5 points.
  const playHelps = rows.filter((r) => r.diff < -5).sort((a, b) => a.diff - b.diff);
  const benchHelps = rows.filter((r) => r.diff > 5).sort((a, b) => b.diff - a.diff);

  return (
    <>
      <LiveBadge {...live} generatedAt={league.generatedAt} />

      <p className="caption ctx">
        Late in a matchup you can lock in a lead by sitting everyone: banked totals cannot
        go down. This compares playing out the rest of the week with sitting the whole
        roster, category by category.
      </p>
      {/* The crowded days' one-line format (components/RecLine.tsx), owner 2026-11-03. */}
      <RecLine
        tone={benchAllBetter ? "hold" : "go"}
        why={`${benchAllBetter ? "+" : "+"}${Math.abs(catsDiff).toFixed(2)} cats and ${Math.abs(winDiff).toFixed(1)}% win over ${benchAllBetter ? "playing" : "sitting everyone"}`}
      >
        {benchAllBetter ? "Sit everyone" : "Play everyone"}
      </RecLine>

      <div className="bn-scen">
        <Scenario
          kind="play"
          title="Play scenario"
          note="Everyone plays their remaining games."
          win={playAll.win}
          cats={playAll.expectedCats}
          helpsLabel="Playing helps"
          helps={playHelps.map((r) => [r.cat, -r.diff])}
        />
        <Scenario
          kind="bench"
          title="Bench scenario"
          note="Everyone sits; only what is already banked counts."
          win={benchAll.win}
          cats={benchAll.expectedCats}
          helpsLabel="Benching helps"
          helps={benchHelps.map((r) => [r.cat, r.diff])}
        />
      </div>

      <h3 className="bn-h">Category comparison (play vs bench)</h3>
      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Play win %</th>
              <th className="num">Bench win %</th>
              <th className="num">Difference</th>
              <th>Better</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat}>
                <td>{r.cat}</td>
                <td className="num">{r.play.toFixed(1)}%</td>
                <td className="num">{r.bench.toFixed(1)}%</td>
                <td className="num">
                  {r.diff >= 0 ? "+" : ""}
                  {r.diff.toFixed(1)}%
                </td>
                <td className={`bn-better${r.diff > 2 ? " bench" : r.diff < -2 ? " play" : ""}`}>
                  {r.diff > 2 ? "Bench" : r.diff < -2 ? "Play" : "Same"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="bn-h">Crowded days: who to sit</h3>
      {crowded == null ? (
        <p className="caption">This export has no daily schedule, so crowded days cannot be read.</p>
      ) : crowded.length === 0 ? (
        <p className="caption">
          No day left this week has more of your players with a game than a legal lineup can
          start, so everyone who plays can start.
        </p>
      ) : (
        <>
          <p className="caption ctx">
            Days not everyone with a game can start: more than {win.slots} playing, or too many
            at one position. Every legal lineup (PG, SG, SF, PF, C, G, F, UTIL) is scored against
            this matchup and compared with starting by season value. <b>One game</b> is what that player&apos;s game that
            night adds to expected categories and win chance (negative means it hurts you).
          </p>
          {crowded.map((d) => (
            <CrowdedDayCard key={d.date} day={d} categories={league.categories} />
          ))}
        </>
      )}
    </>
  );
}

const signed = (x: number, digits: number) => `${x >= 0 ? "+" : ""}${x.toFixed(digits)}`;
/** "Zach LaVine" -> "LaVine"; keeps a suffix with its name ("Jabari Smith Jr." -> "Smith Jr."). */
const lastName = (n: string) => {
  const parts = n.split(" ");
  const suffix = /^(Jr\.?|Sr\.?|II|III|IV)$/.test(parts[parts.length - 1] ?? "");
  return parts.slice(suffix ? -2 : -1).join(" ");
};

/**
 * One crowded day on one line (owner, 2026-11-03): the date, the recommendation, then the
 * numbers in brackets — what each sat player's game is worth, and how far ahead of the
 * next-best option (his closest one-for-one swap) the call is, without naming that player.
 */
function CrowdedDayCard({ day, categories }: { day: CrowdedDay; categories: string[] }) {
  const sits = day.players.filter((p) => p.recSit);
  return (
    <section className="bn-day">
      <div className="bn-day-h">
        <span className="mono">{dayLabel(day.date)}</span>;{" "}
        <span className="bn-day-rec">
          Recommend: Sit{" "}
          {sits.map((p, i) => (
            <span key={p.name}>
              {i > 0 && ", "}
              <b>
                <PlayerLink name={p.name} />
              </b>
            </span>
          ))}{" "}
          <span className="bn-day-why">
            (
            {sits.map((p, i) => (
              <span key={p.name}>
                {i > 0 && "; "}
                {sits.length > 1 && `${lastName(p.name)}: `}
                <span className="mono">{signed(p.gameCats, 3)}</span> cats and{" "}
                <span className="mono">{signed(p.gameWinPct, 1)}%</span> win;{" "}
                {p.swapCats != null ? (
                  <>
                    <span className="mono">{Math.abs(p.swapCats).toFixed(3)}</span> cats better than
                    the next-best option
                  </>
                ) : (
                  "no other legal option"
                )}
              </span>
            ))}
            )
          </span>
        </span>
      </div>
      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th>Slot</th>
              <th>Player</th>
              <th>Pos</th>
              <th className="num">Value</th>
              <th className="num">One game: cats</th>
              <th className="num">One game: win %</th>
              <th>Swap (xCats)</th>
              <th>Moves most</th>
              <th>Call</th>
            </tr>
          </thead>
          <tbody>
            {day.players.map((p) => {
              const top = p.gameByCat
                .map((x, c) => [categories[c], x] as const)
                .filter(([, x]) => Math.abs(x) >= 0.5)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .slice(0, 3);
              return (
                <tr key={p.name} className={p.recSit ? "bn-sit" : ""}>
                  <td className="mono">{p.slot ?? "Bench"}</td>
                  <td>
                    <PlayerLink name={p.name} /> <span className="bn-note">{p.nbaTeam}</span>
                  </td>
                  <td className="mono bn-cats">{p.positions?.join(", ") || "?"}</td>
                  <td className="num">{p.value.toFixed(1)}</td>
                  <td className={`num${p.gameCats < 0 ? " bn-neg" : ""}`}>{signed(p.gameCats, 3)}</td>
                  <td className={`num${p.gameWinPct < 0 ? " bn-neg" : ""}`}>{signed(p.gameWinPct, 1)}%</td>
                  <td
                    className="bn-swap"
                    title={
                      p.swapWinPct == null ? undefined : `Win chance ${signed(p.swapWinPct, 1)}%`
                    }
                  >
                    {p.swapWith == null || p.swapCats == null ? (
                      <span className="bn-note">locked</span>
                    ) : (
                      <>
                        {p.recSit ? `for ${lastName(p.swapWith)}` : `${lastName(p.swapWith)} in`}{" "}
                        <span className="mono">{signed(p.swapCats, 3)}</span>
                      </>
                    )}
                  </td>
                  <td className="mono bn-cats">
                    {top.length === 0
                      ? "-"
                      : top.map(([c, x]) => `${c} ${signed(x, 1)}`).join(", ")}
                  </td>
                  <td className={`bn-better ${p.recSit ? "bench" : "play"}`}>
                    {p.recSit ? "Sit" : "Start"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One scenario card: its win chance, expected cats, and the categories it helps. */
function Scenario({
  kind,
  title,
  note,
  win,
  cats,
  helpsLabel,
  helps,
}: {
  kind: "play" | "bench";
  title: string;
  note: string;
  win: number;
  cats: number;
  helpsLabel: string;
  helps: Array<[string, number]>;
}) {
  return (
    <section className={`bn-card ${kind}`}>
      <div className="bn-card-h">{title}</div>
      <div className="bn-note">{note}</div>
      <div className="bn-stats">
        <div>
          <span className="bn-l">Win probability</span>
          <span className="bn-v mono">{(win * 100).toFixed(1)}%</span>
        </div>
        <div>
          <span className="bn-l">Expected cats</span>
          <span className="bn-v mono">{cats.toFixed(2)}</span>
        </div>
      </div>
      <div className="bn-helps">
        <div className="bn-l">{helpsLabel}</div>
        {helps.length === 0 ? (
          <div className="bn-note">No category by more than 5 points.</div>
        ) : (
          helps.slice(0, 5).map(([cat, d]) => (
            <div key={cat} className="bn-help mono">
              {cat} +{d.toFixed(1)}%
            </div>
          ))
        )}
      </div>
    </section>
  );
}
