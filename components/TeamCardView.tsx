"use client";

import { useEffect, useMemo, useState } from "react";
import PlayerLink from "./PlayerLink";
import { playerStatus } from "@/lib/playerPool";

/** One team, as the server page builds it (app/team/page.tsx). */
export interface TeamCardData {
  id: number;
  name: string;
  abbrev: string;
  wins: number;
  losses: number;
  ties: number;
  standing: number;
  allPlay: { w: number; l: number; t: number; pct: number } | null;
  /** All-play power rank, or null before any week is scored. */
  powerRank: number | null;
  /** The opening-day value rank (power-week0.json). */
  week0Place: number | null;
  playoffProb: number | null;
  titleProb: number | null;
  acquisitions: number | null;
  trades: number | null;
  /** Category -> this season's actual total (ratios as fractions). */
  season: Record<string, number | null>;
  /** Category -> the current roster's per-game line, IR excluded. */
  roster: Record<string, number | null>;
  /** The best lineup by value (starters in slot order), then the bench, then IR. */
  lineup: Array<{ name: string; nbaTeam: string; slot: string; value: number; status: string }>;
}

type Basis = "season" | "roster";

const BASIS_LABEL: Record<Basis, string> = {
  season: "Season Totals",
  roster: "Roster Per Game",
};

/**
 * The 15 categories in three groups, the Player Card's arrangement. Anything the league
 * scores that is not listed here falls into a last "Other" group rather than vanishing.
 */
/** The value rows, always first: summed player values, not scored categories. */
const VALUE_KEYS = ["VALUE", "OFF", "DEF", "OTHER"];

const GROUPS: Array<{ title: string; cats: string[] }> = [
  { title: "Scoring", cats: ["PTS", "3PM", "DD", "TW"] },
  { title: "Shooting", cats: ["FGM", "FGA", "FG%", "FT%", "3PA", "3P%"] },
  { title: "Defense & Playmaking", cats: ["REB", "AST", "STL", "BLK", "TO"] },
];

const LABEL: Record<string, string> = {
  VALUE: "Total Value",
  OFF: "Offensive Value",
  DEF: "Defensive Value",
  OTHER: "Other Value",
  PTS: "Points",
  "3PM": "3-Pointers Made",
  "3PA": "3-Point Attempts",
  "3P%": "3-Point %",
  FGM: "Field Goals Made",
  FGA: "Field Goal Attempts",
  "FG%": "Field Goal %",
  "FT%": "Free Throw %",
  REB: "Rebounds",
  AST: "Assists",
  STL: "Steals",
  BLK: "Blocks",
  TO: "Turnovers",
  DD: "Double-Doubles",
  TW: "Team Wins",
};

interface CatRank {
  cat: string;
  value: number | null;
  rank: number | null;
  tied: boolean;
  n: number;
  /** 0-100 by rank, best = 100 — the Player Card's scale, with 8 teams on it. */
  percentile: number | null;
}

