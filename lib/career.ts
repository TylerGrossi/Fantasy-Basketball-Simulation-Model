/**
 * Career history — every player ever rostered, across every league and season.
 *
 * Built by `scripts/build_history.py` into `public/data/career.json`, on demand rather
 * than on the hourly schedule: finished seasons never change, and the sweep costs ~170
 * requests per season.
 *
 * SPANS LEAGUES, NOT JUST SEASONS. This manager has played in five different ESPN league
 * ids since 2017-18 and under three different team names. Seasons are matched by the SWID
 * cookie, so the history follows the PERSON rather than any league or team id — see the
 * script's header.
 */

export interface CareerPlayerSeason {
  playerId: number;
  name: string;
  /** Days this player spent on the roster that season — 1 for a single-day streamer. */
  days: number;
  /**
   * Per-game line over the days THIS TEAM held them — not the player's season.
   *
   * `build_history.py` accumulates it from each day's box line during the roster sweep, so
   * `gp` is games actually played while rostered. A streamer held for one day who did not
   * play has `gp: 0` and no line, which is the truth about what you got from them.
   */
  gp?: number;
  min?: number;
  PTS?: number; REB?: number; AST?: number; STL?: number; BLK?: number; TO?: number;
  FGM?: number; FGA?: number; FTM?: number; FTA?: number;
  "3PM"?: number; "3PA"?: number;
}

export interface CareerSeason {
  season: number;
  leagueId: number;
  leagueName: string;
  teamId: number;
  teamName: string;
  /** [wins, losses, ties] in categories. */
  record: number[];
  finalStanding: number;
  standing: number;
  /** ESPN's own `scoringType` — "H2H_CATEGORY" or "H2H_POINTS". */
  scoringType?: string;
  weeksCovered: number;
  daysCovered: number;
  players: CareerPlayerSeason[];
  /** Every matchup you played that season. Absent on exports built before this existed. */
  matchups?: CareerMatchup[];
  /** Every team in that league that season, for the manager leaderboard. */
  standings?: CareerStanding[];
}

export interface CareerLog {
  generatedAt: string;
  seasons: CareerSeason[];
}

/** One player, summed over every season they were ever on the roster. */
export interface CareerPlayer {
  playerId: number;
  name: string;
  /** Seasons rostered, newest first — e.g. [2026, 2024, 2021]. */
  seasons: number[];
  /** Total days across all of them. */
  days: number;
  /** Games played FOR YOU — counted from the days they were on the roster. */
  gp: number;
  /** Per-game averages, WEIGHTED BY GAMES — see the note in `careerPlayers`. */
  PTS: number; REB: number; AST: number; STL: number; BLK: number; TO: number;
  "3PM": number;
  fgPct: number; ftPct: number;
  /** Attempts per game — the volume behind the percentages, needed to weight them. */
  fga: number; fta: number;
  /** True when at least one season had no stat line to average. */
  partial: boolean;
}

const PER_GAME = ["PTS", "REB", "AST", "STL", "BLK", "TO", "3PM"] as const;

/**
 * Collapse the per-season rows into one row per player.
 *
 * Averages are weighted by GAMES PLAYED, not by seasons. A player who gave you 70 games
 * one year and 4 the next is overwhelmingly the first season, and averaging the two
 * seasons evenly would let a 4-game cameo drag a career line as hard as a full year.
 * Shooting percentages are rebuilt from summed makes and attempts for the same reason —
 * averaging two percentages is wrong whenever the attempt counts differ, which is always.
 */
