import type { EspnGameLog } from "./gamelogTypes";
import type { PoolPlayer } from "./league";
import { makeValuer, type StatLine } from "./percentiles";
import { isAllStar, isRegularSeason } from "./gamelogTypes";

/**
 * The Player Card's live ESPN data, WITHOUT React — so the server can read it too.
 *
 * The card's splits, opponent-defence buckets and game log come from two public ESPN
 * endpoints fetched in the browser, which put them out of reach of the Agent: it runs
 * server-side off `league.json` and simply could not see them. This module is the pure
 * half of that machinery — the fetching and the parsing with no hooks — so a tool can
 * call it directly.
 *
 * WHY NOT PUT THE DATA IN THE EXPORT INSTEAD. That was the other option, and it is worse
 * here: ~290 game logs per build for detail almost nobody asks about, a much larger
 * export for every page to ship past, and numbers that go stale between builds. Fetching
 * one player's log at the moment a question is asked costs one request, stays current,
 * and needs no pipeline change. `fetch_player_history` in build_data.py already
 * establishes that per-player fan-out is affordable; this is the same trade taken one
 * player at a time.
 *
 * THE PARSERS ARE SHARED, NOT COPIED. `parseGameLog` and `parseTeamDefense` are the same
 * functions the card's hooks use, moved here out of their `"use client"` modules — a
 * second implementation would eventually disagree with the page, and an agent that
 * contradicts the screen is worse than one that says nothing.
 */

export interface PlayerGame {
  id: string;
  /** Epoch ms, for sorting and for the rest-day arithmetic. */
  date: number;
  /** Calendar month key, e.g. "2026-01". */
  month: string;
  home: boolean;
  opp: string;
  /** Nights off since his previous appearance. 0 = back-to-back. Null for his first. */
  rest: number | null;
  min: number;
  line: StatLine;
  /** This one game, valued against the season pool — the card's scale throughout. */
  value: number;
}

export interface TeamDefense {
  /** Opponent points per game. Lower is a better defence. */
  allowed: number;
  /** 1 = stingiest defence in the league. */
  rank: number;
}

/** `"10-18"` -> `[10, 18]`. ESPN ships made-attempted as one string. */
function pair(s: string | undefined): [number, number] {
  const m = /^(\d+)-(\d+)$/.exec((s ?? "").trim());
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

const MS_DAY = 86_400_000;

/**
 * One player's regular-season games, valued.
 *
 * Moved verbatim from `lib/playerGames.ts` so both the card and the agent run the same
 * code. No All-Star game, no did-not-plays: the fantasy season is the NBA regular season,
 * and a night he was not on the floor is not a data point about how he played.
 */
export function parseGameLog(
  data: EspnGameLog,
  value: (l: StatLine) => { off: number; def: number }
): PlayerGame[] {
  const index: Record<string, number> = {};
  (data.labels ?? []).forEach((l, i) => (index[l] = i));
  const meta = data.events ?? {};
  const seen = new Set<string>();
  const out: PlayerGame[] = [];

  for (const st of data.seasonTypes ?? []) {
    if (!isRegularSeason(st.displayName ?? "")) continue;
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        if (seen.has(ev.eventId) || isAllStar(data, ev.eventId)) continue;
        seen.add(ev.eventId);
        const s = ev.stats ?? [];
        const at = (label: string) => (index[label] != null ? s[index[label]] : undefined);
        const min = Number(at("MIN") ?? 0);
        if (!Number.isFinite(min) || min <= 0) continue;

        const m = meta[ev.eventId] ?? {};
        const [fgm, fga] = pair(at("FG"));
        const [tpm] = pair(at("3PT"));
        const [ftm, fta] = pair(at("FT"));
        const line: StatLine = {
          PTS: Number(at("PTS") ?? 0),
          REB: Number(at("REB") ?? 0),
          AST: Number(at("AST") ?? 0),
          STL: Number(at("STL") ?? 0),
          BLK: Number(at("BLK") ?? 0),
          TO: Number(at("TO") ?? 0),
          "3PM": tpm,
          FGM: fgm,
          FGA: fga,
          FTM: ftm,
          FTA: fta,
        };
        const d = new Date(m.gameDate ?? 0);
        const { off, def } = value(line);
        out.push({
          id: ev.eventId,
          date: +d,
          month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
          // ESPN writes "@" for a road game and "vs" for a home one.
          home: (m.atVs ?? "") !== "@",
          opp: m.opponent?.abbreviation ?? "",
          rest: null,
          min,
          line,
          value: off + def,
        });
      }
    }
  }

  out.sort((a, b) => a.date - b.date);
  /*
   * Rest is measured between HIS OWN appearances, which needs no schedule lookup and is
   * the right definition anyway: if he played last night and again tonight, that is a
   * back-to-back for him whatever his team did.
   */
  for (let i = 1; i < out.length; i++) {
    out[i].rest = Math.max(0, Math.round((out[i].date - out[i - 1].date) / MS_DAY) - 1);
  }
  return out;
}

