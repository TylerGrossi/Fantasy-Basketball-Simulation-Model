"use client";

import { useEffect, useMemo, useState } from "react";
import type { RecentMoveRow } from "@/lib/league";
import {
  groupByDay,
  groupMoves,
  netValue,
  timeLabel,
  type MoveGroup,
  type MoveRow,
} from "@/lib/moves";
import FilterBar from "./FilterBar";
import MultiSelect from "./MultiSelect";
import PlayerLink from "./PlayerLink";
import SortableTable, { type SortCol, type SortRow } from "./SortableTable";
import FitText, { shortName } from "./FitText";
import { makeOddsSimulator, type Odds, type SeasonContext, type SimPlayer } from "@/lib/playoffOdds";
import type { LeagueData } from "@/lib/league";

/**
 * League-wide transaction feed — ESPN's "Recent Activity" — with client-side filters
 * over the exported `recentMoves` list. Same pattern as Player Value's filter bar:
 * everything is already on the page (150 rows, not 290 players, so there's no case for
 * a server round trip), filtering is instant, and the controls reuse `.field` /
 * `MultiSelect` rather than inventing a second filter language.
 */

const DATE_OPTIONS = [
  { label: "All time", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 6 months", days: 182 },
  { label: "Last year", days: 365 },
] as const;

function badgeClass(action: string) {
  if (action === "Add" || action === "Waiver Add") return "add";
  if (action === "Drop") return "drop";
  if (action === "Trade") return "trade";
  if (action === "Draft") return "draft";
  return "moved";
}

/** A move plus the player's 9-cat value, joined by the page. Defined in lib/moves.ts,
 *  re-exported here because the page imports it from this module. */
export type { MoveRow } from "@/lib/moves";

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
const tone = (v: number) => (v > 0.05 ? "var(--good)" : v < -0.05 ? "var(--bad)" : "var(--ink-3)");

/** "Oct 27, 4:44 PM" — the same stamp the Log table uses. */
const stamp = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

type View = "pairs" | "log";
const VIEWS: Array<[View, string]> = [
  ["pairs", "Transactions"],
  ["log", "Log"],
];

/*
 * TRANSACTIONS (owner, 2026-10-30): one row per decision — the add and the drop it was made
 * for side by side, and what the swap was worth. The Log keeps one row per player moved.
 */
const PAIR_COLS: SortCol[] = [
  { key: "date", label: "Date", title: "When ESPN processed it." },
  { key: "team", label: "Team" },
  { key: "added", label: "Added", title: "Who came in, with his season value." },
  { key: "dropped", label: "Dropped", title: "Who went out to make room, with his season value." },
  {
    key: "net",
    label: "Net",
    num: true,
    title:
      "Value added minus value dropped. Only for a swap: a lone add filled an open spot, a lone drop opened one.",
  },
  {
    key: "dPlayoff",
    label: "Δ Playoff",
    num: true,
    title:
      "How much the swap changes the team's playoff chance from here on, in percentage points: its current roster with the added player, against the same roster with the dropped one instead.",
  },
  {
    key: "dChamp",
    label: "Δ Champ",
    num: true,
    title: "The same for the team's chance of winning the title.",
  },
];

/** What the page hands over for the playoff / title columns (built server-side). */
export interface MovesOdds {
  ctx: SeasonContext;
  teamIds: Record<string, number>;
  meta: Pick<LeagueData, "stats" | "categories" | "lowerIsBetter" | "variance" | "projectionError">;
}

/** One name list as "J. Poeltl, D. Acuff Jr." when the full one does not fit. */
const names = (rs: MoveRow[]) => rs.map((r) => r.player).join(", ");
const shortNames = (rs: MoveRow[]) => rs.map((r) => shortName(r.player)).join(", ");

export default function RecentMovesView({
  rows,
  week = {},
  teams: leagueTeams = [],
  odds: oddsInput = null,
}: {
  rows: MoveRow[];
  /** Rosters, schedule and model inputs for the Δ Playoff / Δ Champ columns. */
  odds?: MovesOdds | null;
  /** This matchup's acquisitions used / allowed, by team name. */
  week?: Record<string, { used: number; max: number }>;
  /** Every team in the league, so one with no moves still gets a card. */
  teams?: string[];
}) {
  const [view, setView] = useState<View>("pairs");
  const [player, setPlayer] = useState("");
  const [teams, setTeams] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [days, setDays] = useState(0);

  const teamOptions = useMemo(
    () => [...new Set(rows.map((r) => r.team).filter(Boolean))].sort(),
    [rows]
  );
  // Fixed, sensible order rather than whatever order they first appear in the feed —
  // "Add" leading and "Trade" last reads the way the badge colors do (good -> bad ->
  // neutral trade).
  const ACTION_ORDER = ["Add", "Waiver Add", "Drop", "Trade", "Draft", "Moved"];
  const actionOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.action).filter(Boolean));
    return [
      ...ACTION_ORDER.filter((a) => present.has(a)),
      ...[...present].filter((a) => !ACTION_ORDER.includes(a)).sort(),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const filtered = useMemo(() => {
    const q = player.trim().toLowerCase();
    const cutoff = days > 0 ? Date.now() - days * 86_400_000 : null;
    return rows.filter((r) => {
      if (q && !r.player.toLowerCase().includes(q)) return false;
      if (teams.length && !teams.includes(r.team)) return false;
      if (actions.length && !actions.includes(r.action)) return false;
      if (cutoff !== null) {
        const t = r.date ? Date.parse(r.date) : NaN;
        if (Number.isNaN(t) || t < cutoff) return false;
      }
      return true;
    });
  }, [rows, player, teams, actions, days]);

  // Transactions, then day headings — computed once per filter change and shared by the
  // mobile feed. The table below renders the ungrouped rows exactly as before.
  const groups = useMemo(() => groupMoves(filtered), [filtered]);
  const feed = useMemo(() => groupByDay(groups), [groups]);

  /*
   * Δ PLAYOFF / Δ CHAMP per swap (owner, 2026-10-30). For each add-for-drop, the team's
   * CURRENT roster is put back the way it would be without the swap (added player out,
   * dropped player in) and then with it, and the season simulated both ways
   * (lib/playoffOdds.ts — same random draws, so the gap is the swap). Measured from today
   * forward; the weeks already played are in the records either way. Runs after paint in
   * small batches — a simulator per team (~0.1s) and two runs per swap (~10ms each).
   */
  const [swapOdds, setSwapOdds] = useState<Map<string, { dP: number; dC: number }>>(new Map());
  useEffect(() => {
    if (!oddsInput) return;
    const { ctx, teamIds, meta } = oddsInput;
    const swaps = groupMoves(rows).filter((g) => netValue(g) != null);
    const sims = new Map<number, ReturnType<typeof makeOddsSimulator>>();
    const out = new Map<string, { dP: number; dC: number }>();
    let alive = true;
    let i = 0;
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const step = () => {
      if (!alive) return;
      for (const end = Math.min(swaps.length, i + 4); i < end; i++) {
        const g = swaps[i];
        const id = teamIds[g.team];
        if (id == null) continue;
        if (!sims.has(id)) sims.set(id, makeOddsSimulator(meta, ctx, id));
        const run = sims.get(id);
        if (!run) continue;
        const addN = new Set(g.adds.map((r) => r.player));
        const dropN = new Set(g.drops.map((r) => r.player));
        const p = (n: string): SimPlayer | undefined => ctx.players[n];
        const current = ctx.rosters[id] ?? [];
        // Without the swap: added players out, dropped players back in.
        const base = [
          ...current.filter((x) => !addN.has(x.name ?? "") && !dropN.has(x.name ?? "")),
          ...[...dropN].map(p).filter((x): x is SimPlayer => !!x),
        ];
        // With it: the dropped players out, the added ones in.
        const withSwap = [
          ...base.filter((x) => !dropN.has(x.name ?? "")),
          ...[...addN].map(p).filter((x): x is SimPlayer => !!x),
        ];
        const a: Odds = run(base, null);
        const b: Odds = run(withSwap, null);
        out.set(g.key, { dP: b.playoff - a.playoff, dC: b.champ - a.champ });
      }
      setSwapOdds(new Map(out));
      if (i < swaps.length) timer = setTimeout(step, 0);
    };
    timer = setTimeout(step, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [oddsInput, rows]);

  /*
   * PER-TEAM SUMMARY, over the whole season's moves (not the filters — it is the league
   * at a glance). Click a team to filter everything below to it.
   */
  const summary = useMemo(() => {
    const all = groupMoves(rows);
    const names = [...new Set([...leagueTeams, ...rows.map((r) => r.team)])].filter(Boolean);
    return names
      .map((team) => {
        const mine = rows.filter((r) => r.team === team);
        const swaps = all
          .filter((g) => g.team === team)
          .map((g) => ({ g, net: netValue(g) }))
          .filter((x): x is { g: MoveGroup; net: number } => x.net != null)
          .sort((a, b) => b.net - a.net);
        return {
          team,
          adds: mine.filter((r) => r.action === "Add" || r.action === "Waiver Add").length,
          drops: mine.filter((r) => r.action === "Drop").length,
          week: week[team],
          best: swaps[0],
          worst: swaps.length > 1 ? swaps[swaps.length - 1] : undefined,
        };
      })
      .sort((a, b) => b.adds - a.adds || a.team.localeCompare(b.team));
  }, [rows, week, leagueTeams]);

  return (
    <>
      <TeamStrip
        summary={summary}
        selected={teams}
        onPick={(t) => setTeams(teams.length === 1 && teams[0] === t ? [] : [t])}
      />

      <FilterBar className="controls rm-filters">
        <div className="segmented rm-view" role="group" aria-label="Format">
          {VIEWS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`seg ${view === k ? "seg-on" : ""}`}
              aria-pressed={view === k}
              onClick={() => setView(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ms rm-f-player">
          <div className="ms-label">Player</div>
          <input
            className="field"
            type="search"
            placeholder="Search…"
            value={player}
            onChange={(e) => setPlayer(e.target.value)}
            aria-label="Player name"
          />
        </div>
        <MultiSelect
          label="Team"
          options={teamOptions}
          selected={teams}
          onChange={setTeams}
          className="rm-f-team"
        />
        <MultiSelect
          label="Move type"
          options={actionOptions}
          selected={actions}
          onChange={setActions}
          className="rm-f-action"
        />
        <div className="ms rm-f-date">
          <div className="ms-label">Date</div>
          <select
            className="field field-select"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Date range"
          >
            {DATE_OPTIONS.map((o) => (
              <option key={o.label} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </FilterBar>

      {filtered.length === 0 ? (
        <p className="caption">No moves match those filters.</p>
      ) : (
        <>
        {/*
          MOBILE: the same rows as one card per transaction, under a day heading.

          Both are rendered and switched by CSS at 767px — no width detection and no flash
          of the wrong one, the pattern the nav and the rest of the app already use. The
          grouping runs over `filtered`, so a filter narrows the cards exactly as it
          narrows the table; filtering to "Drop" leaves a card holding only its drop, which
          is the truth about what survived the filter.
        */}
        <div className="rm-feed">
          {feed.map((d) => (
            <section className="rm-day" key={d.key}>
              <h2 className="rm-day-h">{d.label}</h2>
              {d.groups.map((g) => (
                <MoveCard key={g.key} g={g} />
              ))}
            </section>
          ))}
        </div>

        {view === "pairs" ? (
          <div className="rm-table-wrap">
            <SortableTable
              cols={PAIR_COLS}
              defaultKey="date"
              className="rm-pairs"
              scrollClassName="rm-scroll"
              rows={groups.map((g): SortRow => {
                const net = netValue(g);
                const list = (rs: MoveRow[]) =>
                  rs.length ? (
                    <span className="rm-plist">
                      {rs.map((r, i) => (
                        <span className="rm-pl" key={`${r.player}-${i}`}>
                          <PlayerLink name={r.player}>
                            <FitText full={r.player} short={shortName(r.player)} />
                          </PlayerLink>
                          {r.value != null && (
                            <span className="rm-pl-v mono">{signed(r.value)}</span>
                          )}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="rm-none">—</span>
                  );
                const ins = [...g.adds, ...g.drafted, ...g.other];
                return {
                  id: g.key,
                  cells: {
                    date: { sort: g.date, text: stamp(g.date), node: <span className="rm-date">{stamp(g.date)}</span> },
                    team: { sort: g.team, text: g.team, node: <span className="rm-team">{g.team}</span> },
                    added: {
                      sort: ins.map((r) => r.player).join(", "),
                      text: ins.map((r) => r.player).join(", "),
                      node: g.drafted.length > 1 ? <span className="rm-none">{g.label}</span> : list(ins),
                    },
                    dropped: {
                      sort: g.drops.map((r) => r.player).join(", "),
                      text: g.drops.map((r) => r.player).join(", "),
                      node: list(g.drops),
                    },
                    net:
                      net == null
                        ? { sort: -Infinity, text: "—", color: "var(--ink-3)" }
                        : { sort: net, text: signed(net), color: tone(net), node: <strong>{signed(net)}</strong> },
                    ...(() => {
                      const none = { sort: -Infinity, text: "—", color: "var(--ink-3)" };
                      if (net == null || !oddsInput) return { dPlayoff: none, dChamp: none };
                      const o = swapOdds.get(g.key);
                      if (!o) {
                        const wait = { sort: -Infinity, text: "…", color: "var(--ink-3)" };
                        return { dPlayoff: wait, dChamp: wait };
                      }
                      return {
                        dPlayoff: { sort: o.dP, text: signed(o.dP), color: tone(o.dP) },
                        dChamp: { sort: o.dC, text: signed(o.dC), color: tone(o.dC) },
                      };
                    })(),
                  },
                };
              })}
            />
          </div>
        ) : (
        <div className="table-scroll rm-table-wrap rm-scroll">
          <table className="sheet rm-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Team</th>
                <th>Move</th>
                <th>Player</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.date}-${r.player}-${i}`}>
                  <td className="rm-date">
                    {r.date
                      ? new Date(r.date).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="rm-team">{r.team}</td>
                  <td>
                    <span className={`rm-badge ${badgeClass(r.action)}`}>{r.action}</span>
                  </td>
                  <td>
                    <PlayerLink name={r.player} />
                    {r.position && <span className="lu-name-sub"> {r.position}</span>}
                  </td>
                  <td className="num">
                    {r.value == null
                      ? "—"
                      : `${r.value >= 0 ? "+" : ""}${r.value.toFixed(1)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        </>
      )}
    </>
  );
}

/**
 * One transaction: who did it, when, and every player it moved.
 *
 * Adds lead, drops follow, because that is the order the decision was made in — you pick
 * someone up and drop to make room. The sign carries the meaning (green +, red −) so the
 * word "Added" does not have to appear on every line.
 */
function MoveCard({ g }: { g: MoveGroup }) {
  const lines: Array<{ row: MoveRow; sign: "+" | "−"; kind: string }> = [
    ...g.adds.map((row) => ({ row, sign: "+" as const, kind: "add" })),
    ...g.drafted.map((row) => ({ row, sign: "+" as const, kind: "draft" })),
    ...g.other.map((row) => ({ row, sign: "+" as const, kind: "moved" })),
    ...g.drops.map((row) => ({ row, sign: "−" as const, kind: "drop" })),
  ];

  return (
    <article className="rm-card">
      <header className="rm-card-h">
        <span className="rm-card-team">{g.team}</span>
        <span className="rm-card-when">{timeLabel(g.date)}</span>
      </header>
      <div className="rm-card-b">
        <div className="rm-card-label">
          {g.label}
          {(() => {
            const net = netValue(g);
            return net == null ? null : (
              <span className="rm-card-net mono" style={{ color: tone(net) }}>
                Net {signed(net)}
              </span>
            );
          })()}
        </div>
        {lines.map(({ row, sign, kind }, i) => (
          <div className={`rm-line rm-${kind}`} key={`${row.player}-${i}`}>
            <span className="rm-sign" aria-hidden="true">
              {sign}
            </span>
            <span className="rm-who">
              <PlayerLink name={row.player} />
              {row.position && <span className="rm-pos"> {row.position}</span>}
            </span>
            <span className="rm-val">
              {row.value == null ? "" : `${row.value >= 0 ? "+" : ""}${row.value.toFixed(1)}`}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

interface TeamSummary {
  team: string;
  adds: number;
  drops: number;
  week?: { used: number; max: number };
  best?: { g: MoveGroup; net: number };
  worst?: { g: MoveGroup; net: number };
}

/**
 * One card per team: adds left this week, season churn, and its best and worst swap by
 * net value. A card is a button — it filters the page to that team, and again to clear.
 */
function TeamStrip({
  summary,
  selected,
  onPick,
}: {
  summary: TeamSummary[];
  selected: string[];
  onPick: (team: string) => void;
}) {
  const swap = (x: { g: MoveGroup; net: number }) => (
    <>
      <FitText
        className="rm-ts-swap"
        full={`+${names(x.g.adds)} / −${names(x.g.drops)}`}
        short={`+${shortNames(x.g.adds)} / −${shortNames(x.g.drops)}`}
      />
      <b className="mono" style={{ color: tone(x.net) }}>
        {signed(x.net)}
      </b>
    </>
  );
  return (
    <div className="rm-strip">
      {summary.map((t) => {
        const on = selected.length === 1 && selected[0] === t.team;
        return (
          <button
            type="button"
            key={t.team}
            className={`rm-ts${on ? " rm-ts-on" : ""}`}
            onClick={() => onPick(t.team)}
            aria-pressed={on}
            title={on ? "Show every team" : `Show only ${t.team}`}
          >
            <span className="rm-ts-name">{t.team}</span>
            <span className="rm-ts-row">
              <span>This week</span>
              <b className="mono" style={t.week && t.week.used >= t.week.max ? { color: "var(--bad)" } : undefined}>
                {t.week ? `${t.week.used} of ${t.week.max} adds` : "—"}
              </b>
            </span>
            <span className="rm-ts-row">
              <span>Season</span>
              <b className="mono">
                {t.adds} adds · {t.drops} drops
              </b>
            </span>
            <span className="rm-ts-row rm-ts-move">
              <span>Best</span>
              {t.best ? swap(t.best) : <span className="rm-none">no swaps yet</span>}
            </span>
            {t.worst && (
              <span className="rm-ts-row rm-ts-move">
                <span>Worst</span>
                {swap(t.worst)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
