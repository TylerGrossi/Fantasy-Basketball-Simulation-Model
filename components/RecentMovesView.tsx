"use client";

import { useMemo, useState } from "react";
import type { RecentMoveRow } from "@/lib/league";
import { groupByDay, groupMoves, timeLabel, type MoveGroup, type MoveRow } from "@/lib/moves";
import FilterBar from "./FilterBar";
import MultiSelect from "./MultiSelect";
import PlayerLink from "./PlayerLink";

/**
 * League-wide transaction feed — ESPN's "Recent Activity" — with client-side filters
 * over the exported `recentMoves` list. Same pattern as Player Value's filter bar:
 * everything is already on the page (150 rows, not 290 players, so there's no case for
 * a server round trip), filtering is instant, and the controls reuse `.field` /
 * `MultiSelect` rather than inventing a second filter language.
 */

const DATE_OPTIONS = [
  { label: "All time", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 6 months", days: 182 },
  { label: "Last year", days: 365 },
] as const;

function badgeClass(action: string) {
  if (action === "Add" || action === "Waiver Add") return "add";
  if (action === "Drop") return "drop";
  if (action === "Trade") return "trade";
  if (action === "Draft") return "draft";
  return "moved";
}

/** A move plus the player's 9-cat value, joined by the page. Defined in lib/moves.ts,
 *  re-exported here because the page imports it from this module. */
export type { MoveRow } from "@/lib/moves";

export default function RecentMovesView({ rows }: { rows: MoveRow[] }) {
  const [player, setPlayer] = useState("");
  const [teams, setTeams] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [days, setDays] = useState(0);

  const teamOptions = useMemo(
    () => [...new Set(rows.map((r) => r.team).filter(Boolean))].sort(),
    [rows]
  );
  // Fixed, sensible order rather than whatever order they first appear in the feed —
  // "Add" leading and "Trade" last reads the way the badge colors do (good -> bad ->
  // neutral trade).
  const ACTION_ORDER = ["Add", "Waiver Add", "Drop", "Trade", "Draft", "Moved"];
  const actionOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.action).filter(Boolean));
    return [
      ...ACTION_ORDER.filter((a) => present.has(a)),
      ...[...present].filter((a) => !ACTION_ORDER.includes(a)).sort(),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const filtered = useMemo(() => {
    const q = player.trim().toLowerCase();
    const cutoff = days > 0 ? Date.now() - days * 86_400_000 : null;
    return rows.filter((r) => {
      if (q && !r.player.toLowerCase().includes(q)) return false;
      if (teams.length && !teams.includes(r.team)) return false;
      if (actions.length && !actions.includes(r.action)) return false;
      if (cutoff !== null) {
        const t = r.date ? Date.parse(r.date) : NaN;
        if (Number.isNaN(t) || t < cutoff) return false;
      }
      return true;
    });
  }, [rows, player, teams, actions, days]);

  // Transactions, then day headings — computed once per filter change and shared by the
  // mobile feed. The table below renders the ungrouped rows exactly as before.
  const feed = useMemo(() => groupByDay(groupMoves(filtered)), [filtered]);

  return (
    <>
      <FilterBar className="controls rm-filters">
        <div className="ms rm-f-player">
          <div className="ms-label">Player</div>
          <input
            className="field"
            type="search"
            placeholder="Search…"
            value={player}
            onChange={(e) => setPlayer(e.target.value)}
            aria-label="Player name"
          />
        </div>
        <MultiSelect
          label="Team"
          options={teamOptions}
          selected={teams}
          onChange={setTeams}
          className="rm-f-team"
        />
        <MultiSelect
          label="Move type"
          options={actionOptions}
          selected={actions}
          onChange={setActions}
          className="rm-f-action"
        />
        <div className="ms rm-f-date">
          <div className="ms-label">Date</div>
          <select
            className="field field-select"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Date range"
          >
            {DATE_OPTIONS.map((o) => (
              <option key={o.label} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </FilterBar>

      {filtered.length === 0 ? (
        <p className="caption">No moves match those filters.</p>
      ) : (
        <>
        {/*
          MOBILE: the same rows as one card per transaction, under a day heading.

          Both are rendered and switched by CSS at 767px — no width detection and no flash
          of the wrong one, the pattern the nav and the rest of the app already use. The
          grouping runs over `filtered`, so a filter narrows the cards exactly as it
          narrows the table; filtering to "Drop" leaves a card holding only its drop, which
          is the truth about what survived the filter.
        */}
        <div className="rm-feed">
          {feed.map((d) => (
            <section className="rm-day" key={d.key}>
              <h2 className="rm-day-h">{d.label}</h2>
              {d.groups.map((g) => (
                <MoveCard key={g.key} g={g} />
              ))}
            </section>
          ))}
        </div>

        <div className="table-scroll rm-table-wrap">
          <table className="sheet rm-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Team</th>
                <th>Move</th>
                <th>Player</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.date}-${r.player}-${i}`}>
                  <td className="rm-date">
                    {r.date
                      ? new Date(r.date).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="rm-team">{r.team}</td>
                  <td>
                    <span className={`rm-badge ${badgeClass(r.action)}`}>{r.action}</span>
                  </td>
                  <td>
                    <PlayerLink name={r.player} />
                    {r.position && <span className="lu-name-sub"> {r.position}</span>}
                  </td>
                  <td className="num">
                    {r.value == null
                      ? "—"
                      : `${r.value >= 0 ? "+" : ""}${r.value.toFixed(1)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </>
  );
}

/**
 * One transaction: who did it, when, and every player it moved.
 *
 * Adds lead, drops follow, because that is the order the decision was made in — you pick
 * someone up and drop to make room. The sign carries the meaning (green +, red −) so the
 * word "Added" does not have to appear on every line.
 */
function MoveCard({ g }: { g: MoveGroup }) {
  const lines: Array<{ row: MoveRow; sign: "+" | "−"; kind: string }> = [
    ...g.adds.map((row) => ({ row, sign: "+" as const, kind: "add" })),
    ...g.drafted.map((row) => ({ row, sign: "+" as const, kind: "draft" })),
    ...g.other.map((row) => ({ row, sign: "+" as const, kind: "moved" })),
    ...g.drops.map((row) => ({ row, sign: "−" as const, kind: "drop" })),
  ];

  return (
    <article className="rm-card">
      <header className="rm-card-h">
        <span className="rm-card-team">{g.team}</span>
        <span className="rm-card-when">{timeLabel(g.date)}</span>
      </header>
      <div className="rm-card-b">
        <div className="rm-card-label">{g.label}</div>
        {lines.map(({ row, sign, kind }, i) => (
          <div className={`rm-line rm-${kind}`} key={`${row.player}-${i}`}>
            <span className="rm-sign" aria-hidden="true">
              {sign}
            </span>
            <span className="rm-who">
              <PlayerLink name={row.player} />
              {row.position && <span className="rm-pos"> {row.position}</span>}
            </span>
            <span className="rm-val">
              {row.value == null ? "" : `${row.value >= 0 ? "+" : ""}${row.value.toFixed(1)}`}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
