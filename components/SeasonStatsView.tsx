"use client";

import { useMemo, useState } from "react";
import PlayerLink from "./PlayerLink";
import FilterBar from "./FilterBar";

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

/**
 * Columns that get NO bold leader.
 *
 * Only **TO**, because it is lower-is-better: bolding the biggest number would decorate
 * your worst contributor as though it were an achievement, and bolding the smallest would
 * just find whoever played least. Neither is a leader, so the column has none.
 *
 * GP is NOT here — most games played for you is a real thing to lead, and it is a total,
 * so it qualifies itself. It is ranked separately below because it is rendered outside the
 * stat groups.
 */
const NO_LEADER = new Set(["TO"]);

/**
 * The volume a row needs before it can lead a RATE column, as a fraction of the biggest
 * volume in that column.
 *
 * Basketball Reference solves this with a qualifying threshold ("hide non-qualifiers for
 * rate stats") and it needs solving here for the same reason: this roster ran 56 players
 * through it, so without a floor a two-game call-up who went 3-for-4 leads FG% at 75%
 * over everyone who actually played. Proportional rather than an absolute number of
 * attempts, because the same table has to behave on a 20-game roster and a full season.
 *
 * Only rates need it. The counting columns rank on SEASON TOTALS whatever unit is on
 * screen (see `leaders`), and a total qualifies itself — nobody accumulates the most
 * points in three games.
 */
const QUALIFY = 0.2;

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

  /**
   * Who leads each visible column — ALWAYS BY SEASON TOTAL, never by the unit on screen.
   *
   * The bold means "led the team in this category", which is a fact about the season and
   * does not change because you asked to see it per game. Switching the unit re-expresses
   * the same players' numbers; it does not crown a different one. That also disposes of
   * the qualifier problem for counting stats outright — a total qualifies itself, since
   * nobody accumulates the most points in three games.
   *
   * Note the dependency list: no `mode`. That absence IS the rule.
   *
   * RATES are the exception and have to be, because a percentage has no total to rank by.
   * They keep their own volume floor (see QUALIFY) and are compared at the precision they
   * print at — 90.12% and 90.09% both read "90.1%", and bolding one of two identical-
   * looking cells reads as a bug however defensible the third decimal is.
   *
   * A Set per column, not a single name, so a genuine TIE bolds both rows instead of
   * silently keeping whichever the loop reached first.
   */
  const leaders = useMemo(() => {
    const out: Record<string, Set<string>> = {};

    for (const col of cols) {
      if (NO_LEADER.has(col.key)) continue;

      // What this column ranks on, and who is even eligible. Null = not in the running.
      let rank: (p: SeasonPlayer) => number | null;
      if (col.pct) {
        const { num, den } = col.pct;
        const maxDen = Math.max(0, ...players.map((p) => p.stats[den] ?? 0));
        rank = (p) => {
          const d = p.stats[den] ?? 0;
          if (d <= 0 || d < maxDen * QUALIFY) return null;
          return Math.round(((p.stats[num] ?? 0) / d) * 1000) / 10;
        };
      } else {
        rank = (p) => p.stats[col.key] ?? 0;
      }

      let best = -Infinity;
      let names = new Set<string>();
      for (const p of players) {
        const v = rank(p);
        if (v === null) continue;
        if (v > best) {
          best = v;
          names = new Set([p.name]);
        } else if (v === best) {
          names.add(p.name);
        }
      }
      // A column where nobody recorded anything has no leader — bolding a row of zeroes
      // would read as "led the team in blocks" for a team that blocked nothing.
      if (best > 0) out[col.key] = names;
    }

    // GP sits outside the stat groups (it is shown in both), so it is ranked here rather
    // than in the loop above.
    let bestGp = -Infinity;
    let gpNames = new Set<string>();
    for (const p of players) {
      if (p.gp > bestGp) {
        bestGp = p.gp;
        gpNames = new Set([p.name]);
      } else if (p.gp === bestGp) {
        gpNames.add(p.name);
      }
    }
    if (bestGp > 0) out.GP = gpNames;

    return out;
  }, [players, group]);

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

  // What the numbers under the current toggles actually mean. The bold note leads, because
  // an unexplained bold is the reader's first question; "Totals" needs no unit note at all.
  const caption = [
    // Says "season total" explicitly, because in Per game the bold sits on the totals
    // leader and not always on the biggest number in the column — which is the intended
    // behaviour and exactly the thing a reader would otherwise take for a bug.
    "Bold marks the season-total leader in each column, whichever unit is shown.",
    group === "Shooting" &&
      `Percentages have no total, so their leader is the best rate among players with at least ${Math.round(QUALIFY * 100)}% of the most attempts.`,
    mode === "game" && "Per game played while on your roster. A player with no games shows a dash.",
    mode === "share" && "Each player's share of your season team total in that category.",
    group === "Shooting" && "Percentages are rates, so the unit toggle leaves them alone.",
    // Named rather than left as a silent gap — a reader who notices no bold in the
    // turnover column should find out that it is deliberate.
    group === "Overview" && "Turnovers have no leader: fewest is a function of minutes, most is not an achievement.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <FilterBar className="controls">
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
      </FilterBar>

      {/*
        Still inside a .table-scroll. The column groups mean it fits the content column
        outright on a desktop, so nothing scrolls there — but a phone cannot show nine
        columns at this size, and the alternative to scrolling in its own box is being
        silently clipped by the `overflow-x: clip` on body. Never let it widen the page.
      */}
      <div className="table-scroll">
        {/* `sheet-fixed` locks the column widths so sorting cannot reflow the grid. It is
            opt-in and comes with a min-width in globals.css — never add it without one. */}
        <table className="sheet sortable sheet-lg sheet-fixed">
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
                {(() => {
                  const leads = leaders.GP?.has(p.name) ?? false;
                  return (
                    <td className={leads ? "num is-leader" : "num"}>
                      {leads ? <strong>{p.gp}</strong> : p.gp}
                    </td>
                  );
                })()}
                {cols.map((c) => {
                  const leads = leaders[c.key]?.has(p.name) ?? false;
                  return (
                    <td key={c.key} className={leads ? "num is-leader" : "num"}>
                      {/* <strong>, not a CSS-only weight: leading the column is a fact
                          about the number, so it should survive a screen reader and a
                          forced-colors mode that drops the styling. */}
                      {leads ? <strong>{fmt(p, c.key)}</strong> : fmt(p, c.key)}
                    </td>
                  );
                })}
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