interface ByTeam {
  teams?: Array<{
    team?: { abbreviation?: string };
    categories?: Array<{ name?: string; splitId?: string; names?: string[]; values?: number[] }>;
  }>;
  categories?: Array<{ name?: string; names?: string[] }>;
}

/**
 * Points allowed per team, ranked. Moved verbatim from `lib/teamDefense.ts`.
 *
 * `splitId: "900"` is the OPPONENT half of a category — opponent offence is, by
 * definition, this team's defence. Not possession-adjusted, which is why every consumer
 * buckets into thirds rather than quoting a rank.
 */
export function parseTeamDefense(d: ByTeam): Map<string, TeamDefense> {
  const names = new Map<string, string[]>();
  for (const c of d.categories ?? []) {
    if (c.name && c.names) names.set(c.name, c.names);
  }

  const rows: Array<{ abbr: string; allowed: number }> = [];
  for (const t of d.teams ?? []) {
    const abbr = t.team?.abbreviation;
    if (!abbr) continue;
    const cat = (t.categories ?? []).find(
      (c) => c.name === "offensive" && c.splitId === "900"
    );
    const idx = names.get("offensive")?.indexOf("avgPoints") ?? -1;
    const v = idx >= 0 ? cat?.values?.[idx] : undefined;
    if (typeof v === "number" && v > 0) rows.push({ abbr, allowed: v });
  }

  rows.sort((a, b) => a.allowed - b.allowed);
  const out = new Map<string, TeamDefense>();
  rows.forEach((r, i) => out.set(r.abbr, { allowed: r.allowed, rank: i + 1 }));
  return out;
}

export const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** Population standard deviation — this is his whole season, not a sample from it. */
export const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export interface Consistency {
  /** Games measured. */
  n: number;
  avg: number;
  /** His typical night, which a mean flatters when a few blow-ups pull it up. */
  median: number;
  /** Game-to-game standard deviation of value. Small = a floor you can plan around. */
  sd: number;
  /** Share of nights at or above his OWN average. */
  aboveOwn: number;
  /** Share of nights above the pool average, which is 0 by construction. */
  abovePool: number;
}

/**
 * The Consistency panel's four numbers, computed once for both readers.
 *
 * Lifted out of `components/PlayerConsistency.tsx` verbatim so the Agent quotes the exact
 * figures on the card rather than a lookalike. Two players averaging the same value are
 * not the same asset — one who alternates 30-point nights with 4-point nights wins a
 * category some weeks and loses it others — and this is the only place that shows it.
 */
export function consistency(games: PlayerGame[]): Consistency | null {
  if (games.length < 2) return null;
  const vals = games.map((g) => g.value);
  const avg = mean(vals);
  const sorted = [...vals].sort((a, b) => a - b);
  return {
    n: vals.length,
    avg,
    median: sorted[Math.floor(sorted.length / 2)],
    sd: stdev(vals),
    aboveOwn: vals.filter((v) => v >= avg).length / vals.length,
    abovePool: vals.filter((v) => v > 0).length / vals.length,
  };
}

