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

/**
 * How many neighbours to show.
 *
 * Five, not ten. As a ten-column table the extra rows cost nothing to render and were
 * skimmed past; as cards each one is a real block of the screen, and the fifth-closest
 * comp is already a stretch — past that the shapes stop resembling each other enough for
 * the answer to be useful.
 */
const N = 5;

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

      {/*
        A card per neighbour, not a ten-column table.
        The question this panel answers is "who else plays like him", and the answer is a
        name and how close it is — the six category columns were the working, not the
        result, and they are one tap away on that player's own card. Owner stays because
        it decides what you can DO about it: a waiver add or a trade you have to negotiate.
      */}
      <div className="pd-sim-list">
        {rows.map(({ p, d }) => (
          <PlayerLink key={p.name} name={p.name} className="pd-sim-card">
            <span className="pd-sim-who">
              <span className="pd-sim-name">{p.name}</span>
              <span className="pd-sim-meta">
                {[p.nbaTeam, p.position].filter(Boolean).join(" · ")}
                {" · "}
                {p.owner === "FA" ? "Free Agent" : p.owner}
              </span>
            </span>
            <span className="pd-sim-pct mono">{pct(d)}</span>
          </PlayerLink>
        ))}
      </div>
    </section>
  );
}
