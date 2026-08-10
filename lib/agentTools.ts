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

import type { LeagueData, PoolPlayer, StandingRow, ScoreboardRow } from "./league";
// The same helpers /scoreboard and /matchup use, so the agent's numbers are the page's
// numbers rather than a second implementation that can drift from it.
import {
  categoryRecord,
  periodLabel,
  scoreboardRows,
  winProbability,
} from "./league";
// Live ESPN data — the Player Card's splits panels, reachable from the server.
import {
  averageLine,
  consistency,
  fetchPlayerGames,
  fetchTeamDefense,
  spreadRank,
  type ConsistencyPool,
} from "./espnLive";
import { playerStatus } from "./playerPool";
import { APP_TOUR } from "./appTour";

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
/** A per-game line from one of the recent-window blobs, in the card's own order. */
function windowLine(w: Partial<Record<string, number>> | undefined): string | null {
  if (!w || !w.gp) return null;
  const n = (k: string) => Number(w[k] ?? 0).toFixed(1);
  return (
    `${w.gp}gp ${n("PTS")}p ${n("REB")}r ${n("AST")}a ` +
    `${n("STL")}s ${n("BLK")}b ${n("3PM")}3 ${n("TO")}to`
  );
}

/**
 * ONE player, with everything the export knows about him.
 *
 * Deliberately the same facts the Player Card shows, because the agent is asked the
 * questions that page answers and was previously working from a third of them — it had
 * the season line and the two trend deltas, and none of the sample size, the recent
 * WINDOWS, the ESPN ranks, the career history, or how the player was acquired. It would
 * say "he is trending up" without being able to say off how many games.
 *
 * NOT here: the card's splits (home/away, rest, by month), the opponent-defence buckets
 * and the game log. Those are not in league.json at all — they come live from ESPN, and
 * the `player_game_detail` tool fetches them on demand. They are kept out of this line
 * deliberately, because it is returned for every player in a list and a network call per
 * row would be ruinous.
 */
function playerLine(p: PoolPlayer): string {
  const bits: string[] = [
    `${p.name} (${p.nbaTeam || "?"}, ${p.position || "?"}${
      p.eligibleSlots?.length ? `; eligible ${p.eligibleSlots.join("/")}` : ""
    }) - owner: ${ownerLabel(p.owner)}`,
  ];

  // Age and experience: the card's bio row, and what separates a breakout from a decline.
  const who = [
    p.age != null ? `age ${p.age}` : null,
    p.exp != null ? `${p.exp} yr${p.exp === 1 ? "" : "s"} exp` : null,
    p.lineupSlot ? `slot ${p.lineupSlot}` : null,
    p.acquisitionType ? `acquired via ${p.acquisitionType}` : null,
  ].filter(Boolean);
  if (who.length) bits.push(who.join(", "));

  // Value in all three windows, each with its trend — the card's three basis tiles.
  bits.push(
    `value ${signed(p.value)} (season), ${signed(p.recent)} (30d, trend ${signed(p.trend)}), ` +
      `${signed(p.recent15)} (15d, trend ${signed(p.trend15)})`
  );

  bits.push(
    `${p.gp ?? "?"} games: ${p.PTS.toFixed(1)} PTS, ${p.REB.toFixed(1)} REB, ` +
      `${p.AST.toFixed(1)} AST, ${p.STL.toFixed(1)} STL, ${p.BLK.toFixed(1)} BLK, ` +
      `${p["3PM"].toFixed(1)} 3PM, ${p.TO.toFixed(1)} TO, ${p.DD.toFixed(1)} DD/g`
  );
  bits.push(`FG ${pct(p.fgPct)}, FT ${pct(p.ftPct)}, 3P ${pct(p.tpPct)}`);

  const l30 = windowLine(p.last30);
  const l15 = windowLine(p.last15);
  if (l30) bits.push(`last 30 days: ${l30}`);
  if (l15) bits.push(`last 15 days: ${l15}`);

  // ESPN's own opinion, which the draft board is measured against.
  const espn = [
    p.espnRank != null ? `ESPN roto rank ${p.espnRank}` : null,
    p.espnStdRank != null ? `standard rank ${p.espnStdRank}` : null,
    p.adp != null ? `ADP ${p.adp}` : null,
  ].filter(Boolean);
  if (espn.length) bits.push(espn.join(", "));

  if (p.history?.length) {
    bits.push(
      "career: " +
        p.history
          .map(
            (h) =>
              `${h.season - 1}-${String(h.season % 100).padStart(2, "0")} ` +
              `${h.gp}gp ${h.min?.toFixed(1) ?? "?"}min ${Number(h.PTS ?? 0).toFixed(1)}p ` +
              `${Number(h.REB ?? 0).toFixed(1)}r ${Number(h.AST ?? 0).toFixed(1)}a`
          )
          .join("; ")
    );
  }

  bits.push(`status: ${p.status || "active"}`);
  return bits.join("; ");
}