/** `public/data/consistency.json` — every qualified player's spread, keyed by ESPN id. */
export interface ConsistencyPool {
  generatedAt: string;
  season: number;
  /** Games required to qualify; below it a standard deviation is noise. */
  minGames: number;
  players: Record<string, Consistency>;
}

export interface SpreadRank {
  sd: number;
  /** Share of the qualified pool he is STEADIER than, 0-100. */
  steadierThan: number;
  /** Qualified players compared. */
  pool: number;
  /** The same, among players of a similar season value — see below. */
  peerSteadierThan: number;
  peerPool: number;
}

/**
 * Where a player's spread sits in the league, twice.
 *
 * THE TRAP THIS AVOIDS. Spread correlates with quality at r ≈ 0.69 in this pool: a star
 * takes more shots and has more room to swing, so a raw league-wide percentile quietly
 * ranks scrubs as the steadiest players in basketball and calls every good player
 * volatile. True, and useless — nobody wants the advice "roster worse players".
 *
 * So the peer figure compares him only against players of a similar season value, which
 * is the question actually being asked: steady FOR A PLAYER AT HIS LEVEL. Both are
 * returned because they answer different things, and the Agent is told which is which.
 */
export function spreadRank(
  playerId: number,
  seasonValue: number,
  base: ConsistencyPool,
  pool: PoolPlayer[],
  peerCount = 40
): SpreadRank | null {
  const me = base.players[String(playerId)];
  if (!me) return null;

  const all: number[] = [];
  // Season value of each qualified player, so the peer set can be cut by it.
  const byValue: Array<{ sd: number; value: number }> = [];
  for (const p of pool) {
    const r = p.playerId != null ? base.players[String(p.playerId)] : undefined;
    if (!r) continue;
    all.push(r.sd);
    byValue.push({ sd: r.sd, value: p.value });
  }
  if (all.length < 2) return null;

  const share = (xs: number[]) =>
    (xs.filter((s) => s > me.sd).length / xs.length) * 100;

  const peers = byValue
    .sort((a, b) => Math.abs(a.value - seasonValue) - Math.abs(b.value - seasonValue))
    .slice(0, Math.min(peerCount, byValue.length))
    .map((r) => r.sd);

  return {
    sd: me.sd,
    steadierThan: share(all),
    pool: all.length,
    peerSteadierThan: share(peers),
    peerPool: peers.length,
  };
}

/** Mean of a per-game line over a set of games. */
export function averageLine(games: PlayerGame[]): StatLine {
  const keys: Array<keyof StatLine> = [
    "PTS", "REB", "AST", "STL", "BLK", "TO", "3PM", "FGM", "FGA", "FTM", "FTA",
  ];
  const out = {} as StatLine;
  for (const k of keys) {
    out[k] = games.length
      ? games.reduce((a, g) => a + Number(g.line[k] ?? 0), 0) / games.length
      : 0;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Server-side fetching                                                        */
/* -------------------------------------------------------------------------- */

const LOG_URL = (playerId: number) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`;

const DEFENSE_URL = (season: number) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byteam` +
  `?season=${season}&seasontype=2`;

/**
 * Both fetches are best-effort and time-limited.
 *
 * A tool that hangs is worse than one that says it could not find out: the agent route is
 * serverless and the user is waiting on a reply. Ten seconds is far past ESPN's typical
 * ~300ms and still short enough that a stall surfaces as an answer rather than a timeout.
 */
async function getJson<T>(url: string, ms = 10_000): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** One player's valued game list, or null when ESPN is unreachable or has no log. */
export async function fetchPlayerGames(
  playerId: number,
  pool: PoolPlayer[]
): Promise<PlayerGame[] | null> {
  const raw = await getJson<EspnGameLog>(LOG_URL(playerId));
  if (!raw) return null;
  const games = parseGameLog(raw, makeValuer(pool));
  return games.length ? games : null;
}

/** League defensive ranks, or null when unavailable. */
export async function fetchTeamDefense(
  season: number
): Promise<Map<string, TeamDefense> | null> {
  const raw = await getJson<ByTeam>(DEFENSE_URL(season));
  if (!raw) return null;
  const map = parseTeamDefense(raw);
  return map.size ? map : null;
}
