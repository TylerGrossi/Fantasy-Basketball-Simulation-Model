/**
 * Game Day's NBA half (2026-10-21): tonight's slate, every player's box line and the
 * fantasy-relevant play-by-play, parsed out of ESPN's public NBA endpoints. Pure functions
 * and types only — `app/api/gameday` fetches and calls them, the page reads the result.
 *
 * Modelled on FantasyPros' Game Day: all games and your matchup on one screen, a feed of
 * every play your players are involved in, and the night's leaders tagged by who owns
 * them. The fantasy half (what COUNTS, lineup slots included) comes from the live route;
 * this half is the real games, which is what the fantasy numbers are made of.
 */

/** ESPN's NBA-site abbreviations that differ from the fantasy data's (`nbaTeam`). */
export const SITE_TO_FANTASY: Record<string, string> = {
  NY: "NYK", PHI: "PHL", SA: "SAS", GS: "GSW", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHX: "PHO",
};

export const fantasyAbbr = (site: string) => SITE_TO_FANTASY[site] ?? site;

export interface NbaTeamScore {
  /** Fantasy-data abbreviation (matches `PlayerRow.nbaTeam`). */
  abbr: string;
  score: number;
  /** Won the game. Only ever true once it is final. */
  winner: boolean;
}

export interface NbaGame {
  id: string;
  state: "pre" | "in" | "post";
  /** ESPN's own short status: "7:30 PM EDT", "5:06 - 4th", "Final", "Final/OT". */
  detail: string;
  period: number;
  /** Seconds left in the period. */
  clock: number;
  /** Tip-off, ISO. */
  start: string;
  away: NbaTeamScore;
  home: NbaTeamScore;
  /** Share of the game still to play: 1 before tip-off, 0 once final. */
  left: number;
}

/** One player's line tonight, from the NBA box score. */
export interface NbaLine {
  id: number;
  name: string;
  /** Fantasy-data abbreviation. */
  team: string;
  gameId: string;
  /** On the floor right now (only meaningful while the game is in progress). */
  onCourt: boolean;
  min: number;
  /** PTS, REB, … plus FGM/FGA, FTM/FTA, 3PM/3PA, DD, TW. */
  line: Record<string, number>;
  /** The night's line valued against the season pool on a single-game scale (see
   *  makeGameValuer) — against an average player at the same point in the game while it
   *  is still going. */
  value: number;
}

/** A fantasy-relevant play, with what it did for each tracked player in it. */
export interface Play {
  gameId: string;
  /** Sorts plays within a game. */
  seq: number;
  period: number;
  clock: string;
  /** When it happened, ISO — sorts plays across games. */
  at: string;
  text: string;
  /** Player id -> the stats this play added to him ("PTS", "3PM", "REB", "FGA", …). */
  credit: Record<string, Record<string, number>>;
}

/* --------------------------------------------------------------- scoreboard */

/**
 * Seconds left in the period. ESPN's numeric `clock` first; else `displayClock`, which is
 * "M:SS" for most of a period but SECONDS ONLY ("45.3") in its last minute — read as
 * minutes, that would make every quarter look barely started for its final minute.
 */
export function clockSeconds(st: any): number {
  if (typeof st?.clock === "number" && Number.isFinite(st.clock)) return st.clock;
  const s = String(st?.displayClock ?? "0:00");
  if (s.includes(":")) {
    const [m, sec] = s.split(":").map(Number);
    return (m || 0) * 60 + (sec || 0);
  }
  return Number(s) || 0;
}

/** Share of regulation still to play; overtime counts as all but done. */
export function shareLeft(state: string, period: number, clock: number): number {
  if (state === "post") return 0;
  if (state !== "in") return 1;
  if (period > 4) return 0.02;
  return Math.max(0, Math.min(1, ((4 - period) * 720 + clock) / 2880));
}

/** ESPN's scoreboard (`site.api.espn.com/.../nba/scoreboard`) as a list of games. */
export function parseScoreboard(data: any): { day: string | null; games: NbaGame[] } {
  const games: NbaGame[] = [];
  for (const e of data?.events ?? []) {
    const comp = e?.competitions?.[0];
    const st = comp?.status ?? {};
    const state = (st?.type?.state ?? "pre") as NbaGame["state"];
    const period = Number(st?.period) || 0;
    const clock = clockSeconds(st);
    const side = (homeAway: string): NbaTeamScore => {
      const c = (comp?.competitors ?? []).find((x: any) => x?.homeAway === homeAway) ?? {};
      return {
        abbr: fantasyAbbr(String(c?.team?.abbreviation ?? "")),
        score: Number(c?.score) || 0,
        winner: state === "post" && c?.winner === true,
      };
    };
    games.push({
      id: String(e?.id ?? ""),
      state,
      detail: String(st?.type?.shortDetail ?? ""),
      period,
      clock,
      start: String(e?.date ?? ""),
      away: side("away"),
      home: side("home"),
      left: shareLeft(state, period, clock),
    });
  }
  // ESPN's `day.date` is ITS current day, which stays on last night's slate while a late
  // game is still going after midnight Eastern — the right notion of "tonight".
  return { day: typeof data?.day?.date === "string" ? data.day.date : null, games };
}

