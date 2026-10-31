"use client";

import { useEffect, useState } from "react";
import { fetchGameLog } from "./gamelog";
import { isAllStar, isRegularSeason } from "./gamelogTypes";

/**
 * A player's whole career, season by season — the Player Card's Career tab.
 *
 * Everything else on the card is ONE season. This is the reference-site sheet: every
 * regular season, a row per team when he was traded plus a combined row, then career and
 * per-franchise totals underneath.
 *
 * FOUR ESPN SOURCES, all public and CORS-open, fetched client-side only when the tab opens
 * (same trade-off as the game log — see AGENTS.md):
 *
 *   1. site.web …/athletes/{id}/stats — per-season averages, totals and misc (DD2, TD3),
 *      already split by team with ESPN's own combined row for a traded season. One request,
 *      and the whole counting-stat table renders from it.
 *   2. core …/seasons/{y}/types/2/athletes/{id}/statistics — ESPN's PER for the season.
 *   3. core …/seasons/{y}/types/2/teams/{t}/statistics — team totals, the denominators for
 *      USG% and AST%. Shared across players, so the cache pays off on the second card.
 *   4. the season game log (lib/gamelog, shared cache) — Team Wins, which no ESPN stats
 *      endpoint carries for a player.
 *
 * 2-4 arrive after 1 and fill their columns in; the table never waits on them.
 *
 * TEAM WINS IS COUNTED, NEVER ESTIMATED. ESPN's older game logs are missing games (Kawhi
 * Leonard's 2015-16 log holds 66 of his 72), so a count can come up short. Such a cell is
 * flagged `twShort` and the table marks it, rather than scaling it up to a guess.
 *
 * What is NOT here, deliberately: ORB% / DRB% / STL% / BLK% need OPPONENT totals, which
 * ESPN's team endpoint does not have; Win Shares, BPM and VORP are Basketball-Reference
 * models, not data. ESPN's `plusMinus` is a -1 placeholder for older seasons, so it is out
 * too — a sentinel that is also a plausible real value cannot be told apart from one.
 */

/** Counting totals for one row. Per-game figures are derived from these, never stored. */
export interface Line {
  gp: number;
  gs: number;
  /** Total minutes: ESPN's per-game average times games (ESPN ships no minute total). */
  min: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  pf: number;
  pts: number;
  dd: number;
  td: number;
}

export type RowKind =
  /** A whole season with one team. */
  | "season"
  /** One team's share of a traded season. */
  | "part"
  /** ESPN's combined row for a traded season. */
  | "combined"
  | "career"
  /** Career with one franchise. */
  | "team";

export interface CareerRow {
  key: string;
  kind: RowKind;
  /** ESPN season year (2027 = 2026-27). Absent on the career / franchise rows. */
  year?: number;
  label: string;
  team: string;
  teamId?: string;
  line: Line;
  /** Age on Feb 1 of the season — Basketball-Reference's convention. */
  age?: number;
  per?: number;
  usg?: number;
  astPct?: number;
  /** Wins in the regular-season games ESPN's log has for this row. */
  tw?: number;
  /** How many games that count is over — fewer than `line.gp` when the log is short. */
  twGames?: number;
}

export interface Career {
  rows: CareerRow[];
  /** Career first, then each franchise, most games first. */
  summary: CareerRow[];
}

// ---------------------------------------------------------------- fetching

const SITE = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";

const CACHE = new Map<string, Promise<unknown>>();

/** One cached GET. A failure is dropped from the cache so a retry can try again. */
function getJson<T>(url: string): Promise<T> {
  let hit = CACHE.get(url) as Promise<T> | undefined;
  if (!hit) {
    hit = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<T>;
      })
      .catch((err) => {
        CACHE.delete(url);
        throw err;
      });
    CACHE.set(url, hit);
  }
  return hit;
}

interface EspnStatRow {
  teamId?: string;
  teamSlug?: string;
  displayName?: string;
  season?: { year?: number; displayName?: string };
  stats?: string[];
}

interface EspnCareer {
  teams?: Record<string, { id?: string; abbreviation?: string }>;
  categories?: Array<{
    name?: string;
    labels?: string[];
    statistics?: EspnStatRow[];
  }>;
}

interface CoreStats {
  splits?: {
    categories?: Array<{ stats?: Array<{ name?: string; value?: number }> }>;
  };
}

