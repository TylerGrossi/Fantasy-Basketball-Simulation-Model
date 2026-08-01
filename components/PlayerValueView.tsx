"use client";

import { useMemo, useState } from "react";
import type { LeagueData, PoolPlayer } from "@/lib/league";
import GameLog from "./GameLog";
import MultiSelect from "./MultiSelect";
import {
  POSITION_ORDER,
  VALUE_BASES,
  VALUE_COL,
  TREND_COL,
  type ValueBasis,
  headshotUrl,
  playerStatus,
  stocks,
} from "@/lib/playerPool";

/**
 * Every rostered player plus the top free agents, as the ranked value list the Streamlit
 * page showed — one tappable row each, opening an ESPN-style card.
 *
 * The row's translucent bar is the player's value as a share of the largest in the pool
 * (cobalt positive, clay negative), so the list reads as a distribution and not just a
 * column of numbers. All filtering is client-side over the exported pool — instant at
 * ~290 players, no server round trip.
 */

export default function PlayerValueView({ league }: { league: LeagueData }) {
  const pool = league.seasonData.playerPool ?? [];

  const [name, setName] = useState("");
  const [positions, setPositions] = useState<string[]>([]);
  const [nbaTeams, setNbaTeams] = useState<string[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [basis, setBasis] = useState<ValueBasis>("Regular");
  const [showInjured, setShowInjured] = useState(true);

  const valueCol = VALUE_COL[basis];
  const trendCol = TREND_COL[basis];

  // Basketball order (PG -> C), not alphabetical: "C, PF, PG, SF, SG" reads as noise to
  // anyone who thinks in lineup slots. Anything unexpected is appended alphabetically.
  const positionOptions = useMemo(() => {
    const present = new Set(pool.map((p) => p.position).filter(Boolean));
    return [
      ...POSITION_ORDER.filter((p) => present.has(p)),
      ...[...present].filter((p) => !POSITION_ORDER.includes(p)).sort(),
    ];
  }, [pool]);

  const teamOptions = useMemo(
    () => [...new Set(pool.map((p) => p.nbaTeam).filter(Boolean))].sort(),
    [pool]
  );

  // Free agents first — it is the one "owner" that gets filtered to constantly, and
  // alphabetical buried it between team names.
  const ownerOptions = useMemo(() => {
    const all = [...new Set(pool.map((p) => p.owner).filter(Boolean))].sort();
    return [...all.filter((o) => o === "FA"), ...all.filter((o) => o !== "FA")];
  }, [pool]);

  const maxAbs = useMemo(
    () => Math.max(1, ...pool.map((p) => Math.abs(p[valueCol]))),
    [pool, valueCol]
  );

  const rows = useMemo(() => {
    const q = name.trim().toLowerCase();
    const out = pool.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (positions.length && !positions.includes(p.position)) return false;
      if (nbaTeams.length && !nbaTeams.includes(p.nbaTeam)) return false;
      if (owners.length && !owners.includes(p.owner)) return false;
      if (!showInjured && playerStatus(p.status)[1] === "out") return false;
      return true;
    });
    return [...out].sort((a, b) => b[valueCol] - a[valueCol]);
  }, [pool, name, positions, nbaTeams, owners, showInjured, valueCol]);

  if (!pool.length) {
    return <p className="caption">No player pool data — run the data export.</p>;
  }

  return (
    <>
      <div className="controls pv-filters">
        {/* Widths come from .pv-f-* in globals.css so the six controls share one row —
            see the note there. Position/NBA Team/Value basis hold short values and are
            sized down; the two that hold long text take the leftover space. */}
        <div className="ms pv-f-name">
          <div className="ms-label">Player name</div>
          <input
            className="field"
            type="search"
            placeholder="Search…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Player name"
          />
        </div>
        <MultiSelect
          label="Position"
          options={positionOptions}
          selected={positions}
          onChange={setPositions}
          className="pv-f-pos"
        />
        <MultiSelect
          label="NBA Team"
          options={teamOptions}
          selected={nbaTeams}
          onChange={setNbaTeams}
          searchable
          className="pv-f-team"
        />
        <MultiSelect
          label="Fantasy Owner"
          options={ownerOptions}
          selected={owners}
          onChange={setOwners}
          className="pv-f-owner"
        />
        <div className="ms pv-f-basis">
          <div className="ms-label">Value basis</div>
          <select
            className="field field-select"
            value={basis}
            onChange={(e) => setBasis(e.target.value as ValueBasis)}
            aria-label="Value basis"
          >
            {VALUE_BASES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <label className="check pv-injured">
          <input
            type="checkbox"
            checked={showInjured}
            onChange={(e) => setShowInjured(e.target.checked)}
          />
          Show injured players
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="caption">No players match these filters.</p>
      ) : (
        <div className="pv-list">
          {rows.map((p, i) => (
            <PlayerRow
              key={`${p.name}-${p.playerId ?? i}`}
              p={p}
              rank={i + 1}
              value={p[valueCol]}
              trend={p[trendCol]}
              maxAbs={maxAbs}
            />
          ))}
        </div>
      )}

      {/* A footnote, not something that needs to sit above the data. */}
      <p className="caption" style={{ marginTop: "1rem" }}>
        <strong>Value</strong> is a 9-category z-score (points above/below an average
        leaguer, turnovers and percentages included). <strong>30D/15D Trend</strong>{" "}
        compare the last 30 or 15 days to the season on that same scale: positive = heating
        up. Covers every rostered player plus the top free agents.
      </p>
    </>
  );
}

