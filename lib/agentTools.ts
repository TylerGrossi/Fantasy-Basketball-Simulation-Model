/**
 * The Agent's LEAGUE DATA tools — a port of the tool functions in the Streamlit app
 * (`lookup_player`, `list_players`, `compare_players`, `team_category_ranks`,
 * `team_roster`, `list_teams`, `power_rankings`).
 *
 * The design intent carries over exactly: **the model never does the basketball maths.**
 * It picks a tool, this code returns the real numbers out of the export, and the model
 * narrates a recommendation grounded in them. That is the whole reason the answers can be
 * trusted — an LLM asked to recall a z-score will happily invent one.
 *
 * Two differences from the Python, both because of where this runs:
 *  - the numbers come from `public/data/league.json`, not a live ESPN call, so a tool is
 *    a dictionary lookup rather than a network round trip;
 *  - every tool returns a plain string, which is what gets fed back to the model. Compact
 *    prose beats JSON here: it costs fewer tokens and the model quotes it more faithfully.
 */

import type { LeagueData, PoolPlayer, StandingRow } from "./league";

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const pct = (v: number | undefined): string => {
  if (v == null || Number.isNaN(v)) return "-";
  const n = v <= 1 ? v * 100 : v;
  return `${n.toFixed(1)}%`;
};

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

const ownerLabel = (owner: string) => (owner === "FA" ? "Free Agent" : owner);

/** One-line per-game summary — the `_player_line` format the Python assistant used. */
function playerLine(p: PoolPlayer): string {
  return (
    `${p.name} (${p.nbaTeam || "?"}, ${p.position || "?"}) - ` +
    `owner: ${ownerLabel(p.owner)}; ` +
    `value ${signed(p.value)}, 15-day trend ${signed(p.trend15)}, ` +
    `30-day trend ${signed(p.trend)}; ` +
    `${p.PTS.toFixed(1)} PTS, ${p.REB.toFixed(1)} REB, ${p.AST.toFixed(1)} AST, ` +
    `${p.STL.toFixed(1)} STL, ${p.BLK.toFixed(1)} BLK, ${p["3PM"].toFixed(1)} 3PM, ` +
    `${p.TO.toFixed(1)} TO, ${p.DD.toFixed(1)} DD/g; ` +
    `FG ${pct(p.fgPct)}, FT ${pct(p.ftPct)}, 3P ${pct(p.tpPct)}; ` +
    `status: ${p.status || "active"}`
  );
}

/** Exact (case-insensitive) → substring → last name. Ties break on value. */
function fuzzyPlayer(pool: PoolPlayer[], name: string): PoolPlayer | null {
  const n = (name || "").trim().toLowerCase();
  if (!n || !pool.length) return null;
  const exact = pool.filter((p) => p.name.toLowerCase() === n);
  if (exact.length) return exact[0];
  const byValue = (a: PoolPlayer, b: PoolPlayer) => b.value - a.value;
  const contains = pool.filter((p) => p.name.toLowerCase().includes(n));
  if (contains.length) return [...contains].sort(byValue)[0];
  const last = pool.filter((p) => p.name.toLowerCase().split(/\s+/).pop() === n);
  if (last.length) return [...last].sort(byValue)[0];
  return null;
}

/**
 * Match a fantasy team name loosely: exact, then substring either way (so "hustle" finds
 * "Hustle and Hart"), then word overlap ("hustle or hart"). People do not type league
 * team names accurately, and a miss here reads to the user as the bot not knowing its
 * own league.
 */
