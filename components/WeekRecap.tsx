import type { ReactNode } from "react";
import Link from "next/link";
import { AcquisitionLine, CategorySheet, PlayerBoxTable, tally } from "./BoxScoreSheet";
import { periodLabel, type LeagueData } from "@/lib/league";
import type { BoxScores } from "@/lib/loadLeague";

/**
 * A completed week, laid out the way ESPN's box-score page lays it out: the head-to-head
 * category sheet, the acquisition line, and a per-player box table for each side.
 *
 * NOT a component — a plain function returning the three panels the mobile 3-tab control
 * (You / Matchup / Opponent) and the desktop continuous layout both need, so a server
 * page can distribute them into `<ScoreboardTabs>` without this file knowing tabs exist.
 * `CategorySheet`/`AcquisitionLine`/`PlayerBoxTable` are shared with Scoreboard.tsx (the
 * CURRENT week, which needs the same three panels built from live totals) — see
 * components/BoxScoreSheet.tsx.
 *
 * The player tables come from `boxscores.json` — ESPN's own per-player weekly totals,
 * collected in the loop `build_period_results` already runs, so they cost no extra
 * requests. Summing them reproduces the team's category totals exactly, which is worth
 * knowing: there is no bench to separate out, because ESPN only lists the players whose
 * stats counted.
 *
 * Called from a server component, so the browser never receives `periodResults`.
 */
export function buildWeekRecap({
  league,
  period,
  teamId,
  myTeamId,
  box,
}: {
  league: LeagueData;
  period: number;
  /**
   * Whose game to show. Defaults to your own team upstream, but the strip's links can
   * point it at ANY team in the period — the panels are built from that team's side, so
   * "mine"/"opp" mean the selected game's two teams, not necessarily you.
   */
  teamId: number;
  /**
   * YOUR team, which is not necessarily the one being shown. Only used to keep your own
   * game marked in the strip while you're looking at somebody else's — otherwise it
   * becomes one anonymous card among five.
   */
  myTeamId: number;
  /** Per-player lines, or null when the export predates them. */
  box: BoxScores | null;
}): { oppId: number; matchup: ReactNode; mine: ReactNode; opp: ReactNode } | null {
  const result = (league.periodResults ?? []).find((p) => p.period === period);
  const mine = result?.games.find((g) => g.homeId === teamId || g.awayId === teamId);
  if (!result || !mine) return null;

  const byId = new Map(league.teams.map((t) => [t.id, t]));
  const name = (id: number) => byId.get(id)?.name ?? "Unknown";
  const record = (id: number) => {
    const t = byId.get(id);
    return t ? `${t.wins}-${t.losses}-${t.ties}` : "";
  };

  const isHome = mine.homeId === teamId;
  const you = isHome ? mine.home : mine.away;
  const opp = isHome ? mine.away : mine.home;
  const oppId = isHome ? mine.awayId : mine.homeId;
  const youAcq = isHome ? mine.homeAcq : mine.awayAcq;
  const oppAcq = isHome ? mine.awayAcq : mine.homeAcq;

  const score = tally(league, you, opp);
  const oppScore = { win: score.loss, loss: score.win, tie: score.tie };
  const label = periodLabel(league, period);

  const linesFor = (id: number) => box?.periods[String(period)]?.[String(id)] ?? [];
  const gp = (id: number) => linesFor(id).reduce((a, l) => a + (l.gp || 0), 0);

  const matchup = (
    <>
      {/*
        Every matchup in the league that week — the strip ESPN puts above the box score,
        so a week reads as a league event rather than just your own game.

        Each card SELECTS its game: the whole page below re-renders for whichever one is
        showing. Links carrying `?game=`, not client state, so the choice survives a
        reload and is shareable, and so the panels stay server-rendered — the alternative
        was shipping every game's box tables to the browser to switch between them.
      */}
      <div className="rc-strip">
        {result.games.map((g) => {
          const home = tally(league, g.home, g.away);
          const shown = g.homeId === teamId || g.awayId === teamId;
          const yours = g.homeId === myTeamId || g.awayId === myTeamId;
          return (
            <Link
              href={`/scoreboard?period=${period}&game=${g.homeId}`}
              scroll={false}
              aria-current={shown ? "true" : undefined}
              className={`rc-game ${shown ? "rc-game-on" : ""} ${yours ? "rc-game-you" : ""}`}
              key={g.homeId}
            >
              <RcSide
                name={name(g.homeId)}
                score={`${home.win}-${home.loss}-${home.tie}`}
                won={home.win > home.loss}
              />
              <RcSide
                name={name(g.awayId)}
                score={`${home.loss}-${home.win}-${home.tie}`}
                won={home.loss > home.win}
              />
            </Link>
          );
        })}
      </div>

      {/* The head-to-head, in the app's own board rather than a copy of ESPN's chrome.
          Board, acquisition/GP line and category sheet share ONE panel on desktop — see
          the note in Scoreboard.tsx. */}
      <div className="sb-panel">
      <div className="board">
        <div className="board-side">
          <span className="board-team board-you">{name(teamId)}</span>
          <span className="rc-meta">{record(teamId)}</span>
        </div>
        <div className={`board-score ${score.win >= score.loss ? "sb-win" : "sb-lose"}`}>
          {score.win}
        </div>
        <div className="board-center">
          <span className="board-status">Final</span>
          {score.tie > 0 && (
            <span className="board-ties">
              {score.tie} {score.tie === 1 ? "tie" : "ties"}
            </span>
          )}
        </div>
        <div className={`board-score ${oppScore.win >= oppScore.loss ? "sb-win" : "sb-lose"}`}>
          {score.loss}
        </div>
        <div className="board-side board-side-right">
          <span className="board-team board-opp">{name(oppId)}</span>
          <span className="rc-meta">{record(oppId)}</span>
        </div>
      </div>

      {/* Directly under the board: these are per-side facts about the same scoreline,
          so they belong with it rather than after the category detail. */}
      <AcquisitionLine
        youName={name(teamId)}
        oppName={name(oppId)}
        youAcq={youAcq}
        oppAcq={oppAcq}
        youGp={gp(teamId)}
        oppGp={gp(oppId)}
      />

      <CategorySheet
        league={league}
        youName={name(teamId)}
        oppName={name(oppId)}
        youVec={you}
        oppVec={opp}
      />
      </div>

      <p className="caption">Final totals for {label}. A shaded cell is a category won.</p>
    </>
  );

  const lines = (id: number) => box?.periods[String(period)]?.[String(id)] ?? [];

  return {
    oppId,
    matchup,
    mine: (
      <PlayerBoxTable
        title={`${name(teamId)} box score`}
        stats={box?.stats ?? league.stats}
        lines={lines(teamId)}
      />
    ),
    opp: (
      <PlayerBoxTable
        title={`${name(oppId)} box score`}
        stats={box?.stats ?? league.stats}
        lines={lines(oppId)}
      />
    ),
  };
}

function RcSide({ name, score, won }: { name: string; score: string; won: boolean }) {
  return (
    <div className={`rc-row ${won ? "rc-row-won" : ""}`}>
      <span className="rc-name">{name}</span>
      <span className="rc-score mono">{score}</span>
    </div>
  );
}