export function careerPlayers(log: CareerLog): CareerPlayer[] {
  const by = new Map<number, CareerPlayer & { _fgm: number; _fga: number; _ftm: number; _fta: number }>();

  for (const season of log.seasons) {
    for (const row of season.players) {
      const key = row.playerId;
      let p = by.get(key);
      if (!p) {
        p = {
          playerId: key, name: row.name, seasons: [], days: 0, gp: 0,
          PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0, TO: 0, "3PM": 0,
          fgPct: 0, ftPct: 0, fga: 0, fta: 0, partial: false,
          _fgm: 0, _fga: 0, _ftm: 0, _fta: 0,
        };
        by.set(key, p);
      }
      if (!p.seasons.includes(season.season)) p.seasons.push(season.season);
      p.days += row.days || 0;

      const gp = row.gp ?? 0;
      if (!gp) {
        p.partial = true;
        continue;
      }
      p.gp += gp;
      for (const s of PER_GAME) p[s] += (row[s] ?? 0) * gp;
      p._fgm += (row.FGM ?? 0) * gp;
      p._fga += (row.FGA ?? 0) * gp;
      p._ftm += (row.FTM ?? 0) * gp;
      p._fta += (row.FTA ?? 0) * gp;
    }
  }

  const out: CareerPlayer[] = [];
  for (const p of by.values()) {
    const g = p.gp || 1;
    for (const s of PER_GAME) p[s] = p[s] / g;
    p.fgPct = p._fga > 0 ? p._fgm / p._fga : 0;
    p.ftPct = p._fta > 0 ? p._ftm / p._fta : 0;
    p.fga = p._fga / g;
    p.fta = p._fta / g;
    p.seasons.sort((a, b) => b - a);
    const { _fgm, _fga, _ftm, _fta, ...rest } = p;
    void _fgm; void _fga; void _ftm; void _fta;
    out.push(rest);
  }
  // Days rostered leads, because this is a history of WHO YOU KEPT — the player you held
  // all year is the story, not whoever happened to average the most points.
  out.sort((a, b) => b.days - a.days || b.gp - a.gp);
  return out;
}

/** Career totals across every season, for the summary strip. */
export function careerTotals(log: CareerLog) {
  let w = 0;
  let l = 0;
  let t = 0;
  let titles = 0;
  for (const s of log.seasons) {
    w += s.record[0] ?? 0;
    l += s.record[1] ?? 0;
    t += s.record[2] ?? 0;
    if (s.finalStanding === 1) titles++;
  }
  const decided = w + l;
  return {
    seasons: s_len(log),
    record: [w, l, t] as const,
    winPct: decided > 0 ? w / decided : 0,
    titles,
    distinctPlayers: new Set(
      log.seasons.flatMap((s) => s.players.map((p) => p.playerId))
    ).size,
  };
}

function s_len(log: CareerLog) {
  return log.seasons.length;
}

/* -------------------------------------------------------------------------- */
/* Head-to-head, managers, and the game log                                    */
/* -------------------------------------------------------------------------- */

export interface CareerMatchup {
  week: number;
  playoff: boolean;
  oppTeamId: number;
  oppTeam: string;
  oppOwner: string;
  /**
   * How this league scored, which decides what `scoreFor` MEANS: categories won (0-15ish)
   * or fantasy points (hundreds). Never average across the two — see `headToHead`.
   */
  scoring: "categories" | "points";
  scoreFor: number;
  scoreAgainst: number;
  tied: number;
  /**
   * A playoff bye — no opponent, no result, NOT a game.
   *
   * ESPN files one as an ordinary schedule entry with a null opponent, 0-0, and
   * `winner: UNDECIDED`, which reads literally as a tie against a manager named "?".
   * Two of these seasons had one, and they sat on the head-to-head table as a phantom
   * rival until this flag existed. Byes are excluded from every record and average and
   * appear only in the game log.
   */
  bye?: boolean;
  result: "W" | "L" | "T" | "BYE";
}

export interface CareerStanding {
  teamId: number;
  teamName: string;
  owner: string;
  record: number[];
  finalStanding: number;
  standing: number;
}

/** One opponent, every time you have played them. */
export interface HeadToHead {
  owner: string;
  /** The team names they used, newest first — people rename constantly. */
  teams: string[];
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  playoffW: number;
  playoffL: number;
  /** Average categories won by each side across every meeting. */
  avgFor: number;
  avgAgainst: number;
  /** Best single week against them, in categories won. */
  best: number;
  /** Total category differential — the size of the edge, not just its direction. */
  diff: number;
  /** Closest meeting, as an absolute category margin. */
  closest: number;
  meetings: number;
  /**
   * Meetings played under CATEGORY scoring.
   *
   * NOT the same as `meetings`, and the gap matters. One of these leagues (2017-18) was a
   * POINTS league, where a weekly score is ~1,600 rather than ~8. Averaging the two
   * together would produce a number that describes neither — so the RECORD counts every
   * meeting and the category columns count only category meetings. A rival met solely in
   * the points league shows "—" there, with their record intact.
   */
  scored: number;
}

/**
 * Every opponent you have ever faced, keyed by PERSON.
 *
 * Grouped by owner rather than team name on purpose: managers rename their team most
 * years, and grouping by name would split one rival into five rows of one game each,
 * which is the opposite of a head-to-head record.
 */
