"use client";

import { useMemo } from "react";
import type { PoolPlayer } from "@/lib/league";
import { CAT_AXES, percentileRows, type CatAxis, type StatKey } from "@/lib/percentiles";

/**
 * WHICH categories a player actually wins you, as one shape.
 *
 * The percentile bars above answer this stat by stat, and answering it stat by stat is the
 * problem: nine numbers read in sequence do not add up to a picture, and the thing a
 * manager needs from a player page — "what kind of player is this" — is a picture. A
 * punt-turnovers big and a low-usage sharpshooter can post the same Total Value off
 * completely different shapes, and only one of them fits any given roster.
 *
 * The axes are PERCENTILES — the same 0-100 numbers as the bars above, so a spike here and
 * a long bar there are the same fact and the dial needs no separate scale to learn. They
 * replaced z-scores, which were mathematically tidier (they summed to the Total Value) but
 * drew everyone as a small blob near the middle: real z-scores cluster in a narrow band, so
 * the dial spent most of its area on nobody. On percentiles an 80th-percentile category
 * reaches four fifths of the way out, which is what it should look like.
 *
 * Turnovers are inverted upstream by `percentileRows` (fewer is better), so every axis
 * reads the same way: further out is better, and a dent is a weakness wherever it sits.
 *
 * Offence and defence are kept contiguous around the dial (see `CAT_AXES`) so a scorer and
 * a rim-protector produce visibly different silhouettes rather than two similar stars.
 */

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2 + 6;
const R = 96;

/*
 * Centre is the 0th percentile, the outer ring the 100th. Fixed, like every other scale on
 * this card — an auto-fitted radar makes every player's shape fill the dial, which is
 * exactly the comparison it exists to support.
 */

const SHORT: Record<CatAxis, string> = {
  PTS: "PTS",
  "3PM": "3PM",
  "FG%": "FG%",
  "FT%": "FT%",
  AST: "AST",
  REB: "REB",
  STL: "STL",
  BLK: "BLK",
  TO: "TO",
};

/** Where an axis sits on the dial. Starts at 12 o'clock and runs clockwise. */
function angle(i: number): number {
  return (Math.PI * 2 * i) / CAT_AXES.length - Math.PI / 2;
}

function point(i: number, pct: number): [number, number] {
  const t = Math.max(0, Math.min(1, pct / 100));
  const a = angle(i);
  return [CX + Math.cos(a) * R * t, CY + Math.sin(a) * R * t];
}

export default function CategoryShape({
  player,
  pool,
}: {
  player: PoolPlayer;
  pool: PoolPlayer[];
}) {
  /*
   * Straight from the same function the bars use, so the dial can never disagree with them.
   * A category with no sample (no three-point attempts) sits at the centre rather than
   * breaking the outline — the shape then honestly shows a player who gives you nothing
   * there, which is what a zero-attempt shooter does.
   */
  const z = useMemo(() => {
    const rows = percentileRows(pool, player, "Regular");
    const by = new Map(rows.map((r) => [r.spec.key as StatKey, r.percentile]));
    return Object.fromEntries(
      CAT_AXES.map((c) => [c, by.get(c as StatKey) ?? 0])
    ) as Record<CatAxis, number>;
  }, [player, pool]);

  const pts = CAT_AXES.map((c, i) => point(i, z[c]));
  const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  // The 50th percentile — league average, and the one ring that means something.
  const zeroT = 0.5;

  const best = [...CAT_AXES].sort((a, b) => z[b] - z[a]);

  return (
    <section className="pd-sheet">
      <div className="pd-sheet-h">
        <h2>Category Shape</h2>
        <span className="pd-sheet-n">percentile vs pool</span>
      </div>

      <div className="pd-shape">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="pd-shape-svg" role="img"
          aria-label={`Category profile. Strongest: ${best.slice(0, 3).map((c) => SHORT[c]).join(", ")}. Weakest: ${best.slice(-2).map((c) => SHORT[c]).join(", ")}.`}
        >
          {/* Rings. Solid hairlines, one step off the surface — never dashed. */}
          {[0.25, 0.75, 1].map((t) => (
            <circle
              key={t}
              cx={CX}
              cy={CY}
              r={R * t}
              fill="none"
              stroke="var(--line-2)"
              strokeWidth={1}
            />
          ))}
          <circle
            cx={CX}
            cy={CY}
            r={R * zeroT}
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth={1}
          />

          {CAT_AXES.map((c, i) => {
            const a = angle(i);
            const [ex, ey] = [CX + Math.cos(a) * R, CY + Math.sin(a) * R];
            const [lx, ly] = [CX + Math.cos(a) * (R + 17), CY + Math.sin(a) * (R + 17)];
            return (
              <g key={c}>
                <line x1={CX} y1={CY} x2={ex} y2={ey} stroke="var(--line-2)" strokeWidth={1} />
                <text
                  className="pd-shape-ax"
                  x={lx}
                  y={ly + 3}
                  textAnchor={Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end"}
                >
                  {SHORT[c]}
                </text>
              </g>
            );
          })}

          <polygon
            points={poly}
            fill="var(--cobalt)"
            fillOpacity={0.16}
            stroke="var(--cobalt)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {pts.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={2.6} fill="var(--cobalt)" />
          ))}
        </svg>

        <div className="pd-shape-key">
          <div className="pd-shape-row">
            <span className="pd-shape-l">Wins you</span>
            <span className="pd-shape-v">
              {best.slice(0, 3).map((c) => SHORT[c]).join(" · ")}
            </span>
          </div>
          <div className="pd-shape-row">
            <span className="pd-shape-l">Costs you</span>
            <span className="pd-shape-v">
              {best.slice(-2).map((c) => SHORT[c]).join(" · ")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