function PlayerRow({
  p,
  rank,
  value,
  trend,
  maxAbs,
}: {
  p: PoolPlayer;
  rank: number;
  value: number;
  trend: number;
  maxAbs: number;
}) {
  const [code, sev] = playerStatus(p.status);
  const positive = value >= 0;
  const width = Math.min(100, (Math.abs(value) / maxAbs) * 100);
  const shot = headshotUrl(p.playerId);
  const isFa = p.owner === "FA";

  // Counting stats first, rate stats second — the same eight tiles as the Streamlit card.
  const tiles: Array<[string, string]> = [
    ["PTS", p.PTS.toFixed(1)],
    ["REB", p.REB.toFixed(1)],
    ["AST", p.AST.toFixed(1)],
    ["STOCKS", stocks(p).toFixed(1)],
    ["FG%", (p.fgPct * 100).toFixed(1)],
    ["FT%", (p.ftPct * 100).toFixed(1)],
    ["3P%", (p.tpPct * 100).toFixed(1)],
    ["TO", p.TO.toFixed(1)],
  ];

  // The card body is only mounted once the row is opened. With ~290 rows, rendering every
  // card up front put a headshot, eight tiles and a log stub into the page for players
  // nobody expanded — the disclosure is closed markup either way, so this is free.
  const [open, setOpen] = useState(false);

  return (
    <details className="pv-item" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="pv-sum">
        <span
          className="pv-fill"
          style={{
            width: `${width.toFixed(1)}%`,
            background: positive ? "var(--cobalt)" : "var(--clay)",
          }}
        />
        <span className="pv-rank">{rank}</span>
        <span className="pv-name">{p.name}</span>
        {code && <span className={`pv-badge ${sev}`}>{code}</span>}
        {isFa && <span className="pv-fa">FA</span>}
        <span className="pv-meta">{p.position}</span>
        <span
          className="pv-val"
          style={{ color: positive ? "var(--good)" : "var(--bad)" }}
        >
          {value >= 0 ? "+" : ""}
          {value.toFixed(1)}
        </span>
        <TrendChip v={trend} />
      </summary>
      {open && (
      <div className="pv-detail">
        <div className="pv-card">
          {shot ? (
            <div className="pv-shot" style={{ backgroundImage: `url('${shot}')` }} />
          ) : (
            <div className="pv-shot pv-shot-blank" />
          )}
          <div className="pv-chead">
            <div className="pv-cname">{p.name}</div>
            <div className="pv-csub">
              <span className="pv-cmeta">
                {[p.nbaTeam, p.position].filter(Boolean).join(" · ")}
              </span>
              {(code || isFa) && (
                <span className="pv-badges">
                  {code && <span className={`pv-badge ${sev}`}>{code}</span>}
                  {isFa && <span className="pv-fa">FA</span>}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="pv-statgrid">
          {tiles.map(([label, v]) => (
            <div className="pv-stat" key={label}>
              <span className="pv-stat-l">{label}</span>
              <span className="pv-stat-v">{v}</span>
            </div>
          ))}
        </div>
        <GameLog playerId={p.playerId} />
      </div>
      )}
    </details>
  );
}

/** Geometric arrow, no emoji — the trend marker from the legacy list. */
function TrendChip({ v }: { v: number }) {
  if (v > 0.5) return <span className="pv-trend up">&#9650;</span>;
  if (v < -0.5) return <span className="pv-trend down">&#9660;</span>;
  return <span className="pv-trend flat">&ndash;</span>;
}
