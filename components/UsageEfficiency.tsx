"use client";

import { useMemo, useRef, useState } from "react";
import type { PoolPlayer } from "@/lib/league";
import { MIN_GP, gamesFor } from "@/lib/percentiles";

/**
 * Volume against efficiency, this player against the whole pool.
 *
 * The trade-off nobody escapes: the more of an offence a player is handed, the harder his
 * shots get. So "he shoots 61%" means one thing on four attempts a game and something else
 * entirely on twenty, and a percentile bar for FG% cannot tell you which — it ranks the
 * rate and says nothing about the load behind it.
 *
 * Plotted as a scatter because the interesting fact is a POSITION relative to a cloud: up
 * and to the right is a star, up and to the left is a specialist you can stream, down and
 * to the right is a volume scorer costing you percentages. Those are three different roster
 * decisions and they are indistinguishable in a table of averages.
 *
 * Every dot is a live player: hover names him, click switches the card to him. That turns
 * the chart from a picture into the fastest way around the pool — "who else is up here"
 * is one glance and one click rather than a search box and a guess.
 *
 * Shooting possessions use the standard 0.44 weight on free-throw attempts — a trip to the
 * line is not a full possession, because and-ones and technicals exist.
 *
 * DESKTOP ONLY (`pd-desktop-only`). Two hundred-odd overlapping dots need a pointer to be
 * worth anything: there is no hover on a phone, the marks are smaller than a fingertip,
 * and the whole cloud collapses into a smudge at 340px wide. A chart that cannot be
 * interrogated is just decoration, so the phone gets the sections that still work instead.
 */

const W = 640;
const H = 320;
const PAD_L = 44;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 42;

/** How close the pointer must get, in SVG units, before a dot is considered hovered. */
const HIT = 14;

interface Pt {
  name: string;
  x: number;
  y: number;
  value: number;
  gp: number;
}

/** Shot equivalents per game: field goals plus the possession-share of free throws. */
function usage(p: PoolPlayer): number {
  return p.FGA + 0.44 * p.FTA;
}

/** Points per shooting possession — true shooting, on the 0-2 scale it naturally lives on. */
function efficiency(p: PoolPlayer): number {
  const poss = usage(p);
  return poss > 0 ? p.PTS / poss : 0;
}

