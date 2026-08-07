"use client";

import { useEffect, useState } from "react";
import { fetchGameLog, isAllStar, isRegularSeason } from "@/lib/gamelog";

/**
 * "Injuries & missed games" — what a player's availability actually cost, fetched from
 * ESPN on open (same lazy + cache pattern as GameLog).
 *
 * WHAT ESPN GIVES AND WHAT IT DOESN'T. There is no injury-history endpoint: the athlete
 * record carries at most ONE injury, the current one, with its diagnosis (type, side,
 * detail, expected return). A past injury and its diagnosis are simply not published —
 * verified across every injured player in this league's pool, all of whom return either
 * zero or one entry.
 *
 * So the missed games are DERIVED rather than reported: every regular-season game his
 * team played that he does not appear in is an absence, and consecutive absences are
 * grouped into one stint. That number is solid — it comes from two authoritative lists —
 * but the CAUSE of a past stint is not knowable here, and the UI says so rather than
 * implying every absence was the injury named at the top. Rest, suspension and coach's
 * decision all look identical from the outside.
 */

interface Injury {
  type: string;
  side: string;
  detail: string;
  status: string;
  returnDate: string;
}

interface Stint {
  start: string;
  end: string;
  games: number;
  /** "DAL @ UTAH" style labels, for the tooltip on a multi-game stint. */
  opponents: string[];
}

interface Report {
  played: number;
  total: number;
  stints: Stint[];
  injury: Injury | null;
}

const CACHE = new Map<string, Report>();

const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url.replace(/^http:/, "https:"));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The current injury, if ESPN has one on file. */
async function currentInjury(playerId: number, season: number): Promise<Injury | null> {
  try {
    const athlete = await json<{ injuries?: Array<{ $ref: string }> }>(
      `${CORE}/seasons/${season}/athletes/${playerId}`
    );
    const ref = athlete.injuries?.[0]?.$ref;
    if (!ref) return null;
    const inj = await json<{
      status?: string;
      details?: {
        type?: string;
        side?: string;
        detail?: string;
        returnDate?: string;
      };
    }>(ref);
    const d = inj.details ?? {};
    // Only the STRUCTURED fields. The record also carries `shortComment`/`longComment`,
    // which are Rotowire news blurbs that frequently have nothing to do with the injury
    // — Anthony Davis's finger sprain came with a sentence about the Wizards' draft pick.
    // Printing that under an injury heading states something ESPN never claimed.
    return {
      type: d.type ?? "",
      side: d.side ?? "",
      detail: d.detail ?? "",
      status: inj.status ?? "",
      returnDate: d.returnDate ?? "",
    };
  } catch {
    return null;
  }
}

/** One unbroken run of games the player spent at a single club. */
interface Stay {
  teamId: string;
  /** ISO dates. Half-open: `from` inclusive, `to` exclusive. */
  from: string;
  to: string;
}

/**
 * The clubs a player passed through, as date windows, from his own appearances.
 *
 * A traded player is on the hook only for the games of the team he was AT that night.
 * Merging both clubs' schedules by event id — the previous approach — deduplicates
 * nothing except the one game the two teams played each other, so a mid-season trade
 * reported 162 team games and ~114 "missed", which is both wrong and alarming.
 *
 * The boundary is his first appearance for the new club: everything before it is charged
 * to the old one. That misplaces only the handful of games between a trade and his debut,
 * and it errs the right way — those genuinely were games he was unavailable for someone.
 *
 * Consecutive runs are grouped rather than assuming one move, so a player who goes A → B →
 * A (a 10-day deal, a buyout return) still gets three correct windows.
 */
