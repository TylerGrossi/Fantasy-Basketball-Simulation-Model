import { notFound } from "next/navigation";
import SectionIndex, { type IndexStat } from "@/components/SectionIndex";
import { careerPlayers, careerTotals, headToHead, managerTable } from "@/lib/career";
import { categoryRecord, periodLabel, scoreboardRows, winProbability } from "@/lib/league";
import { loadCareer, loadLeague, myTeam, resolveMatchup } from "@/lib/loadLeague";
import { livePhase } from "@/lib/matchupPhase";
import { INDEXED_SECTIONS, navFor, type SectionKey } from "@/lib/nav";

/**
 * A section's index — the screen This Week / Season / Tools open on a phone.
 *
 * One route for all three, because they differ only in their page list and their figures;
 * three near-identical files would drift. Home and Agent have no index (see
 * INDEXED_SECTIONS in lib/nav.ts), so `/browse/home` 404s rather than rendering an index
 * of one item.
 *
 * PURE SERVER COMPONENT. It hands `SectionIndex` strings that are already formatted, so
 * none of the league object reaches the client payload — the reason every figure here is
 * computed rather than passed down. See the trimLeague note in lib/loadLeague.ts.
 *
 * The figures are the point of the whole pattern: a row that says "Rankings · #1 of 10"
 * has answered the question most visits were going to ask. Where a page needs an input
 * before it can say anything (Compare, Trade, Player Card), the figure is deliberately
 * ABSENT rather than filled with something true but pointless like the pool size.
 */

export function generateStaticParams() {
  return INDEXED_SECTIONS.map((section) => ({ section }));
}

export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!(INDEXED_SECTIONS as readonly string[]).includes(section)) notFound();
  const key = section as SectionKey;

  const league = await loadLeague();
  const me = await myTeam(league);
  const { sections } = navFor(league.seasonOver);
  const s = sections.find((x) => x.key === key);
  if (!s) notFound();

  const stats =
    key === "week"
      ? weekStats(league, me.id)
      : key === "season"
        ? seasonStats(league, me.id)
        : key === "more"
          ? await moreStats()
          : toolStats(league);

  return (
    <SectionIndex
      title={s.label}
      caption={captionFor(key, league)}
      pages={s.pages}
      stats={stats}
    />
  );
}

type League = Awaited<ReturnType<typeof loadLeague>>;
type Stats = Record<string, IndexStat | undefined>;

/**
 * League and season on every index, so the three headers read the same way.
 *
 * Only This Week departs, and only in its second half: on that screen the period is the
 * scope of everything below it, and it changes week to week, so it earns the slot the year
 * takes elsewhere. Tools used to show a pool count there, which was a fact about the data
 * rather than a heading, and made one of the three headers look unlike its siblings.
 */
function captionFor(key: SectionKey, league: League): string {
  const name = league.leagueName?.trim() || "Your league";
  const year = `${league.season - 1}–${String(league.season).slice(2)}`;
  if (key === "week") return `${name} · ${periodLabel(league)}`;
  // "More" spans every league you have played in, so the current one's name would be
  // wrong on five of its seven rows.
  if (key === "more") return "Agent, settings and your career history";
  return `${name} · ${year}`;
}

/* -------------------------------------------------------------------------- */
/* This Week                                                                   */
/* -------------------------------------------------------------------------- */

function weekStats(league: League, teamId: number): Stats {
  const r = resolveMatchup(league, teamId);
  if (!r) return {};
  const you = r.isHome ? r.matchup.home : r.matchup.away;
  const opp = r.isHome ? r.matchup.away : r.matchup.home;

  const rec = categoryRecord(scoreboardRows(league, you.current, opp.current));
  const phase = livePhase(r.matchup);
  const score = rec.tie ? `${rec.win}–${rec.loss}–${rec.tie}` : `${rec.win}–${rec.loss}`;

  /*
   * The Matchup row shows the MODEL, and the model has nothing left to say once the week
   * is played — it would read 100% for a result the Scoreboard row above it already
   * states, which is the "a probability is not an outcome" trap in miniature. Once the
   * week is final it names the result instead, and the probability comes back on its own
   * the moment there are games left to project.
   */
  const matchupStat: IndexStat =
    phase === "post"
      ? { value: rec.win > rec.loss ? "Won" : rec.win < rec.loss ? "Lost" : "Tied", tone: rec.win > rec.loss ? "good" : rec.win < rec.loss ? "bad" : "plain", note: "final" }
      : {
          value: `${Math.round(
            winProbability(league, you, opp, you.current, opp.current).win * 100
          )}%`,
          tone: "plain",
          note: "to win",
        };

  const withGames = you.players.filter((p) => p.gamesLeft > 0).length;

  return {
    "/scoreboard": {
      value: score,
      tone: rec.win > rec.loss ? "good" : rec.win < rec.loss ? "bad" : "plain",
      note: "categories",
    },
    "/matchup": matchupStat,
    "/streamers": {
      value: String(league.freeAgents.length),
      note: "free agents",
    },
    "/bench": {
      value: String(withGames),
      note: withGames === 1 ? "player has games" : "players have games",
    },
    "/roster": { value: String(you.players.length), note: "players" },
  };
}

