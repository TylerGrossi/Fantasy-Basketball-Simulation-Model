"use client";

import { useState } from "react";

/**
 * "Last 10 games" for one player, fetched from ESPN's public (CORS-enabled) game-log
 * endpoint the first time the disclosure is opened.
 *
 * Port of `_PV_GAMELOG_SCRIPT` in the Streamlit app, and on purpose it keeps that
 * design: the log is a per-card detail almost nobody opens for most players, so
 * pre-fetching it for ~290 pool players would cost hundreds of requests to render one
 * page. Lazy + a module-level cache means each player is fetched at most once per
 * session and re-opening is instant.
 */

const CACHE = new Map<number, Parsed>();

interface Row {
  date: string;
  atVs: string;
  opp: string;
  stats: string[];
}

/**
 * The columns ESPN labels these by, in the order the table shows them.
 *
 * The percentages sit next to the made-attempted they come from. ESPN ships them as
 * their own labels ("FG%", "3P%"), so they are read straight from the row rather than
 * divided out here — a 0-attempt game then shows ESPN's own value instead of a NaN.
 */
const COLS = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FG", "FG%", "3PT", "3P%"];

interface EspnEvent {
  eventId: string;
  stats?: string[];
}

interface EspnLog {
  labels?: string[];
  events?: Record<string, {
    gameDate?: string;
    atVs?: string;
    opponent?: { abbreviation?: string };
  }>;
  seasonTypes?: Array<{
    displayName?: string;
    categories?: Array<{ events?: EspnEvent[] }>;
  }>;
}

/**
 * Flatten ESPN's nested seasonTypes → categories → events into the ten most recent
 * games. Preseason is skipped but the postseason is NOT: for a team that made the
 * playoffs those ARE the most recent games, and the log would otherwise stop in April.
 */
interface Parsed {
  rows: Row[];
  /** Stat label -> its position in each game's `stats` array. */
  index: Record<string, number>;
}

function parse(data: EspnLog): Parsed {
  const index: Record<string, number> = {};
  (data.labels ?? []).forEach((l, i) => (index[l] = i));
  const meta = data.events ?? {};
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const st of data.seasonTypes ?? []) {
    if (/Preseason/i.test(st.displayName ?? "")) continue;
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        if (seen.has(ev.eventId)) continue;
        seen.add(ev.eventId);
        const m = meta[ev.eventId] ?? {};
        rows.push({
          date: m.gameDate ?? "",
          atVs: m.atVs ?? "",
          opp: m.opponent?.abbreviation ?? "",
          stats: ev.stats ?? [],
        });
      }
    }
  }
  rows.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  return { rows: rows.slice(0, 10), index };
}

export default function GameLog({ playerId }: { playerId: number | null }) {
  const cached = playerId ? CACHE.get(playerId) : undefined;
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    cached ? "done" : "idle"
  );
  const [log, setLog] = useState<Parsed>(cached ?? { rows: [], index: {} });
  const { rows, index } = log;

  if (!playerId) return null;

  const load = async () => {
    if (state !== "idle") return;
    setState("loading");
    try {
      const r = await fetch(
        `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`
      );
      const parsed = parse((await r.json()) as EspnLog);
      CACHE.set(playerId, parsed);
      setLog(parsed);
      setState("done");
    } catch {
      setState("error");
    }
  };

  const val = (s: string[], label: string) =>
    index[label] != null ? (s[index[label]] ?? "") : "";

  return (
    <details className="pv-gl" onToggle={(e) => e.currentTarget.open && load()}>
      <summary className="pv-gl-sum">Last 10 games</summary>
      <div className="pv-gl-body">
        {state === "loading" && <span className="caption">Loading…</span>}
        {state === "error" && <span className="caption">Game log unavailable.</span>}
        {state === "done" && rows.length === 0 && (
          <span className="caption">No recent games.</span>
        )}
        {state === "done" && rows.length > 0 && (
          <table className="pv-gl-tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Opp</th>
                {COLS.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((g, i) => {
                const d = g.date ? new Date(g.date) : null;
                const ds = d ? `${d.getMonth() + 1}/${d.getDate()}` : "";
                // The opponent used to be tinted green/red by whether the player's NBA
                // team won that night. That is not a fantasy fact — a player can post his
                // best line of the month in a loss — so it read as a judgement on the row
                // it had nothing to do with. Plain ink; the stats speak for themselves.
                return (
                  <tr key={`${g.date}-${i}`}>
                    <td>{ds}</td>
                    <td>
                      {g.atVs}
                      {g.opp}
                    </td>
                    {COLS.map((c) => (
                      <td key={c}>{val(g.stats, c)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