function staysFrom(appearances: Array<{ date: string; teamId: string }>): Stay[] {
  const sorted = [...appearances].sort((a, b) => a.date.localeCompare(b.date));
  const stays: Stay[] = [];
  for (const a of sorted) {
    const last = stays[stays.length - 1];
    if (last && last.teamId === a.teamId) last.to = a.date;
    else stays.push({ teamId: a.teamId, from: a.date, to: a.date });
  }
  if (!stays.length) return stays;
  // Widen to cover the whole season: the first club owns everything before his debut (he
  // may have been hurt in October), the last owns everything after his final game, and
  // each handover falls on the new club's first appearance.
  for (let i = 1; i < stays.length; i++) stays[i - 1].to = stays[i].from;
  stays[0].from = "";
  stays[stays.length - 1].to = "￿";
  return stays;
}

/**
 * Games played vs games his team played, grouped into stints.
 *
 * "His team" is resolved per game — see `staysFrom`.
 */
async function missedGames(
  playerId: number,
  season: number
): Promise<{ played: number; total: number; stints: Stint[] }> {
  // Shared with the game-log table and the rolling-value chart — one request, not three.
  const log = await fetchGameLog(playerId);

  const meta = log.events ?? {};
  const played = new Set<string>();
  const appearances: Array<{ date: string; teamId: string }> = [];
  for (const st of log.seasonTypes ?? []) {
    // Preseason, play-in and postseason are not the fantasy season; the regular season is.
    // `isRegularSeason` also rejects ESPN's "Play In Regular Season", which the old
    // substring test here let through.
    if (!isRegularSeason(st.displayName ?? "")) continue;
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        const m = meta[ev.eventId];
        // ESPN files the ALL-STAR GAME under the regular season, with "WORLD" as the
        // player's team. Left in, it both inflates games played and pulls in a fake
        // team's schedule — which is how a Feb 15 "WORLD @ STRIPES" turned up as a
        // missed Denver game.
        if (isAllStar(log, ev.eventId)) continue;
        played.add(ev.eventId);
        if (m?.team?.id && m.gameDate) {
          appearances.push({ date: m.gameDate, teamId: m.team.id });
        }
      }
    }
  }

  const stays = staysFrom(appearances);
  if (!stays.length) return { played: played.size, total: 0, stints: [] };

  const teamIds = [...new Set(stays.map((s) => s.teamId))];
  const games = new Map<string, { date: string; name: string }>();
  await Promise.all(
    teamIds.map(async (teamId) => {
      const sched = await json<{
        events?: Array<{
          id: string;
          date: string;
          shortName?: string;
          competitions?: Array<{ status?: { type?: { completed?: boolean } } }>;
        }>;
      }>(`${SITE}/teams/${teamId}/schedule?season=${season}&seasontype=2`);
      const windows = stays.filter((s) => s.teamId === teamId);
      for (const e of sched.events ?? []) {
        // COMPLETED games only. A game not yet played cannot have been missed, and the
        // feed also keeps the original date of a POSTPONED game alongside its makeup —
        // which is why every team's schedule reads 83 games instead of 82.
        if (!e.competitions?.[0]?.status?.type?.completed) continue;
        // Only while he was actually at this club.
        if (!windows.some((w) => e.date >= w.from && e.date < w.to)) continue;
        games.set(e.id, { date: e.date, name: e.shortName ?? "" });
      }
    })
  );

  const ordered = [...games.entries()].sort((a, b) =>
    a[1].date.localeCompare(b[1].date)
  );
  const stints: Stint[] = [];
  let open: Stint | null = null;
  for (const [id, g] of ordered) {
    if (played.has(id)) {
      if (open) stints.push(open);
      open = null;
    } else if (open) {
      open.games += 1;
      open.end = g.date;
      open.opponents.push(g.name);
    } else {
      open = { start: g.date, end: g.date, games: 1, opponents: [g.name] };
    }
  }
  if (open) stints.push(open);

  return { played: played.size, total: ordered.length, stints };
}

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(+d)
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default function InjuryLog({
  playerId,
  season,
}: {
  playerId: number | null;
  season: number;
}) {
  const key = `${playerId}-${season}`;
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [report, setReport] = useState<Report | null>(null);

  /*
   * Loads on mount rather than on open — the section is always visible now, so there is
   * no "open" to hang it off. Still one request per player per session: the cache is keyed
   * by player and season, and the game log underneath is shared with the other two
   * sections through `lib/gamelog`.
   */
  useEffect(() => {
    if (!playerId) {
      setReport(null);
      setState("idle");
      return;
    }
    const hit = CACHE.get(key);
    if (hit) {
      setReport(hit);
      setState("done");
      return;
    }
    let live = true;
    setState("loading");
    setReport(null);
    // The diagnosis and the absences come from different APIs; one failing should not take
    // out the other, so they settle independently.
    Promise.all([
      currentInjury(playerId, season),
      missedGames(playerId, season).catch(() => ({
        played: 0,
        total: 0,
        stints: [] as Stint[],
      })),
    ])
      .then(([injury, missed]) => {
        const next: Report = { ...missed, injury };
        CACHE.set(key, next);
        // The card may have moved to another player while this was in flight.
        if (!live) return;
        setReport(next);
        setState("done");
      })
      .catch(() => {
        if (live) setState("error");
      });
    return () => {
      live = false;
    };
  }, [playerId, season, key]);

  if (!playerId) return null;

  const missedTotal = report?.stints.reduce((a, s) => a + s.games, 0) ?? 0;

  return (
    <section className="pd-sheet">
      <div className="pd-sheet-h">
        <h2>Availability</h2>
        {report && report.total > 0 && (
          <span className="pd-sheet-n">
            {report.played} of {report.total} team games
          </span>
        )}
      </div>
      <div>
        {state === "loading" && <p className="pd-sheet-note">Loading…</p>}
        {state === "error" && (
          <p className="pd-sheet-note">Injury data unavailable right now.</p>
        )}
        {state === "done" && report && (
          <>
            {report.injury ? (
              <div className="inj-current">
                <div className="inj-head">
                  <span className="inj-what">
                    {[report.injury.type, report.injury.side, report.injury.detail]
                      .filter(Boolean)
                      .join(" · ") || "Injury"}
                  </span>
                  {report.injury.status && (
                    <span className="inj-status">{report.injury.status}</span>
                  )}
                  {report.injury.returnDate && (
                    <span className="inj-return">
                      est. return {day(report.injury.returnDate)}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="inj-comment">No injury on file with ESPN right now.</p>
            )}

            {report.total > 0 ? (
              <>
                <div className="inj-summary">
                  Played <strong>{report.played}</strong> of{" "}
                  <strong>{report.total}</strong> team games ·{" "}
                  <strong>{missedTotal}</strong> missed across{" "}
                  <strong>{report.stints.length}</strong>{" "}
                  {report.stints.length === 1 ? "absence" : "absences"}
                </div>
                {report.stints.length > 0 && (
                  <table className="sheet sheet-tight inj-tbl">
                    <thead>
                      <tr>
                        <th>Out</th>
                        <th>Games</th>
                        <th>Missed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.stints.map((s) => (
                        <tr key={s.start}>
                          <td>
                            {day(s.start)}
                            {s.end !== s.start ? ` – ${day(s.end)}` : ""}
                          </td>
                          <td>{s.games}</td>
                          <td title={s.opponents.join(", ")}>
                            {s.opponents.slice(0, 3).join(", ")}
                            {s.opponents.length > 3 ? ` +${s.opponents.length - 3}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {/* Say what the numbers are, and are not. */}
                <p className="inj-note">
                  Absences are every regular-season game his team played that he did not
                  appear in. ESPN publishes a diagnosis only for the <em>current</em>{" "}
                  injury, so earlier stints are shown without a cause — rest and coach&rsquo;s
                  decisions look the same as injuries from the outside.
                </p>
              </>
            ) : (
              <p className="inj-note">No regular-season game log for this player.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
