"use client";

import { useState } from "react";

/**
 * Season Summary: the champion, one team's headline numbers, and the final standings.
 *
 * A CLIENT component for one reason: TAPPING A TEAM IN THE STANDINGS RE-POINTS THE KPIs.
 * They used to describe your team and only your team, which left the page unable to answer
 * the question it most obviously invites — "how did HE do?". Every figure is already on
 * the page (ten rows), so switching is instant and needs no server round trip.
 *
 * The standings row IS the control. An earlier version also had a dropdown; two controls
 * for one choice is one too many, and on a list of teams the tap is the obvious gesture.
 *
 * The standings render twice, switched at 767px: a ladder on mobile, the six-column table
 * on desktop. The ladder deliberately reuses the `.pr-*` classes from Power Rankings —
 * they are the same object (a ranked list of teams with one headline figure), and a second
 * copy of that CSS under a different prefix would be sixty lines waiting to drift. The
 * prefix is historical; treat the block in globals.css as "team ladder", not "power
 * rankings only".
 */

export interface SummaryRow {
  teamId: number;
  teamName: string;
  rank: number;
  record: string;
  winPct: number;
  allPlayPct: number;
  luck: number;
}

export default function SeasonSummaryView({
  rows,
  myTeamId,
  seasonOver,
}: {
  /** Standings, already sorted by finish. */
  rows: SummaryRow[];
  myTeamId: number;
  seasonOver: boolean;
}) {
  // Opens on your own team, which is the common case; the picker is for everyone else.
  const [teamId, setTeamId] = useState(myTeamId);
  const champ = rows[0];
  const team = rows.find((r) => r.teamId === teamId) ?? rows[0];

  return (
    <>
      <div className="champion">
        <div className="eyebrow">
          {seasonOver ? "Champion" : "Regular-Season Leader"}
        </div>
        <div className="champion-name">{champ.teamName}</div>
        <div className="mono champion-rec">{champ.record}</div>
      </div>

      {/*
        THE LADDER IS THE PICKER. There was a dropdown here; it did the same job as tapping
        a row and meant the page carried two controls for one choice. Tapping a team is the
        obvious gesture on a list of teams, so the dropdown went.

        Three KPIs, not four: All-Play % is already the figure on every ladder row and the
        rank is the row's own number, so repeating either here would be the same fact
        twice on one screen.
      */}
      <p className="ss-finish">
        <strong>{team.teamName}</strong> finished{" "}
        <strong className="ss-place">{ordinal(team.rank)}</strong>.
      </p>
      <div className="metrics ss-metrics">
        <Metric label="Record" value={team.record} />
        <Metric label="Win %" value={pct(team.winPct)} />
        <Metric label="Luck" value={signed(team.luck)} tone={team.luck} />
      </div>

      <h2 className="pr-title">Final Standings</h2>

      {/* MOBILE: the ladder. Selecting a team here also moves the KPIs above, so the row
          and the numbers can never disagree about who they describe. */}
      <div className="pr-ladder">
        {rows.map((r) => (
          <button
            key={r.teamId}
            type="button"
            className={`pr-row pr-row-btn${r.teamId === teamId ? " pr-you" : ""}`}
            aria-pressed={r.teamId === teamId}
            onClick={() => setTeamId(r.teamId)}
          >
            <span className="pr-pos mono">{r.rank}</span>
            {/* Name only. Record and luck moved to the KPIs above, where they describe
                the selected team rather than repeating on all ten rows. */}
            <span className="pr-main">
              <span className="pr-team">{r.teamName}</span>
            </span>
            <span className="pr-pct mono">{pct(r.allPlayPct)}</span>
          </button>
        ))}
      </div>

      <div className="table-scroll pr-table-wrap">
        <table className="sheet ss-standings">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Team</th>
              <th className="num">Record</th>
              <th className="num">Win %</th>
              <th className="num">All-Play %</th>
              <th className="num">Luck</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId} className={r.teamId === myTeamId ? "row-you" : undefined}>
                <td className="ss-rank">{r.rank}</td>
                <td className="ss-team">{r.teamName}</td>
                <td className="num">{r.record}</td>
                <td className="num">{pct(r.winPct)}</td>
                <td className="num">{pct(r.allPlayPct)}</td>
                <td
                  className="num"
                  style={{ color: r.luck >= 0 ? "var(--good)" : "var(--bad)" }}
                >
                  {signed(r.luck)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** `tone` colours the figure by sign — used for Luck, where the sign is the meaning. */
function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div
        className="metric-value mono"
        style={tone === undefined ? undefined : { color: tone >= 0 ? "var(--good)" : "var(--bad)" }}
      >
        {value}
      </div>
    </div>
  );
}
