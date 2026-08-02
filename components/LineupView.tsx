"use client";

import { useMemo, useState, type DragEvent } from "react";
import { categoryValue, formatValue } from "@/lib/league";
import { headshotUrl, playerStatus } from "@/lib/playerPool";

export interface LineupPlayer {
  name: string;
  nbaTeam: string;
  playerId: number | null;
  position: string;
  /** Every position ESPN considers this player eligible for; falls back to [position]. */
  eligibleSlots: string[];
  /** 9-cat value, for ranking the bench. */
  value: number;
  gamesLeft: number;
  injured: boolean;
  status: string;
  /** Per-game averages, in `stats` order. */
  avg: number[];
}

interface Props {
  players: LineupPlayer[];
  stats: string[];
  categories: string[];
  lowerIsBetter: string[];
  slots: number;
}

/** The columns ESPN shows that this export can actually fill. */
const SHOOTING: Array<[string, string, string]> = [
  ["FG", "FGM", "FGA"],
  ["FT", "FTM", "FTA"],
  ["3PT", "3PM", "3PA"],
];
const COUNTING = ["REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW"];

/** Backcourt -> frontcourt, not alphabetical — matches how a depth chart reads. */
const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F"];

/** "PG/SG", not the single default position — what the pipeline's eligibleSlots is for. */
function positionLabel(p: LineupPlayer): string {
  const raw = p.eligibleSlots.length ? p.eligibleSlots : p.position ? [p.position] : [];
  const clean = Array.from(new Set(raw.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  clean.sort((a, b) => {
    const ia = POSITION_ORDER.indexOf(a);
    const ib = POSITION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return clean.length ? clean.join("/") : "—";
}

/**
 * Interactive lineup builder — a board of starters and a board of bench, drag a card
 * from one to the other (or onto a specific card, to swap) with a click-to-toggle
 * fallback on every card for touch and keyboard. Category totals for the current ten
 * sit in a rail that stays on screen while the board scrolls, so the cost of a swap is
 * visible the instant you make it rather than after scrolling back up to a table header.
 *
 * Totals are PER GAME, not projected-to-end-of-week. That is deliberate: the projection
 * multiplies by games left, and once a season is over every player has zero of those, so
 * a projected view would read as a column of noughts forever. Per-game production is the
 * thing a lineup decision is actually made on and it is defined in any week.
 *
 * The comparison line is against your best possible ten by 9-cat value — not against the
 * whole roster, which would compare ten players with thirteen and always look worse.
 */
export default function LineupView({
  players,
  stats,
  categories,
  lowerIsBetter,
  slots,
}: Props) {
  const idx = useMemo(() => {
    const m: Record<string, number> = {};
    stats.forEach((s, i) => (m[s] = i));
    return m;
  }, [stats]);

  /** Best `slots` by value, healthy first — the lineup the app would pick for you. */
  const best = useMemo(() => {
    const ranked = [...players].sort((a, b) => {
      if (a.injured !== b.injured) return a.injured ? 1 : -1;
      return b.value - a.value;
    });
    return new Set(ranked.slice(0, slots).map((p) => p.name));
  }, [players, slots]);

  const [starting, setStarting] = useState<Set<string>>(best);
  // Which card is mid-drag, so a drop target can style itself as "will land here" and so
  // Firefox — which doesn't reliably surface dataTransfer payloads on dragover — always
  // has a fallback source for the name.
  const [dragName, setDragName] = useState<string | null>(null);

  const starters = players.filter((p) => starting.has(p.name));
  const bench = players.filter((p) => !starting.has(p.name));
  const full = starters.length === slots;

  const toggle = (name: string) => {
    setStarting((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (next.size < slots) next.add(name);
      return next;
    });
  };

  /**
   * Drop `fromName`'s card onto `targetName`'s card. Same side is a no-op — there is no
   * meaningful order within a board — different sides swap: whichever one was benched
   * takes the other's spot.
   */
  const swapOnto = (fromName: string, targetName: string) => {
    if (fromName === targetName) return;
    setStarting((prev) => {
      const fromStarting = prev.has(fromName);
      const targetStarting = prev.has(targetName);
      if (fromStarting === targetStarting) return prev;
      const next = new Set(prev);
      if (fromStarting) {
        next.delete(fromName);
        next.add(targetName);
      } else {
        next.delete(targetName);
        next.add(fromName);
      }
      return next;
    });
  };

  /** Drop `fromName` on open board space rather than on another card. */
  const dropOnZone = (fromName: string, zone: "starters" | "bench") => {
    setStarting((prev) => {
      const isStarting = prev.has(fromName);
      if (zone === "starters" && !isStarting) {
        if (prev.size >= slots) return prev;
        return new Set(prev).add(fromName);
      }
      if (zone === "bench" && isStarting) {
        const next = new Set(prev);
        next.delete(fromName);
        return next;
      }
      return prev;
    });
  };

  /** Per-game category totals for a set of players. */
  const totalsFor = (list: LineupPlayer[]): Record<string, number> => {
    const vec = stats.map((_, i) => list.reduce((a, p) => a + (p.avg[i] ?? 0), 0));
    const out: Record<string, number> = {};
    for (const c of categories) out[c] = categoryValue(stats, vec, c);
    return out;
  };

  const totals = useMemo(() => totalsFor(starters), [starters, stats, categories]);
  const bestTotals = useMemo(
    () => totalsFor(players.filter((p) => best.has(p.name))),
    [players, best, stats, categories]
  );

  const lower = new Set(lowerIsBetter);
  const valueSum = starters.reduce((a, p) => a + p.value, 0);
  const bestValue = players
    .filter((p) => best.has(p.name))
    .reduce((a, p) => a + p.value, 0);
  const injuredStarting = starters.filter((p) => p.injured).length;

  const pair = (p: LineupPlayer, made: string, att: string) =>
    `${(p.avg[idx[made]] ?? 0).toFixed(1)}/${(p.avg[idx[att]] ?? 0).toFixed(1)}`;

  return (
    <div className="lu-layout">
      <div className="lu-main">
        <Board
          zone="starters"
          title="Starters"
          note="Drag a bench player here, or click Bench on a card to open a spot."
          players={starters}
          openSlots={slots - starters.length}
          idx={idx}
          dragName={dragName}
          setDragName={setDragName}
          onToggle={toggle}
          onSwap={swapOnto}
          onDropZone={dropOnZone}
        />
        <Board
          zone="bench"
          title="Bench"
          note={
            full
              ? "Lineup is full — drop or click a starter to open a spot first."
              : "Drag a starter here, or click Start on a card."
          }
          players={bench}
          idx={idx}
          dragName={dragName}
          setDragName={setDragName}
          onToggle={toggle}
          onSwap={swapOnto}
          onDropZone={dropOnZone}
        />

        <h2>Full stats</h2>
        <p className="caption">Every column, for when the cards above aren&rsquo;t enough.</p>
        <DetailTable title="Starters" players={starters} stats={stats} idx={idx} pair={pair} />
        <DetailTable title="Bench" players={bench} stats={stats} idx={idx} pair={pair} />
      </div>

      <aside className="lu-rail">
        <div className="lu-rail-tiles">
          <RailTile
            label="Starters"
            value={`${starters.length} / ${slots}`}
            sub={full ? "lineup full" : `${slots - starters.length} slot(s) open`}
            warn={!full}
          />
          <RailTile
            label="Lineup value"
            value={`${valueSum >= 0 ? "+" : ""}${valueSum.toFixed(1)}`}
            sub={`${(valueSum - bestValue >= 0 ? "+" : "") + (valueSum - bestValue).toFixed(1)} vs best ten`}
            warn={valueSum < bestValue - 0.05}
          />
          <RailTile
            label="Injured starting"
            value={String(injuredStarting)}
            sub={injuredStarting ? "check before lock" : "none"}
            warn={injuredStarting > 0}
          />
        </div>

        {/* The point of the page: what the current ten produce, and where that is short
            of the best available ten. Green/red is vs that benchmark, not an opponent. */}
        <h3 className="lu-rail-h">Projected per game</h3>
        <div className="lu-totals">
          {categories.map((c) => {
            const v = totals[c] ?? 0;
            const b = bestTotals[c] ?? 0;
            const d = v - b;
            const better = lower.has(c) ? d < 0 : d > 0;
            const flat = Math.abs(d) < 1e-9;
            return (
              <div className="lu-total-row" key={c}>
                <span className="lu-total-l">{c}</span>
                <span className="lu-total-v mono">{formatValue(c, v)}</span>
                <span
                  className="lu-total-d mono"
                  style={{ color: flat ? "var(--ink-3)" : better ? "var(--good)" : "var(--bad)" }}
                >
                  {flat ? "—" : `${d > 0 ? "+" : ""}${formatValue(c, d)}`}
                </span>
              </div>
            );
          })}
        </div>
        <p className="caption">
          Per-game totals for the ten you have starting, vs. the best ten your roster
          could field by 9-cat value. Turnovers count down.
        </p>

        <div className="controls lu-rail-controls">
          <button type="button" className="chip" onClick={() => setStarting(new Set(best))}>
            Reset to best ten
          </button>
          <button type="button" className="chip" onClick={() => setStarting(new Set())}>
            Clear lineup
          </button>
        </div>
      </aside>
    </div>
  );
}

function Board({
  zone,
  title,
  note,
  players,
  openSlots = 0,
  idx,
  dragName,
  setDragName,
  onToggle,
  onSwap,
  onDropZone,
}: {
  zone: "starters" | "bench";
  title: string;
  note: string;
  players: LineupPlayer[];
  openSlots?: number;
  idx: Record<string, number>;
  dragName: string | null;
  setDragName: (n: string | null) => void;
  onToggle: (name: string) => void;
  onSwap: (fromName: string, targetName: string) => void;
  onDropZone: (fromName: string, zone: "starters" | "bench") => void;
}) {
  const nameFrom = (e: DragEvent) => e.dataTransfer.getData("text/plain") || dragName;

  return (
    <>
      <h2>
        {title} <span className="lu-count">{players.length}</span>
      </h2>
      <div
        className="lu-board"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const from = nameFrom(e);
          if (from) onDropZone(from, zone);
          setDragName(null);
        }}
      >
        {players.length === 0 && openSlots === 0 && (
          <p className="caption lu-empty-note">
            {zone === "starters" ? "No one starting — drag someone up." : "Everyone is starting."}
          </p>
        )}
        {players.map((p) => (
          <PlayerCard
            key={p.name}
            p={p}
            zone={zone}
            idx={idx}
            dragging={dragName === p.name}
            onToggle={onToggle}
            onDragStart={(name) => {
              setDragName(name);
            }}
            onDragEnd={() => setDragName(null)}
            onDrop={(e, target) => {
              // dataTransfer, NOT the `dragName` closure: dragstart/dragover/drop can
              // fire faster than React re-renders between them (every browser does this
              // on a real drag, and a scripted one guarantees it), so the inline
              // callback here can still be holding the PREVIOUS render's `dragName` —
              // which for the very first drag of a session is `null`. dataTransfer is
              // the browser's own channel for this and is never stale.
              const from = nameFrom(e);
              if (from) onSwap(from, target);
              setDragName(null);
            }}
          />
        ))}
        {Array.from({ length: Math.max(0, openSlots) }).map((_, i) => (
          <div
            key={`open-${i}`}
            className="lu-slot-empty"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = nameFrom(e);
              if (from) onDropZone(from, "starters");
              setDragName(null);
            }}
          >
            Open slot
          </div>
        ))}
      </div>
      <p className="caption">{note}</p>
    </>
  );
}

