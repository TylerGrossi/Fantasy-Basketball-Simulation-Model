"use client";

import { useState } from "react";

/**
 * Weekly power-rank movement — inline SVG, ported from legacy/visualizations.py.
 *
 * One polyline per team with rank 1 at the top; your team in cobalt and thick, everyone
 * else a muted hairline so the shape of your season is what stands out.
 *
 * Hovering a WEEK column shows that week's whole table with each team's movement since
 * the week before. That tooltip is a real HTML element, not an SVG <title>: a native
 * tooltip cannot be styled (no white panel, no coloured arrows), is delayed by the
 * browser, and forces the help cursor. This is the one chart here with hover state —
 * everything else stays hand-rolled SVG with no JS, per the note in AGENTS.md.
 */

interface Props {
  weeks: number[];
  teams: Array<{ teamId: number; teamName: string; rankHistory: number[] }>;
  yourTeamId: number;
}

const W = 900;
const H = 420;
const PAD_L = 42;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 34;

export default function RankTrendChart({ weeks, teams, yourTeamId }: Props) {
  // Which week column the pointer is over. Click also sets it, so the tooltip is
  // reachable on touch, where there is no hover at all.
  const [hover, setHover] = useState<number | null>(null);

  if (!weeks.length || !teams.length) {
    return <p className="caption">Not enough weeks played to chart a trend.</p>;
  }

  const n = Math.max(teams.length, 1);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const px = (i: number) =>
    weeks.length === 1 ? PAD_L + plotW / 2 : PAD_L + (plotW * i) / (weeks.length - 1);
  const py = (rank: number) => PAD_T + (plotH * (rank - 1)) / Math.max(1, n - 1);

  const line = (hist: number[]) =>
    hist
      .map((r, i) => (i < weeks.length && r != null ? `${px(i).toFixed(1)},${py(r).toFixed(1)}` : ""))
      .filter(Boolean)
      .join(" ");

  const you = teams.find((t) => t.teamId === yourTeamId);
  const others = teams.filter((t) => t.teamId !== yourTeamId);
  const step = Math.max(1, Math.floor(weeks.length / 12));

  /**
   * That week's table, top to bottom, each row with its movement since the week before.
   *
   * `delta` is previous rank MINUS current, so a positive number is an improvement —
   * ranks count downward, and the raw difference has the opposite sign to the intuition.
   * Null in week one, and for any team without a rank in both weeks.
   */
  const tableFor = (i: number) =>
    teams
      .filter((t) => t.rankHistory[i] != null)
      .sort((a, b) => (a.rankHistory[i] as number) - (b.rankHistory[i] as number))
      .map((t) => {
        const cur = t.rankHistory[i] as number;
        const prev = i > 0 ? t.rankHistory[i - 1] : null;
        return {
          teamId: t.teamId,
          teamName: t.teamName,
          rank: cur,
          delta: prev == null ? null : prev - cur,
        };
      });

  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "0.2rem",
        }}
      >
        <span className="eyebrow">power rank</span>
        <span className="eyebrow">week</span>
      </div>

      {/* Positioning context for the tooltip, which is absolutely placed over the SVG. */}
      <div className="rt-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Weekly power ranking movement"
          style={{ display: "block" }}
        >
          {Array.from({ length: n }, (_, k) => k + 1).map((rank) => (
            <g key={rank}>
              <line
                x1={PAD_L}
                y1={py(rank)}
                x2={W - PAD_R}
                y2={py(rank)}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 10}
                y={py(rank) + 4}
                textAnchor="end"
                style={{ fontFamily: "var(--mono)", fontSize: 11, fill: "var(--ink-3)" }}
              >
                {rank}
              </text>
            </g>
          ))}
          {weeks.map((w, i) =>
            i % step === 0 || i === weeks.length - 1 ? (
              <text
                key={w}
                x={px(i)}
                y={H - PAD_B + 20}
                textAnchor="middle"
                style={{ fontFamily: "var(--mono)", fontSize: 11, fill: "var(--ink-3)" }}
              >
                {w}
              </text>
            ) : null
          )}
          {others.map((t) => (
            <polyline
              key={t.teamId}
              points={line(t.rankHistory)}
              fill="none"
              stroke="var(--ink-3)"
              strokeWidth={1.2}
              strokeOpacity={0.45}
              strokeLinejoin="round"
            />
          ))}
          {you && (
            <>
              <polyline
                points={line(you.rankHistory)}
                fill="none"
                stroke="var(--cobalt)"
                strokeWidth={3.2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {you.rankHistory.map((r, i) =>
                i < weeks.length && r != null ? (
                  <circle key={i} cx={px(i)} cy={py(r)} r={3.4} fill="var(--cobalt)" />
                ) : null
              )}
            </>
          )}

          {/* The hovered column, drawn under the hit bands so it never blocks them. */}
          {hover !== null && (
            <rect
              x={px(hover) - 1}
              y={PAD_T}
              width={2}
              height={plotH}
              fill="var(--cobalt)"
              fillOpacity={0.5}
            />
          )}

          {/*
            One hover band per WEEK, spanning the full plot height: hovering anywhere in
            a week's column reports that week's whole table, not the single point under
            the cursor. Bands run midpoint-to-midpoint so they tile the plot with no dead
            gaps, and are LAST in the DOM so they sit above every line and win the pointer.

            `fill="transparent"`, NOT `fill="none"` — "none" is not painted at all and so
            receives no pointer events, which would make these silently inert.
          */}
          <g>
            {weeks.map((w, i) => {
              const x = px(i);
              const left = i === 0 ? PAD_L : (px(i - 1) + x) / 2;
              const right = i === weeks.length - 1 ? W - PAD_R : (x + px(i + 1)) / 2;
              return (
                <rect
                  key={w}
                  x={left}
                  y={PAD_T}
                  width={Math.max(right - left, 1)}
                  height={plotH}
                  fill="transparent"
                  className="rt-band"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover((h) => (h === i ? null : i))}
                />
              );
            })}
          </g>
        </svg>

        {hover !== null && (
          <RankTip
            week={weeks[hover]}
            rows={tableFor(hover)}
            yourTeamId={yourTeamId}
            /* Percent of the chart's width, so it tracks the column at any rendered
               size — the SVG scales to 100% but the tooltip is HTML and does not. */
            leftPct={(px(hover) / W) * 100}
          />
        )}
      </div>
    </div>
  );
}

