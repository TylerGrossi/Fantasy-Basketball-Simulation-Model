"use client";

import { useState } from "react";
import { useCareer, type CareerRow, type Line } from "@/lib/careerStats";

/**
 * The Career tab: every regular season of the player's career, Basketball-Reference's
 * layout — a counting sheet (per game or totals) and an advanced sheet, each ending in a
 * career row and a row per franchise.
 *
 * The counting sheet carries ALL FIFTEEN league categories (FGM, FGA, FG%, FT%, 3PM, 3PA,
 * 3P%, REB, AST, STL, BLK, TO, DD, PTS, TW), plus the box-score columns around them.
 * Their headers are set in ink and the rest in grey, so the categories read out of the
 * row without a second legend.
 *
 * Data and its limits: lib/careerStats.ts.
 */

type Mode = "pg" | "tot";
const MODES: Array<[Mode, string]> = [
  ["pg", "Per Game"],
  ["tot", "Totals"],
];

interface Col {
  key: string;
  label: string;
  /** One of the league's fifteen scoring categories. */
  cat?: boolean;
  title?: string;
  /** A made/attempted pair ("3.1/6.3"): twice a normal column's width. */
  wide?: boolean;
  cell: (r: CareerRow, mode: Mode) => string;
}

const dash = "—";
const f1 = (x: number) => x.toFixed(1);
const pct = (m: number, a: number) => (a > 0 ? f1((100 * m) / a) : dash);
/** A counting stat: per game to one decimal, or the season's whole number. */
const count = (k: keyof Line) => (r: CareerRow, mode: Mode) =>
  mode === "tot" ? String(r.line[k]) : r.line.gp ? f1(r.line[k] / r.line.gp) : dash;
/** Made and attempted in one cell, "3.1/6.3" (owner, 2026-10-30) — the box score's style. */
const pair = (m: keyof Line, a: keyof Line) => (r: CareerRow, mode: Mode) =>
  `${count(m)(r, mode)}/${count(a)(r, mode)}`;

function twCell(r: CareerRow, mode: Mode): string {
  if (r.tw == null || r.twGames == null) return dash;
  const short = r.twGames < r.line.gp ? "*" : "";
  if (mode === "tot") return `${r.tw}${short}`;
  // Per game over the games actually counted, so a short log does not drag the rate down.
  return r.twGames ? `${(r.tw / r.twGames).toFixed(2)}${short}` : dash;
}

const BASIC: Col[] = [
  { key: "gp", label: "GP", cell: (r) => String(r.line.gp) },
  { key: "gs", label: "GS", cell: (r) => String(r.line.gs) },
  { key: "min", label: "MIN", cell: count("min") },
  // The headline line first — PTS, REB, AST, STL, BLK — then the shooting and the rest
  // (owner, 2026-10-29: points never sits at the far right).
  { key: "pts", label: "PTS", cat: true, cell: count("pts") },
  { key: "reb", label: "REB", cat: true, cell: count("reb") },
  { key: "ast", label: "AST", cat: true, cell: count("ast") },
  { key: "stl", label: "STL", cat: true, cell: count("stl") },
  { key: "blk", label: "BLK", cat: true, cell: count("blk") },
  { key: "fg", label: "FGM/FGA", cat: true, wide: true, cell: pair("fgm", "fga") },
  { key: "fgp", label: "FG%", cat: true, cell: (r) => pct(r.line.fgm, r.line.fga) },
  { key: "tp", label: "3PM/3PA", cat: true, wide: true, cell: pair("tpm", "tpa") },
  { key: "tpp", label: "3P%", cat: true, cell: (r) => pct(r.line.tpm, r.line.tpa) },
  { key: "ft", label: "FTM/FTA", wide: true, cell: pair("ftm", "fta") },
  { key: "ftp", label: "FT%", cat: true, cell: (r) => pct(r.line.ftm, r.line.fta) },
  { key: "to", label: "TO", cat: true, cell: count("to") },
  {
    key: "dd",
    label: "DD",
    cat: true,
    title: "Double-doubles",
    cell: (r, mode) =>
      mode === "tot" ? String(r.line.dd) : r.line.gp ? (r.line.dd / r.line.gp).toFixed(2) : dash,
  },
  { key: "tw", label: "TW", cat: true, title: "Team wins in games he played", cell: twCell },
];

const opt = (x: number | undefined, digits = 1) => (x == null ? dash : x.toFixed(digits));
/** Basketball-Reference's spelling for a 0-1 ratio: ".290". */
const ratio = (n: number, d: number) => (d > 0 ? (n / d).toFixed(3).replace(/^0/, "") : dash);