function PlayerCard({
  p,
  zone,
  idx,
  dragging,
  onToggle,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  p: LineupPlayer;
  zone: "starters" | "bench";
  idx: Record<string, number>;
  dragging: boolean;
  onToggle: (name: string) => void;
  onDragStart: (name: string) => void;
  onDragEnd: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>, targetName: string) => void;
}) {
  const [code, sev] = playerStatus(p.status);
  const shot = headshotUrl(p.playerId);
  const stat = (c: string) => (p.avg[idx[c]] ?? 0).toFixed(1);

  return (
    <div
      className={`lu-card${dragging ? " lu-card-drag" : ""}${p.injured ? " lu-card-injured" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", p.name);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(p.name);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e, p.name);
      }}
    >
      {shot ? (
        <div className="lu-card-shot" style={{ backgroundImage: `url('${shot}')` }} />
      ) : (
        <div className="lu-card-shot lu-card-shot-blank" />
      )}
      <div className="lu-card-body">
        <div className="lu-card-top">
          <span className="lu-card-name">{p.name}</span>
          <span className="lu-card-value mono">
            {p.value >= 0 ? "+" : ""}
            {p.value.toFixed(1)}
          </span>
        </div>
        <div className="lu-card-sub">
          <span>
            {p.nbaTeam} · {positionLabel(p)}
          </span>
          {code && <span className={`pv-badge ${sev}`}>{code}</span>}
        </div>
        <div className="lu-card-stats mono">
          <span>
            <b>{stat("PTS")}</b> PTS
          </span>
          <span>
            <b>{stat("REB")}</b> REB
          </span>
          <span>
            <b>{stat("AST")}</b> AST
          </span>
        </div>
      </div>
      <button
        type="button"
        className="lu-card-move"
        onClick={() => onToggle(p.name)}
        aria-label={`${zone === "starters" ? "Bench" : "Start"} ${p.name}`}
      >
        {zone === "starters" ? "Bench" : "Start"}
      </button>
    </div>
  );
}

function DetailTable({
  title,
  players,
  stats,
  idx,
  pair,
}: {
  title: string;
  players: LineupPlayer[];
  stats: string[];
  idx: Record<string, number>;
  pair: (p: LineupPlayer, made: string, att: string) => string;
}) {
  const pct = (p: LineupPlayer, made: string, att: string) => {
    const a = p.avg[idx[att]] ?? 0;
    return a > 0 ? ((p.avg[idx[made]] ?? 0) / a).toFixed(3).replace(/^0/, "") : "—";
  };

  if (players.length === 0) return null;

  return (
    <>
      <h3 className="lu-detail-h">{title}</h3>
      <div className="table-scroll">
        <table className="sheet lu-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              {SHOOTING.map(([label]) => (
                <th key={label} className="num">
                  {label}
                </th>
              ))}
              <th className="num">FG%</th>
              <th className="num">FT%</th>
              <th className="num">3P%</th>
              {COUNTING.map((c) => (
                <th key={c} className="num">
                  {c}
                </th>
              ))}
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.name} className={p.injured ? "row-muted" : undefined}>
                <td className="lu-name">
                  {p.name}
                  {p.injured && <span className="tag">{p.status || "OUT"}</span>}
                </td>
                <td className="lu-pos">{positionLabel(p)}</td>
                {SHOOTING.map(([label, made, att]) => (
                  <td key={label} className="num">
                    {pair(p, made, att)}
                  </td>
                ))}
                <td className="num">{pct(p, "FGM", "FGA")}</td>
                <td className="num">{pct(p, "FTM", "FTA")}</td>
                <td className="num">{pct(p, "3PM", "3PA")}</td>
                {COUNTING.map((c) => (
                  <td key={c} className="num">
                    {(p.avg[idx[c]] ?? 0).toFixed(1)}
                  </td>
                ))}
                <td className="num">
                  {p.value >= 0 ? "+" : ""}
                  {p.value.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RailTile({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div className="lu-rail-tile">
      <div className="eyebrow">{label}</div>
      <div className="lu-rail-tile-v mono">{value}</div>
      <div className="metric-delta mono" style={{ color: warn ? "var(--bad)" : "var(--ink-3)" }}>
        {sub}
      </div>
    </div>
  );
}
