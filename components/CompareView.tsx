"use client";

import { useState } from "react";
import type { LeagueData, PoolPlayer } from "@/lib/league";
import GameLog from "./GameLog";
import PlayerSearch from "./PlayerSearch";
import { headshotUrl, playerStatus } from "@/lib/playerPool";
import PlayerLink from "./PlayerLink";

/**
 * Head-to-head of any two players: 9-cat Value plus the season per-game line, each row a
 * pair of bars diverging from the centre label with the better side in green.
 *
 * Higher is better everywhere except turnovers. The bars are proportional to the two
 * values rather than to a margin — with only two players the comparison IS the magnitude,
 * which is why this differs from the Scoreboard's margin bars.
 */

interface Spec {
  label: string;
  a: number;
  b: number;
  /** False for turnovers — fewer wins. */
  higherIsBetter: boolean;
  signed?: boolean;
}

export default function CompareView({ league }: { league: LeagueData }) {
  const pool = league.seasonData.playerPool ?? [];
  // Seeded with the two most valuable players — the export is already value-sorted.
  const [a, setA] = useState(pool[0]?.name ?? "");
  const [b, setB] = useState(pool[1]?.name ?? "");

  const pa = pool.find((p) => p.name === a);
  const pb = pool.find((p) => p.name === b);

  if (!pool.length) {
    return <p className="caption">No player pool data — run the data export.</p>;
  }

  return (
    <>
      <div className="controls pv-cmp-pickers">
        {/* Each side excludes the other's pick, so choosing the same player twice — the
            one state this page cannot render — is unreachable rather than an error. */}
        <PlayerSearch pool={pool} value={a} onPick={setA} label="Player A" exclude={b} />
        <span className="caption" style={{ margin: 0 }}>
          vs
        </span>
        <PlayerSearch pool={pool} value={b} onPick={setB} label="Player B" exclude={a} />
      </div>

      {a === b ? (
        <p className="caption">Pick two different players.</p>
      ) : (
        pa && pb && <Comparison a={pa} b={pb} />
      )}
    </>
  );
}

function Comparison({ a, b }: { a: PoolPlayer; b: PoolPlayer }) {
  const specs: Spec[] = [
    { label: "Value", a: a.value, b: b.value, higherIsBetter: true, signed: true },
    { label: "PTS", a: a.PTS, b: b.PTS, higherIsBetter: true },
    { label: "REB", a: a.REB, b: b.REB, higherIsBetter: true },
    { label: "AST", a: a.AST, b: b.AST, higherIsBetter: true },
    // Steals and blocks are two SEPARATE scoring categories in this league, and a
    // combined "stocks" figure hid which one a player actually provides — a 2.0/0.2 guard
    // and a 0.2/2.0 centre read as identical rows and win opposite categories.
    { label: "STL", a: a.STL, b: b.STL, higherIsBetter: true },
    { label: "BLK", a: a.BLK, b: b.BLK, higherIsBetter: true },
    { label: "FG%", a: a.fgPct * 100, b: b.fgPct * 100, higherIsBetter: true },
    { label: "FT%", a: a.ftPct * 100, b: b.ftPct * 100, higherIsBetter: true },
    { label: "3P%", a: a.tpPct * 100, b: b.tpPct * 100, higherIsBetter: true },
    { label: "TO", a: a.TO, b: b.TO, higherIsBetter: false },
  ];

  return (
    <div className="pv-cmp">
      <div className="pv-cmp-head">
        <CompareHeader p={a} />
        <CompareHeader p={b} />
      </div>

      <div className="pv-cmp-rows">
        {specs.map((s) => {
          const aWins = s.higherIsBetter ? s.a > s.b : s.a < s.b;
          const bWins = s.higherIsBetter ? s.b > s.a : s.b < s.a;
          // Higher-is-better shifts by the lower bound so a negative Value still scales
          // sanely; for TO the SMALLER number fills more, since less is the good outcome.
          let fillA: number;
          let fillB: number;
          if (s.higherIsBetter) {
            const lo = Math.min(s.a, s.b, 0);
            const x = s.a - lo;
            const y = s.b - lo;
            const m = Math.max(x, y, 1e-9);
            fillA = (x / m) * 100;
            fillB = (y / m) * 100;
          } else {
            const mn = Math.min(s.a, s.b);
            fillA = s.a ? (mn / s.a) * 100 : 100;
            fillB = s.b ? (mn / s.b) * 100 : 100;
          }
          const fmt = (v: number) =>
            s.signed ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : v.toFixed(1);
          return (
            <div className="pv-cmp-row" key={s.label}>
              <span className={`pv-cmp-a${aWins ? " pv-cmp-win" : ""}`}>{fmt(s.a)}</span>
              <span className="pv-cmp-bar pv-cmp-bar-a">
                <span className="pv-cmp-fill" style={{ width: `${fillA.toFixed(0)}%` }} />
              </span>
              <span className="pv-cmp-lbl">{s.label}</span>
              <span className="pv-cmp-bar pv-cmp-bar-b">
                <span className="pv-cmp-fill" style={{ width: `${fillB.toFixed(0)}%` }} />
              </span>
              <span className={`pv-cmp-b${bWins ? " pv-cmp-win" : ""}`}>{fmt(s.b)}</span>
            </div>
          );
        })}
      </div>

      <div className="pv-cmp-logs">
        <div className="pv-cmp-log">
          <GameLog key={a.playerId ?? a.name} playerId={a.playerId} />
        </div>
        <div className="pv-cmp-log">
          <GameLog key={b.playerId ?? b.name} playerId={b.playerId} />
        </div>
      </div>
    </div>
  );
}

function CompareHeader({ p }: { p: PoolPlayer }) {
  const [code, sev] = playerStatus(p.status);
  const shot = headshotUrl(p.playerId);
  const isFa = p.owner === "FA";
  return (
    <div className="pv-cmp-player">
      {shot ? (
        <div className="pv-shot" style={{ backgroundImage: `url('${shot}')` }} />
      ) : (
        <div className="pv-shot pv-shot-blank" />
      )}
      <div className="pv-cmp-name"><PlayerLink name={p.name} /></div>
      <div className="pv-csub pv-cmp-sub">
        <span className="pv-cmeta">
          {[p.nbaTeam, p.position].filter(Boolean).join(" · ")}
        </span>
        <span className="pv-badges">
          {code && <span className={`pv-badge ${sev}`}>{code}</span>}
          {isFa && <span className="pv-fa">FA</span>}
        </span>
      </div>
    </div>
  );
}