/* ---------------------------------------------------------------- box score */

/** `"10-18"` -> `[10, 18]`. ESPN ships made-attempted as one string. */
function pair(s: unknown): [number, number] {
  const m = /^(\d+)-(\d+)$/.exec(String(s ?? "").trim());
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/**
 * Every player who has played in one game, from its summary's box score. Did-not-plays
 * and players yet to check in (no minutes) are left out: tonight's line of a player who
 * has not played is not a line.
 *
 * DD and TW are derived, as ESPN's fantasy side scores them: a double-double is double
 * figures in two of PTS/REB/AST/STL/BLK, and TW (team wins) is the team's chance of
 * winning — 1 or 0 once the game is final, ESPN's live win probability until then.
 */
export function parseBox(
  summary: any,
  game: NbaGame,
  value: (line: Record<string, number>) => Record<string, number>
): NbaLine[] {
  const out: NbaLine[] = [];
  /*
   * PACE-ADJUSTED while the game runs. `value` scores a line against the season pool's
   * PER-GAME averages, so a line half a game old read as a bad night — 15 points at
   * halftime came out negative. Instead each line is compared with an average player at
   * the same point in the game: scale it up to a full game, value it, scale back down by
   * the share played. Every term of the value is linear in the counts (z-scores, and the
   * percentages' made − lg×att), so that is exactly Σ (x − played×mean) / sd — the full
   * game's scale, no extrapolation noise from the 1st quarter. A final game is played = 1,
   * i.e. unchanged.
   *
   * TEAM WINS IS THE EXCEPTION: a win is not banked a quarter at a time, so it is never
   * paced. Its line is the team's CHANCE of winning — ESPN's live win probability, from
   * the summary — scored against the full-game average: up 15 late reads as ~0.95 of a
   * win, a tie at the half ~0.5, and the final makes it exactly 1 or 0.
   */
  const played = 1 - game.left;
  const paced = (line: Record<string, number>) => {
    if (played <= 0) return 0;
    const scale = Math.min(1, played);
    const z = value(Object.fromEntries(Object.entries(line).map(([k, v]) => [k, v / scale])));
    let total = 0;
    for (const [cat, v] of Object.entries(z)) total += cat === "TW" ? 0 : scale * v;
    return total + (value({ TW: line.TW })["TW"] ?? 0);
  };
  const homeWin = homeWinChance(summary, game);
  for (const t of summary?.boxscore?.players ?? []) {
    const team = fantasyAbbr(String(t?.team?.abbreviation ?? ""));
    const winChance = game.home.abbr === team ? homeWin : 1 - homeWin;
    for (const block of t?.statistics ?? []) {
      const labels: string[] = block?.labels ?? [];
      const at = (a: any, l: string) => {
        const i = labels.indexOf(l);
        return i >= 0 ? a?.stats?.[i] : undefined;
      };
      for (const a of block?.athletes ?? []) {
        if (a?.didNotPlay || !Array.isArray(a?.stats) || !a.stats.length) continue;
        const min = Number(at(a, "MIN")) || 0;
        if (min <= 0) continue;
        const [fgm, fga] = pair(at(a, "FG"));
        const [tpm, tpa] = pair(at(a, "3PT"));
        const [ftm, fta] = pair(at(a, "FT"));
        const line: Record<string, number> = {
          PTS: Number(at(a, "PTS")) || 0,
          REB: Number(at(a, "REB")) || 0,
          AST: Number(at(a, "AST")) || 0,
          STL: Number(at(a, "STL")) || 0,
          BLK: Number(at(a, "BLK")) || 0,
          TO: Number(at(a, "TO")) || 0,
          FGM: fgm, FGA: fga, "3PM": tpm, "3PA": tpa, FTM: ftm, FTA: fta,
        };
        const tens = ["PTS", "REB", "AST", "STL", "BLK"].filter((k) => line[k] >= 10).length;
        line.DD = tens >= 2 ? 1 : 0;
        // A chance while the game runs, 1 or 0 once it is final (see `paced`).
        line.TW = winChance;
        out.push({
          id: Number(a?.athlete?.id) || 0,
          name: String(a?.athlete?.displayName ?? ""),
          team,
          gameId: game.id,
          onCourt: game.state === "in" && a?.active === true,
          min,
          line,
          value: paced(line),
        });
      }
    }
  }
  return out;
}

/**
 * The home team's chance of winning, 0..1: the final result once the game is over, else
 * the latest point of ESPN's live win-probability series. With no series (ESPN does not
 * always carry one) the score decides it — ahead is a win, tied is a coin flip — which is
 * crude but only ever a fallback.
 */
function homeWinChance(summary: any, game: NbaGame): number {
  if (game.state === "post") return game.home.winner ? 1 : 0;
  const series: any[] = Array.isArray(summary?.winprobability) ? summary.winprobability : [];
  const last = Number(series[series.length - 1]?.homeWinPercentage);
  if (Number.isFinite(last)) return Math.max(0, Math.min(1, last));
  const d = game.home.score - game.away.score;
  return d > 0 ? 1 : d < 0 ? 0 : 0.5;
}

/* ------------------------------------------------------------- play-by-play */

/**
 * What one play did, per player, read from ESPN's play-by-play.
 *
 * `participants[0]` is the actor of the play's type — the shooter, the rebounder, the
 * player who turned it over — and `participants[1]` the secondary one, named in the text
 * as "(X assists)", "X blocks Y's …" or "(X steals)". Verified against a live game's feed
 * (2026-10-21) rather than assumed. Fouls, substitutions and timeouts credit nothing in
 * this league's categories and are dropped.
 */
export function playCredit(p: any): Record<string, Record<string, number>> | null {
  const ids: string[] = (p?.participants ?? []).map((x: any) => String(x?.athlete?.id ?? ""));
  const [a, b] = ids;
  if (!a) return null;
  const text = String(p?.text ?? "");
  const type = String(p?.type?.text ?? "");
  const credit: Record<string, Record<string, number>> = {};
  const add = (id: string | undefined, k: string, n = 1) => {
    if (!id) return;
    (credit[id] ??= {})[k] = (credit[id][k] ?? 0) + n;
  };

  if (p?.shootingPlay) {
    const made = /\bmakes\b/.test(text);
    if (/^Free Throw/i.test(type) || /free throw/i.test(text)) {
      add(a, "FTA");
      if (made) {
        add(a, "FTM");
        add(a, "PTS", Number(p?.scoreValue) || 1);
      }
    } else {
      const three = Number(p?.pointsAttempted) === 3 || /three point/i.test(text);
      add(a, "FGA");
      if (three) add(a, "3PA");
      if (made) {
        add(a, "FGM");
        if (three) add(a, "3PM");
        add(a, "PTS", Number(p?.scoreValue) || (three ? 3 : 2));
      }
      if (made && /assists\)/.test(text)) add(b, "AST");
      if (!made && /\bblocks\b/.test(text)) add(b, "BLK");
    }
  } else if (/rebound/i.test(type)) {
    add(a, "REB");
  } else if (/turnover/i.test(type) || /turnover/i.test(text)) {
    add(a, "TO");
    if (/steals\)/.test(text)) add(b, "STL");
  } else {
    return null;
  }
  return Object.keys(credit).length ? credit : null;
}

