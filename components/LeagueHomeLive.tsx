"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  categoryRecord,
  scoreboardRows,
  winProbability,
  type LeagueData,
  winPctText,
} from "@/lib/league";
import { remainingSide } from "@/lib/liveAdjust";
import type { MatchupOutcome } from "@/lib/probability";
import { useLiveTotals } from "@/lib/useLiveTotals";

/**
 * League Home's LIVE pieces (2026-10-20): the scores card, the "This week vs" box and
 * Your Matchup by Category. Each used to read the twice-daily export; now all three
 * read ESPN's live totals for EVERY matchup (the `games` the live route returns), with
 * the same correction as Current Matchup — games ESPN already counts come out of the
 * projection (lib/liveAdjust.ts) — so records and win chances move as games are played.
 *
 * All three share one poller (lib/useLiveTotals): one request for the whole page — and
 * ONE computation of every matchup's record and odds, done in `LiveMatchupsProvider` and
 * read by each of them, rather than each recomputing all four matchups on every update.
 */

interface LiveLine {
  homeId: number;
  awayId: number;
  /** Category record from the HOME side: [won, lost, tied]. */
  home: [number, number, number];
  /** P(home wins the week), ties split. */
  /** Each side's chance to win outright — the same `.win` Current Matchup shows. */
  homeWin: number;
  awayWin: number;
}

function useLiveMatchups(league: LeagueData, meId: number) {
  const mine = league.matchups.find((m) => m.homeId === meId || m.awayId === meId);
  const meHome = mine?.homeId === meId;
  const live = useLiveTotals(
    league.period,
    meId,
    (meHome ? mine?.home.current : mine?.away.current) ?? [],
    (meHome ? mine?.away.current : mine?.home.current) ?? [],
    !!mine
  );

  return useMemo(() => {
    const byPair = new Map((live.games ?? []).map((g) => [`${g.homeId}-${g.awayId}`, g]));
    let myOutcome: MatchupOutcome | null = null;
    let myOppId: number | null = null;
    const lines: LiveLine[] = league.matchups.map((m) => {
      const g = byPair.get(`${m.homeId}-${m.awayId}`);
      const homeVec = g?.home ?? m.home.current;
      const awayVec = g?.away ?? m.away.current;
      // Without this matchup's live totals the snapshot's stand in, and they count none
      // of the games played since the export — so nothing comes out of the projection.
      const gl = g ? live.gameLeft : null;
      const home = remainingSide(league, m.home, g?.homePlayedToday ?? null, gl);
      const away = remainingSide(league, m.away, g?.awayPlayedToday ?? null, gl);
      const rec = categoryRecord(scoreboardRows(league, homeVec, awayVec));
      const p = winProbability(league, home, away, homeVec, awayVec);
      if (m.homeId === meId || m.awayId === meId) {
        const isHome = m.homeId === meId;
        myOppId = isHome ? m.awayId : m.homeId;
        myOutcome = isHome ? p : winProbability(league, away, home, awayVec, homeVec);
      }
      return {
        homeId: m.homeId,
        awayId: m.awayId,
        home: [rec.win, rec.loss, rec.tie],
        homeWin: p.win,
        awayWin: p.loss,
      };
    });
    return { lines, myOutcome: myOutcome as MatchupOutcome | null, myOppId: myOppId as number | null };
  }, [league, meId, live.games, live.gameLeft]);
}

type LiveMatchups = ReturnType<typeof useLiveMatchups>;
const LiveMatchupsContext = createContext<LiveMatchups | null>(null);

/**
 * Computes the live matchups ONCE for everything inside it. League Home wraps its grid in
 * this; LiveMyWeek, LiveScoresCard and LiveCategoryEdge read the result.
 */
export function LiveMatchupsProvider({
  league,
  meId,
  children,
}: {
  league: LeagueData;
  meId: number;
  children: ReactNode;
}) {
  const value = useLiveMatchups(league, meId);
  return <LiveMatchupsContext.Provider value={value}>{children}</LiveMatchupsContext.Provider>;
}

function useSharedMatchups(): LiveMatchups {
  const value = useContext(LiveMatchupsContext);
  if (!value) throw new Error("League Home live components need a LiveMatchupsProvider");
  return value;
}

