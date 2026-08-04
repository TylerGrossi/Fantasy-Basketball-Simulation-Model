"use client";

import { useMemo, useState } from "react";
import type { RecentMoveRow } from "@/lib/league";
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

export default function RecentMovesView({ rows }: { rows: RecentMoveRow[] }) {
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

  return (
    <>
      <div className="controls rm-filters">
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
      </div>

      {filtered.length === 0 ? (
        <p className="caption">No moves match those filters.</p>
      ) : (
        <div className="table-scroll">
          <table className="sheet rm-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Team</th>
                <th>Move</th>
                <th>Player</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
