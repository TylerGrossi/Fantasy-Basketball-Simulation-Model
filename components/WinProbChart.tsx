"use client";

import { useEffect, useMemo, useState } from "react";
import type { WinProbPoint } from "@/lib/predictions";
import { dayLabel, etDate } from "@/lib/dates";

/**
 * Your win probability across the matchup week (owner, 2026-10-21): the pre-week
 * forecast, every data refresh's reading (public/data/winprob-log.json), and the live
 * value now. One series, so no legend box — the heading names it.
 *
 * Marks follow the app's chart rules: a 2px cobalt line, 8px markers with a 2px surface
 * ring, a recessive grid, and the 50% line dashed as the reference that matters (above it
 * you are favoured). Hovering anywhere on the plot picks the nearest point.
 *
 * The live "now" point is added after mount: it depends on the clock, and a server-
 * rendered timestamp would never match the browser's (a hydration mismatch).
 */

// Compact: it sits as the third column beside the gauge and the score distribution
// (owner, 2026-10-21), so the drawing space is small and the type sized for it.
const W = 360;
const H = 240;
const PAD = { l: 38, r: 10, t: 12, b: 30 };
const PW = W - PAD.l - PAD.r;
const PH = H - PAD.t - PAD.b;
const r2 = (v: number) => Math.round(v * 100) / 100;

export default function WinProbChart({
  points,
  liveWin,
  weekStart,
  weekEnd,
}: {
  points: WinProbPoint[];
  /** The gauge's current value, 0-1; null when there is no live reading. */
  liveWin: number | null;
  /** The matchup window (ISO dates, Eastern), when the export has it. */
  weekStart?: string;
  weekEnd?: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [liveWin]);
  const [hover, setHover] = useState<number | null>(null);

  const all = useMemo(() => {
    const out = points.map((p) => ({ t: Date.parse(p.at), win: p.win, kind: p.kind as string }));
    if (now != null && liveWin != null) out.push({ t: now, win: liveWin, kind: "now" });
    return out.filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  }, [points, now, liveWin]);

  // X spans the whole matchup week (midnight Eastern to the end of its last day), so the
  // chart reads as "how far into the week we are"; without the window, the points' span.
  const [x0, x1] = useMemo(() => {
    if (weekStart && weekEnd) {
      return [Date.parse(`${weekStart}T00:00:00-04:00`), Date.parse(`${weekEnd}T23:59:59-04:00`)];
    }
    const ts = all.map((p) => p.t);
    return ts.length ? [Math.min(...ts), Math.max(...ts) + 1] : [0, 1];
  }, [weekStart, weekEnd, all]);

  if (all.length === 0) {
    return (
      <p className="caption">
        No readings yet — a point is added at each data refresh (every two hours, outside
        game time).
      </p>
    );
  }

  const x = (t: number) => r2(PAD.l + ((Math.min(Math.max(t, x0), x1) - x0) / (x1 - x0)) * PW);
  const y = (p: number) => r2(PAD.t + (1 - p) * PH);
  const line = all.map((p) => `${x(p.t)},${y(p.win)}`).join(" ");

  // One x tick per day of the week, at midnight Eastern.
  const days: string[] = [];
  if (weekStart && weekEnd) {
    for (let d = new Date(`${weekStart}T12:00:00Z`); etDate(d) <= weekEnd && days.length < 15; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
  }

  const h = hover != null ? all[hover] : null;
  const fmtTime = (t: number) =>
    new Date(t).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * PW + PAD.l;
    let best = 0;
    all.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(all[best].t) - px)) best = i;
    });
    setHover(best);
  }

  return (
    <div className="wpc">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Win probability over the week: ${all
          .map((p) => `${(p.win * 100).toFixed(1)}%`)
          .join(", ")}`}
      >
        {/* Recessive grid; the 50% line is the reference and is dashed in ink. */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(g)}
              y2={y(g)}
              stroke={g === 0.5 ? "var(--ink-3)" : "var(--line-2)"}
              strokeDasharray={g === 0.5 ? "4 4" : undefined}
              strokeWidth={1}
            />
            <text x={PAD.l - 8} y={y(g) + 4} textAnchor="end" className="wpc-ax">
              {g * 100}%
            </text>
          </g>
        ))}
        {days.map((d) => {
          const t = Date.parse(`${d}T00:00:00-04:00`);
          const mid = Date.parse(`${d}T12:00:00-04:00`);
          return (
            <g key={d}>
              <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-2)" strokeWidth={1} />
              <text x={x(mid)} y={H - PAD.b + 20} textAnchor="middle" className="wpc-ax">
                {/* Weekday only ("Tue"): six full dates do not fit a third of the row. */}
                {dayLabel(d).split(" ")[0]}
              </text>
            </g>
          );
        })}

        <polyline points={line} fill="none" stroke="var(--cobalt)" strokeWidth={2} strokeLinejoin="round" />
        {all.map((p, i) => (
          <circle
            key={`${p.t}-${i}`}
            cx={x(p.t)}
            cy={y(p.win)}
            r={p.kind === "now" ? 5 : 4}
            fill={p.kind === "now" ? "var(--card)" : "var(--cobalt)"}
            stroke={p.kind === "now" ? "var(--cobalt)" : "var(--card)"}
            strokeWidth={2}
          />
        ))}

        {h && (
          <line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink-3)" strokeWidth={1} />
        )}
        {/* Hit area larger than the marks: the whole plot. */}
        <rect
          x={PAD.l}
          y={PAD.t}
          width={PW}
          height={PH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {h && (
        <div
          className="wpc-tip"
          // Kept inside the plot: a point at the very start or end of the week would
          // otherwise push half the tooltip off the card.
          style={{
            left: `${Math.min(88, Math.max(12, (x(h.t) / W) * 100)).toFixed(2)}%`,
            top: `${((y(h.win) / H) * 100).toFixed(2)}%`,
          }}
        >
          <b className="mono">{(h.win * 100).toFixed(1)}%</b>
          <span>
            {h.kind === "now" ? "Now (live)" : h.kind === "forecast" ? "Pre-week forecast" : "Data refresh"} ·{" "}
            {fmtTime(h.t)}
          </span>
        </div>
      )}
    </div>
  );
}
