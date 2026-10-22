import type { LeagueData, PlayerRow, TeamSide } from "./league";
import { playerMoments } from "./league";
import { etDate } from "./dates";

/**
 * Take the games that ESPN's live totals ALREADY COUNT out of a side's projection, so the
 * two never count the same game twice and the odds move as games are played
 * (2026-10-20).
 *
 * The export projects every game from the day it ran (Eastern) to the end of the week.
 * Once those games are played, ESPN's live totals include them too. So for each player:
 *
 *   - every team game before today is gone (those are over): what stays is the team's
 *     games after today, capped at the player's own (injury-aware) scheduled count;
 *   - TODAY's game is removed in proportion to how much of it has been played, from the
 *     NBA scoreboard (`gameLeft`: 1 before tip-off, 0 when final, the clock in between).
 *     An in-progress game keeps its unplayed share in the projection, because only the
 *     played share is in the live totals yet. It also catches a player who sat out a
 *     finished game: the game is gone either way.
 *   - If the scoreboard could not be read (`gameLeft` null), today's game is removed
 *     whole once ESPN shows the player with a game played (`playedToday`) — the cruder
 *     fallback.
 *
 * Games are FRACTIONAL from here on: the projection is a plain sum of `avg x games`
 * moments (scripts/build_data.py `team_totals`), and 2.47 games is as valid an input to
 * it as 3. `gamesLeft` (slot-capped, what the model uses) is scaled down in proportion to
 * `nbaGamesLeft` (the schedule), since which games were the capped ones is not recorded.
 *
 * Returns the side unchanged when nothing has been played since the export, or when no
 * live data has arrived (both `playedToday` and `gameLeft` null) — the totals beside it
 * are then still the export's.
 */
export function remainingSide(
  league: LeagueData,
  side: TeamSide,
  playedToday: string[] | null,
  gameLeft: Record<string, number> | null,
  now: Date = new Date()
): TeamSide {
  // No live data (first paint, demo, frozen, or the fetch failed): the totals beside this
  // projection are still the export's, which count none of the games played since — so
  // taking those games out of the projection would drop them from both.
  if (playedToday == null && gameLeft == null) return side;

  const today = etDate(now);
  const sched = league.weekSchedule;
  const played = new Set(playedToday ?? []);

  let changed = false;
  const mu = side.projMu.slice();
  const vr = side.projVar.slice();

  const players: PlayerRow[] = side.players.map((p) => {
    const scheduled = p.nbaGamesLeft ?? p.gamesLeft;
    // Today's game still to play: the unplayed share of it.
    const todayLeft = (): number => {
      if (gameLeft) return gameLeft[p.nbaTeam] ?? 1;
      return played.has(p.name) ? 0 : 1;
    };
    let restScheduled: number;
    const games = sched?.teams[p.nbaTeam];
    if (games) {
      // What is LEFT on his team's calendar (later days, plus the unplayed share of
      // today's), capped at his own scheduled count. Counting what is left rather than
      // subtracting what was played keeps the injury-aware `nbaGamesLeft` right: a player
      // out Mon-Tue who returns Wed is not charged for the Mon/Tue games he never had.
      let rest = 0;
      for (const d of Object.keys(games)) {
        if (d > today) rest += 1;
        else if (d === today) rest += todayLeft();
      }
      restScheduled = Math.min(scheduled, rest);
    } else {
      // No schedule for his team: only today's game can be accounted for.
      const todayDone = gameLeft
        ? gameLeft[p.nbaTeam] != null ? 1 - gameLeft[p.nbaTeam] : 0
        : played.has(p.name) ? 1 : 0;
      restScheduled = Math.max(0, scheduled - todayDone);
    }
    if (restScheduled >= scheduled) return p;

    const restCounted = scheduled > 0 ? (p.gamesLeft * restScheduled) / scheduled : 0;
    const removed = p.gamesLeft - restCounted;
    // A player the slot cap gave no counted games still shows his schedule (GL).
    if (removed <= 0) return { ...p, nbaGamesLeft: restScheduled };

    changed = true;
    // Swap his whole-week moments for his remaining ones rather than subtracting the
    // played games' worth: the projection-error term grows with games^2, so it is not
    // additive over games (see playerMoments).
    const full = playerMoments(p.avg, p.gamesLeft, league.variance, league.projectionError);
    const rest = playerMoments(p.avg, restCounted, league.variance, league.projectionError);
    for (let i = 0; i < mu.length; i++) {
      mu[i] = Math.max(0, mu[i] - full.mu[i] + rest.mu[i]);
      vr[i] = Math.max(0, vr[i] - full.var[i] + rest.var[i]);
    }
    return { ...p, gamesLeft: restCounted, nbaGamesLeft: restScheduled };
  });

  const touched = players.some((p, i) => p !== side.players[i]);
  if (!touched) return side;
  return changed ? { ...side, players, projMu: mu, projVar: vr } : { ...side, players };
}

/**
 * A games count for display: whole numbers as they are, a game in progress to one
 * decimal ("34.5") — the fractional remainder is real, rounding it away would hide it.
 */
export function formatGames(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