function matchTeam(teams: string[], name: string): string | null {
  const n = (name || "").trim().toLowerCase();
  if (!n || !teams.length) return null;
  const exact = teams.find((t) => t.toLowerCase() === n);
  if (exact) return exact;
  const subs = teams.filter((t) => t.toLowerCase().includes(n) || n.includes(t.toLowerCase()));
  if (subs.length) return subs.reduce((a, b) => (b.length > a.length ? b : a));
  const stop = new Set(["and", "or", "the", "of", "&", "a"]);
  const words = new Set(n.replace(/&/g, " ").split(/\s+/).filter((w) => w && !stop.has(w)));
  let best: string | null = null;
  let bestScore = 0;
  for (const t of teams) {
    const tw = new Set(
      t.toLowerCase().replace(/&/g, " ").split(/\s+/).filter((w) => w && !stop.has(w))
    );
    const score = [...words].filter((w) => tw.has(w)).length;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** A season-total category value, deriving the percentages from makes/attempts. */
function seasonTotal(totals: Record<string, number>, stat: string): number {
  const ratio: Record<string, [string, string]> = {
    "FG%": ["FGM", "FGA"],
    "FT%": ["FTM", "FTA"],
    "3P%": ["3PM", "3PA"],
  };
  const pair = ratio[stat];
  if (pair) {
    const [made, att] = pair;
    return totals[att] ? (totals[made] ?? 0) / totals[att] : 0;
  }
  return totals[stat] ?? 0;
}

/** 1-based league rank for a category. TO is inverted — fewer turnovers ranks better. */
function leagueRank(rows: StandingRow[], teamId: number, stat: string): number | null {
  const me = rows.find((r) => r.teamId === teamId);
  if (!me) return null;
  const mine = seasonTotal(me.catTotals, stat);
  let better = 0;
  for (const r of rows) {
    const v = seasonTotal(r.catTotals, stat);
    if (stat === "TO" ? v < mine : v > mine) better += 1;
  }
  return better + 1;
}

/** Which pool column a `sort_by` argument means. */
const SORT_COLUMNS: Record<string, keyof PoolPlayer> = {
  value: "value",
  trend_15day: "trend15",
  trend_30day: "trend",
  points: "PTS",
  rebounds: "REB",
  assists: "AST",
  steals: "STL",
  blocks: "BLK",
  threes: "3PM",
  fg_pct: "fgPct",
  ft_pct: "ftPct",
};

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: "lookup_player",
    description:
      "Look up one NBA player's full fantasy profile: 9-category value, 15-day and 30-day trend, per-game stats (points, rebounds, assists, steals, blocks, threes, turnovers, double-doubles, shooting %), NBA team, position, fantasy owner, and injury status.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: 'The player\'s name, full or partial (e.g. "Jokic" or "Nikola Jokic").',
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_players",
    description:
      'List the top players in the league, ranked. Use this for "best available free agents", "who is trending up", "my best players", or leaders in a category.',
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "free_agents", "my_team"],
          description:
            'Which players to include: "all", "free_agents" (unowned/waiver pickups), or "my_team" (the user\'s roster).',
        },
        sort_by: {
          type: "string",
          enum: Object.keys(SORT_COLUMNS),
          description: 'How to rank. "value" is the overall 9-cat value.',
        },
        limit: { type: "integer", description: "How many players to return (1-25)." },
      },
    },
  },
  {
    name: "compare_players",
    description:
      "Compare two players head-to-head across value, trends, and per-game categories.",
    parameters: {
      type: "object",
      properties: {
        name_a: { type: "string", description: "First player's name." },
        name_b: { type: "string", description: "Second player's name." },
      },
      required: ["name_a", "name_b"],
    },
  },
  {
    name: "team_category_ranks",
    description:
      'Rank a fantasy team against the rest of the league in each scoring category (season totals). Use this for "my weakest/strongest categories" or scouting an opponent. Returns a 1-based rank per category (1 = best in the league; for turnovers, fewer ranks better).',
    parameters: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "The fantasy team name. Leave blank to use the user's own team.",
        },
      },
    },
  },
  {
    name: "team_roster",
    description:
      "List a fantasy team's roster with each player's value and 15-day trend, best first.",
    parameters: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "The fantasy team name. Leave blank for the user's own team.",
        },
      },
    },
  },
  {
    name: "list_teams",
    description: "List every fantasy team in the league (their names).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "power_rankings",
    description:
      'League power rankings: each team\'s rank, cumulative all-play win %, record, recent form (Hot/Cold/Steady), and strength of schedule. Use for "who is the best team", standings, or scouting the league.',
    parameters: { type: "object", properties: {} },
  },
  {
    name: "web_search",
    description:
      "Search the live web (Google) for real-world basketball information the league data can't answer: current NBA news, injuries, trades, the offseason, standings, awards, schedules, or general basketball facts. Use this whenever the question is about the real NBA rather than this fantasy league's own player pool.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'A focused web search query (e.g. "LeBron James injury status today").',
        },
      },
      required: ["query"],
    },
  },
];

export type ToolArgs = Record<string, unknown>;

/**
 * Bind the tools to one league snapshot and one "my team".
 *
 * `webSearch` is injected rather than implemented here: it is the only tool that needs
 * the model provider (Google Search grounding runs as its own call), and keeping it out
 * of this module leaves everything here pure and testable against the export alone.
 */