/* -------------------------------------------------------------------------- */
/* Season                                                                      */
/* -------------------------------------------------------------------------- */

function seasonStats(league: League, teamId: number): Stats {
  const sd = league.seasonData;
  const out: Stats = {};

  const mine = sd.standings?.find((t) => t.teamId === teamId);
  if (mine) {
    const place = mine.finalStanding || mine.standing;
    out["/season"] = { value: ordinal(place), tone: place === 1 ? "good" : "plain", note: `of ${sd.standings?.length ?? 0}` };
    out["/schedule"] = {
      value: `${mine.wins}–${mine.losses}${mine.ties ? `–${mine.ties}` : ""}`,
      note: "category record",
    };
  }

  const pool = sd.playerPool ?? [];
  if (pool.length) out["/season-stats"] = { value: String(pool.length), note: "players" };
  if (league.teams.length) out["/league-stats"] = { value: String(league.teams.length), note: "teams" };

  const rank = sd.powerRankings?.teams.find((t) => t.teamId === teamId);
  if (rank) {
    out["/rankings"] = {
      value: `#${rank.rank}`,
      tone: rank.rank === 1 ? "good" : "plain",
      // The movement is the interesting half of a rank, and the row has space for it.
      note: rank.delta === 0 ? "no change" : `${rank.delta > 0 ? "+" : ""}${rank.delta} this week`,
    };
  }

  /*
   * Counted by MATCHING A TEAM, not by excluding the free-agent marker.
   *
   * PoolPlayer documents that marker as `""` or `"Waivers"`; this league's export writes
   * `"FA"`, so a denylist counted all 289 pool players as rostered and the row read "289
   * rostered" under ten teams of thirteen. Same shape as the `acquisitionType` trap in
   * AGENTS.md — an unrecognised code has to fail visibly, not pass through. An allowlist
   * of the team names in this very export cannot go wrong when ESPN invents a new one.
   */
  const teamNames = new Set(league.teams.map((t) => t.name.trim()));
  const rostered = pool.filter((p) => teamNames.has(p.owner?.trim() ?? "")).length;
  if (rostered) out["/league-rosters"] = { value: String(rostered), note: "rostered" };

  const moves = sd.recentMoves ?? [];
  if (moves.length) out["/recent-moves"] = { value: String(moves.length), note: "this season" };

  return out;
}

/* -------------------------------------------------------------------------- */
/* More                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Agent and Settings carry no figure — neither is a page you open to read a number.
 *
 * The History rows do, and they read their own file, which is built by a separate script
 * and may not exist. Every row is written from a successful read or not at all: a missing
 * career.json leaves them blank rather than printing zeros, which would read as "you have
 * never played" instead of "this has not been generated".
 */
async function moreStats(): Promise<Stats> {
  const career = await loadCareer();
  if (!career) return {};
  const totals = careerTotals(career);
  return {
    "/history": {
      value: String(totals.seasons),
      note: totals.titles ? `${totals.titles} title${totals.titles > 1 ? "s" : ""}` : "seasons",
    },
    "/history/players": { value: String(careerPlayers(career).length), note: "players" },
    "/history/head-to-head": { value: String(headToHead(career).length), note: "opponents" },
    "/history/managers": { value: String(managerTable(career).length), note: "managers" },
    "/history/matchups": {
      value: String(career.seasons.reduce((a, s) => a + (s.matchups?.length ?? 0), 0)),
      note: "weeks played",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Tools                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Tools is mostly figure-free ON PURPOSE. Six of these eight take a player, a trade or a
 * lineup before they have a number, and filling the column with the same pool size six
 * times would make the one row that does carry a real figure invisible.
 */
function toolStats(league: League): Stats {
  const out: Stats = {};
  /*
   * Player Value's pool size used to sit here. It was the only figure in the section, so
   * instead of reading as a preview it read as a stray number against five otherwise
   * clean rows — and "289 rated" is a fact about the dataset, not an answer to anything
   * you opened the page to ask. Tools is figure-free.
   */
  const odds = league.seasonData.playoffOdds ?? [];
  const alive = odds.filter((o) => o.championshipProb > 0).length;
  if (alive) out["/playoffs"] = { value: String(alive), note: "still alive" };
  return out;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
