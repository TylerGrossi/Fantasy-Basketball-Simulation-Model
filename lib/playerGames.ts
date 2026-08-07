"use client";

import { useMemo } from "react";
import type { PoolPlayer } from "./league";
import { isAllStar, isRegularSeason, useGameLog, type EspnGameLog } from "./gamelog";
import { makeValuer, type StatLine } from "./percentiles";

/**
 * One player's season as a list of GAMES, each scored on the card's own value scale.
 *
 * Everything below the percentile bars that asks "when", "where" or "how consistently"
 * reduces to grouping this list: monthly splits, home/away, rest, the best and worst
 * nights, the spread. Parsing it once here keeps those modules honest with each other —
 * and with the rolling chart, which reads the same shared log.
 *
 * REGULAR SEASON ONLY, no All-Star game, no did-not-plays. Same rules as everywhere else
 * on the card: the fantasy season is the NBA regular season, and a night the player was
 * not on the floor is not a data point about how he played.
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

/** `"10-18"` -> `[10, 18]`. ESPN ships made-attempted as one string. */
function pair(s: string | undefined): [number, number] {
  const m = /^(\d+)-(\d+)$/.exec((s ?? "").trim());
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

const MS_DAY = 86_400_000;

function parse(data: EspnGameLog, value: (l: StatLine) => { off: number; def: number }) {
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
   * back-to-back for him whatever his team did. A long gap is an absence rather than rest,
   * so anything past a week is capped into the "3+" bucket by the consumer.
   */
  for (let i = 1; i < out.length; i++) {
    out[i].rest = Math.max(0, Math.round((out[i].date - out[i - 1].date) / MS_DAY) - 1);
  }
  return out;
}

/** The player's games, valued. Empty until the shared log resolves. */
export function usePlayerGames(
  playerId: number | null,
  pool: PoolPlayer[]
): { games: PlayerGame[]; loading: boolean } {
  const { log, state } = useGameLog(playerId);
  const value = useMemo(() => makeValuer(pool), [pool]);
  const games = useMemo(() => (log ? parse(log, value) : []), [log, value]);
  return { games, loading: state === "loading" };
}

/** Mean of a per-game line over a set of games — the input a split's value is scored on. */
export function averageLine(games: PlayerGame[]): StatLine {
  const keys = ["PTS", "REB", "AST", "STL", "BLK", "TO", "3PM", "FGM", "FGA", "FTM", "FTA"];
  const avg: StatLine = {};
  if (!games.length) return avg;
  for (const k of keys) {
    avg[k] = games.reduce((a, g) => a + Number(g.line[k] ?? 0), 0) / games.length;
  }
  return avg;
}

export const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** Population standard deviation — this is his whole season, not a sample from it. */
export const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
