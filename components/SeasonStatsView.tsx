"use client";

import { useMemo, useState } from "react";
import PlayerLink from "./PlayerLink";

export interface SeasonPlayer {
  name: string;
  gp: number;
  /** Season totals accumulated while on your roster, keyed by stat. */
  stats: Record<string, number>;
}

/** How to express each counting stat. Totals are the raw season figures. */
type Mode = "total" | "game" | "share";

const MODES: Array<[Mode, string]> = [
  ["total", "Totals"],
  ["game", "Per game"],
  ["share", "% of total"],
];

/**
 * A column. `pct` marks a RATE — made/attempted — which is neither a total nor
 * something you can average per game, so it ignores the unit toggle entirely.
 */
interface Col {
  key: string;
  pct?: { num: string; den: string };
}

/**
 * Column groups, carried over from the legacy app's STAT_VIEWS for the same reason it
 * had them: a fourteen-column table is read by scrolling sideways, which is not reading.
 * Each group is narrow enough to fit the content column outright, which is what buys the
 * larger type.
 */
const GROUPS: Record<string, Col[]> = {
  // DD and TW live here rather than in a group of their own — two columns did not
  // justify a third tab, and they are counting categories like the rest of the row.
  Overview: [
    { key: "PTS" }, { key: "REB" }, { key: "AST" }, { key: "STL" },
    { key: "BLK" }, { key: "TO" }, { key: "DD" }, { key: "TW" },
  ],
  Shooting: [
    { key: "FGM" }, { key: "FGA" }, { key: "FG%", pct: { num: "FGM", den: "FGA" } },
    { key: "FT%", pct: { num: "FTM", den: "FTA" } },
    { key: "3PM" }, { key: "3PA" }, { key: "3P%", pct: { num: "3PM", den: "3PA" } },
  ],
};

interface Props {
  players: SeasonPlayer[];
  /** Team season totals, the denominator for "% of total". */
  teamTotals: Record<string, number>;
}

/**
 * The player contribution table: sortable, grouped, in one of three units.
 *
 * A client component because the grouping, sorting and unit toggle are pure view state —
 * the numbers never change, only which are shown and how they are expressed, so there is
 * nothing to re-fetch. It is handed just the rows it draws (see the trimLeague note in
 * AGENTS.md); the whole league object must never cross this boundary.
 */
export default function SeasonStatsView({ players, teamTotals }: Props) {
  const [group, setGroup] = useState<keyof typeof GROUPS>("Overview");
  const [mode, setMode] = useState<Mode>("total");
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({
    key: "PTS",
    desc: true,
  });

  const cols = GROUPS[group];
  const colOf = (key: string) => cols.find((c) => c.key === key);

  // Sort by what is on screen, not by the underlying totals — otherwise "Per game"
  // would print one order and rank by another. (Share and totals happen to agree,
  // since every row shares a denominator, but deriving it uniformly costs nothing.)
  const shown = (p: SeasonPlayer, key: string): number => {
    if (key === "GP") return p.gp;
    const col = colOf(key);
    if (col?.pct) {
      const den = p.stats[col.pct.den] ?? 0;
      return den > 0 ? ((p.stats[col.pct.num] ?? 0) / den) * 100 : 0;
    }
    const v = p.stats[key] ?? 0;
    if (mode === "game") return p.gp > 0 ? v / p.gp : 0;
    if (mode === "share") {
      const t = teamTotals[key] ?? 0;
      return t > 0 ? (v / t) * 100 : 0;
    }
    return v;
  };

  const rows = useMemo(() => {
    const out = [...players];
    // The sorted column can vanish when the group changes (sorting by PTS, then
    // switching to Shooting) — fall back to that group's first column.
    const stillShown =
      sort.key === "Player" || sort.key === "GP" || Boolean(colOf(sort.key));
    const key = stillShown ? sort.key : cols[0].key;
    out.sort((a, b) => {
      if (key === "Player") {
        return sort.desc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
      }
      const d = shown(a, key) - shown(b, key);
      return sort.desc ? -d : d;
    });
    return out;
  }, [players, teamTotals, sort, mode, group]);

  const click = (key: string) =>
    setSort((s) =>
      // Same column flips direction; a new column starts the way that column is most
      // useful — biggest first for numbers, A-Z for names.
      s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "Player" }
    );

  const fmt = (p: SeasonPlayer, key: string): string => {
    if (key === "GP") return String(p.gp);
    const col = colOf(key);
    const v = shown(p, key);
    if (col?.pct) return (p.stats[col.pct.den] ?? 0) > 0 ? `${v.toFixed(1)}%` : "—";
    if (mode === "game") return p.gp > 0 ? v.toFixed(1) : "—";
    if (mode === "share") return (teamTotals[key] ?? 0) > 0 ? `${v.toFixed(1)}%` : "—";
    return Math.round(v).toLocaleString("en-US");
  };

  const headers = ["Player", "GP", ...cols.map((c) => c.key)];

  // What the numbers under the current toggles actually mean. "Totals" needs no note.
  const caption = [
    mode === "game" && "Per game played while on your roster. A player with no games shows a dash.",
    mode === "share" && "Each player's share of your season team total in that category.",
    group === "Shooting" && "Percentages are rates, so the unit toggle leaves them alone.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className="controls">
        <div className="segmented" role="group" aria-label="Stat group">
          {(Object.keys(GROUPS) as Array<keyof typeof GROUPS>).map((g) => (
            <button
              key={g}
              type="button"
              className={`seg ${group === g ? "seg-on" : ""}`}
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Stat units">
          {MODES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`seg ${mode === k ? "seg-on" : ""}`}
              aria-pressed={mode === k}
              onClick={() => setMode(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/*
        Still inside a .table-scroll. The column groups mean it fits the content column
        outright on a desktop, so nothing scrolls there — but a phone cannot show nine
        columns at this size, and the alternative to scrolling in its own box is being
        silently clipped by the `overflow-x: clip` on body. Never let it widen the page.
      */}
      <div className="table-scroll">
        <table className="sheet sortable sheet-lg">
          <thead>
          <tr>
            {headers.map((h) => {
              const active = sort.key === h;
              return (
                <th
                  key={h}
                  className={h === "Player" ? undefined : "num"}
                  aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                >
                  <button type="button" className="th-sort" onClick={() => click(h)}>
                    {h}
                    <span className={`sort-caret ${active ? "on" : ""}`} aria-hidden="true">
                      {active ? (sort.desc ? "▾" : "▴") : "▾"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.name}>
                <td className="cell-name"><PlayerLink name={p.name} /></td>
                <td className="num">{p.gp}</td>
                {cols.map((c) => (
                  <td key={c.key} className="num">
                    {fmt(p, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rendered only when there is something to say — an always-present <p> would leave
          its bottom margin under the table on the modes that no longer carry a note. */}
      {caption && <p className="caption">{caption}</p>}
    </>
  );
}