export function createToolRunner(
  league: LeagueData,
  myTeamName: string,
  webSearch: (query: string) => Promise<string>
) {
  const pool = league.seasonData.playerPool ?? [];
  const standings = league.seasonData.standings ?? [];
  const teamNames = [...new Set(pool.map((p) => p.owner))].filter((t) => t && t !== "FA");

  return async function run(name: string, args: ToolArgs): Promise<string> {
    const str = (k: string) => String(args[k] ?? "").trim();

    switch (name) {
      case "lookup_player": {
        const p = fuzzyPlayer(pool, str("name"));
        return p
          ? playerLine(p)
          : `No player matching "${str("name")}" was found in this league's player pool.`;
      }

      case "list_players": {
        if (!pool.length) return "Player data is unavailable right now.";
        const scope = (str("scope") || "all").toLowerCase();
        let sub = pool;
        if (scope === "free_agents") sub = pool.filter((p) => p.owner === "FA");
        else if (scope === "my_team") sub = pool.filter((p) => p.owner === myTeamName);
        if (!sub.length) return `No players found for scope "${scope}".`;
        const sortBy = (str("sort_by") || "value").toLowerCase();
        const col = SORT_COLUMNS[sortBy] ?? "value";
        const limit = Math.max(1, Math.min(Number(args.limit ?? 10) || 10, 25));
        const top = [...sub]
          .sort((a, b) => Number(b[col] ?? 0) - Number(a[col] ?? 0))
          .slice(0, limit);
        return [
          `Top ${top.length} by ${sortBy} (scope: ${scope}):`,
          ...top.map((p, i) => `${i + 1}. ${playerLine(p)}`),
        ].join("\n");
      }

      case "compare_players": {
        const a = fuzzyPlayer(pool, str("name_a"));
        const b = fuzzyPlayer(pool, str("name_b"));
        if (!a) return `No player matching "${str("name_a")}" was found.`;
        if (!b) return `No player matching "${str("name_b")}" was found.`;
        return `Player A: ${playerLine(a)}\nPlayer B: ${playerLine(b)}`;
      }

      case "team_category_ranks": {
        if (!standings.length) return "Standings data is unavailable right now.";
        const wanted = str("team") || myTeamName;
        const matched = matchTeam(
          standings.map((s) => s.teamName),
          wanted
        );
        const row = standings.find((s) => s.teamName === matched);
        if (!row) return `No season totals found for team "${wanted}".`;
        const cats = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "FG%", "FT%", "3P%", "DD"];
        const parts = cats
          .map((c) => {
            const rk = leagueRank(standings, row.teamId, c);
            return rk == null ? null : `${c}: ${ordinal(rk)} of ${standings.length}`;
          })
          .filter(Boolean);
        return (
          `Category ranks for ${row.teamName} (1 = best; TO ranked so fewer is better):\n` +
          parts.join("; ")
        );
      }

      case "team_roster": {
        if (!pool.length) return "League data is unavailable right now.";
        const wanted = str("team") || myTeamName;
        const matched = matchTeam(teamNames, wanted);
        if (!matched) {
          return `No roster found for "${wanted}". Known teams: ${[...teamNames].sort().join(", ")}.`;
        }
        const sub = pool
          .filter((p) => p.owner === matched)
          .sort((a, b) => b.value - a.value);
        return [
          `${matched} roster (${sub.length} players):`,
          ...sub.map((p, i) => `${i + 1}. ${playerLine(p)}`),
        ].join("\n");
      }

      case "list_teams": {
        if (!teamNames.length) return "League data is unavailable right now.";
        return (
          "Fantasy teams: " +
          [...teamNames]
            .sort()
            .map((t) => (t === myTeamName ? `${t} (the user's team)` : t))
            .join(", ")
        );
      }

      case "power_rankings": {
        const teams = league.seasonData.powerRankings?.teams ?? [];
        if (!teams.length) return "Power-ranking data is unavailable right now.";
        return [
          "League power rankings (by cumulative all-play):",
          ...teams.map((t) => {
            const [w, l, tie] = t.record;
            const tag = t.teamName === myTeamName ? " <- user's team" : "";
            return (
              `${t.rank}. ${t.teamName}${tag} - all-play ${(t.powerPct * 100).toFixed(0)}%, ` +
              `record ${w}-${l}-${tie}, form ${t.form}, SoS ${(t.sos * 100).toFixed(0)}%`
            );
          }),
        ].join("\n");
      }

      case "web_search":
        return webSearch(str("query"));

      default:
        return `Unknown tool "${name}".`;
    }
  };
}

