"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildLineup, type DraftLeague, type LiveDraft } from "@/lib/draft";
import { gradeTeams, letterFor, type MockState } from "@/lib/mockDraft";
import { scoreProjections, type DraftRow, type ProjectedLine } from "@/lib/projection";
import { HIGHLIGHT_MAX_ROUND, roundWeight, type SeasonResult } from "@/lib/seasonSim";

/**
 * The Recap tab: who won the draft.
 *
 * Graded NEUTRALLY — the league's own categories, equal weights, no punts — because this
 * judges every team, not the owner's build. Two lenses:
 *   - Projected category all-play: each team's per-category z totals against every other
 *     team's, the way a category week is decided. This is the "who won" number.
 *   - Value vs ADP: picks gained (positive) or lost against ESPN's ADP — who drafted well
 *     against the room, whatever their build.
 *
 * Source: the real draft once ESPN publishes it. ESPN's league API returns NO picks while a
 * draft is live (learned on draft night), so until then the tab can preview the latest
 * mock, clearly labelled.
 */

type Source = "live" | "mock";

/**
 * How much a pick counts, by round (owner, 2026-10-19: "lower picks are likely to be
 * dropped"). Flat through round 2, then about -0.075 a round, floored at 0.25 — a
 * round-13 pick counts a quarter as much as a first-rounder. Applied to category totals,
 * projected value and the ADP score alike.
 */
/**
 * Best pick / biggest reach only consider rounds 1-8 (owner, 2026-10-19: first rounds 1-10,
 * then "not the 70s"). Later picks are fliers that get dropped, so a big ADP gap there
 * says little — a 23-pick "steal" at #101, or Herro at #76.
 */
// HIGHLIGHT_MAX_ROUND (8) lives in lib/seasonSim.ts, shared with lib/draftSeason.ts.

// roundWeight lives in lib/seasonSim.ts (the server-side season route needs it too).

/** A copy of the row with every category z scaled, so gradeTeams sums weighted totals. */
function weighted(r: DraftRow, w: number): DraftRow {
  const z: Record<string, number> = {};
  for (const [c, v] of Object.entries(r.z)) z[c] = v * w;
  return { ...r, z };
}

interface TeamResult {
  id: number;
  name: string;
  mine: boolean;
  picks: { pick: number; round: number; r: DraftRow }[];
  projValue: number;
  adpValue: number;
  steal?: { pick: number; r: DraftRow; d: number };
  reach?: { pick: number; r: DraftRow; d: number };
}