export function headToHead(log: CareerLog): HeadToHead[] {
  const by = new Map<string, HeadToHead & { _teams: Set<string> }>();
  for (const s of log.seasons) {
    for (const m of s.matchups ?? []) {
      if (m.bye || m.oppTeamId == null) continue; // a bye is not an opponent
      let h = by.get(m.oppOwner);
      if (!h) {
        h = {
          owner: m.oppOwner, teams: [], wins: 0, losses: 0, ties: 0, winPct: 0,
          playoffW: 0, playoffL: 0, avgFor: 0, avgAgainst: 0, best: 0, diff: 0,
          closest: Number.POSITIVE_INFINITY, meetings: 0, scored: 0, _teams: new Set(),
        };
        by.set(m.oppOwner, h);
      }
      h._teams.add(m.oppTeam);
      h.meetings++;
      if (m.result === "W") h.wins++;
      else if (m.result === "L") h.losses++;
      else h.ties++;
      if (m.playoff) {
        if (m.result === "W") h.playoffW++;
        else if (m.result === "L") h.playoffL++;
      }
      // Category columns only count CATEGORY meetings — see `scored`.
      if (m.scoring === "categories") {
        h.scored++;
        h.avgFor += m.scoreFor;
        h.avgAgainst += m.scoreAgainst;
        h.best = Math.max(h.best, m.scoreFor);
        h.diff += m.scoreFor - m.scoreAgainst;
        h.closest = Math.min(h.closest, Math.abs(m.scoreFor - m.scoreAgainst));
      }
    }
  }
  const out: HeadToHead[] = [];
  for (const h of by.values()) {
    const n = h.scored || 1;
    h.avgFor /= n;
    h.avgAgainst /= n;
    const decided = h.wins + h.losses;
    h.winPct = decided > 0 ? h.wins / decided : 0;
    if (!Number.isFinite(h.closest)) h.closest = 0;
    const { _teams, ...rest } = h;
    out.push({ ...rest, teams: [..._teams] });
  }
  // Most-played first: a 16-game rivalry says more than a single meeting at 100%.
  out.sort((a, b) => b.meetings - a.meetings || b.winPct - a.winPct);
  return out;
}

/** One manager, across every season of theirs you have shared a league with. */
export interface ManagerRow {
  owner: string;
  seasons: number;
  avgFinish: number;
  bestFinish: number;
  worstFinish: number;
  titles: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  isYou: boolean;
}

/**
 * The league-mate leaderboard, across every league and season in the log.
 *
 * SPANS LEAGUES, which is unusual and worth stating on the page: these are not all rivals
 * from one continuous league, they are everyone you have shared any league with since
 * 2017-18. A manager with two seasons was in one of your leagues for two years, not
 * necessarily the same league as the manager above them.
 *
 * Finish is `finalStanding` — where the bracket actually left them — and seasons where
 * ESPN records no final standing are skipped for the average rather than counted as zero.
 */
export function managerTable(log: CareerLog, meName?: string): ManagerRow[] {
  const by = new Map<string, ManagerRow & { _finishes: number[] }>();
  for (const s of log.seasons) {
    for (const t of s.standings ?? []) {
      let m = by.get(t.owner);
      if (!m) {
        m = {
          owner: t.owner, seasons: 0, avgFinish: 0, bestFinish: 0, worstFinish: 0,
          titles: 0, wins: 0, losses: 0, ties: 0, winPct: 0,
          isYou: false, _finishes: [],
        };
        by.set(t.owner, m);
      }
      m.seasons++;
      m.wins += t.record[0] ?? 0;
      m.losses += t.record[1] ?? 0;
      m.ties += t.record[2] ?? 0;
      const fin = t.finalStanding || t.standing || 0;
      if (fin > 0) m._finishes.push(fin);
      if (fin === 1) m.titles++;
    }
  }
  const out: ManagerRow[] = [];
  for (const m of by.values()) {
    const f = m._finishes;
    m.avgFinish = f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
    m.bestFinish = f.length ? Math.min(...f) : 0;
    m.worstFinish = f.length ? Math.max(...f) : 0;
    const decided = m.wins + m.losses;
    m.winPct = decided > 0 ? m.wins / decided : 0;
    m.isYou = !!meName && m.owner === meName;
    const { _finishes, ...rest } = m;
    void _finishes;
    out.push(rest);
  }
  /*
   * Titles first, then win %.
   *
   * Deliberately NOT average finish, which was the first cut and read wrong: it rewards
   * being reliably 4th over winning it twice and missing the playoffs twice, and a
   * league is played to win. Win % breaks the (very common) tie at zero titles, and
   * average finish only settles what is left. The sort is also the tie-break order the
   * table inherits — SortableTable's sort is stable, so sorting its Titles column keeps
   * these rows in win-% order underneath.
   */
  out.sort(
    (a, b) =>
      b.titles - a.titles ||
      b.winPct - a.winPct ||
      (a.avgFinish || 99) - (b.avgFinish || 99)
  );
  return out;
}

