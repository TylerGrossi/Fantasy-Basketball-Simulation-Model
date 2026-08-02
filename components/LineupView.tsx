"use client";

import { useMemo, useState } from "react";
import { categoryValue, formatValue } from "@/lib/league";

export interface LineupPlayer {
  name: string;
  nbaTeam: string;
  position: string;
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

/**
 * Interactive lineup builder.
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

  const pair = (p: LineupPlayer, made: string, att: string) =>
    `${(p.avg[idx[made]] ?? 0).toFixed(1)}/${(p.avg[idx[att]] ?? 0).toFixed(1)}`;

  return (
    <>
      <div className="metrics metrics-3">
        <Tile
          label="Starters"
          value={`${starters.length} / ${slots}`}
          sub={full ? "lineup full" : `${slots - starters.length} slot(s) open`}
          warn={!full}
        />
        <Tile
          label="Lineup value"
          value={`${valueSum >= 0 ? "+" : ""}${valueSum.toFixed(1)}`}
          sub={`${(valueSum - bestValue >= 0 ? "+" : "") + (valueSum - bestValue).toFixed(1)} vs best ten`}
          warn={valueSum < bestValue - 0.05}
        />
        <Tile
          label="Injured starting"
          value={String(starters.filter((p) => p.injured).length)}
          sub={starters.filter((p) => p.injured).length ? "check before lock" : "none"}
          warn={starters.some((p) => p.injured)}
        />
      </div>

      {/* The point of the page: what the current ten produce, and where that is short of
          the best available ten. Green/red is vs that benchmark, not vs the opponent. */}
      <h2>Projected per game</h2>
      <div className="lu-cats">
        {categories.map((c) => {
          const v = totals[c] ?? 0;
          const b = bestTotals[c] ?? 0;
          const d = v - b;
          const better = lower.has(c) ? d < 0 : d > 0;
          const flat = Math.abs(d) < 1e-9;
          return (
            <div className="lu-cat" key={c}>
              <span className="lu-cat-l">{c}</span>
              <span className="lu-cat-v mono">{formatValue(c, v)}</span>
              <span
                className="lu-cat-d mono"
                style={{
                  color: flat
                    ? "var(--ink-3)"
                    : better
                      ? "var(--good)"
                      : "var(--bad)",
                }}
              >
                {flat ? "—" : `${d > 0 ? "+" : ""}${formatValue(c, d)}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="caption">
        Per-game totals for the ten you have starting, and the difference against the
        best ten your roster could field by 9-cat value. Turnovers count down.
      </p>

      <div className="controls">
        <button type="button" className="chip" onClick={() => setStarting(new Set(best))}>
          Reset to best ten
        </button>
        <button type="button" className="chip" onClick={() => setStarting(new Set())}>
          Clear lineup
        </button>
      </div>

      <Group
        title="Starters"
        note="Click a row to bench that player."
        players={starters}
        empty="No one starting — pick up to ten."
        onToggle={toggle}
        stats={stats}
        idx={idx}
        pair={pair}
      />
      <Group
        title="Bench"
        note={full ? "Lineup is full — bench someone first." : "Click a row to start that player."}
        players={bench}
        empty="Everyone is starting."
        onToggle={toggle}
        disabled={full}
        stats={stats}
        idx={idx}
        pair={pair}
      />
    </>
  );
}

function Group({
  title,
  note,
  players,
  empty,
  onToggle,
  disabled = false,
  stats,
  idx,
  pair,
}: {
  title: string;
  note: string;
  players: LineupPlayer[];
  empty: string;
  onToggle: (name: string) => void;
  disabled?: boolean;
  stats: string[];
  idx: Record<string, number>;
  pair: (p: LineupPlayer, made: string, att: string) => string;
}) {
  const pct = (p: LineupPlayer, made: string, att: string) => {
    const a = p.avg[idx[att]] ?? 0;
    return a > 0 ? ((p.avg[idx[made]] ?? 0) / a).toFixed(3).replace(/^0/, "") : "—";
  };

  return (
    <>
      <h2>
        {title} <span className="lu-count">{players.length}</span>
      </h2>
      {players.length === 0 ? (
        <p className="caption">{empty}</p>
      ) : (
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
                <th />
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.name} className={p.injured ? "row-muted" : undefined}>
                  <td className="lu-name">
                    {p.name}
                    {p.injured && <span className="tag">{p.status || "OUT"}</span>}
                  </td>
                  <td className="lu-pos">{p.position || "—"}</td>
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
                  <td className="num">
                    <button
                      type="button"
                      className="lu-move"
                      onClick={() => onToggle(p.name)}
                      disabled={disabled}
                      aria-label={`${title === "Starters" ? "Bench" : "Start"} ${p.name}`}
                    >
                      {title === "Starters" ? "Bench" : "Start"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="caption">{note}</p>
    </>
  );
}

function Tile({
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
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono">{value}</div>
      <div
        className="metric-delta mono"
        style={{ color: warn ? "var(--bad)" : "var(--ink-3)" }}
      >
        {sub}
      </div>
    </div>
  );
}