const ADVANCED: Col[] = [
  { key: "gp", label: "GP", cell: (r) => String(r.line.gp) },
  { key: "min", label: "MIN", title: "Total minutes", cell: (r) => String(r.line.min) },
  { key: "per", label: "PER", title: "Player Efficiency Rating (ESPN)", cell: (r) => opt(r.per) },
  {
    key: "ts",
    label: "TS%",
    title: "True shooting: PTS / (2 × (FGA + 0.44 × FTA))",
    cell: ({ line: l }) => pct(l.pts, 2 * (l.fga + 0.44 * l.fta)),
  },
  {
    key: "efg",
    label: "eFG%",
    title: "Effective FG%: (FGM + 0.5 × 3PM) / FGA",
    cell: ({ line: l }) => pct(l.fgm + 0.5 * l.tpm, l.fga),
  },
  { key: "3par", label: "3PAr", title: "Share of shots that are threes", cell: ({ line: l }) => ratio(l.tpa, l.fga) },
  { key: "ftr", label: "FTr", title: "Free throws per shot", cell: ({ line: l }) => ratio(l.fta, l.fga) },
  { key: "usg", label: "USG%", title: "Share of team plays used while on the floor", cell: (r) => opt(r.usg) },
  {
    key: "astp",
    label: "AST%",
    title: "Share of teammate field goals he assisted while on the floor",
    cell: (r) => opt(r.astPct),
  },
  {
    key: "tovp",
    label: "TOV%",
    title: "Turnovers per 100 plays: TO / (FGA + 0.44 × FTA + TO)",
    cell: ({ line: l }) => pct(l.to, l.fga + 0.44 * l.fta + l.to),
  },
  {
    key: "ato",
    label: "AST/TO",
    cell: ({ line: l }) => (l.to > 0 ? (l.ast / l.to).toFixed(2) : dash),
  },
  {
    key: "p36",
    label: "PTS/36",
    title: "Points per 36 minutes",
    cell: ({ line: l }) => (l.min > 0 ? f1((36 * l.pts) / l.min) : dash),
  },
  { key: "dd", label: "DD", title: "Double-doubles", cell: (r) => String(r.line.dd) },
  { key: "td", label: "TD", title: "Triple-doubles", cell: (r) => String(r.line.td) },
];

export default function CareerStats({ playerId }: { playerId: number | null }) {
  const { career, state } = useCareer(playerId);
  const [mode, setMode] = useState<Mode>("pg");

  if (!playerId) return null;
  const rows = career?.rows ?? [];
  const twShort = rows.some((r) => r.twGames != null && r.twGames < r.line.gp);

  const status =
    state === "loading" ? (
      <p className="pd-sheet-note">Loading…</p>
    ) : state === "error" ? (
      <p className="pd-sheet-note">Career stats unavailable.</p>
    ) : state === "done" && rows.length === 0 ? (
      <p className="pd-sheet-note">No regular-season games on record.</p>
    ) : null;

  return (
    <>
      <section className="pd-sheet">
        <div className="pd-sheet-h">
          <h2>Career {mode === "pg" ? "Per Game" : "Totals"}</h2>
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
        {status}
        {career && rows.length > 0 && (
          <>
            <CareerTable cols={BASIC} career={career} mode={mode} />
            {twShort && (
              <p className="pd-cs-note">
                <b>*</b> ESPN&apos;s game log is missing some of that season&apos;s games, so
                TW counts only the games it has.
              </p>
            )}
          </>
        )}
      </section>

      {career && rows.length > 0 && (
        <section className="pd-sheet">
          <div className="pd-sheet-h">
            <h2>Career Advanced</h2>
          </div>
          <CareerTable cols={ADVANCED} career={career} mode="tot" />
        </section>
      )}
    </>
  );
}

/** Width of the Season column, and the narrowest any other column may get. */
const CS_SEASON_REM = 7;
const CS_COL_REM = 3.4;

function CareerTable({
  cols,
  career,
  mode,
}: {
  cols: Col[];
  career: { rows: CareerRow[]; summary: CareerRow[] };
  mode: Mode;
}) {
  // Age and Team, then one share per column and two per pair.
  const units = 2 + cols.reduce((n, c) => n + (c.wide ? 2 : 1), 0);
  const row = (r: CareerRow) => (
    <tr key={r.key} className={`pd-cs-${r.kind}`}>
      <th scope="row">{r.label}</th>
      <td className="num">{r.age ?? ""}</td>
      <td>{r.kind === "career" || r.kind === "team" ? "" : r.team}</td>
      {cols.map((c) => (
        <td key={c.key} className="num">
          {c.cell(r, mode)}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="table-scroll">
      {/* Fixed layout: Season gets its own width and every other column an equal share
          (a made/attempted pair two shares), so the gaps between columns are the same
          across the table. The min-width keeps a share wide enough for "100.0"; below it
          the box scrolls instead. */}
      <table
        className="sheet sheet-tight pd-cs"
        style={{ minWidth: `${CS_SEASON_REM + units * CS_COL_REM}rem` }}
      >
        <colgroup>
          <col style={{ width: `${CS_SEASON_REM}rem` }} />
          <col style={{ width: `${CS_COL_REM}rem` }} />
          <col style={{ width: `${CS_COL_REM}rem` }} />
          {cols.map((c) => (
            <col key={c.key} style={{ width: `${(c.wide ? 2 : 1) * CS_COL_REM}rem` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>Season</th>
            <th className="num">Age</th>
            <th>Team</th>
            {cols.map((c) => (
              <th key={c.key} className={`num${c.cat ? " pd-cs-cat" : ""}`} title={c.title}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{career.rows.map(row)}</tbody>
        {career.summary.length > 0 && <tbody className="pd-cs-sum">{career.summary.map(row)}</tbody>}
      </table>
    </div>
  );
}
