"use client";

import { useState } from "react";
import { formatValue } from "@/lib/league";
import { dayLabel } from "@/lib/dates";
import type { CategoryRace } from "@/lib/weekStory";

/**
 * The category race, interactive (owner, 2026-11-10): hovering or dragging across a chart
 * picks a day on THAT chart only. It marks the day, its header shows the two teams' totals
 * at that point, and its note shows the lead. Leaving the chart returns it to the final
 * result. (A first version moved all fifteen together; the owner preferred one at a time.)
 *
 * Client-side only for the hover; the data is small (15 categories x 7 days).
 */

interface Side {
  name: string;
  abbrev: string;
}

const RW = 200;
const RH = 84;
const RP = { l: 4, r: 6, t: 6, b: 20 };
const PW = RW - RP.l - RP.r;
const PH = RH - RP.t - RP.b;

const day = (d: string) => dayLabel(d).split(" ")[0];
const signedLead = (v: number, ratio: boolean) => {
  const r = Number((ratio ? v : Math.round(v)).toFixed(1));
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  return ratio ? `${sign}${Math.abs(r).toFixed(1)}%` : `${sign}${Math.abs(r)}`;
};

export default function RaceGrid({
  race,
  focus,
  opp,
}: {
  race: CategoryRace[];
  focus: Side;
  opp: Side;
}) {
  const n = race[0]?.days.length ?? 0;
  return (
    <div className="wst-race-grid">
      {race.map((r) => (
        <RaceCell key={r.cat} race={r} focus={focus} opp={opp} n={n} />
      ))}
    </div>
  );
}

function RaceCell({
  race,
  focus,
  opp,
  n,
}: {
  race: CategoryRace;
  focus: Side;
  opp: Side;
  n: number;
}) {
  // Each chart owns its hover (owner, 2026-11-10): one chart at a time, not all fifteen.
  const [hover, setHover] = useState<number | null>(null);
  const { cat, days } = race;
  const last = days[n - 1];
  const ratio = cat.includes("%");
  const peak = Math.max(...days.map((d) => Math.abs(d.lead)), ratio ? 0.5 : 1);
  const x = (i: number) => RP.l + (i / n) * PW; // i = 0 is the start of the week
  const y = (v: number) => RP.t + PH / 2 - (v / peak) * (PH / 2);
  const pts = [{ x: x(0), y: y(0) }, ...days.map((d, i) => ({ x: x(i + 1), y: y(d.lead) }))];
  const line = "M" + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L");
  const area = `${line}V${y(0).toFixed(1)}Z`;
  const id = `wsr-${cat.replace(/[^A-Za-z0-9]/g, "p")}`;

  const shown = hover != null ? days[hover] : last;
  const sign = Math.sign(Math.abs(shown.lead) < 1e-9 ? 0 : shown.lead);
  const final = Math.sign(last.lead);
  const who = final > 0 ? focus.abbrev : opp.abbrev;
  const note =
    hover != null
      ? sign === 0
        ? `Level after ${day(shown.date)}`
        : `${sign > 0 ? focus.abbrev : opp.abbrev} ${signedLead(Math.abs(shown.lead), ratio)} after ${day(shown.date)}`
      : race.ledFrom == null
        ? "Tied"
        : race.ledFrom === 0
          ? `${who} led wire to wire`
          : race.ledFrom >= n - 1
            ? `${who} took it ${day(days[n - 1].date)}`
            : `${who} led from ${day(days[race.ledFrom].date)}`;

  const dotColor = (s: number) => (s > 0 ? "var(--cobalt)" : s < 0 ? "var(--clay)" : "var(--ink-3)");

  function pick(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * RW;
    const i = Math.round(((px - RP.l) / PW) * n) - 1;
    setHover(Math.min(n - 1, Math.max(0, i)));
  }

  const hx = hover != null ? x(hover + 1) : null;

  return (
    <figure className={`wst-race ${hover != null ? "wst-race-on" : ""}`}>
      <figcaption className="wst-race-h">
        <span className="wst-race-cat">{cat}</span>
        <span className="wst-race-v mono">
          <b className={sign > 0 ? "wst-strong" : ""}>{formatValue(cat, shown.focus)}</b>
          <span className="wst-dash">–</span>
          <b className={sign < 0 ? "wst-strong" : ""}>{formatValue(cat, shown.opp)}</b>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${RW} ${RH}`}
        width="100%"
        role="img"
        aria-label={`${cat}: ${note}`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: "pan-y" }}
      >
        <defs>
          <clipPath id={`${id}-up`}>
            <rect x={0} y={0} width={RW} height={y(0)} />
          </clipPath>
          <clipPath id={`${id}-dn`}>
            <rect x={0} y={y(0)} width={RW} height={RH} />
          </clipPath>
        </defs>
        <line x1={RP.l} x2={RW - RP.r} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" strokeDasharray="3 3" strokeWidth={1} />
        <path d={area} fill="var(--cobalt)" fillOpacity={0.18} clipPath={`url(#${id}-up)`} />
        <path d={area} fill="var(--clay)" fillOpacity={0.2} clipPath={`url(#${id}-dn)`} />
        <path d={line} fill="none" stroke="var(--ink-2)" strokeWidth={1.75} strokeLinejoin="round" />
        {hx != null && (
          <line x1={hx} x2={hx} y1={RP.t - 2} y2={RH - RP.b + 2} stroke="var(--ink-3)" strokeWidth={1} />
        )}
        {hover == null ? (
          <circle cx={pts[n].x} cy={pts[n].y} r={3.5} fill={dotColor(final)} stroke="var(--card)" strokeWidth={2} />
        ) : (
          <circle cx={pts[hover + 1].x} cy={pts[hover + 1].y} r={4.5} fill={dotColor(sign)} stroke="var(--card)" strokeWidth={2} />
        )}
        {days.map((d, i) => (
          <text
            key={d.date}
            x={x(i + 1)}
            y={RH - 3}
            textAnchor="middle"
            className={`wst-ax ${hover === i ? "wst-ax-on" : ""}`}
          >
            {day(d.date)[0]}
          </text>
        ))}
        {/* The whole plot is the hit area: larger than the line, as the pointer needs. */}
        <rect x={0} y={0} width={RW} height={RH} fill="transparent" />
      </svg>
      <p className="wst-race-n">
        {note}
        {hover == null && race.changes > 0 && (
          <span> · {race.changes} lead change{race.changes > 1 ? "s" : ""}</span>
        )}
      </p>
    </figure>
  );
}
