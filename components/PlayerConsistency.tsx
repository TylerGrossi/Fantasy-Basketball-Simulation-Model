"use client";

import { useMemo } from "react";
import type { PoolPlayer } from "@/lib/league";
import { consistency, usePlayerGames, type PlayerGame } from "@/lib/playerGames";

/**
 * How RELIABLE a player was, and his best and worst nights.
 *
 * Two players averaging the same value are not the same asset. One who alternates 30-point
 * games with 4-point games wins you a category some weeks and loses it others; one who
 * posts the same line every night is a floor you can build a roster around. The season
 * average — the only thing the card above shows — is identical for both.
 *
 * Every figure here is the per-game 9-cat value from `usePlayerGames`, scored on the same
 * scale as everything else on the page, so "his median night was +2.1" is directly
 * comparable to the Total Value bar.
 */

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** How many games each extremes list shows. */
const EXTREMES = 5;

export default function PlayerConsistency({
  playerId,
  pool,
}: {
  playerId: number | null;
  pool: PoolPlayer[];
}) {
  const { games, loading } = usePlayerGames(playerId, pool);

  /*
   * The maths lives in lib/espnLive.ts, not here.
   *
   * The Agent quotes these same four numbers, and a panel that computed its own copy
   * would eventually disagree with what the assistant says about the same player —
   * which is worse than either one being slightly off.
   *
   * "Above own avg" is deliberately measured against HIS average, not the league's: a
   * player can beat his own average most nights and still have a middling season, which
   * is exactly the signature of a steady floor with a few disasters. Against the league
   * it would just restate his value.
   */
  const stats = useMemo(() => consistency(games), [games]);

  const ranked = useMemo(() => [...games].sort((a, b) => b.value - a.value), [games]);

  if (!playerId) return null;

  return (
    <section className="pd-sheet">
      <div className="pd-sheet-h">
        <h2>Consistency</h2>
        {stats && <span className="pd-sheet-n">{stats.n} games</span>}
      </div>

      {loading && <p className="pd-sheet-note">Loading…</p>}
      {!loading && !stats && (
        <p className="pd-sheet-note">Not enough games to measure a spread.</p>
      )}

      {stats && (
        <>
          <div className="pd-con-metrics">
            <Metric
              label="Median night"
              value={`${stats.median >= 0 ? "+" : ""}${stats.median.toFixed(1)}`}
              sub="typical game"
            />
            <Metric
              label="Spread"
              value={`± ${stats.sd.toFixed(1)}`}
              sub="std dev, game to game"
            />
            <Metric
              label="Above own avg"
              value={`${Math.round(stats.aboveOwn * 100)}%`}
              sub="of his games"
            />
            <Metric
              label="Above pool avg"
              value={`${Math.round(stats.abovePool * 100)}%`}
              sub="startable nights"
            />
          </div>

          <div className="pd-split-cols">
            <Extremes title="Best games" rows={ranked.slice(0, EXTREMES)} />
            <Extremes title="Worst games" rows={ranked.slice(-EXTREMES).reverse()} />
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="pd-con-metric">
      <div className="pd-con-l">{label}</div>
      <div className="pd-con-v">{value}</div>
      <div className="pd-con-s">{sub}</div>
    </div>
  );
}

function Extremes({ title, rows }: { title: string; rows: PlayerGame[] }) {
  if (!rows.length) return null;
  return (
    <div className="pd-split-block">
      <h3 className="pd-split-h">{title}</h3>
      <div className="table-scroll">
        <table className="sheet sheet-tight">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opp</th>
              <th className="num">PTS</th>
              <th className="num">REB</th>
              <th className="num">AST</th>
              <th className="num">Val</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const c = (k: string) => Number(g.line[k] ?? 0).toFixed(0);
              return (
                <tr key={g.id}>
                  <td>{DATE_FMT.format(new Date(g.date))}</td>
                  <td>
                    {g.home ? "vs " : "@ "}
                    {g.opp}
                  </td>
                  <td className="num">{c("PTS")}</td>
                  <td className="num">{c("REB")}</td>
                  <td className="num">{c("AST")}</td>
                  <td className="num pd-split-v">
                    {g.value >= 0 ? "+" : ""}
                    {g.value.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