export default function TeamCardView({
  teams,
  categories,
  lowerIsBetter,
  meId,
  initialId,
  defaultBasis,
  allPlayReady,
}: {
  teams: TeamCardData[];
  categories: string[];
  lowerIsBetter: string[];
  meId: number;
  initialId: number;
  defaultBasis: Basis;
  /** Week 1 is final, so the all-play numbers mean something. */
  allPlayReady: boolean;
}) {
  const [id, setId] = useState(initialId);
  const [basis, setBasis] = useState<Basis>(defaultBasis);
  const team = teams.find((t) => t.id === id) ?? teams[0];

  // Keep the address bar on the team being shown, as the Player Card does with ?name=.
  useEffect(() => {
    window.history.replaceState(null, "", `${window.location.pathname}?id=${id}`);
  }, [id]);

  const ranks = useMemo(
    () => rankCategories(teams, team, categories, new Set(lowerIsBetter), basis),
    [teams, team, categories, lowerIsBetter, basis]
  );
  const valueRanks = useMemo(
    () => rankCategories(teams, team, VALUE_KEYS, new Set(), basis),
    [teams, team, basis]
  );
  const byCat = new Map([...valueRanks, ...ranks].map((r) => [r.cat, r]));
  const grouped = [
    { title: "Value", cats: VALUE_KEYS.filter((k) => team?.[basis][k] != null) },
    ...GROUPS.map((g) => ({ ...g, cats: g.cats.filter((c) => categories.includes(c)) })),
    {
      title: "Other",
      cats: categories.filter((c) => !GROUPS.some((g) => g.cats.includes(c))),
    },
  ].filter((g) => g.cats.length);

  if (!team) return <p className="caption">No teams in the export.</p>;

  const record = `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}`;
  const pct = (v: number | null) => (v == null ? "" : `${v.toFixed(1)}%`);
  /*
   * The facts sit IN the masthead as a grid of figures (owner, 2026-10-21), not as a
   * label/value list under it. Ranks are bare numbers — "1", not "1st". Always the same
   * eight cells so the header is the same height for every team; a fact a team doesn't
   * have yet prints a dash.
   */
  const power =
    allPlayReady && team.powerRank ? team.powerRank : (team.week0Place ?? null);
  const facts: Array<{ label: string; value: string }> = [
    { label: "Record", value: record },
    { label: "Standing", value: String(team.standing) },
    { label: allPlayReady ? "Power" : "Power (Wk 0)", value: power ? String(power) : "" },
    {
      label: "All-play",
      value: allPlayReady && team.allPlay ? `${(team.allPlay.pct * 100).toFixed(1)}%` : "",
    },
    { label: "Playoffs", value: pct(team.playoffProb) },
    { label: "Title", value: pct(team.titleProb) },
    { label: "Adds", value: team.acquisitions == null ? "" : String(team.acquisitions) },
    { label: "Trades", value: team.trades == null ? "" : String(team.trades) },
  ];

  return (
    <div className="pd">
      <div className="controls pd-search">
        <select
          className="tc-pick"
          value={team.id}
          onChange={(e) => setId(Number(e.target.value))}
          aria-label="Team"
        >
          {[...teams]
            .sort((a, b) => a.standing - b.standing)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.id === meId ? " (you)" : ""}
              </option>
            ))}
        </select>
      </div>

      <div className="pd-split">
        <aside className="pd-card tc-card">
          <div className="pd-head">
            <div className="pv-shot tc-mono" aria-hidden="true">
              {team.abbrev}
            </div>
          </div>
          <div className="pd-id">
            <div className="pd-name">{team.name}</div>
            <div className="tc-facts">
              {facts.map((f) => (
                <div className="tc-fact" key={f.label}>
                  <span className={`tc-fv mono${f.value ? "" : " tc-fv-none"}`}>
                    {f.value || "—"}
                  </span>
                  <span className="tc-fl">{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          <h3 className="tc-h">Lineup</h3>
          <div className="pd-wt-wrap tc-lineup-wrap">
            <table className="pd-wt tc-lineup">
              <thead>
                <tr>
                  <th className="tc-slot">Slot</th>
                  <th className="tc-player">Player</th>
                  <th>NBA</th>
                  <th className="pd-wt-val">Val</th>
                </tr>
              </thead>
              <tbody>
                {team.lineup.map((p, i) => {
                  const [code, sev] = playerStatus(p.status);
                  // The first player off the starting lineup draws the divider.
                  const benched = (s: string) => s === "Bench" || s === "IR" || !s;
                  const firstBench =
                    i > 0 && benched(p.slot) && !benched(team.lineup[i - 1].slot);
                  const cls = [p.slot === "IR" ? "tc-ir" : "", firstBench ? "tc-bench-start" : ""]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <tr key={p.name} className={cls || undefined}>
                      <td className="tc-slot">{p.slot || "—"}</td>
                      <th scope="row" className="tc-player">
                        <PlayerLink name={p.name} />
                        {sev && <span className={`tc-inj ${sev}`}>{code}</span>}
                      </th>
                      <td>{p.nbaTeam}</td>
                      <td className="pd-wt-val">
                        {p.value >= 0 ? "+" : ""}
                        {p.value.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </aside>

        <section className="pd-rank">
          <div className="pd-rank-head">
            <h2 className="pd-rank-h">
              <select
                className="pd-rank-sel"
                value={basis}
                onChange={(e) => setBasis(e.target.value as Basis)}
                aria-label="Basis"
              >
                {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => (
                  <option key={b} value={b}>
                    {BASIS_LABEL[b]}
                  </option>
                ))}
              </select>{" "}
              <span className="pd-rank-full">League Category Rankings</span>
              <span className="pd-rank-short">Rankings</span>
            </h2>
          </div>

          <div className="pct-scale" aria-hidden="true">
            <span>Last</span>
            <span>Middle</span>
            <span>First</span>
          </div>
          {grouped.map((g) => (
            <section className="pct-group" key={g.title}>
              <h3 className="pct-group-h">{g.title}</h3>
              {g.cats.map((cat) => {
                const r = byCat.get(cat);
                return r ? <CategoryBar key={cat} r={r} lower={lowerIsBetter.includes(cat)} basis={basis} /> : null;
              })}
            </section>
          ))}
        </section>
      </div>
    </div>
  );
}

/**
 * Where `team` ranks in each category among every team with a figure. Rank 1 is best:
 * highest, or lowest for a lower-is-better category (TO). Ties share the better rank.
 */
function rankCategories(
  teams: TeamCardData[],
  team: TeamCardData,
  categories: string[],
  lower: Set<string>,
  basis: Basis
): CatRank[] {
  return categories.map((cat) => {
    const value = team[basis][cat] ?? null;
    const all = teams.map((t) => t[basis][cat]).filter((v): v is number => v != null);
    // Every team at zero (nothing played yet) ranks nobody — no bar beats a row of ties.
    if (value == null || all.length < 2 || all.every((v) => v === all[0])) {
      return { cat, value, rank: null, tied: false, n: all.length, percentile: null };
    }
    const better = (a: number, b: number) => (lower.has(cat) ? a < b : a > b);
    const rank = 1 + all.filter((v) => better(v, value)).length;
    const tied = all.filter((v) => v === value).length > 1;
    const n = all.length;
    return { cat, value, rank, tied, n, percentile: Math.round(((n - rank) / (n - 1)) * 100) };
  });
}

/**
 * One category bar, the Player Card's PercentileBar with a team's RANK in the bubble —
 * with eight teams "3" says more than "71". Same diverging fill: clay above the middle,
 * cobalt below, deeper the further from it.
 */
function CategoryBar({ r, lower, basis }: { r: CatRank; lower: boolean; basis: Basis }) {
  const label = LABEL[r.cat] ?? r.cat;
  const text = formatCat(r.cat, r.value, basis);

  if (r.percentile == null || r.rank == null) {
    return (
      <div className="pct-row">
        <span className="pct-label">{label}</span>
        <span className="pct-value mono">{text}</span>
        <span className="pct-track pct-track-empty">
          <span className="pct-none">{r.value == null ? "No data" : "Not ranked yet"}</span>
        </span>
      </div>
    );
  }

  const strength = Math.min(Math.abs(r.percentile - 50) / 50, 1);
  const pole = r.percentile >= 50 ? "var(--pct-hi)" : "var(--pct-lo)";
  const fill = `color-mix(in oklab, ${pole} ${Math.round(strength * 100)}%, var(--pct-mid))`;
  const tone = strength >= 0.4 ? "strong" : "pale";
  const width = Math.max(r.percentile, 3);
  // The bubble is the bare rank ("2", "T3"); the tooltip spells it out.
  const place = `${r.tied ? "T" : ""}${r.rank}`;

  return (
    <div
      className="pct-row"
      title={`${label}: ${text} — ${r.tied ? "T-" : ""}${ordinal(r.rank)} of ${r.n}${
        lower ? " (fewer is better)" : ""
      }`}
    >
      <span className="pct-label">{label}</span>
      <span className="pct-value mono">{text}</span>
      <span className="pct-track">
        <span className="pct-tick" aria-hidden="true" />
        <span className={`pct-fill pct-${tone}`} style={{ width: `${width}%`, background: fill }}>
          <span className="pct-bubble mono">{place}</span>
        </span>
      </span>
    </div>
  );
}

/** Ratios as percentages; values signed; season totals whole; per-game lines to one decimal. */
function formatCat(cat: string, v: number | null, basis: Basis): string {
  if (v == null) return "—";
  if (VALUE_KEYS.includes(cat)) return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
  if (cat.endsWith("%")) return `${(v * 100).toFixed(1)}%`;
  return basis === "season" ? Math.round(v).toLocaleString() : v.toFixed(1);
}

/** 1 -> "1st", 12 -> "12th", 22 -> "22nd". */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