interface TipRow {
  teamId: number;
  teamName: string;
  rank: number;
  delta: number | null;
}

function RankTip({
  week,
  rows,
  yourTeamId,
  leftPct,
}: {
  week: number;
  rows: TipRow[];
  yourTeamId: number;
  leftPct: number;
}) {
  // Flip the anchor near the edges so the panel never hangs off the chart.
  const anchor = leftPct < 22 ? "left" : leftPct > 78 ? "right" : "center";
  const shift =
    anchor === "left" ? "0" : anchor === "right" ? "-100%" : "-50%";

  return (
    <div
      className="rt-tip"
      style={{ left: `${leftPct}%`, transform: `translateX(${shift})` }}
      role="tooltip"
    >
      <div className="rt-tip-h">Week {week}</div>
      {rows.map((r) => (
        <div
          key={r.teamId}
          className={`rt-tip-row${r.teamId === yourTeamId ? " rt-tip-you" : ""}`}
        >
          <span className="rt-tip-rank">{r.rank}</span>
          <span className="rt-tip-name">{r.teamName}</span>
          <Delta d={r.delta} />
        </div>
      ))}
    </div>
  );
}

/** Movement since the previous week. Positive = moved UP the table. */
function Delta({ d }: { d: number | null }) {
  if (d == null) return <span className="rt-tip-d rt-flat">·</span>;
  if (d === 0) return <span className="rt-tip-d rt-flat">–</span>;
  return (
    <span className={`rt-tip-d ${d > 0 ? "rt-up" : "rt-down"}`}>
      {d > 0 ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}
