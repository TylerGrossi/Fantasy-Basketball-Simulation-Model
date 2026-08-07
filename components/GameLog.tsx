"use client";

import { useMemo } from "react";
import {
  isAllStar,
  isRegularSeason,
  useGameLog,
  type EspnGameLog,
} from "@/lib/gamelog";

/**
 * The full season game log — every game, newest first, always on screen.
 *
 * It used to be a `<details>` disclosure showing the last ten. Two things were wrong with
 * that: a collapsed section is a section nobody reads, and ten games is a sample too short
 * to see anything the card above does not already say. A player page should end in the raw
 * record, the way a reference site does.
 *
 * The lazy fetch went with it. Its reason — "pre-fetching for ~290 pool players would cost
 * hundreds of requests" — was about the PLAYER VALUE table, where every row is a player.
 * Here exactly one player is on screen, the rolling-value chart above already pulls this
 * same log, and `lib/gamelog` now shares that single request between them.
 *
 * REGULAR SEASON ONLY, matching every number on the card. The postseason is not part of
 * the fantasy season, so a playoff run at the top of this table would be games that never
 * scored a point in any matchup, sitting above the ones that did.
 */

/**
 * The columns, in reading order.
 *
 * The percentages sit next to the made-attempted they come from. ESPN ships them as their
 * own labels ("FG%", "3P%"), so they are read straight from the row rather than divided
 * out here — a 0-attempt game then shows ESPN's own value instead of a NaN.
 */
const COLS = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FG", "FG%", "3PT", "3P%", "FT"];

interface Row {
  id: string;
  date: string;
  atVs: string;
  opp: string;
  result: string;
  stats: string[];
}

function parse(data: EspnGameLog): { rows: Row[]; index: Record<string, number> } {
  const index: Record<string, number> = {};
  (data.labels ?? []).forEach((l, i) => (index[l] = i));
  const meta = data.events ?? {};
  const seen = new Set<string>();
  const rows: Row[] = [];

  for (const st of data.seasonTypes ?? []) {
    if (!isRegularSeason(st.displayName ?? "")) continue;
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        if (seen.has(ev.eventId) || isAllStar(data, ev.eventId)) continue;
        seen.add(ev.eventId);
        const m = meta[ev.eventId] ?? {};
        rows.push({
          id: ev.eventId,
          date: m.gameDate ?? "",
          atVs: m.atVs ?? "",
          opp: m.opponent?.abbreviation ?? "",
          result: m.gameResult ?? "",
          stats: ev.stats ?? [],
        });
      }
    }
  }
  rows.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  return { rows, index };
}

/** How many games the compact variant shows. The full sheet shows the season. */
const COMPACT_ROWS = 10;

export default function GameLog({
  playerId,
  compact = false,
}: {
  playerId: number | null;
  /**
   * Drops the card chrome and shows only the most recent games.
   *
   * For the Compare page, which renders two of these side by side: a full-season sticky
   * table in each half of a two-column grid buries the comparison it is meant to support.
   * The player card, where one player has the whole width, gets the full sheet.
   */
  compact?: boolean;
}) {
  const { log, state } = useGameLog(playerId);
  const parsed = useMemo(
    () => (log ? parse(log) : { rows: [], index: {} }),
    [log]
  );
  const index = parsed.index;
  const rows = compact ? parsed.rows.slice(0, COMPACT_ROWS) : parsed.rows;

  if (!playerId) return null;

  const val = (s: string[], label: string) =>
    index[label] != null ? (s[index[label]] ?? "") : "";

  return (
    <section className={compact ? "pd-sheet-plain" : "pd-sheet"}>
      <div className="pd-sheet-h">
        <h2>{compact ? `Last ${COMPACT_ROWS} games` : "Game Log"}</h2>
        {!compact && rows.length > 0 && (
          <span className="pd-sheet-n">{rows.length} regular-season games</span>
        )}
      </div>

      {state === "loading" && <p className="pd-sheet-note">Loading…</p>}
      {state === "error" && <p className="pd-sheet-note">Game log unavailable.</p>}
      {state === "done" && rows.length === 0 && (
        <p className="pd-sheet-note">No regular-season games on record.</p>
      )}

      {rows.length > 0 && (
        // Capped height with a sticky header: a 70-row table should not push the rest of
        // the page off the screen, and the column names have to survive the scroll.
        <div className={`table-scroll${compact ? "" : " pd-sheet-scroll"}`}>
          <table className="sheet sheet-tight pd-gl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Opp</th>
                <th>Res</th>
                {COLS.map((c) => (
                  <th key={c} className="num">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const d = g.date ? new Date(g.date) : null;
                const ds = d ? `${d.getMonth() + 1}/${d.getDate()}` : "";
                // The opponent used to be tinted green/red by whether the player's NBA
                // team won that night. That is not a fantasy fact — a player can post his
                // best line of the month in a loss — so it read as a judgement on the row
                // it had nothing to do with. The result gets its own quiet column instead.
                return (
                  <tr key={g.id}>
                    <td>{ds}</td>
                    <td>
                      {g.atVs}
                      {g.opp}
                    </td>
                    <td className="pd-gl-res">{g.result}</td>
                    {COLS.map((c) => (
                      <td key={c} className="num">
                        {val(g.stats, c)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
