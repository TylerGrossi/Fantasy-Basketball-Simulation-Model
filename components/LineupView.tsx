"use client";

import { useMemo, useState, type DragEvent } from "react";
import { categoryValue, formatValue } from "@/lib/league";
import { headshotUrl, playerStatus } from "@/lib/playerPool";
import PlayerLink from "./PlayerLink";
import StatusBadge from "./StatusBadge";

export interface LineupPlayer {
  name: string;
  nbaTeam: string;
  playerId: number | null;
  position: string;
  /** Every position ESPN considers this player eligible for; falls back to [position]. */
  eligibleSlots: string[];
  /** 9-cat value over the whole season. */
  value: number;
  /** Same score over the last 30 / last 15 days. See VALUE_MODES. */
  recent: number;
  recent15: number;
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

/**
 * Which 9-cat number the board ranks and totals by.
 *
 * The same three the Streamlit app offered (`VMAP` in streamlit_app.py): season-long
 * value, or the same score recomputed over the last 30 / 15 days. They answer different
 * questions — "who is better" vs "who is hot right now" — and a lineup decision made in
 * March usually wants the second.
 */
const VALUE_MODES = [
  { key: "value", label: "Season" },
  { key: "recent", label: "30D" },
  { key: "recent15", label: "15D" },
] as const;
type ValueMode = (typeof VALUE_MODES)[number]["key"];

/**
 * The starting lineup's shape, in ESPN's own order.
 *
 * `slots` from the caller is the COUNT (ten); this is what those ten are. If a league
 * ever reports a different count the layout is trimmed or padded with UTIL, so the board
 * can never disagree with the cap the rest of the page enforces.
 */
const SLOT_LAYOUT = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "UTIL", "UTIL"];

/** Backcourt -> frontcourt, not alphabetical — matches how a depth chart reads. */
const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F"];

/**
 * Can this player fill this slot?
 *
 * G/F/UTIL are the combination slots ESPN uses: G takes either guard, F takes either
 * forward, UTIL takes anyone. Eligibility is read from `eligibleSlots` (every position
 * ESPN lists a player at), never from the single default `position` — a "PG/SG" player
 * is legal in three different slots and treating them as PG-only would block real moves.
 */
function eligibleFor(p: LineupPlayer, slot: string): boolean {
  if (slot === "UTIL") return true;
  const e = new Set(
    (p.eligibleSlots.length ? p.eligibleSlots : p.position ? [p.position] : []).map((s) =>
      s.trim().toUpperCase()
    )
  );
  if (slot === "G") return e.has("PG") || e.has("SG") || e.has("G");
  if (slot === "F") return e.has("SF") || e.has("PF") || e.has("F");
  return e.has(slot);
}

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
 * Fill the slots greedily: best available player who is LEGAL in each slot, working
 * through the layout in order.
 *
 * Position-locked slots come first in SLOT_LAYOUT, which matters — filling UTIL first
 * would let a guard occupy it and leave PG empty with nobody eligible left. Healthy
 * players outrank injured ones at equal value, since a slot filled by someone who won't
 * play is worth nothing.
 */
function autoFill(players: LineupPlayer[], layout: string[], val: (p: LineupPlayer) => number) {
  const ranked = [...players].sort((a, b) => {
    if (a.injured !== b.injured) return a.injured ? 1 : -1;
    return val(b) - val(a);
  });
  const taken = new Set<string>();
  return layout.map((slot) => {
    const pick = ranked.find((p) => !taken.has(p.name) && eligibleFor(p, slot));
    if (pick) taken.add(pick.name);
    return pick?.name ?? null;
  });
}