/** A core-API stat by its `name`. The first match: some names repeat as per-48 variants. */
function coreStat(d: CoreStats, name: string): number | undefined {
  for (const c of d.splits?.categories ?? []) {
    const s = c.stats?.find((x) => x.name === name);
    if (s && typeof s.value === "number") return s.value;
  }
  return undefined;
}

// ---------------------------------------------------------------- parsing

const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
/** "199-404" -> [199, 404]. */
const madeAtt = (s: string | undefined): [number, number] => {
  const [m, a] = (s ?? "").split("-");
  return [num(m), num(a)];
};

/**
 * The averages, totals and misc categories are three parallel lists — same rows, same
 * order — so row `i` of each describes the same season-and-team. Checked rather than
 * assumed: a length mismatch drops the misc columns instead of misaligning them.
 */
function parseCareer(d: EspnCareer): CareerRow[] {
  const cat = (name: string) => d.categories?.find((c) => c.name === name);
  const avg = cat("averages");
  const tot = cat("totals");
  const misc = cat("miscellaneous");
  if (!avg?.statistics || !tot?.statistics) return [];
  const n = avg.statistics.length;
  if (tot.statistics.length !== n) return [];
  const miscOk = misc?.statistics?.length === n;

  const idx = (labels: string[] | undefined) => {
    const m: Record<string, number> = {};
    (labels ?? []).forEach((l, i) => (m[l] = i));
    return m;
  };
  const ai = idx(avg.labels);
  const ti = idx(tot.labels);
  const mi = idx(misc?.labels);

  const abbr: Record<string, string> = {};
  for (const [slug, t] of Object.entries(d.teams ?? {})) abbr[slug] = t.abbreviation ?? "";

  const rows: CareerRow[] = [];
  for (let i = 0; i < n; i++) {
    const a = avg.statistics[i].stats ?? [];
    const t = tot.statistics[i].stats ?? [];
    const m = miscOk ? (misc!.statistics![i].stats ?? []) : [];
    const head = avg.statistics[i];
    const year = head.season?.year;
    if (!year) continue;

    const gp = num(a[ai.GP]);
    const [fgm, fga] = madeAtt(t[ti.FG]);
    const [tpm, tpa] = madeAtt(t[ti["3PT"]]);
    const [ftm, fta] = madeAtt(t[ti.FT]);
    const line: Line = {
      gp,
      gs: num(a[ai.GS]),
      min: Math.round(num(a[ai.MIN]) * gp),
      fgm,
      fga,
      tpm,
      tpa,
      ftm,
      fta,
      oreb: num(t[ti.OR]),
      dreb: num(t[ti.DR]),
      reb: num(t[ti.REB]),
      ast: num(t[ti.AST]),
      stl: num(t[ti.STL]),
      blk: num(t[ti.BLK]),
      to: num(t[ti.TO]),
      pf: num(t[ti.PF]),
      pts: num(t[ti.PTS]),
      dd: miscOk ? num(m[mi.DD2]) : 0,
      td: miscOk ? num(m[mi.TD3]) : 0,
    };

    // ESPN's combined row for a traded season has no teamId and a "2020-21 Totals" name.
    const combined = !head.teamId;
    rows.push({
      key: `${year}-${head.teamId ?? "tot"}`,
      kind: combined ? "combined" : "season",
      year,
      label: head.season?.displayName ?? String(year),
      team: combined ? "" : abbr[head.teamSlug ?? ""] || "",
      teamId: head.teamId,
      line,
    });
  }

  // A season with a combined row: its team rows are parts, and the combined row is
  // labelled by how many teams it covers (Basketball-Reference's "2TM").
  for (const r of rows) {
    if (r.kind !== "combined") continue;
    const parts = rows.filter((x) => x.year === r.year && x.kind === "season");
    for (const p of parts) p.kind = "part";
    r.team = `${parts.length}TM`;
  }
  return rows;
}

function sumLines(lines: Line[]): Line {
  const out = {} as Line;
  for (const l of lines) {
    for (const k of Object.keys(l) as Array<keyof Line>) out[k] = (out[k] ?? 0) + l[k];
  }
  return out;
}

/** Rows that are one team in one season — the units that sum without double counting. */
const isTeamRow = (r: CareerRow) => r.kind === "season" || r.kind === "part";