/**
 * League context + ground rules, ported from `build_system_instruction`.
 *
 * The long trade-realism paragraph is not padding: without it the model reads value as
 * fungible and proposes two-good-players-for-a-superstar packages that no owner would
 * ever accept, which is the fastest way to make the whole assistant feel naive.
 */
export function systemInstruction(teamName: string, seasonOver: boolean, season: number) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
  return (
    `Today's date is ${today}. This is authoritative - your own training data is older ` +
    "than this, so anything that could have happened or changed since your training " +
    "(game/series results, awards, standings, rosters, coaches, records, 'who is the " +
    "current...') is something you must VERIFY with web_search rather than answer from " +
    "memory. If you catch yourself about to say an event 'hasn't happened yet', stop and " +
    "web_search it first - it very likely already has.\n\n" +
    "You are a concise, knowledgeable fantasy basketball assistant for an ESPN " +
    `9-category head-to-head league. The user's team is "${teamName}".\n\n` +
    "Scoring categories: FG%, FT%, 3PM, REB, AST, STL, BLK, TO (turnovers - LOWER is " +
    'better), PTS, and double-doubles (DD). "Value" is a 9-category z-score rating: ' +
    "higher is better, ~0 is replacement level, and positive means a useful fantasy " +
    'player. A player\'s "15-day" / "30-day" trend is how their recent value compares ' +
    "to their season value (positive = heating up, negative = cooling off).\n\n" +
    "You are the user's competitive edge - a sharp, proactive basketball analyst AND a " +
    "full basketball expert. You can and should answer ANY basketball question the user " +
    "asks: their fantasy league, the real NBA (current and historical), players, teams, " +
    "coaches, rules, strategy, scheme, terminology, records, awards, the draft, the " +
    "G-League, college, international/EuroLeague, and history. NEVER refuse or deflect a " +
    "basketball question, and never say you can 'only' help with the fantasy league - if " +
    "you're unsure, use web_search and then answer.\n\n" +
    "You have two sources of truth on top of your own basketball knowledge:\n" +
    "1. LEAGUE DATA tools (lookup_player, list_players, compare_players, " +
    "team_category_ranks, team_roster, list_teams, power_rankings) - use these for " +
    "anything about THIS fantasy league's players, rosters, values, or standings. ALWAYS " +
    "call them for real league numbers; never invent a value, stat, or roster.\n" +
    "2. web_search (Google) - use this LIBERALLY for anything the league data can't " +
    "answer and anything current or that you're not fully certain of: live news, " +
    "injuries, trades, standings, scores, schedules, awards, rosters, coaching changes, " +
    "records, or a fact you want to confirm. When in doubt, search before answering.\n\n" +
    "For general basketball knowledge (rules, strategy, terminology, well-established " +
    "history) you may answer directly from your own expertise; verify with web_search if " +
    "the detail is specific, recent, or uncertain. Call multiple tools when useful (e.g. " +
    "lookup_player AND web_search their injury status).\n\n" +
    "TRADE REALISM - this matters. Fantasy value is a z-score, but real trades are NOT " +
    "just about matching total value. Elite, top-tier players (roughly the top ~15-20 in " +
    "the league, and especially the top 5) carry a large scarcity PREMIUM: their owner " +
    "will almost never trade them for a package of two or more clearly lesser players, " +
    "even if the raw values add up, because one elite player is far more valuable than " +
    "two good ones (roster spots are scarce, and you can't start everyone). To acquire a " +
    "top-tier star you must give up a comparable star or a genuine overpay that still " +
    "centers on a strong player - never suggest landing a top-5 player for two mid-tier " +
    "or role players. When proposing trades, respect this: match star-for-star, and be " +
    "honest that a lopsided 'two-for-one for a superstar' offer would be rejected.\n\n" +
    "Be concise and opinionated: give a clear recommendation and cite the concrete " +
    "value, stat, or source that backs it - don't just dump data. Use markdown (bold, " +
    "short lists) for readability. " +
    (seasonOver
      ? `The ${season - 1}-${String(season).slice(2)} season is COMPLETE; the league ` +
        "numbers you get from the tools are final. Use web_search for anything current."
      : "The season is in progress; league numbers come from the most recent export, so " +
        "use web_search for today's news, injuries and lineups.")
  );
}
