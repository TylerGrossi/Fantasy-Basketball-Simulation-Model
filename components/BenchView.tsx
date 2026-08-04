"use client";

import { useMemo } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import { sideMoments } from "@/lib/league";
import { analyzeBench } from "@/lib/bench";
import { useLiveTotals } from "@/lib/useLiveTotals";
import LiveBadge from "./LiveBadge";
import PlayerLink from "./PlayerLink";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
}

const SHOWN = ["PTS", "FGA", "FG%", "TO", "REB", "AST"];

export default function BenchView({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
}: Props) {
  const you = isHome ? matchup.home : matchup.away;
  const opp = isHome ? matchup.away : matchup.home;

  const live = useLiveTotals(
    league.period,
    teamId,
    you.current,
    opp.current,
    liveEnabled
  );

  const youMoments = useMemo(() => sideMoments(you, live.you), [you, live.you]);
  const oppMoments = useMemo(() => sideMoments(opp, live.opp), [opp, live.opp]);

  const analysis = useMemo(
    () => analyzeBench(league, you.players, youMoments, oppMoments, live.you),
    [league, you.players, youMoments, oppMoments, live.you]
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

  const { playAll, benchAll, benchAllBetter, perPlayer } = analysis;
  const hurting = perPlayer.filter((p) => p.hurts);

  return (
    <>
      <LiveBadge {...live} generatedAt={league.generatedAt} />

      <div className="metrics">
        <Metric
          label="Play everyone"
          value={playAll.expectedCats.toFixed(1)}
          sub={`${(playAll.win * 100).toFixed(0)}% win`}
        />
        <Metric
          label="Bench everyone"
          value={benchAll.expectedCats.toFixed(1)}
          sub={`${(benchAll.win * 100).toFixed(0)}% win`}
        />
        <Metric
          label="Difference"
          value={`${benchAll.expectedCats - playAll.expectedCats >= 0 ? "+" : ""}${(
            benchAll.expectedCats - playAll.expectedCats
          ).toFixed(2)}`}
          sub="cats, bench vs play"
          tone={benchAllBetter ? "bad" : "good"}
        />
        <Metric
          label="Players hurting you"
          value={String(hurting.length)}
          sub={`of ${perPlayer.length} with games left`}
          tone={hurting.length ? "bad" : "good"}
        />
      </div>

      <p className="caption">
        {benchAllBetter ? (
          <>
            Sitting your whole roster would actually score better than playing it — your
            remaining production is costing you more in percentages and turnovers than it
            gains elsewhere.
          </>
        ) : (
          <>Playing your roster beats sitting it. Individual players may still hurt.</>
        )}{" "}
        &ldquo;Sit&rdquo; here means the player misses <em>all</em> their remaining games
        in this matchup, not just today.
      </p>

      <h2>Per-player impact of sitting</h2>
      <p className="caption">
        Positive Δ means your expected category total goes <strong>up</strong> if that
        player sits — they are a net negative for this particular matchup.
      </p>

      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th>Player</th>
              <th>NBA</th>
              <th className="num">GL</th>
              <th className="num">Δ Cats if sat</th>
              <th className="num">Δ Win %</th>
              <th>Verdict</th>
              {SHOWN.map((s) => (
                <th key={s} className="num">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perPlayer.map((r) => (
              <tr key={r.player.name}>
                <td><PlayerLink name={r.player.name} /></td>
                <td>{r.player.nbaTeam}</td>
                <td className="num">{r.player.gamesLeft}</td>
                <td
                  className="num"
                  style={{
                    color: r.hurts ? "var(--bad)" : "var(--ink-3)",
                    fontWeight: r.hurts ? 700 : 400,
                  }}
                >
                  {r.deltaCats >= 0 ? "+" : ""}
                  {r.deltaCats.toFixed(3)}
                </td>
                <td className="num" style={{ color: r.hurts ? "var(--bad)" : "var(--ink-3)" }}>
                  {r.deltaWinPct >= 0 ? "+" : ""}
                  {r.deltaWinPct.toFixed(1)}
                </td>
                <td>
                  {r.hurts ? (
                    <span className="tag">CONSIDER SITTING</span>
                  ) : (
                    <span style={{ color: "var(--ink-3)" }}>play</span>
                  )}
                </td>
                {SHOWN.map((s) => {
                  const i = league.stats.indexOf(s);
                  const v =
                    i >= 0
                      ? r.player.avg[i].toFixed(1)
                      : ratio(league, r.player.avg, s);
                  return (
                    <td key={s} className="num">
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Per-game ratio categories aren't stored directly — derive from made/attempted. */
function ratio(league: LeagueData, avg: number[], cat: string): string {
  const pairs: Record<string, [string, string]> = {
    "FG%": ["FGM", "FGA"],
    "FT%": ["FTM", "FTA"],
    "3P%": ["3PM", "3PA"],
  };
  const pair = pairs[cat];
  if (!pair) return "-";
  const made = avg[league.stats.indexOf(pair[0])] ?? 0;
  const att = avg[league.stats.indexOf(pair[1])] ?? 0;
  return att > 0 ? `${((made / att) * 100).toFixed(1)}%` : "-";
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div
        className="metric-value mono"
        style={tone ? { color: tone === "good" ? "var(--good)" : "var(--bad)" } : undefined}
      >
        {value}
      </div>
      {sub && <div className="metric-delta mono">{sub}</div>}
    </div>
  );
}