/**
 * Interactive lineup builder — ESPN's own board: one row per named slot (PG…UTIL), drag
 * a bench player onto a slot to fill or swap it, with a click-to-select fallback on every
 * row for touch and keyboard. Category totals for the current ten sit in a rail that stays
 * on screen while the board scrolls, so the cost of a swap is visible the instant you make
 * it rather than after scrolling back up to a table header.
 *
 * Slots are ENFORCED, unlike the earlier free-form version: a drop is refused when the
 * player isn't eligible there. That is what makes the board mean anything — a lineup that
 * ignores positions isn't one ESPN would accept.
 *
 * Totals are PER GAME, not projected-to-end-of-week. That is deliberate: the projection
 * multiplies by games left, and once a season is over every player has zero of those, so
 * a projected view would read as a column of noughts forever. Per-game production is the
 * thing a lineup decision is actually made on and it is defined in any week.
 *
 * The comparison line is against the best legal ten by the SELECTED value mode — not
 * against the whole roster, which would compare ten players with thirteen and always look
 * worse. Switching mode re-benchmarks both sides, so the delta always compares like ten
 * with like ten.
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

  const [mode, setMode] = useState<ValueMode>("value");
  const valueOf = useMemo(() => (p: LineupPlayer) => p[mode] ?? 0, [mode]);

  /** The layout, reconciled with the caller's slot COUNT. */
  const layout = useMemo(() => {
    if (slots === SLOT_LAYOUT.length) return SLOT_LAYOUT;
    if (slots < SLOT_LAYOUT.length) return SLOT_LAYOUT.slice(0, slots);
    return [...SLOT_LAYOUT, ...Array(slots - SLOT_LAYOUT.length).fill("UTIL")];
  }, [slots]);

  /** The lineup the app would pick for you, under the current value mode. */
  const best = useMemo(
    () => autoFill(players, layout, valueOf),
    [players, layout, valueOf]
  );

  const [assigned, setAssigned] = useState<(string | null)[]>(() =>
    autoFill(players, layout, (p) => p.value)
  );
  // Which card is mid-drag, so a drop target can style itself as "will land here" and so
  // Firefox — which doesn't reliably surface dataTransfer payloads on dragover — always
  // has a fallback source for the name.
  const [dragName, setDragName] = useState<string | null>(null);
  // Click-to-move fallback: tap a player, then tap a slot. Drag-and-drop does not exist
  // on touch, and this page is otherwise unusable on a phone.
  const [picked, setPicked] = useState<string | null>(null);

  const byName = useMemo(() => new Map(players.map((p) => [p.name, p])), [players]);
  const starters = assigned
    .map((n) => (n ? byName.get(n) : undefined))
    .filter((p): p is LineupPlayer => !!p);
  const startingNames = new Set(starters.map((p) => p.name));
  const bench = players.filter((p) => !startingNames.has(p.name));
  const filled = starters.length;
  const full = filled === layout.length;

  /**
   * Put `name` in slot `i`. Refused when they aren't eligible there.
   *
   * If they were already starting elsewhere the two slots SWAP — moving a player must
   * never silently bench whoever they displaced, and the displaced player is by
   * definition legal in the slot being vacated only if they came from it, so the swap is
   * checked in both directions and abandoned if either half is illegal.
   */
  const place = (name: string, i: number): boolean => {
    const p = byName.get(name);
    if (!p || !eligibleFor(p, layout[i])) return false;
    const from = assigned.indexOf(name);
    if (from === i) return false;
    const displaced = assigned[i];
    if (from >= 0 && displaced) {
      // Both are starters: a straight swap, only if the displaced player is legal in the
      // slot being vacated. Checked BEFORE committing, so a refused half can't leave the
      // board in a state where one player moved and the other didn't.
      const d = byName.get(displaced);
      if (!d || !eligibleFor(d, layout[from])) return false;
    }
    setAssigned((prev) => {
      const next = [...prev];
      if (from >= 0) next[from] = displaced ?? null;
      next[i] = name;
      return next;
    });
    setPicked(null);
    return true;
  };

  /** Empty slot `i` — the player goes back to the bench. */
  const clearSlot = (i: number) => {
    setAssigned((prev) => {
      if (!prev[i]) return prev;
      const next = [...prev];
      next[i] = null;
      return next;
    });
    setPicked(null);
  };

  /** Bench a starter by name, wherever they are. */
  const benchPlayer = (name: string) => {
    const i = assigned.indexOf(name);
    if (i >= 0) clearSlot(i);
  };

  /** First slot this bench player is legal AND free in, or -1. */
  const firstOpenSlotFor = (name: string) => {
    const p = byName.get(name);
    if (!p) return -1;
    return assigned.findIndex((occupant, i) => !occupant && eligibleFor(p, layout[i]));
  };

  /** Per-game category totals for a set of players. */
  const totalsFor = (list: LineupPlayer[]): Record<string, number> => {
    const vec = stats.map((_, i) => list.reduce((a, p) => a + (p.avg[i] ?? 0), 0));
    const out: Record<string, number> = {};
    for (const c of categories) out[c] = categoryValue(stats, vec, c);
    return out;
  };

  const bestPlayers = best
    .map((n) => (n ? byName.get(n) : undefined))
    .filter((p): p is LineupPlayer => !!p);

  const totals = useMemo(() => totalsFor(starters), [starters, stats, categories]);
  const bestTotals = useMemo(() => totalsFor(bestPlayers), [bestPlayers, stats, categories]);

  const lower = new Set(lowerIsBetter);
  const valueSum = starters.reduce((a, p) => a + valueOf(p), 0);
  const bestValue = bestPlayers.reduce((a, p) => a + valueOf(p), 0);
  const injuredStarting = starters.filter((p) => p.injured).length;

  const pair = (p: LineupPlayer, made: string, att: string) =>
    `${(p.avg[idx[made]] ?? 0).toFixed(1)}/${(p.avg[idx[att]] ?? 0).toFixed(1)}`;

  const nameFrom = (e: DragEvent) => e.dataTransfer.getData("text/plain") || dragName;

  return (
    <div className="lu-layout">
      <div className="lu-main">
        <div className="lu-toolbar">
          <div className="controls lu-modes" role="group" aria-label="Value basis">
            <span className="lu-modes-l">Value</span>
            {VALUE_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`chip${mode === m.key ? " chip-on" : ""}`}
                aria-pressed={mode === m.key}
                onClick={() => setMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {picked && (
            <span className="lu-picked">
              Moving <strong>{picked}</strong> — pick a slot, or{" "}
              <button type="button" className="linkish" onClick={() => setPicked(null)}>
                cancel
              </button>
            </span>
          )}
        </div>

        <h2>
          Starters <span className="lu-count">{filled} / {layout.length}</span>
        </h2>
        <div className="table-scroll">
          <table className="sheet lu-slots">
            <thead>
              <tr>
                <th className="lu-slot-h">Slot</th>
                <th>Player</th>
                <th className="num">Value</th>
                <th className="num">GL</th>
                <th className="num">PTS</th>
                <th className="num">REB</th>
                <th className="num">AST</th>
                <th className="num">STL</th>
                <th className="num">BLK</th>
                <th className="num">TO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {layout.map((slot, i) => {
                const name = assigned[i];
                const p = name ? byName.get(name) : undefined;
                const pickedP = picked ? byName.get(picked) : undefined;
                // A slot lights up only when the held player could actually land there,
                // so an illegal target never looks droppable.
                const candidate = dragName ? byName.get(dragName) : pickedP;
                const openTo = candidate ? eligibleFor(candidate, slot) : false;
                return (
                  <SlotRow
                    key={`${slot}-${i}`}
                    slot={slot}
                    player={p}
                    idx={idx}
                    mode={mode}
                    highlight={openTo}
                    dragging={!!p && dragName === p.name}
                    onDragStartPlayer={(n) => setDragName(n)}
                    onDragEnd={() => setDragName(null)}
                    onDropHere={(e) => {
                      // dataTransfer, NOT the `dragName` closure: dragstart/dragover/drop
                      // can fire faster than React re-renders between them, so the inline
                      // callback can still hold the PREVIOUS render's `dragName` — null on
                      // the first drag of a session. dataTransfer is never stale.
                      const from = nameFrom(e);
                      if (from) place(from, i);
                      setDragName(null);
                    }}
                    onClickSlot={() => {
                      // A REFUSED move must not leave you still holding the old player —
                      // the next tap would then be silently swallowed too, which reads as
                      // the board being broken. Falling through to "pick whoever is in
                      // the slot you just tapped" is what a second tap means anyway.
                      if (picked && place(picked, i)) return;
                      setPicked(p ? p.name : null);
                    }}
                    onBench={() => clearSlot(i)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="caption">
          Drag a bench player onto a slot, or tap a player then tap a slot. A slot only
          accepts players eligible for it; G takes either guard, F either forward, UTIL
          anyone.
        </p>

        <h2>
          Bench <span className="lu-count">{bench.length}</span>
        </h2>
        <div
          className="table-scroll"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const from = nameFrom(e);
            if (from) benchPlayer(from);
            setDragName(null);
          }}
        >
          <table className="sheet lu-slots">
            <thead>
              <tr>
                <th className="lu-slot-h">Pos</th>
                <th>Player</th>
                <th className="num">Value</th>
                <th className="num">GL</th>
                <th className="num">PTS</th>
                <th className="num">REB</th>
                <th className="num">AST</th>
                <th className="num">STL</th>
                <th className="num">BLK</th>
                <th className="num">TO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bench.length === 0 && (
                <tr>
                  <td colSpan={11} className="lu-empty-note">
                    Everyone is starting.
                  </td>
                </tr>
              )}
              {bench
                .slice()
                .sort((a, b) => valueOf(b) - valueOf(a))
                .map((p) => {
                  const open = firstOpenSlotFor(p.name);
                  return (
                    <SlotRow
                      key={p.name}
                      slot={positionLabel(p)}
                      player={p}
                      idx={idx}
                      mode={mode}
                      bench
                      dragging={dragName === p.name}
                      onDragStartPlayer={(n) => setDragName(n)}
                      onDragEnd={() => setDragName(null)}
                      onDropHere={(e) => {
                        const from = nameFrom(e);
                        if (from) benchPlayer(from);
                        setDragName(null);
                      }}
                      onClickSlot={() => setPicked(picked === p.name ? null : p.name)}
                      // "Start" only when there is a legal empty slot; otherwise the move
                      // has to be an explicit swap, which the drag/tap flow handles.
                      onBench={open >= 0 ? () => place(p.name, open) : undefined}
                      benchActionLabel={open >= 0 ? "Start" : undefined}
                      selected={picked === p.name}
                    />
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="caption">
          Ranked by the selected value basis. &ldquo;Start&rdquo; appears when a legal slot
          is open; otherwise drag them onto the starter you want to replace.
        </p>

        <h2>Full stats</h2>
        <p className="caption">Every column, for when the rows above aren&rsquo;t enough.</p>
        <DetailTable
          title="Starters"
          players={starters}
          stats={stats}
          idx={idx}
          pair={pair}
          mode={mode}
        />
        <DetailTable
          title="Bench"
          players={bench}
          stats={stats}
          idx={idx}
          pair={pair}
          mode={mode}
        />
      </div>

      <aside className="lu-rail">
        <div className="lu-rail-tiles">
          <RailTile
            label="Starters"
            value={`${filled} / ${layout.length}`}
            sub={full ? "lineup full" : `${layout.length - filled} slot(s) open`}
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
        <div className="controls lu-rail-controls">
          <button type="button" className="chip" onClick={() => setAssigned(best)}>
            Reset to best ten
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => setAssigned(layout.map(() => null))}
          >
            Clear lineup
          </button>
        </div>
      </aside>
    </div>
  );
}

/** One row of the board: a named slot and whoever is in it (or an empty drop target). */
function SlotRow({
  slot,
  player,
  idx,
  mode,
  bench,
  highlight,
  dragging,
  selected,
  onDragStartPlayer,
  onDragEnd,
  onDropHere,
  onClickSlot,
  onBench,
  benchActionLabel,
}: {
  slot: string;
  player?: LineupPlayer;
  idx: Record<string, number>;
  mode: ValueMode;
  bench?: boolean;
  highlight?: boolean;
  dragging?: boolean;
  selected?: boolean;
  onDragStartPlayer: (name: string) => void;
  onDragEnd: () => void;
  onDropHere: (e: DragEvent<HTMLTableRowElement>) => void;
  onClickSlot: () => void;
  onBench?: () => void;
  benchActionLabel?: string;
}) {
  const stat = (c: string) => (player ? (player.avg[idx[c]] ?? 0).toFixed(1) : "—");
  const [code, sev] = player ? playerStatus(player.status) : ["", ""];
  const shot = player ? headshotUrl(player.playerId) : null;
  const v = player ? (player[mode] ?? 0) : 0;

  const cls = [
    "lu-slot-row",
    highlight ? "lu-slot-open" : "",
    dragging ? "lu-slot-dragging" : "",
    selected ? "lu-slot-picked" : "",
    player?.injured ? "row-muted" : "",
    !player ? "lu-slot-empty-row" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <tr
      className={cls}
      draggable={!!player}
      onDragStart={(e) => {
        if (!player) return;
        e.dataTransfer.setData("text/plain", player.name);
        e.dataTransfer.effectAllowed = "move";
        onDragStartPlayer(player.name);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropHere(e);
      }}
      onClick={onClickSlot}
    >
      <td className={bench ? "lu-pos" : "lu-slot-tag"}>{slot}</td>
      <td className="lu-name">
        {player ? (
          <span className="lu-name-cell">
            {shot ? (
              <span className="lu-row-shot" style={{ backgroundImage: `url('${shot}')` }} />
            ) : (
              <span className="lu-row-shot lu-card-shot-blank" />
            )}
            <span className="lu-name-text">
              <span className="lu-name-n">{player.name}</span>
              <span className="lu-name-sub">
                {player.nbaTeam} · {positionLabel(player)}
                {code && <StatusBadge status={player.status} />}
              </span>
            </span>
          </span>
        ) : (
          <span className="lu-slot-empty-text">Empty — drop a player here</span>
        )}
      </td>
      <td className="num">
        {player ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : "—"}
      </td>
      <td className="num">{player ? player.gamesLeft : "—"}</td>
      <td className="num">{stat("PTS")}</td>
      <td className="num">{stat("REB")}</td>
      <td className="num">{stat("AST")}</td>
      <td className="num">{stat("STL")}</td>
      <td className="num">{stat("BLK")}</td>
      <td className="num">{stat("TO")}</td>
      <td className="lu-row-action">
        {player && onBench && (
          <button
            type="button"
            className="lu-card-move"
            onClick={(e) => {
              e.stopPropagation();
              onBench();
            }}
          >
            {benchActionLabel ?? "Bench"}
          </button>
        )}
      </td>
    </tr>
  );
}

function DetailTable({
  title,
  players,
  stats,
  idx,
  pair,
  mode,
}: {
  title: string;
  players: LineupPlayer[];
  stats: string[];
  idx: Record<string, number>;
  pair: (p: LineupPlayer, made: string, att: string) => string;
  mode: ValueMode;
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
                {/*
                  The stat table's name links; the name on the DRAGGABLE card above does
                  not. That card is a drag handle — a link inside it competes with the
                  drag for the same press, and on a touch screen the two are the same
                  gesture until you have already moved. This table is the safe place to
                  reach a player's card from the lineup board.
                */}
                <td className="lu-name">
                  <PlayerLink name={p.name} />
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
                  {(p[mode] ?? 0) >= 0 ? "+" : ""}
                  {(p[mode] ?? 0).toFixed(1)}
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