export default function DraftRecap({
  lines,
  league,
  live: liveProp,
  mock,
  myTeamId,
}: {
  lines: ProjectedLine[];
  league: DraftLeague;
  live: LiveDraft | null;
  mock: MockState;
  myTeamId: number | null;
}) {
  // Fetch the feed itself, independent of the board's sync toggle (which the owner may
  // have switched off during the draft, when ESPN's feed was empty).
  const [own, setOwn] = useState<LiveDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/draft", { cache: "no-store" });
      if (r.ok) setOwn((await r.json()) as LiveDraft);
    } catch {
      /* keep what we have */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const live = (own?.picks.length ?? 0) >= (liveProp?.picks.length ?? 0) ? (own ?? liveProp) : liveProp;

  const nTeams = league.teams.length || 8;
  const liveReady = (live?.picks.length ?? 0) > 0;
  // Real draft only (owner, 2026-10-19: no mock preview on the recap).
  const mockReady = false;
  const [pref, setPref] = useState<Source | null>(null);
  // Phone: the ladder is the picker (Season Summary pattern); null = your own team.
  const [sel, setSel] = useState<number | null>(null);
  const source: Source | null = pref ?? (liveReady ? "live" : mockReady ? "mock" : null);

  // Neutral scoring: league categories, no weights, no punts.
  const rows = useMemo(
    () =>
      scoreProjections(lines, {
        categories: league.categories,
        lowerIsBetter: league.lowerIsBetter,
        poolSize: nTeams * (league.rounds || 13),
        rankBy: "total",
      }),
    [lines, league, nTeams]
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.playerId, r])), [rows]);

  const { teams, grades } = useMemo(() => {
    if (!source) return { teams: [] as TeamResult[], grades: [] as ReturnType<typeof gradeTeams> };
    const picks =
      source === "live"
        ? (live?.picks ?? []).map((p) => ({ pick: p.pick, round: p.round, team: p.teamId, playerId: p.playerId }))
        : mock.picks.map((p) => ({ pick: p.pick, round: Math.ceil(p.pick / nTeams), team: p.slot, playerId: p.playerId }));
    const teamList =
      source === "live"
        ? (live?.teams ?? league.teams).map((t) => ({ id: t.id, name: t.name || t.abbrev, mine: t.id === myTeamId }))
        : Array.from({ length: nTeams }, (_, i) => ({
            id: i + 1,
            name: i + 1 === mock.slot ? "You" : `Bot ${i + 1}`,
            mine: i + 1 === mock.slot,
          }));
    const results: TeamResult[] = teamList.map((t) => {
      const mine = picks
        .filter((p) => p.team === t.id)
        .map((p) => ({ pick: p.pick, round: p.round, r: byId.get(p.playerId) }))
        .filter((x): x is { pick: number; round: number; r: DraftRow } => x.r != null);
      // d = pick - ADP: POSITIVE = taken later than the room usually takes him (a steal),
      // negative = earlier (a reach). It was ADP - pick, which inverted the two: Trae Young
      // at #62 with ADP 23 showed as a reach. wd = d weighted by round (what is scored).
      const withD = mine.map((x) => {
        const d = x.r.adp != null ? x.pick - x.r.adp : 0;
        return { ...x, d, wd: d * roundWeight(x.round) };
      });
      const sorted = withD.filter((x) => x.round <= HIGHLIGHT_MAX_ROUND).sort((a, b) => b.wd - a.wd);
      return {
        ...t,
        picks: mine.sort((a, b) => a.pick - b.pick),
        projValue: mine.reduce((a, x) => a + x.r.total * roundWeight(x.round), 0),
        adpValue: withD.reduce((a, x) => a + x.wd, 0),
        steal: sorted[0] && sorted[0].wd > 0 ? sorted[0] : undefined,
        reach: sorted.length && sorted[sorted.length - 1].wd < 0 ? sorted[sorted.length - 1] : undefined,
      };
    });
    // Category totals with each player scaled by his round weight.
    const rosters = new Map(results.map((t) => [t.id, t.picks.map((x) => weighted(x.r, roundWeight(x.round)))]));
    return { teams: results, grades: gradeTeams(rosters, league.categories) };
  }, [source, live, mock, nTeams, league, myTeamId, byId]);

  const gradeOf = new Map(grades.map((g) => [g.slot, g]));

  /*
   * SEASON PROJECTION (owner, 2026-10-19: "I thought this was a projection of the
   * season"). The real 19-week schedule simulated 10,000 times (lib/seasonSim.ts). It
   * decides place, grade, playoff odds and the category heat map. Run after first paint:
   * about a second of work, so the page shows "Simulating" rather than freezing.
   */
  const [season, setSeason] = useState<SeasonResult[] | null>(null);
  useEffect(() => {
    if (!teams.length || !league.schedule?.length) {
      setSeason(null);
      return;
    }
    // Computed ON THE SERVER and cached (app/api/draft/season): 5,000 seasons froze the
    // page for seconds on a laptop and far longer on a phone when it ran here.
    let alive = true;
    fetch("/api/draft/season")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { results?: SeasonResult[] | null } | null) => {
        if (alive) setSeason(j?.results ?? null);
      })
      .catch(() => alive && setSeason(null));
    return () => {
      alive = false;
    };
  }, [teams.length, league.schedule?.length]);

  type Standing = { place: number; pct: number; res: SeasonResult; catRank: Record<string, number> };
  const standOf = useMemo(() => {
    const m = new Map<number, Standing>();
    if (!season) return m;
    const pct = (x: SeasonResult) => (x.catW + x.catT / 2) / Math.max(1, x.catW + x.catL + x.catT);
    const order = [...season].sort((a, b) => pct(b) - pct(a));
    const catRank: Record<number, Record<string, number>> = {};
    for (const c of league.categories) {
      [...season]
        .sort((a, b) => b.catWinPct[c] - a.catWinPct[c])
        .forEach((x, i) => ((catRank[x.team] ??= {})[c] = i + 1));
    }
    order.forEach((x, i) => m.set(x.team, { place: i + 1, pct: pct(x), res: x, catRank: catRank[x.team] ?? {} }));
    return m;
  }, [season, league.categories]);
  // Tolerant of a missing number (e.g. a result from an older model): shows a dash.
  const fmt0 = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(0) : "—");


  const nT = teams.length || nTeams;
  // Ranked by PROJECTED VALUE (owner, 2026-10-19). The season sim's record and playoff
  // odds are shown alongside, but the order, place and grade follow value.
  const valuePlace = new Map(
    [...teams].sort((a, b) => b.projValue - a.projValue).map((t, i) => [t.id, i + 1])
  );
  // Both views are ordered by projected value (owner, 2026-10-19).
  const ranked = [...teams].sort((a, b) => (valuePlace.get(a.id) ?? 99) - (valuePlace.get(b.id) ?? 99));
  const valueRanked = [...teams].sort((a, b) => (valuePlace.get(a.id) ?? 99) - (valuePlace.get(b.id) ?? 99));
  const winner = ranked[0];
  const allPicks = teams.flatMap((t) =>
    t.picks.map((x) => {
      const d = x.r.adp != null ? x.pick - x.r.adp : 0;
      return { ...x, team: t.name, d, wd: d * roundWeight(x.round) };
    })
  );
  const early = allPicks.filter((x) => x.round <= HIGHLIGHT_MAX_ROUND);
  const steals = [...early].sort((a, b) => b.wd - a.wd).slice(0, 5);
  const reaches = [...early].sort((a, b) => a.wd - b.wd).slice(0, 5);

  if (!source) {
    return (
      <section className="dg-recap">
        <p className="dg-note">
          {live?.inProgress
            ? "The draft is under way. ESPN publishes the picks only once it ends, and the recap fills in then."
            : "No draft results yet."}{" "}
        </p>
      </section>
    );
  }

  return (
    <section className="dg-recap">

      {!season && teams.length > 0 && <p className="dg-note">Simulating the season…</p>}
      <div className="only-web">
      {winner && standOf.get(winner.id) && (
        <div className="dg-recap-win">
          <span className="dg-dim">Won the draft</span>
          <strong>{winner.name}</strong>
          <span>
            Grade {letterFor(1, nT)} · projected {fmt0(standOf.get(winner.id)!.res.catW)}-
            {fmt0(standOf.get(winner.id)!.res.catL)} · playoffs {(standOf.get(winner.id)!.res.playoffPct * 100).toFixed(0)}%
          </span>
        </div>
      )}
      </div>

      {/*
        PHONE: the Season Summary pattern. Tiles describe ONE team (yours until you tap
        another); the ladder below is compact, one row per team with a single figure, so
        all eight fit on a screen. Tapping a row re-points the tiles.
      */}
      {(() => {
        const selId = sel ?? valueRanked.find((t) => t.mine)?.id ?? valueRanked[0]?.id;
        const t = valueRanked.find((x) => x.id === selId);
        if (!t) return null;
        const g = standOf.get(t.id);
        const place = valuePlace.get(t.id) ?? nT;
        return (
          <div className="only-app">
            <p className="ss-finish">
              <strong>{t.name}</strong> ranks <strong className="ss-place">{ordinalOf(place)}</strong>{" "}
              &middot; grade {letterFor(place, nT)}
            </p>
            <div className="metrics ss-metrics">
              <Tile label="Proj value" value={t.projValue.toFixed(1)} />
              <Tile label="Playoffs" value={g ? `${(g.res.playoffPct * 100).toFixed(0)}%` : "\u2026"} />
              <Tile label="Best pick" text value={t.steal ? t.steal.r.name : "—"} sub={t.steal ? `#${t.steal.pick} · ADP ${t.steal.r.adp?.toFixed(0)}` : undefined} />
            </div>
            <h2 className="pr-title">Draft rankings</h2>
          </div>
        );
      })()}
      <div className="pr-ladder">
        {valueRanked.map((t) => {
          const selId = sel ?? valueRanked.find((x) => x.mine)?.id ?? valueRanked[0]?.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`pr-row pr-row-btn${t.id === selId ? " pr-you" : ""}`}
              aria-pressed={t.id === selId}
              onClick={() => setSel(t.id)}
            >
              <span className="pr-pos mono">{valuePlace.get(t.id)}</span>
              <span className="pr-main">
                <span className="pr-team">{t.name}</span>
              </span>
              <span className="pr-pct mono">{t.projValue.toFixed(1)}</span>
            </button>
          );
        })}
      </div>
      <div className="only-web">
      <div className="table-scroll">
        <table className="sheet dg-recap-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Team</th>
              <th className="num">Grade</th>
              <th className="num" title="Projected season record in categories: 19 weeks x 15 categories = 285 (mean of 5,000 simulated seasons)">
                Proj record
              </th>
              <th className="num">Win %</th>
              <th className="num" title={`Share of simulated seasons finishing in the top ${league.playoffTeams || 4}`}>Playoff %</th>
              <th className="num" title="Sum of each player's projected season value">Proj value</th>
              <th>Best pick</th>
              <th>Biggest reach</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t) => {
              const g = standOf.get(t.id);
              return (
                <tr key={t.id} className={t.mine ? "dg-me" : ""}>
                  <td className="num">{valuePlace.get(t.id)}</td>
                  <td>{t.name}</td>
                  <td className="num">
                    <strong>{letterFor(valuePlace.get(t.id) ?? nT, nT)}</strong>
                  </td>
                  <td className="num">
                    <strong>{g ? `${fmt0(g.res.catW)}-${fmt0(g.res.catL)}` : "\u2014"}</strong>
                  </td>
                  <td className="num">{g ? `${(g.pct * 100).toFixed(1)}%` : "\u2014"}</td>
                  <td className={`num ${g ? (g.res.playoffPct >= 0.6 ? "dg-good" : g.res.playoffPct < 0.25 ? "dg-bad" : "") : ""}`}>
                    <strong>{g ? `${(g.res.playoffPct * 100).toFixed(0)}%` : "\u2014"}</strong>
                  </td>
                  <td className="num">{t.projValue.toFixed(1)}</td>
                  <td>
                    {t.steal ? (
                      <>
                        {t.steal.r.name} <span className="dg-dim">#{t.steal.pick} (ADP {t.steal.r.adp?.toFixed(0)})</span>
                      </>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                  <td>
                    {t.reach ? (
                      <>
                        {t.reach.r.name} <span className="dg-dim">#{t.reach.pick} (ADP {t.reach.r.adp?.toFixed(0)})</span>
                      </>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

      <h2 className="dg-h dg-recap-h">Category ranks (projected weekly win rate)</h2>
      <div className="table-scroll">
        <table className="sheet dg-recap-cats">
          <thead>
            <tr>
              <th>Team</th>
              {league.categories.map((c) => (
                <th key={c} className="num">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((t) => {
              const g = standOf.get(t.id);
              return (
                <tr key={t.id} className={t.mine ? "dg-me" : ""}>
                  <td>{t.name}</td>
                  {league.categories.map((c) => {
                    const r = g?.catRank[c] ?? 0;
                    return (
                      <td key={c} className={`num dg-heat${r <= 2 ? " top" : r >= nTeams - 1 ? " low" : ""}`}>
                        {r || "\u2014"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="dg-panels dg-recap-moves">
        <section className="dg-panel">
          <h2 className="dg-h">Best values</h2>
          <MoveList items={steals} />
        </section>
        <section className="dg-panel">
          <h2 className="dg-h">Biggest reaches</h2>
          <MoveList items={reaches} />
        </section>
      </div>

      <h2 className="dg-h dg-recap-h">Rosters</h2>
      <div className="dg-recap-teams">
        {ranked.map((t) => {
          const lineup = buildLineup(
            [...t.picks.map((x) => x.r)].sort((a, b) => a.rank - b.rank),
            league.rosterSlots
          );
          const g = standOf.get(t.id);
          return (
            <section key={t.id} className={`dg-panel dg-recap-team${t.mine ? " is-me" : ""}`}>
              <div className="dg-side-h">
                <h3 className="dg-h">{t.name}</h3>
                <span className="dg-dim">
                  {`${letterFor(valuePlace.get(t.id) ?? nT, nT)} · #${valuePlace.get(t.id)} · `}
                  <span title="Team projected value (round-weighted)">{t.projValue.toFixed(1)}</span>
                </span>
              </div>
              <table className="dg-lineup">
                <tbody>
                  {lineup.map((row, i) => (
                    <tr key={i} className={row.slot === "Bench" ? "is-bench" : ""}>
                      <th scope="row">{row.slot === "Bench" ? "BE" : row.slot === "UTIL" ? "UT" : row.slot}</th>
                      {row.player ? (
                        <>
                          <td className="dg-lu-nm">{row.player.name}</td>
                          <td className="dg-lu-pos">
                            #{t.picks.find((x) => x.r === row.player)?.pick}
                          </td>
                          <td
                            className={`dg-lu-val ${row.player.total >= 0 ? "" : "neg"}`}
                            title="Projected 2026-27 value"
                          >
                            {/* Round first, so -0.04 shows as 0.0, not "-0.0". */}
                            {(() => {
                              const v = Math.round(row.player.total * 10) / 10;
                              return `${v > 0 ? "+" : ""}${(v === 0 ? 0 : v).toFixed(1)}`;
                            })()}
                          </td>
                        </>
                      ) : (
                        <td className="dg-lu-empty" colSpan={3}>
                          Empty
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
      <p className="caption">
        Graded on this league&rsquo;s {league.categories.length} categories with equal weights
        and no punts, from 2026-27 projections (with this guide&rsquo;s injury adjustments).
        Early picks count more: each player is weighted by round (1.0 through round 2, then
        about &minus;0.075 a round, down to 0.25 by round 12), because late picks are the ones
        that get dropped. Best pick, biggest reach and the value lists use rounds 1&ndash;{HIGHLIGHT_MAX_ROUND} only.
        Proj record and Playoff % come from a season projection: the real {league.regularWeeks || 19}-week schedule simulated 10,000 times, each week&rsquo;s swings calibrated on this league&rsquo;s real 2025-26 weekly results, plus season-level uncertainty for breakouts, busts, injuries and in-season moves, every category a win or loss (H2H each category), the top {league.playoffTeams || 4} make the playoffs. Late picks are blended with a replacement-level waiver player by round weight. Category ranks are each team&rsquo;s weekly win rate in that category. Teams are ranked by projected value: each roster&rsquo;s value over replacement, weighted by round.
        Best pick and biggest reach compare each pick with ESPN ADP.
      </p>
    </section>
  );
}

function MoveList({ items }: { items: { pick: number; r: DraftRow; team: string; d: number }[] }) {
  if (!items.length) return <p className="dg-note dg-dim">None yet.</p>;
  return (
    <table className="sheet dg-vtable dg-side-table">
      <tbody>
        {items.map((x) => (
          <tr key={x.pick}>
            <td className="num dg-dim">#{x.pick}</td>
            <td>
              {x.r.name} <span className="dg-dim">{x.team}</span>
            </td>
            <td className={`num ${x.d >= 0 ? "dg-good" : "dg-bad"}`}>
              ADP {x.r.adp?.toFixed(0) ?? "\u2014"} ({x.d >= 0 ? "+" : ""}
              {x.d.toFixed(0)})
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ordinalOf(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** The Season Summary KPI tile, same markup and classes. */
function Tile({ label, value, sub, text }: { label: string; value: string; sub?: string; text?: boolean }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      {/* `text` = a name rather than a number: no mono, smaller, ellipsis if long. */}
      <div className={text ? "metric-value dg-tile-text" : "metric-value mono"} title={value}>
        {value}
      </div>
      {sub && <div className="dg-tile-sub">{sub}</div>}
    </div>
  );
}
