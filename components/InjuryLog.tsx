"use client";

import { useState } from "react";

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
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";

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

/**
 * Games played vs games his team played, grouped into stints.
 *
 * Schedules are pulled for every team he appeared for, and merged BY EVENT ID — a player
 * traded mid-season otherwise gets both clubs' full schedules counted against him, and a
 * game between his old and new team would count twice.
 */
async function missedGames(
  playerId: number,
  season: number
): Promise<{ played: number; total: number; stints: Stint[] }> {
  const log = await json<{
    events?: Record<string, { team?: { id?: string; isAllStar?: boolean } }>;
    seasonTypes?: Array<{
      displayName?: string;
      categories?: Array<{ events?: Array<{ eventId: string }> }>;
    }>;
  }>(`${WEB}/athletes/${playerId}/gamelog`);

  const meta = log.events ?? {};
  const played = new Set<string>();
  const teamIds = new Set<string>();
  for (const st of log.seasonTypes ?? []) {
    // Preseason and postseason are not the fantasy season; the regular season is.
    if (!/Regular Season/i.test(st.displayName ?? "")) continue;
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        const team = meta[ev.eventId]?.team;
        // ESPN files the ALL-STAR GAME under the regular season, with "WORLD" as the
        // player's team. Left in, it both inflates games played and pulls in a fake
        // team's schedule — which is how a Feb 15 "WORLD @ STRIPES" turned up as a
        // missed Denver game.
        if (team?.isAllStar) continue;
        played.add(ev.eventId);
        if (team?.id) teamIds.add(team.id);
      }
    }
  }
  if (!teamIds.size) return { played: played.size, total: 0, stints: [] };

  const games = new Map<string, { date: string; name: string }>();
  await Promise.all(
    [...teamIds].map(async (teamId) => {
      const sched = await json<{
        events?: Array<{
          id: string;
          date: string;
          shortName?: string;
          competitions?: Array<{ status?: { type?: { completed?: boolean } } }>;
        }>;
      }>(`${SITE}/teams/${teamId}/schedule?season=${season}&seasontype=2`);
      for (const e of sched.events ?? []) {
        // COMPLETED games only. A game not yet played cannot have been missed, and the
        // feed also keeps the original date of a POSTPONED game alongside its makeup —
        // which is why every team's schedule reads 83 games instead of 82.
        if (!e.competitions?.[0]?.status?.type?.completed) continue;
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
  const cached = playerId ? CACHE.get(key) : undefined;
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    cached ? "done" : "idle"
  );
  const [report, setReport] = useState<Report | null>(cached ?? null);

  if (!playerId) return null;

  const load = async () => {
    if (state !== "idle") return;
    setState("loading");
    try {
      // The diagnosis and the absences come from different APIs; one failing should not
      // take out the other, so they settle independently.
      const [injury, missed] = await Promise.all([
        currentInjury(playerId, season),
        missedGames(playerId, season).catch(() => ({
          played: 0,
          total: 0,
          stints: [] as Stint[],
        })),
      ]);
      const next: Report = { ...missed, injury };
      CACHE.set(key, next);
      setReport(next);
      setState("done");
    } catch {
      setState("error");
    }
  };

  const missedTotal = report?.stints.reduce((a, s) => a + s.games, 0) ?? 0;

  return (
    <details className="pv-gl" onToggle={(e) => e.currentTarget.open && load()}>
      <summary className="pv-gl-sum">Injuries &amp; missed games</summary>
      <div className="pv-gl-body">
        {state === "loading" && <span className="caption">Loading…</span>}
        {state === "error" && (
          <span className="caption">Injury data unavailable right now.</span>
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
                  <table className="pv-gl-tbl inj-tbl">
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
    </details>
  );
}
