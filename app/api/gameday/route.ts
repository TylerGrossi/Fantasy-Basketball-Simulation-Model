import { NextResponse } from "next/server";
import {
  parseBox,
  parsePlays,
  parseScoreboard,
  type GameDayData,
  type NbaGame,
  type NbaLine,
  type Play,
} from "@/lib/gameday";
import { loadGameSpread, loadLeague } from "@/lib/loadLeague";
import { makeGameValuer } from "@/lib/percentiles";

/**
 * Game Day's NBA feed: tonight's games, EVERY player's box line, and the play-by-play —
 * the newest plays from every game, plus every play involving a player asked for (`?ids=`
 * — ESPN athlete ids, the page sends both sides of your matchup) and every play of the
 * games asked for (`?games=`, a comma list — the ones the page has picked), however old.
 *
 * Every player, not just your matchup's (owner, 2026-10-21): the page shows the whole
 * night and highlights yours, so a free agent going off is on screen too. ~240 box lines
 * is ~60 KB; the plays are what get capped.
 *
 * Public ESPN endpoints, no auth. One scoreboard request plus one summary per game that
 * has started. A FINAL game never changes, so its parsed summary is kept for the life of
 * the server process; only games in progress are re-fetched on each poll.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NBA = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
/** Newest plays sent from the whole slate; older ones only if they involve `ids`/`games`. */
const MAX_PLAYS = 300;
/** Hard cap on the plays in one response, whatever matched. */
const PLAY_CAP = 900;

interface Parsed {
  lines: NbaLine[];
  plays: Play[];
}

const finals = new Map<string, Parsed>();

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function gameDetail(
  game: NbaGame,
  value: (line: Record<string, number>) => Record<string, number>
): Promise<Parsed | null> {
  const hit = finals.get(game.id);
  if (hit) return hit;
  const summary = await getJson(`${NBA}/summary?event=${game.id}`);
  if (!summary) return null;
  const parsed = { lines: parseBox(summary, game, value), plays: parsePlays(summary, game.id) };
  if (game.state === "post") finals.set(game.id, parsed);
  return parsed;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tracked = new Set(
    (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  const picked = new Set((url.searchParams.get("games") ?? "").split(",").filter(Boolean));

  // No `dates`: ESPN then serves ITS current day, which holds on to last night's slate
  // while a late West Coast game runs past midnight Eastern.
  const board = await getJson(`${NBA}/scoreboard`);
  if (!board) {
    return NextResponse.json({ error: "ESPN scoreboard unavailable" }, { status: 502 });
  }
  const { day, games } = parseScoreboard(board);

  // Each line valued against the season pool on a SINGLE-GAME scale — the Player Card's
  // formula (all fifteen categories) with one night's measured spreads, so 3 steals
  // cannot outweigh a 30-point game. Without the spread file, the card's season scale.
  const league = await loadLeague();
  const spread = await loadGameSpread();
  const value = makeGameValuer(league.seasonData.playerPool ?? [], spread?.spread ?? {});

  const details = await Promise.all(
    games.map((g) => (g.state === "pre" ? Promise.resolve(null) : gameDetail(g, value)))
  );

  // Every player who has played tonight, best night first.
  const lines = details.flatMap((d) => d?.lines ?? []).sort((a, b) => b.value - a.value);
  const plays = details
    .flatMap((d) => d?.plays ?? [])
    .sort((a, b) => (a.at === b.at ? b.seq - a.seq : a.at < b.at ? 1 : -1))
    .filter(
      (p, i) =>
        i < MAX_PLAYS ||
        picked.has(p.gameId) ||
        Object.keys(p.credit).some((id) => tracked.has(id))
    )
    .slice(0, PLAY_CAP);

  const body: GameDayData = { day, games, lines, plays, fetchedAt: new Date().toISOString() };
  return NextResponse.json(body, {
    // Short shared window: the page polls every 10s while games are on (owner,
    // 2026-10-21), and every viewer inside these 5s shares one ESPN pass.
    headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=10" },
  });
}
