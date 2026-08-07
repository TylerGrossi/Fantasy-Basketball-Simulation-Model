"use client";

import { useMemo } from "react";
import type { PoolPlayer } from "@/lib/league";
import { mean, stdev, usePlayerGames, type PlayerGame } from "@/lib/playerGames";

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

  const stats = useMemo(() => {
    if (games.length < 2) return null;
    const vals = games.map((g) => g.value);
    const avg = mean(vals);
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    /*
     * Share of nights at or above his OWN average, not the league's.
     *
     * A player can beat his average in most games and still have a middling season — that
     * is exactly the signature of a steady floor with a few disasters, and it is the shape
     * this number exists to expose. Against the league it would just restate his value.
     */
    const aboveOwn = vals.filter((v) => v >= avg).length / vals.length;
    // League-average nights. Zero is the pool mean by construction, so this needs no
    // arbitrary threshold: it is simply "how often was he a useful player that night".
    const abovePool = vals.filter((v) => v > 0).length / vals.length;
    return { avg, median, sd: stdev(vals), aboveOwn, abovePool, n: vals.length };
  }, [games]);

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
              <th className="num">STL</th>
              <th className="num">BLK</th>
              <th className="num">TO</th>
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
                  <td className="num">{c("STL")}</td>
                  <td className="num">{c("BLK")}</td>
                  <td className="num">{c("TO")}</td>
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