/**
 * A compact one-liner for list results.
 *
 * `playerLine` is the full profile — fourteen numbers per player. Fine for looking up
 * one man, ruinous for a screen of thirty, where it buries the answer and burns the
 * context the model needs to reason with. This keeps the fields a shortlist is judged on.
 */
function shortLine(p: PoolPlayer): string {
  return (
    `${p.name} (${p.position || "?"}, ${p.nbaTeam || "?"}) — ${ownerLabel(p.owner)}; ` +
    `val ${signed(p.value)}, 15d ${signed(p.trend15)}; ` +
    `${p.PTS.toFixed(1)}p ${p.REB.toFixed(1)}r ${p.AST.toFixed(1)}a ` +
    `${p.STL.toFixed(1)}s ${p.BLK.toFixed(1)}b ${p["3PM"].toFixed(1)}3 ${p.TO.toFixed(1)}to ` +
    `${p.DD.toFixed(1)}dd; FG ${pct(p.fgPct)} FT ${pct(p.ftPct)} 3P ${pct(p.tpPct)}; ` +
    `${p.status && p.status !== "ACTIVE" ? p.status : "healthy"}`
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
    name: "find_players",
    description:
      "SEARCH the player pool with filters and get NAMES back. This is the tool for 'who should I trade for', 'which healthy bigs are available', 'who fits my punt build' — anything where the answer is a shortlist of specific players. Filter by who owns them, position, health and per-category minimums, then rank by whichever category matters. Prefer this over list_players whenever the request has any criteria beyond overall value.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["other_teams", "free_agents", "my_team", "all"],
          description:
            '"other_teams" = rostered by someone else, i.e. TRADE targets. "free_agents" = available on the wire. Defaults to other_teams.',
        },
        positions: {
          type: "array",
          items: { type: "string" },
          description: 'Positions to include, e.g. ["C","PF"] for bigs. Omit for any.',
        },
        healthy_only: {
          type: "boolean",
          description: "Exclude anyone out, on IR or suspended. Default false.",
        },
        sort_by: {
          type: "string",
          enum: Object.keys(SORT_COLUMNS),
          description: 'What to rank by — e.g. "rebounds", "fg_pct", "blocks", "value".',
        },
        min_value: { type: "number", description: "Minimum 9-cat value." },
        max_value: {
          type: "number",
          description:
            "Maximum 9-cat value. Use it to skip untouchable stars when looking for a realistic trade — the top ~20 in the league will not be sold at a discount.",
        },
        min_fg_pct: { type: "number", description: "Minimum field-goal %, as 0-1 (0.5 = 50%)." },
        min_ft_pct: { type: "number", description: "Minimum free-throw %, as 0-1." },
        min_rebounds: { type: "number", description: "Minimum rebounds per game." },
        min_blocks: { type: "number", description: "Minimum blocks per game." },
        min_assists: { type: "number", description: "Minimum assists per game." },
        min_points: { type: "number", description: "Minimum points per game." },
        max_turnovers: { type: "number", description: "Maximum turnovers per game." },
        limit: { type: "integer", description: "How many to return (1-30, default 12)." },
      },
    },
  },
  {
    name: "league_rosters",
    description:
      "Every fantasy team's roster in one call, each player with position, 9-cat value and 15-day trend. Use it to survey the league before proposing a trade — who is deep where, and which manager has a surplus of what. Cheaper than calling team_roster for each team.",
    parameters: {
      type: "object",
      properties: {
        include_my_team: {
          type: "boolean",
          description: "Include the user's own roster too. Default true.",
        },
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
    name: "current_matchup",
    description:
      "This week's head-to-head for a team: the category-by-category score, who is winning each category, and the model's win probability. Use for 'am I winning', 'how does my matchup look', or scouting an opponent's week.",
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
    name: "team_schedule",
    description:
      "A team's week-by-week results for the season: opponent, manager, win/loss, and the category score of each week. Use for 'how did I do in week 12', streaks, or who beat whom.",
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
    name: "recent_moves",
    description:
      "The league transaction feed: adds, drops, waiver claims and trades, newest first. Use for 'who picked up X', 'what has team Y done lately', or roster churn.",
    parameters: {
      type: "object",
      properties: {
        team: {
          type: "string",
          description: "Only this team's moves. Blank for the whole league.",
        },
        player: { type: "string", description: "Only moves involving this player." },
        limit: { type: "number", description: "How many moves to return (default 25)." },
      },
    },
  },
  {
    name: "playoff_odds",
    description:
      "Championship and advancement probabilities from the simulated bracket, per team. Only meaningful while a season is running; once the bracket is decided it reports the actual finalists instead.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "player_game_detail",
    description:
      "One player's GAME-BY-GAME detail, live from ESPN: his last games, monthly splits, home/away and rest splits, how he did against strong versus weak defences, and his CONSISTENCY — median night, game-to-game spread, how often he beat his own average, and where that spread ranks in the league. Use for 'how consistent is he', 'can I rely on him', 'is he trending up', 'does he show up against good teams', 'how is he on back-to-backs', 'what has he done lately', or any question the season averages cannot answer. Slower than the other tools because it fetches live — call it only when the question is actually about form, splits, consistency or recent games.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: 'The player\'s name, full or partial (e.g. "Jokic").',
        },
      },
      required: ["name"],
    },
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
  webSearch: (query: string) => Promise<string>,
  /*
   * The league-wide spread baseline, or null when scripts/build_consistency.mjs has never
   * been run. Optional on purpose: a missing file costs the percentile sentence and
   * nothing else, so a fresh clone still gets a working agent.
   */
  consistencyPool: ConsistencyPool | null = null
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

      case "find_players": {
        if (!pool.length) return "Player data is unavailable right now.";
        const scope = (str("scope") || "other_teams").toLowerCase();
        const positions = (
          Array.isArray(args.positions) ? (args.positions as unknown[]) : []
        ).map((p) => String(p).trim().toUpperCase());
        const num = (k: string) =>
          args[k] == null || args[k] === "" ? null : Number(args[k]);

        let sub = pool.filter((p) => {
          if (scope === "other_teams" && (p.owner === myTeamName || p.owner === "FA" || !p.owner))
            return false;
          if (scope === "free_agents" && p.owner !== "FA") return false;
          if (scope === "my_team" && p.owner !== myTeamName) return false;
          if (positions.length && !positions.includes((p.position || "").toUpperCase()))
            return false;
          if (args.healthy_only && playerStatus(p.status)[1] === "out") return false;
          const gate: Array<[string, number, 1 | -1]> = [
            ["min_value", p.value, 1],
            ["max_value", p.value, -1],
            ["min_fg_pct", p.fgPct, 1],
            ["min_ft_pct", p.ftPct, 1],
            ["min_rebounds", p.REB, 1],
            ["min_blocks", p.BLK, 1],
            ["min_assists", p.AST, 1],
            ["min_points", p.PTS, 1],
            ["max_turnovers", p.TO, -1],
          ];
          for (const [key, actual, dir] of gate) {
            const bound = num(key);
            if (bound == null || Number.isNaN(bound)) continue;
            if (dir === 1 ? actual < bound : actual > bound) return false;
          }
          return true;
        });

        const sortBy = (str("sort_by") || "value").toLowerCase();
        const col = SORT_COLUMNS[sortBy] ?? "value";
        // Turnovers are the one column where less is better, so ranking them descending
        // would hand back the WORST candidates for a low-turnover build.
        const asc = sortBy === "turnovers";
        sub = [...sub].sort((a, b) =>
          asc
            ? Number(a[col] ?? 0) - Number(b[col] ?? 0)
            : Number(b[col] ?? 0) - Number(a[col] ?? 0)
        );
        const limit = Math.max(1, Math.min(Number(args.limit ?? 12) || 12, 30));
        const top = sub.slice(0, limit);
        if (!top.length) {
          return (
            `No players match those filters (scope: ${scope}). Loosen a threshold — ` +
            "say a lower min_value or drop a per-category minimum — and try again."
          );
        }
        const label =
          scope === "other_teams"
            ? "on other rosters (trade targets)"
            : scope === "free_agents"
              ? "available as free agents"
              : scope === "my_team"
                ? "on the user's roster"
                : "in the league";
        return [
          `${top.length} of ${sub.length} matching players ${label}, ranked by ${sortBy}:`,
          ...top.map((p, i) => `${i + 1}. ${shortLine(p)}`),
        ].join("\n");
      }

      case "league_rosters": {
        if (!teamNames.length) return "League data is unavailable right now.";
        const includeMine = args.include_my_team !== false;
        const lines: string[] = [];
        for (const team of [...teamNames].sort()) {
          if (!includeMine && team === myTeamName) continue;
          const roster = pool
            .filter((p) => p.owner === team)
            .sort((a, b) => b.value - a.value);
          const tag = team === myTeamName ? " (the user's team)" : "";
          lines.push(
            `${team}${tag}: ` +
              roster
                .map(
                  (p) =>
                    `${p.name} (${p.position || "?"} ${signed(p.value)}` +
                    `${playerStatus(p.status)[1] === "out" ? " OUT" : ""})`
                )
                .join(", ")
          );
        }
        return ["Every roster, best player first:", ...lines].join("\n");
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

      case "player_game_detail": {
        const p = fuzzyPlayer(pool, str("name"));
        if (!p) return `No player matching "${str("name")}" was found in this league.`;
        if (!p.playerId) return `${p.name} has no ESPN id in the export, so no game log.`;

        /*
         * LIVE, not exported. These are the Player Card's splits panels, which the browser
         * fetches per player; the export has never carried them. Fetching one player's log
         * on demand keeps the answer current and costs one request, where putting ~290
         * logs in the build would bloat every page's payload for detail rarely asked about.
         *
         * Both fetches degrade to a plain sentence rather than an error: the agent saying
         * "I could not reach ESPN" is a fine answer, an exception is not.
         */
        const games = await fetchPlayerGames(p.playerId, pool);
        if (!games?.length) {
          return `No regular-season game log available for ${p.name} right now (ESPN did not return one).`;
        }

        // StatLine's fields are optional, so read them through Number() rather than
        // asserting — a line missing a stat should print 0.0, not throw.
        const fmt = (l: ReturnType<typeof averageLine>) => {
          const n = (k: keyof typeof l) => Number(l[k] ?? 0).toFixed(1);
          return `${n("PTS")}p ${n("REB")}r ${n("AST")}a ${n("STL")}s ${n("BLK")}b ${n("TO")}to`;
        };
        const bucket = (label: string, gs: typeof games) =>
          gs.length ? `${label}: ${gs.length}gp ${fmt(averageLine(gs))}` : null;

        const out: string[] = [`${p.name} — ${games.length} regular-season games on record.`];

        /*
         * The Player Card's Consistency panel, verbatim, plus the one thing the card
         * cannot show: where that spread sits in the league.
         *
         * "± 7.1" means nothing on its own — a reader has no idea whether that is steady
         * or wild. The card gets away with it because a human compares a few players by
         * eye. An answer in prose has to say so outright, which is what the baseline in
         * consistency.json is for.
         */
        const con = consistency(games);
        if (con) {
          const rank =
            consistencyPool && p.playerId
              ? spreadRank(p.playerId, p.value, consistencyPool, pool)
              : null;
          const line =
            `Consistency (per-game 9-cat value) — median night ${signed(con.median)}, ` +
            `average ${signed(con.avg)}, spread ±${con.sd.toFixed(1)} game to game; ` +
            `${Math.round(con.aboveOwn * 100)}% of games at or above his own average, ` +
            `${Math.round(con.abovePool * 100)}% above the pool average (startable nights).`;
          out.push(
            rank
              ? line +
                  ` Spread in context: steadier than ${rank.steadierThan.toFixed(0)}% of the ` +
                  `${rank.pool} qualified players league-wide, and ${rank.peerSteadierThan.toFixed(0)}% ` +
                  `of the ${rank.peerPool} closest to him in season value. Quote the SECOND ` +
                  `number when judging whether he is reliable: spread rises with quality, so ` +
                  `the league-wide figure flatters low-usage players and penalises stars.`
              : line
          );
        }

        // Last ten, newest first: the question "what has he done lately" in raw form.
        out.push(
          "Last 10: " +
            [...games]
              .slice(-10)
              .reverse()
              .map((g) => {
                const d = new Date(g.date);
                return (
                  `${d.getMonth() + 1}/${d.getDate()} ${g.home ? "vs" : "@"}${g.opp} ` +
                  `${g.min.toFixed(0)}min ${fmt(g.line)}`
                );
              })
              .join(" | ")
        );

        const byMonth = new Map<string, typeof games>();
        for (const g of games) {
          const list = byMonth.get(g.month);
          if (list) list.push(g);
          else byMonth.set(g.month, [g]);
        }
        out.push(
          "By month — " +
            [...byMonth.entries()]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([m, gs]) => `${m}: ${gs.length}gp ${fmt(averageLine(gs))}`)
              .join("; ")
        );

        out.push(
          "By situation — " +
            [
              bucket("home", games.filter((g) => g.home)),
              bucket("away", games.filter((g) => !g.home)),
              bucket("back-to-back", games.filter((g) => g.rest === 0)),
              bucket("1 day rest", games.filter((g) => g.rest === 1)),
              bucket("2+ days rest", games.filter((g) => (g.rest ?? 0) >= 2)),
            ]
              .filter(Boolean)
              .join("; ")
        );

        // Opponent strength, in thirds — the resolution the underlying rating supports.
        const defense = await fetchTeamDefense(league.season);
        if (defense) {
          const tier = (lo: number, hi: number) =>
            games.filter((g) => {
              const d = defense.get(g.opp);
              return d ? d.rank >= lo && d.rank <= hi : false;
            });
          out.push(
            "By opponent defence (points allowed, thirds) — " +
              [
                bucket("vs top 10 defences", tier(1, 10)),
                bucket("vs middle 10", tier(11, 20)),
                bucket("vs bottom 10", tier(21, 30)),
              ]
                .filter(Boolean)
                .join("; ")
          );
        }

        return out.join("\n");
      }

      case "current_matchup": {
        const wanted = str("team") || myTeamName;
        const matchedName = matchTeam(
          league.teams.map((t) => t.name.trim()),
          wanted
        );
        const team = league.teams.find((t) => t.name.trim() === matchedName);
        if (!team) return `No team found matching "${wanted}".`;
        const m = league.matchups.find(
          (x) => x.homeId === team.id || x.awayId === team.id
        );
        if (!m) return `No matchup found for ${team.name} in period ${league.period}.`;
        const isHome = m.homeId === team.id;
        const you = isHome ? m.home : m.away;
        const opp = isHome ? m.away : m.home;
        const oppTeam = league.teams.find((t) => t.id === (isHome ? m.awayId : m.homeId));
        const rows = scoreboardRows(league, you.current, opp.current);
        const rec = categoryRecord(rows);
        /*
         * The same caveat the /matchup page carries: once every game is played the
         * probability is not a forecast, it is a restatement of the result. Handing the
         * model "97% to win" about a finished week is how it ends up predicting the past.
         */
        const live = you.projVar.some((v) => v > 0) || opp.projVar.some((v) => v > 0);
        const odds = winProbability(league, you, opp, you.current, opp.current);
        return [
          `${team.name} vs ${oppTeam?.name ?? "opponent"} — ${periodLabel(league)}`,
          `Category score ${rec.win}-${rec.loss}${rec.tie ? `-${rec.tie}` : ""} (${team.name} first).`,
          live
            ? `Win probability ${(odds.win * 100).toFixed(1)}%, with games still to play.`
            : "Every game is played, so this is the FINAL result, not a projection.",
          "By category: " +
            rows
              .map(
                (r: ScoreboardRow) =>
                  `${r.cat} ${r.youStr} vs ${r.oppStr} (${
                    r.youWins ? "win" : r.oppWins ? "loss" : "tie"
                  })`
              )
              .join("; "),
        ].join("\n");
      }

      case "team_schedule": {
        const schedules = league.seasonData.schedules ?? {};
        const wanted = str("team") || myTeamName;
        const matchedName = matchTeam(
          league.teams.map((t) => t.name.trim()),
          wanted
        );
        const team = league.teams.find((t) => t.name.trim() === matchedName);
        if (!team) return `No team found matching "${wanted}".`;
        const rows = schedules[String(team.id)] ?? [];
        if (!rows.length) return `No schedule recorded for ${team.name}.`;
        return [
          `${team.name} week by week:`,
          ...rows.map(
            (r) =>
              `Week ${r.period}: ${r.result || "—"} ${r.score || ""} vs ${r.opponent.trim()}` +
              (r.manager ? ` (${r.manager})` : "")
          ),
        ].join("\n");
      }

      case "recent_moves": {
        const moves = league.seasonData.recentMoves ?? [];
        if (!moves.length) return "No transaction history in this export.";
        const teamQ = str("team");
        const playerQ = str("player").toLowerCase();
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 25));
        const matchedTeam = teamQ
          ? matchTeam([...new Set(moves.map((mv) => mv.team))], teamQ)
          : null;
        const hits = moves.filter(
          (mv) =>
            (!matchedTeam || mv.team === matchedTeam) &&
            (!playerQ || mv.player.toLowerCase().includes(playerQ))
        );
        if (!hits.length) {
          return `No moves matched${matchedTeam ? ` for ${matchedTeam}` : ""}${
            playerQ ? ` involving "${str("player")}"` : ""
          }.`;
        }
        return [
          `${hits.length} move${hits.length === 1 ? "" : "s"}` +
            (hits.length > limit ? ` (showing the ${limit} most recent)` : "") +
            ":",
          ...hits
            .slice(0, limit)
            .map(
              (mv) =>
                `${(mv.date || "").slice(0, 10)} — ${mv.team}: ${mv.action} ${mv.player}` +
                (mv.position ? ` (${mv.position})` : "")
            ),
        ].join("\n");
      }

      case "playoff_odds": {
        const odds = league.seasonData.playoffOdds ?? [];
        if (!odds.length) return "No playoff projection in this export.";
        /*
         * These three fields are ALREADY 0-100, unlike every other rate in the export
         * (winPct, allPlayPct, powerPct are all 0-1). Multiplying by 100 the way the rest
         * of this file does produced "champ 4916.2%, advance 10000.0%". The playoffs page
         * prints them raw, which is the check: compare against app/playoffs/page.tsx.
         */
        const p100 = (v: number) => `${v.toFixed(1)}%`;
        const finalists = league.seasonData.championshipFinalists ?? [];
        if (league.seasonOver) {
          /*
           * A probability is not an outcome — the trap AGENTS.md names. Once the bracket
           * is decided these numbers describe a tournament that has already happened, and
           * the two finalists sit near 50/50, so handed over bare they make the model
           * report a coin flip about a settled title. The result leads; the odds follow
           * with their tense made explicit.
           */
          const names = finalists
            .map((id) => league.teams.find((t) => t.id === id)?.name ?? `team ${id}`)
            .join(" and ");
          const champ = [...(league.seasonData.standings ?? [])].sort(
            (a, b) => (a.finalStanding || a.standing) - (b.finalStanding || b.standing)
          )[0];
          return [
            `The season is OVER. ${names || "Two teams"} reached the final and ` +
              `${champ?.teamName ?? "the top seed"} won the championship.`,
            "The figures below are what the simulation said BEFORE the bracket was played." +
              " Do not present them as a forecast of a decided result.",
            odds
              .map(
                (o) =>
                  `${o.teamName}: champ ${p100(o.championshipProb)}, ` +
                  `advance ${p100(o.advanceProb)}`
              )
              .join("; "),
          ].join("\n");
        }
        return [
          "Playoff projection:",
          ...odds.map(
            (o) =>
              `${o.teamName}: playoffs ${p100(o.playoffProb)}, ` +
              `advance ${p100(o.advanceProb)}, ` +
              `championship ${p100(o.championshipProb)}`
          ),
        ].join("\n");
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
    "1. LEAGUE DATA tools - use these for anything about THIS fantasy league's players, " +
    "rosters, values, matchups, schedule, transactions or standings. ALWAYS call them for " +
    "real league numbers; never invent a value, stat, result or roster:\n" +
    "   - players: lookup_player, find_players, list_players, compare_players, " +
    "player_game_detail\n" +
    "   - teams: team_roster, league_rosters, team_category_ranks, list_teams\n" +
    "   - the season: power_rankings, current_matchup, team_schedule, recent_moves, " +
    "playoff_odds\n" +
    "player_game_detail is the ONLY tool that sees a player's individual GAMES - his last " +
    "ten lines, his month-by-month splits, home/away, rest and back-to-backs, how he does " +
    "against good, average and bad defences, and his consistency (median night, " +
    "game-to-game spread, and where that spread ranks league-wide and among players of " +
    "similar value). Use it whenever the question is about form, consistency, reliability, " +
    "a hot or cold streak, rest, matchups, or what he has done lately; the other tools " +
    "only have season and rolling-window averages, which cannot tell a steady player from " +
    "a volatile one. CONSISTENCY IS A SPREAD QUESTION - answer it with the spread and its " +
    "percentile, not by listing monthly averages. It fetches live from ESPN, so call it " +
    "for one or two players at a time, never for a whole list.\n" +
    "NAME NAMES. If the user asks who to trade for, who to target, who to pick up or who " +
    "to drop, the answer is a list of SPECIFIC PLAYERS - each with the team that owns " +
    "him and the numbers that make him a fit. Describing a 'target profile' or a 'type of " +
    "player' to look for is a NON-ANSWER; the user cannot trade for a profile. Use " +
    "find_players (scope 'other_teams' for trade targets, 'free_agents' for the wire) " +
    "with the filters that match what they asked for, and league_rosters to see which " +
    "manager has a surplus to trade from. If a first search comes back empty, loosen a " +
    "filter and search again rather than falling back on generalities.\n" +
    "RESPECT A STATED STRATEGY. If the user says they are punting a category, stop " +
    "recommending fixes for it and stop counting it against a target - rank candidates " +
    "by the categories they actually want. A punt build makes the overall 9-cat 'value' " +
    "number misleading, so lean on the per-category figures instead.\n" +
    "2. web_search (Google) - use this LIBERALLY for anything the league data can't " +
    "answer and anything current or that you're not fully certain of: live news, " +
    "injuries, trades, standings, scores, schedules, awards, rosters, coaching changes, " +
    "records, or a fact you want to confirm. When in doubt, search before answering.\n\n" +
    "For general basketball knowledge (rules, strategy, terminology, well-established " +
    "history) you may answer directly from your own expertise; verify with web_search if " +
    "the detail is specific, recent, or uncertain. Call multiple tools when useful (e.g. " +
    "lookup_player AND web_search their injury status).\n\n" +
    APP_TOUR +
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