/** A minutes-weighted mean of a rate over team rows, or undefined if none has it. */
function minuteWeighted(rows: CareerRow[], pick: (r: CareerRow) => number | undefined) {
  let w = 0;
  let s = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v == null || !r.line.min) continue;
    w += r.line.min;
    s += v * r.line.min;
  }
  return w ? s / w : undefined;
}

function summarise(rows: CareerRow[]): CareerRow[] {
  const teamRows = rows.filter(isTeamRow);
  if (!teamRows.length) return [];
  const yrs = (rs: CareerRow[]) => new Set(rs.map((r) => r.year)).size;
  const tw = (rs: CareerRow[]) =>
    rs.every((r) => r.tw != null)
      ? {
          tw: rs.reduce((s, r) => s + (r.tw ?? 0), 0),
          twGames: rs.reduce((s, r) => s + (r.twGames ?? 0), 0),
        }
      : {};

  // PER is ESPN's per SEASON, so it weights over whole seasons (single-team and
  // combined rows), not team parts — those have no PER of their own.
  const seasonRows = rows.filter((r) => r.kind === "season" || r.kind === "combined");
  const career: CareerRow = {
    key: "career",
    kind: "career",
    label: `${yrs(teamRows)} Yrs`,
    team: "",
    line: sumLines(teamRows.map((r) => r.line)),
    per: minuteWeighted(seasonRows, (r) => r.per),
    usg: minuteWeighted(teamRows, (r) => r.usg),
    astPct: minuteWeighted(teamRows, (r) => r.astPct),
    ...tw(teamRows),
  };

  const byTeam = new Map<string, CareerRow[]>();
  for (const r of teamRows) {
    const list = byTeam.get(r.team) ?? [];
    list.push(r);
    byTeam.set(r.team, list);
  }
  // A one-franchise career's team row would repeat the career row exactly.
  const teams =
    byTeam.size < 2
      ? []
      : [...byTeam.entries()].map(([team, rs]) => {
          const n = yrs(rs);
          return {
            key: `team-${team}`,
            kind: "team" as const,
            label: `${team} (${n} ${n === 1 ? "Yr" : "Yrs"})`,
            team,
            line: sumLines(rs.map((r) => r.line)),
            // Only his whole seasons there: a traded season's PER is not this team's.
            per: minuteWeighted(rs.filter((r) => r.kind === "season"), (r) => r.per),
            usg: minuteWeighted(rs, (r) => r.usg),
            astPct: minuteWeighted(rs, (r) => r.astPct),
            ...tw(rs),
          };
        });
  teams.sort((a, b) => b.line.gp - a.line.gp);
  return [career, ...teams];
}

// ---------------------------------------------------------------- advanced

/**
 * Basketball-Reference's USG% and AST%, against the team's season totals.
 *
 * Team minutes are games x 240: ESPN's team `minutes` is always 0, and overtime adds well
 * under 1% to a season. The team row is the FULL season's even for a traded player's part,
 * which is what Basketball-Reference does too.
 */
function usgAst(l: Line, team: CoreStats) {
  const tgp = coreStat(team, "gamesPlayed");
  const tfga = coreStat(team, "fieldGoalsAttempted");
  const tfta = coreStat(team, "freeThrowsAttempted");
  // `turnovers`, not `totalTurnovers`: the latter is doubled in older seasons.
  const ttov = coreStat(team, "turnovers");
  const tfgm = coreStat(team, "fieldGoalsMade");
  if (!tgp || !tfga || tfta == null || ttov == null || !l.min) return {};
  const tmMp5 = (tgp * 240) / 5;
  const usg = (100 * (l.fga + 0.44 * l.fta + l.to) * tmMp5) / (l.min * (tfga + 0.44 * tfta + ttov));
  const astDen = tfgm ? (l.min / tmMp5) * tfgm - l.fgm : 0;
  return { usg, astPct: astDen > 0 ? (100 * l.ast) / astDen : undefined };
}