/** Every fantasy-relevant play in one game, credited to whoever was in it. */
export function parsePlays(summary: any, gameId: string): Play[] {
  const out: Play[] = [];
  for (const p of summary?.plays ?? []) {
    const credit = playCredit(p);
    if (!credit) continue;
    out.push({
      gameId,
      seq: Number(p?.sequenceNumber) || 0,
      period: Number(p?.period?.number) || 0,
      clock: String(p?.clock?.displayValue ?? ""),
      at: String(p?.wallclock ?? ""),
      text: String(p?.text ?? ""),
      credit,
    });
  }
  return out;
}

/** "Q3", "OT", "2OT". */
export function periodLabel(n: number): string {
  if (n <= 4) return `Q${n}`;
  return n === 5 ? "OT" : `${n - 4}OT`;
}

/** Share of each team's game tonight still to play, keyed by fantasy abbreviation. */
export function gameLeftByTeam(games: NbaGame[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of games) {
    out[g.away.abbr] = g.left;
    out[g.home.abbr] = g.left;
  }
  return out;
}

/** Response of `/api/gameday`. */
export interface GameDayData {
  /** ESPN's current NBA day (YYYY-MM-DD), or null when it did not say. */
  day: string | null;
  games: NbaGame[];
  /** Every player's line tonight, best night first. */
  lines: NbaLine[];
  /** The slate's newest plays, plus every play of the requested players and game. */
  plays: Play[];
  fetchedAt: string;
}