/** Every matchup ever played, newest first — the raw log behind the tables above. */
export function gameLog(log: CareerLog) {
  const rows = [];
  for (const s of log.seasons) {
    for (const m of s.matchups ?? []) {
      rows.push({ ...m, season: s.season, teamName: s.teamName });
    }
  }
  rows.sort((a, b) => b.season - a.season || (b.week ?? 0) - (a.week ?? 0));
  return rows;
}

/** Your own owner name, taken from the standings row that matches your team. */
export function myOwnerName(log: CareerLog): string | undefined {
  for (const s of log.seasons) {
    const mine = (s.standings ?? []).find((t) => t.teamId === s.teamId);
    if (mine) return mine.owner;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* The franchise Hall of Fame                                                  */
/* -------------------------------------------------------------------------- */

/** A career player plus their standing in this franchise's own history. */
export interface HallOfFamer extends CareerPlayer {
  /** Championships won by THIS team while the player was on the roster. */
  titles: number;
  /** Nine-cat production per game, as a z-score sum against everyone ever rostered. */
  z: number;
  /** Roster seasons — days held divided by the length of a season. */
  tenure: number;
  /** Full seasons of ACTUAL GAMES received, after availability and days held. */
  volume: number;
  /** The franchise rating. See `hallOfFame` for what goes into it. */
  rating: number;
  hof: boolean;
  jersey: boolean;
}

/** Days in a fantasy regular season + playoffs — the sweep covers ~167 per season. */
const SEASON_DAYS = 165;
/** NBA games in a season — the unit `volume` is expressed in. */
const GAMES_PER_SEASON = 82;
/** Below this many career games a rating is noise, so the player is listed but unrated. */
const RATE_MIN_GP = 15;
/** Games needed to help SET the baseline — a 3-game cameo must not widen the spread. */
const BASELINE_MIN_GP = 40;
/** Roughly replacement level in z-sum terms; shifts the scale so 0 means "waiver fodder". */
const REPLACEMENT_Z = -3;
/** What a championship is worth, in rating points. */
const TITLE_BONUS = 2;
/**
 * Share of a title season a player must have been rostered for the ring to count.
 *
 * Without this, a streamer picked up for ONE DAY of a championship season collected the
 * full bonus and sat above every unrated player on nothing but that — six of them tied at
 * exactly 2.00 with zero games. A ring you were on the roster for on a Tuesday in January
 * is not a ring you won.
 */
const TITLE_MIN_SHARE = 0.25;

/*
 * Both thresholds are read off the actual distribution rather than guessed — an honour
 * that most of the leaderboard clears is not an honour. They put 7 of the 196 players
 * ever rostered in the Hall and 3 in the rafters.
 *
 * RE-READ THEM WHENEVER THE FORMULA OR THE DATA CHANGES. They are absolute cutoffs on a
 * scale the inputs set, so they survive neither. Switching the stat line from full-season
 * to while-rostered shrank every rating by roughly a third and, left alone, would have cut
 * the Hall from seven players to one.
 *
 * Both sit on a natural break rather than a round number: 7th (10.2) to 8th (9.1) for the
 * Hall, and 4th (13.5) to 5th (11.8) for the rafters. Placing a cutoff between players
 * separated by 0.1 would make the honour an accident of rounding.
 */
const HOF_RATING = 10;
const JERSEY_RATING = 13;
/** A jersey needs more than one great year — no rentals in the rafters. */
const JERSEY_MIN_SEASONS = 2;

/**
 * Rank every player ever rostered by what they were worth TO THIS TEAM.
 *
 * The rating answers "who mattered here", which is not the same question as "who was the
 * best player". It multiplies quality by tenure, so a superstar rented for nine days
 * cannot outrank a very good player held for three years — the same reason `careerPlayers`
 * sorts on days. Three parts:
 *
 *   1. **Quality** — nine-cat production per game as a z-score sum against every other
 *      player this manager has ever rostered. Not against the NBA: the comparison that
 *      means something on a page about one team's history is against the rest of that
 *      team's history. Turnovers count negatively; the two percentages are weighted by
 *      attempts, because 90% on two free throws a game is not 90% on nine.
 *   2. **Tenure** — days held, in units of a season.
 *   3. **Titles** — championships won while they were on the roster.
 *
 * `rating = max(0, z - replacement) * tenure * 2 + titles * TITLE_BONUS`
 *
 * Quality is floored at replacement level rather than allowed to go negative, so a long
 * tenure can never push someone BELOW an unrostered player — holding a bad player for a
 * year is a mistake, not an anti-achievement, and a big negative would bury genuinely
 * useful players under one-week streamers sitting at zero.
 *
 * The thresholds are franchise lore, not statistics, and are constants above so they can
 * be argued with. Nothing here is predictive — it is a museum, and every input is final.
 */
export function hallOfFame(log: CareerLog): HallOfFamer[] {
  const players = careerPlayers(log);

  /*
   * Rings, per player — counted here rather than from the player's season list, because
   * being ON the roster in a title season is not the same as having been there for it.
   * A season only counts once the player was held for TITLE_MIN_SHARE of it.
   */
  const rings = new Map<number, number>();
  for (const s of log.seasons) {
    if (s.finalStanding !== 1) continue;
    const span = s.daysCovered || SEASON_DAYS;
    for (const row of s.players) {
      if ((row.days || 0) / span < TITLE_MIN_SHARE) continue;
      rings.set(row.playerId, (rings.get(row.playerId) ?? 0) + 1);
    }
  }

  // The baseline is built from players with a real sample. Cameos are RATED but do not
  // get a vote on what average looks like.
  const base = players.filter((p) => p.gp >= BASELINE_MIN_GP);
  if (!base.length) {
    return players.map((p) => ({
      ...p, titles: 0, z: 0, tenure: p.days / SEASON_DAYS, volume: 0,
      rating: 0, hof: false, jersey: false,
    }));
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = (xs: number[], m: number) => {
    const v = mean(xs.map((x) => (x - m) ** 2));
    return v > 0 ? Math.sqrt(v) : 1; // a zero spread would divide every z by nothing
  };

  const counting = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO"] as const;
  const stats: Record<string, { m: number; s: number }> = {};
  for (const k of counting) {
    const xs = base.map((p) => p[k]);
    const m = mean(xs);
    stats[k] = { m, s: sd(xs, m) };
  }

  // Percentages become IMPACT — (rate - league rate) x attempts — before being z-scored,
  // which is the standard nine-cat treatment and the only way volume gets its say.
  const fgLeague = mean(base.map((p) => p.fgPct));
  const ftLeague = mean(base.map((p) => p.ftPct));
  const fgImpact = (p: CareerPlayer) => (p.fgPct - fgLeague) * p.fga;
  const ftImpact = (p: CareerPlayer) => (p.ftPct - ftLeague) * p.fta;
  for (const [k, f] of [["FG", fgImpact], ["FT", ftImpact]] as const) {
    const xs = base.map(f);
    const m = mean(xs);
    stats[k] = { m, s: sd(xs, m) };
  }

  const out = players.map((p) => {
    const titles = rings.get(p.playerId) ?? 0;
    const tenure = p.days / SEASON_DAYS;
    const volume = p.gp / GAMES_PER_SEASON;

    let z = 0;
    if (p.gp >= RATE_MIN_GP) {
      for (const k of counting) {
        const sign = k === "TO" ? -1 : 1; // turnovers are the one cat where less is more
        z += (sign * (p[k] - stats[k].m)) / stats[k].s;
      }
      z += (fgImpact(p) - stats.FG.m) / stats.FG.s;
      z += (ftImpact(p) - stats.FT.m) / stats.FT.s;
    }

    const quality = Math.max(0, z - REPLACEMENT_Z);
    const rating = p.gp >= RATE_MIN_GP ? quality * volume + titles * TITLE_BONUS : 0;

    return {
      ...p,
      titles,
      z,
      tenure,
      volume,
      rating,
      hof: rating >= HOF_RATING,
      jersey: rating >= JERSEY_RATING && p.seasons.length >= JERSEY_MIN_SEASONS,
    };
  });

  out.sort((a, b) => b.rating - a.rating || b.days - a.days);
  return out;
}