/** Wins per team id over the season's regular-season games, and the games counted. */
async function winsBy(playerId: number, year: number) {
  const log = await fetchGameLog(playerId, year);
  const out = new Map<string, { w: number; g: number }>();
  const seen = new Set<string>();
  for (const st of log.seasonTypes ?? []) {
    if (!isRegularSeason(st.displayName ?? "")) continue;
    for (const c of st.categories ?? []) {
      for (const ev of c.events ?? []) {
        if (seen.has(ev.eventId) || isAllStar(log, ev.eventId)) continue;
        seen.add(ev.eventId);
        const m = log.events?.[ev.eventId];
        const id = m?.team?.id ?? "";
        const cur = out.get(id) ?? { w: 0, g: 0 };
        cur.g++;
        if (m?.gameResult === "W") cur.w++;
        out.set(id, cur);
      }
    }
  }
  return out;
}

/** Age on Feb 1 of the season's second calendar year. */
function ageIn(dob: Date, year: number): number {
  const m = dob.getUTCMonth();
  const afterFeb1 = m > 1 || (m === 1 && dob.getUTCDate() > 1);
  return year - dob.getUTCFullYear() - (afterFeb1 ? 1 : 0);
}

// ---------------------------------------------------------------- hook

export type CareerState = "idle" | "loading" | "done" | "error";

/**
 * The career, built in two passes: the counting table as soon as the first request lands,
 * then again as each season's PER / team totals / game log arrive. Each enrichment is
 * independent and failure-tolerant — a season whose game log 404s keeps a dash for TW
 * and nothing else is affected.
 */
export function useCareer(playerId: number | null): { career: Career | null; state: CareerState } {
  const [career, setCareer] = useState<Career | null>(null);
  const [state, setState] = useState<CareerState>(playerId ? "loading" : "idle");

  useEffect(() => {
    if (!playerId) {
      setCareer(null);
      setState("idle");
      return;
    }
    let live = true;
    setCareer(null);
    setState("loading");

    getJson<EspnCareer>(`${SITE}/athletes/${playerId}/stats`)
      .then((d) => {
        if (!live) return;
        const rows = parseCareer(d);
        const publish = () => {
          if (live) setCareer({ rows: [...rows], summary: summarise(rows) });
        };
        publish();
        setState("done");

        const years = [...new Set(rows.map((r) => r.year!))];
        const jobs: Array<Promise<void>> = [];

        jobs.push(
          getJson<{ dateOfBirth?: string }>(`${CORE}/athletes/${playerId}`).then((a) => {
            if (!a.dateOfBirth) return;
            const dob = new Date(a.dateOfBirth);
            for (const r of rows) r.age = ageIn(dob, r.year!);
          })
        );

        for (const y of years) {
          jobs.push(
            getJson<CoreStats>(`${CORE}/seasons/${y}/types/2/athletes/${playerId}/statistics`).then(
              (s) => {
                const per = coreStat(s, "PER");
                // PER belongs to the whole season, so only rows that ARE the whole season.
                for (const r of rows) {
                  if (r.year === y && r.kind !== "part" && per) r.per = per;
                }
              }
            )
          );
          jobs.push(
            winsBy(playerId, y).then((wins) => {
              const yr = rows.filter((r) => r.year === y);
              for (const r of yr.filter(isTeamRow)) {
                const x = wins.get(r.teamId ?? "");
                r.tw = x?.w ?? 0;
                r.twGames = x?.g ?? 0;
              }
              const comb = yr.find((r) => r.kind === "combined");
              if (comb) {
                const parts = yr.filter(isTeamRow);
                comb.tw = parts.reduce((s, r) => s + (r.tw ?? 0), 0);
                comb.twGames = parts.reduce((s, r) => s + (r.twGames ?? 0), 0);
              }
            })
          );
        }

        for (const r of rows.filter(isTeamRow)) {
          jobs.push(
            getJson<CoreStats>(`${CORE}/seasons/${r.year}/types/2/teams/${r.teamId}/statistics`).then(
              (t) => {
                Object.assign(r, usgAst(r.line, t));
              }
            )
          );
        }

        // Re-render as each lands, then derive the combined rows' rates once all are in.
        for (const j of jobs) j.then(publish, () => {});
        Promise.allSettled(jobs).then(() => {
          for (const c of rows.filter((r) => r.kind === "combined")) {
            const parts = rows.filter((r) => r.year === c.year && r.kind === "part");
            c.usg = minuteWeighted(parts, (r) => r.usg);
            c.astPct = minuteWeighted(parts, (r) => r.astPct);
          }
          publish();
        });
      })
      .catch(() => {
        if (live) setState("error");
      });

    return () => {
      live = false;
    };
  }, [playerId]);

  return { career, state };
}