/** The same matchup seen from `teamId`'s side. */
function sideOf(s: LiveLine, teamId: number) {
  const isHome = s.homeId === teamId;
  const [w, l, t] = s.home;
  return {
    oppId: isHome ? s.awayId : s.homeId,
    rec: isHome ? `${w}-${l}-${t}` : `${l}-${w}-${t}`,
    win: isHome ? s.homeWin : s.awayWin,
  };
}

const pct = winPctText;

/** My Team's "This week vs …" box. */
export function LiveMyWeek({
  league,
  meId,
  teamNames,
}: {
  league: LeagueData;
  meId: number;
  teamNames: Record<number, string>;
}) {
  const { lines } = useSharedMatchups();
  const s = lines.find((l) => l.homeId === meId || l.awayId === meId);
  if (!s) return null;
  const side = sideOf(s, meId);
  return (
    <Link href="/scoreboard" className="lh-me-week">
      <span className="lh-me-week-l">This week vs {teamNames[side.oppId]}</span>
      <span className="lh-me-week-r">
        <b className="mono">{side.rec}</b>
        <span className="lh-me-win mono">{pct(side.win)} to win</span>
      </span>
    </Link>
  );
}

/** Every matchup this week: category record and each side's chance to win. */
export function LiveScoresCard({
  league,
  meId,
  teamNames,
  label,
}: {
  league: LeagueData;
  meId: number;
  teamNames: Record<number, string>;
  label: string;
}) {
  const { lines } = useSharedMatchups();
  return (
    <section className="lh-card">
      <h2 className="lh-h">
        Scores <span className="lh-h-note">{label}</span>
      </h2>
      {lines.length === 0 ? (
        <p className="caption">No matchups this week.</p>
      ) : (
        <div className="lh-scores">
          {lines.map((s) => (
            <div
              className={`lh-game${s.homeId === meId || s.awayId === meId ? " lh-game-you" : ""}`}
              key={`${s.homeId}-${s.awayId}`}
            >
              {[s.homeId, s.awayId].map((id) => {
                const side = sideOf(s, id);
                return (
                  <div className="lh-game-row" key={id}>
                    <span className={`lh-game-team${id === meId ? " you" : ""}`}>
                      {teamNames[id]}
                    </span>
                    <span className="lh-game-win mono">{pct(side.win)}</span>
                    <span className="lh-game-rec mono">{side.rec}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <Link href="/scoreboard" className="lh-more">
        Full scoreboard
      </Link>
    </section>
  );
}

/**
 * Your matchup, one row per category: the model's chance you take it, from live totals
 * plus the rest of the week's projection.
 */
export function LiveCategoryEdge({
  league,
  meId,
  teamNames,
}: {
  league: LeagueData;
  meId: number;
  teamNames: Record<number, string>;
}) {
  const { myOutcome: out, myOppId } = useSharedMatchups();
  if (!out || myOppId == null) return null;
  return (
    <section className="lh-card">
      <h2 className="lh-h">
        Your Matchup by Category{" "}
        <span className="lh-h-note">
          vs {teamNames[myOppId] ?? "Opponent"} · {out.expectedCats.toFixed(1)} cats expected
        </span>
      </h2>
      <div className="lh-edge">
        {league.categories.map((cat, i) => {
          const p = out.categoryProbs[i] ?? 0.5;
          const tone = p >= 0.6 ? "up" : p <= 0.4 ? "dn" : "even";
          return (
            <div className="lh-edge-row" key={cat}>
              <span className="lh-edge-cat">{cat}</span>
              {/* Your share of the track in cobalt, theirs in clay — the app's you/them pair. */}
              <span className="lh-edge-track" aria-hidden="true">
                {/* Rounded: an unrounded float in an inline style serialises differently
                    on the server and in the browser (a hydration mismatch). */}
                <span className="lh-edge-you" style={{ width: `${(p * 100).toFixed(2)}%` }} />
              </span>
              <span className={`lh-edge-p mono ${tone}`}>{pct(p)}</span>
            </div>
          );
        })}
      </div>
      <Link href="/scoreboard#odds" className="lh-more">
        Full matchup model
      </Link>
    </section>
  );
}
