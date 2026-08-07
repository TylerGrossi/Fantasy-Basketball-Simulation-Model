"use client";

import { useMemo } from "react";
import type { PoolPlayer } from "@/lib/league";
import { CAT_AXES, MIN_GP, gamesFor, makeZVector } from "@/lib/percentiles";
import { lineOf } from "@/lib/playerShape";
import PlayerLink from "./PlayerLink";

/**
 * The players whose category profile most resembles this one.
 *
 * Similar VALUE is easy and nearly useless — two players at +3.0 can be opposites. This
 * matches on SHAPE: the distance between their nine-category z-vectors, the same vectors
 * the shape dial draws and the same ones Total Value sums. So a neighbour here does the
 * same things for your roster, not merely the same amount of good.
 *
 * That is the question a trade or a waiver claim actually asks. Losing a big to injury,
 * you do not want "someone equally valuable", you want the blocks and rebounds back.
 *
 * Only players with a real season are eligible — a nine-game sample can look like anyone,
 * and offering one as a replacement would be recommending noise.
 */

/** How many neighbours to show. Ten fills the column beside the shape dial. */
const N = 10;

/** Distance in nine-category z-space. Plain Euclidean: every category counts once. */
function distance(a: Record<string, number>, b: Record<string, number>): number {
  let sum = 0;
  for (const c of CAT_AXES) sum += (a[c] - b[c]) ** 2;
  return Math.sqrt(sum);
}

export default function SimilarPlayers({
  player,
  pool,
}: {
  player: PoolPlayer;
  pool: PoolPlayer[];
}) {
  const rows = useMemo(() => {
    const vec = makeZVector(pool);
    const mine = vec(lineOf(player));
    return pool
      .filter((p) => p.name !== player.name && gamesFor(p, "Regular") >= MIN_GP.Regular)
      .map((p) => ({ p, d: distance(mine, vec(lineOf(p))) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, N);
  }, [player, pool]);

  if (!rows.length) return null;

  /*
   * Similarity as a percentage, so the column is readable without knowing what a z-space
   * distance is. Scaled against a distance of 6 — roughly the gap between an average
   * player and a star across all nine categories at once — and floored at zero.
   */
  const pct = (d: number) => `${Math.max(0, Math.round((1 - d / 6) * 100))}%`;

  return (
    <section className="pd-sheet">
      <div className="pd-sheet-h">
        <h2>Similar Players</h2>
        <span className="pd-sheet-n">by category profile</span>
      </div>

      <div className="table-scroll">
        <table className="sheet sheet-tight">
          <thead>
            <tr>
              <th>Player</th>
              <th>Team</th>
              <th className="num">Match</th>
              <th className="num">Val</th>
              <th className="num">PTS</th>
              <th className="num">REB</th>
              <th className="num">AST</th>
              <th className="num">STL</th>
              <th className="num">BLK</th>
              <th className="num">3PM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, d }) => (
              <tr key={p.name}>
                <td>
                  <PlayerLink name={p.name} />
                </td>
                {/* Who holds him matters more than which NBA team he plays for: it is the
                    difference between a waiver add and a trade you have to negotiate. */}
                <td className="pd-sim-own">{p.owner === "FA" ? "Free Agent" : p.owner}</td>
                <td className="num">{pct(d)}</td>
                <td className="num pd-split-v">
                  {p.value >= 0 ? "+" : ""}
                  {p.value.toFixed(1)}
                </td>
                <td className="num">{p.PTS.toFixed(1)}</td>
                <td className="num">{p.REB.toFixed(1)}</td>
                <td className="num">{p.AST.toFixed(1)}</td>
                <td className="num">{p.STL.toFixed(1)}</td>
                <td className="num">{p.BLK.toFixed(1)}</td>
                <td className="num">{p["3PM"].toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