export default function UsageEfficiency({
  player,
  pool,
  onPick,
}: {
  player: PoolPlayer;
  pool: PoolPlayer[];
  /** Switch the card to another player. Omit to make the dots inert. */
  onPick?: (name: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);

  const { pts, me, bounds, mx, my } = useMemo(() => {
    // Qualified players only: a four-game cameo at 90% true shooting is not a data point
    // about the trade-off, it is a data point about small samples.
    const qualified = pool.filter((p) => gamesFor(p, "Regular") >= MIN_GP.Regular);
    const pts: Pt[] = qualified.map((p) => ({
      name: p.name,
      x: usage(p),
      y: efficiency(p),
      value: p.value,
      gp: p.gp ?? 0,
    }));
    const me: Pt = {
      name: player.name,
      x: usage(player),
      y: efficiency(player),
      value: player.value,
      gp: player.gp ?? 0,
    };
    const xs = [...pts.map((p) => p.x), me.x];
    const ys = [...pts.map((p) => p.y), me.y];
    const mid = (v: number[]) => {
      const s = [...v].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)] ?? 0;
    };
    return {
      pts,
      me,
      bounds: {
        x0: 0,
        x1: Math.max(...xs) * 1.06,
        y0: Math.min(...ys) * 0.94,
        y1: Math.max(...ys) * 1.04,
      },
      mx: mid(pts.map((p) => p.x)),
      my: mid(pts.map((p) => p.y)),
    };
  }, [player, pool]);

  const px = (v: number) =>
    PAD_L + ((v - bounds.x0) / (bounds.x1 - bounds.x0)) * (W - PAD_L - PAD_R);
  const py = (v: number) =>
    PAD_T + (1 - (v - bounds.y0) / (bounds.y1 - bounds.y0)) * (H - PAD_T - PAD_B);

  const quadrant = (p: Pt) =>
    p.x >= mx && p.y >= my
      ? "High volume, efficient"
      : p.x < mx && p.y >= my
        ? "Low volume, efficient"
        : p.x >= mx
          ? "High volume, inefficient"
          : "Low volume, inefficient";

  /** Pointer -> nearest dot, in viewBox units. The SVG scales, so client px must be mapped. */
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    let best: Pt | null = null;
    let bestD = HIT;
    for (const p of [...pts, me]) {
      const d = Math.hypot(px(p.x) - sx, py(p.y) - sy);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    setHover(best);
  };

  const shown = hover ?? me;

  return (
    <section className="pd-sheet pd-desktop-only">
      <div className="pd-sheet-h">
        <h2>Volume vs Efficiency</h2>
        <span className="pd-sheet-n">{quadrant(me)}</span>
      </div>

      <div>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="pd-ue-svg"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          // Click anywhere near a dot opens that player — the hit test already found him,
          // so there is nothing extra to aim at.
          onClick={() => hover && onPick && hover.name !== me.name && onPick(hover.name)}
          style={{ cursor: hover && hover.name !== me.name ? "pointer" : "default" }}
          role="img"
          aria-label={`${player.name}: ${me.x.toFixed(1)} shooting possessions per game at ${me.y.toFixed(2)} points each. ${quadrant(me)} relative to the pool.`}
        >
          {/* Quadrant wash — the faintest possible cue that the medians divide the plot
              into four readings, without drawing four boxes. */}
          <rect
            x={px(mx)}
            y={PAD_T}
            width={W - PAD_R - px(mx)}
            height={py(my) - PAD_T}
            fill="var(--cobalt)"
            fillOpacity={0.04}
          />

          {/* Median crosshair, under every dot. */}
          <line x1={px(mx)} y1={PAD_T} x2={px(mx)} y2={H - PAD_B} stroke="var(--line)" strokeWidth={1} />
          <line x1={PAD_L} y1={py(my)} x2={W - PAD_R} y2={py(my)} stroke="var(--line)" strokeWidth={1} />

          <text className="pd-ue-q" x={W - PAD_R - 4} y={PAD_T + 11} textAnchor="end">
            EFFICIENT · HIGH VOLUME
          </text>
          <text className="pd-ue-q" x={PAD_L + 4} y={H - PAD_B - 5} textAnchor="start">
            LOW VOLUME · INEFFICIENT
          </text>

          {/* The pool, in the de-emphasis grey — context, not subjects. */}
          {pts.map((p) => (
            <circle
              key={p.name}
              cx={px(p.x)}
              cy={py(p.y)}
              r={2.6}
              fill="var(--ink-3)"
              fillOpacity={0.45}
            />
          ))}

          {/* Whoever is hovered, promoted out of the cloud and NAMED where he sits.
              Labelling in place is the whole reason the side panel could go: the answer
              appears at the point you are pointing at, not in a column across the card. */}
          {hover && hover.name !== me.name && (
            <>
              <circle
                cx={px(hover.x)}
                cy={py(hover.y)}
                r={5}
                fill="var(--clay)"
                stroke="var(--card)"
                strokeWidth={2}
              />
              <text
                className="pd-ue-tag"
                x={px(hover.x) + (px(hover.x) > W * 0.72 ? -9 : 9)}
                y={py(hover.y) + 3.5}
                textAnchor={px(hover.x) > W * 0.72 ? "end" : "start"}
              >
                {hover.name}
              </text>
            </>
          )}

          {/* Him. The one mark that is allowed to be loud, and always named. */}
          <circle
            cx={px(me.x)}
            cy={py(me.y)}
            r={5.5}
            fill="var(--cobalt)"
            stroke="var(--card)"
            strokeWidth={2}
          />
          <text
            className="pd-ue-tag pd-ue-tag-me"
            x={px(me.x) + (px(me.x) > W * 0.72 ? -10 : 10)}
            y={py(me.y) + 3.5}
            textAnchor={px(me.x) > W * 0.72 ? "end" : "start"}
          >
            {me.name}
          </text>

          {/* Axes. Ticks are round numbers so the grid reads without being drawn. */}
          <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--line-strong)" strokeWidth={1} />
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--line-strong)" strokeWidth={1} />

          {[bounds.y0, (bounds.y0 + bounds.y1) / 2, bounds.y1].map((t) => (
            <text key={t} className="pd-ue-ax" x={PAD_L - 6} y={py(t) + 3} textAnchor="end">
              {t.toFixed(2)}
            </text>
          ))}
          {[0, Math.round(bounds.x1 / 2), Math.floor(bounds.x1)].map((t) => (
            <text key={t} className="pd-ue-ax" x={px(t)} y={H - PAD_B + 13} textAnchor="middle">
              {t}
            </text>
          ))}

          <text className="pd-ue-title" x={(PAD_L + W - PAD_R) / 2} y={H - 6} textAnchor="middle">
            Shooting possessions per game
          </text>
          <text
            className="pd-ue-title"
            transform={`translate(11 ${(PAD_T + H - PAD_B) / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            Points per possession
          </text>
        </svg>

      </div>

      {/*
        One line under the plot instead of a column beside it.
        
        The side panel cost the chart a fifth of its width to restate four numbers, and
        the chart IS the point — a scatter reads better the more room the cloud gets. With
        the hovered player named in place, all this has to carry is the detail behind the
        name, so it fits on a row and never moves.
      */}
      <div className="pd-ue-bar">
        <span className="pd-ue-who">
          {shown.name}
          {shown.name === me.name && <em> · this card</em>}
        </span>
        <span className="pd-ue-stat">
          <b>{shown.x.toFixed(1)}</b> shots/gm
        </span>
        <span className="pd-ue-stat">
          <b>{shown.y.toFixed(2)}</b> pts/shot
        </span>
        <span className="pd-ue-stat">
          <b>
            {shown.value >= 0 ? "+" : ""}
            {shown.value.toFixed(1)}
          </b>{" "}
          value
        </span>
        <span className="pd-ue-stat">
          <b>{shown.gp}</b> games
        </span>
        <span className="pd-ue-quad">{quadrant(shown)}</span>
      </div>
    </section>
  );
}
