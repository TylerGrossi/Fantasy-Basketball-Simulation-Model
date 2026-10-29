"use client";

import { useEffect, useMemo, useState } from "react";
import type { AcquisitionSummary, LeagueData, Matchup } from "@/lib/league";
import { sideMoments, winPctText } from "@/lib/league";
import { matchupOutcome } from "@/lib/probability";
import { playerStatus } from "@/lib/playerPool";
import {
  evaluatePlan,
  INACTIVE,
  isAdd,
  newMoveId,
  optimizePlan,
  planScore,
  preparePlan,
  type PlanObjective,
  type PlannedMove,
  type PlanRow,
} from "@/lib/planner";
import { dayLabel } from "@/lib/dates";
import { byLineup, lineupOrder, type LineupOrder } from "@/lib/lineupOrder";
import { useLiveSides } from "@/lib/useLiveSides";
import { useMoveWindow } from "@/lib/useMoveWindow";
import { useSettings } from "@/lib/useSettings";
import { remotePut, useRemotePull } from "@/lib/remoteSync";
import FilterBar from "./FilterBar";
import { ShuffleIcon, StarIcon } from "./Icons";
import PlayerLink from "./PlayerLink";

/**
 * WEEK PLANNER (owner, 2026-10-29) — the add/drop spreadsheet the owner kept by hand,
 * built from live data: the moves for the week on the left, the roster x day grid with
 * every pickup's span and every drop's cut-off, and the started games each day against
 * the slot cap underneath. Moves can be entered by hand, and Optimize fills the rest of
 * the week's acquisitions around them (lib/planner.ts).
 *
 * The plan is kept in localStorage per season / week / team, so it survives a reload
 * and a new week starts empty. Moves that stop applying — the pickup is already on your
 * roster because you made the move, or the day has passed — are flagged, not deleted.
 */

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
  /** This matchup's acquisitions, used of allowed. */
  acq?: AcquisitionSummary;
}

interface Stored {
  moves: PlannedMove[];
  objective: PlanObjective;
  /** Moves to plan; null = what ESPN says is left this week. */
  maxMoves: number | null;
}

const KEY = "fbb.planner.v1";
const DEFAULTS: Stored = { moves: [], objective: "cats", maxMoves: null };

function readStore(): Record<string, Stored> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export default function WeekPlanner({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
  acq,
}: Props) {
  const { live, you, opp } = useLiveSides(league, matchup, isHome, teamId, liveEnabled);
  const [settings, updateSettings] = useSettings();
  const win = useMoveWindow(league, live.gameLeft);

  // ---- persisted plan, one per season / week / team ----
  const storeKey = `${league.season}:${league.period}:${teamId}`;
  const [state, setState] = useState<Stored>(DEFAULTS);
  // Read after mount: server and first client render must match.
  useEffect(() => {
    setState({ ...DEFAULTS, ...readStore()[storeKey] });
  }, [storeKey]);
  const saveLocal = (next: Stored) => {
    try {
      // Only this week's entry is kept: last week's plan is of no further use.
      window.localStorage.setItem(KEY, JSON.stringify({ [storeKey]: next }));
    } catch {
      // Storage blocked — the plan still works for this visit.
    }
  };
  // CROSS-DEVICE (owner, 2026-10-29): the server copy (/api/sync, `plan:<week key>`) wins
  // when it exists — on load and whenever the page comes back into view, so the plan made
  // on the laptop is the one the phone shows. Nothing stored yet: this device's plan seeds it.
  useRemotePull(`plan:${storeKey}`, (got) => {
    if (!got?.configured) return;
    const local = { ...DEFAULTS, ...readStore()[storeKey] };
    if (got.value && typeof got.value === "object") {
      const remote = { ...DEFAULTS, ...(got.value as Partial<Stored>) };
      if (JSON.stringify(remote) !== JSON.stringify(local)) {
        saveLocal(remote);
        setState(remote);
      }
    } else if (JSON.stringify(local) !== JSON.stringify(DEFAULTS)) {
      remotePut(`plan:${storeKey}`, local);
    }
  });
  // Written through on every change, never from an effect — an effect would run once
  // with the old week's state under the new week's key.
  const update = (patch: Partial<Stored>) =>
    setState((s) => {
      const next = { ...s, ...patch };
      saveLocal(next);
      remotePut(`plan:${storeKey}`, next);
      return next;
    });

  // ---- the context the engine plans against ----
  const youMoments = useMemo(() => sideMoments(you, live.you), [you, live.you]);
  const oppMoments = useMemo(() => sideMoments(opp, live.opp), [opp, live.opp]);
  const pool = useMemo(() => {
    // Anyone on either live roster is not a free agent any more, whatever the export says.
    const taken = new Set([...(live.youToday ?? []), ...(live.oppToday ?? [])].map((t) => t.name));
    return league.freeAgents.filter((fa) => !taken.has(fa.name));
  }, [league.freeAgents, live.youToday, live.oppToday]);
  const openSpots = settings.hasOpenSpot ? 1 : 0;

  // Today's ESPN lineup: the roster rows read PG first, IR last (lib/lineupOrder.ts). It
  // also says who is in the IR slot — inactive in the plan until an Activate move.
  const lineup = useMemo(() => lineupOrder(live.youToday), [live.youToday]);
  const ir = useMemo(
    () => new Set([...lineup].filter(([, v]) => v.label === "IR").map(([name]) => name)),
    [lineup]
  );

  const prep = useMemo(
    () =>
      preparePlan({
        league,
        roster: you.players,
        pool,
        teamMoments: youMoments,
        oppMoments,
        dates: win.dates,
        teams: win.teams,
        slots: win.slots,
        openSpots,
        ir,
      }),
    [league, you.players, pool, youMoments, oppMoments, win.dates, win.teams, win.slots, openSpots, ir]
  );

  // The one protect list: Streamers' "Protect from dropping" chips (owner, 2026-10-29) —
  // protect a player there and neither section will ever suggest dropping him.
  const protect = useMemo(() => new Set(settings.untouchables), [settings.untouchables]);

  const evaluation = useMemo(() => evaluatePlan(prep, state.moves), [prep, state.moves]);
  // "No moves" starts from the plan's own baseline, which takes IR players' games out.
  const baseWin = useMemo(
    () => matchupOutcome(league, prep.teamMoments, oppMoments).win,
    [league, prep.teamMoments, oppMoments]
  );
  const planWin = useMemo(
    () => matchupOutcome(league, evaluation.moments, oppMoments).win,
    [league, evaluation.moments, oppMoments]
  );

  // What each move is worth on its own: the plan with and without it. A move a later
  // one depends on (that one drops his pickup) cannot be taken out alone — no number.
  const marginal = useMemo(() => {
    const out = new Map<string, { games: number; cats: number } | null>();
    for (const m of evaluation.applied) {
      const without = evaluatePlan(prep, state.moves.filter((x) => x.id !== m.id));
      out.set(
        m.id,
        without.invalid.size > evaluation.invalid.size
          ? null
          : {
              games: evaluation.started - without.started,
              cats: evaluation.expectedCats - without.expectedCats,
            }
      );
    }
    return out;
  }, [prep, state.moves, evaluation]);

  const movesLeft = acq ? Math.max(0, acq.max - acq.used) : 7;
  const maxMoves = state.maxMoves ?? movesLeft;
  // Only pickups count against ESPN's acquisition limit; activations are free.
  const planned = evaluation.applied.filter(isAdd).length;
  const activations = evaluation.applied.length - planned;

  const [busy, setBusy] = useState(false);
  function optimize() {
    setBusy(true);
    // Let the button repaint as busy before the synchronous search runs.
    setTimeout(() => {
      const moves = optimizePlan(prep, state.moves, {
        objective: state.objective,
        maxMoves,
        protect,
      });
      update({ moves });
      setBusy(false);
    }, 20);
  }

  // ---- the add-a-move form ----
  const [formDate, setFormDate] = useState("");
  const [formAdd, setFormAdd] = useState("");
  const [formKind, setFormKind] = useState<"add" | "activate">("add");
  const [formDrop, setFormDrop] = useState("");
  const date = win.dates.includes(formDate) ? formDate : (win.dates[0] ?? "");
  const dropOptions = useMemo(
    () =>
      evaluation.rows.filter(
        (r) => (r.from == null || r.from < date) && r.until == null
      ),
    [evaluation.rows, date]
  );
  const openLeft = openSpots - evaluation.applied.filter((m) => m.drop == null).length;
  const dropName =
    formDrop === "__open" && openLeft > 0
      ? "__open"
      : dropOptions.some((r) => r.name === formDrop)
        ? formDrop
        : (lowestDroppable(dropOptions, protect)?.name ?? "");
  // Players still in the IR slot (no Activate move yet) — the Activate form's choices.
  const stillOnIr = evaluation.rows.filter((r) => r.ir && r.from === INACTIVE);
  const kind = formKind === "activate" && stillOnIr.length > 0 ? "activate" : "add";
  /*
   * Every pickup (or IR player) with a game from the chosen day, RANKED by what the move
   * would add to the plan as it stands — with the chosen drop, in the objective's own
   * units — so the list reads like the Streamers table for that day. ~130 evaluations.
   */
  const addOptions = useMemo(() => {
    if (!date || !dropName) return [];
    const drop = dropName === "__open" ? null : dropName;
    const used = new Set(evaluation.rows.map((r) => r.name));
    const now = planScore(evaluation, state.objective);
    const seats =
      kind === "activate"
        ? prep.roster.filter((s) => stillOnIr.some((r) => r.name === s.name))
        : [...prep.pool.values()].filter((s) => !used.has(s.name));
    return seats
      .map((s) => ({ s, games: [...s.days].filter((d) => d >= date).length }))
      .filter((x) => x.games > 0)
      .map((x) => {
        const e = evaluatePlan(prep, [...state.moves, { id: "", kind, date, add: x.s.name, drop }]);
        return { ...x, gain: e.invalid.size > evaluation.invalid.size ? -Infinity : planScore(e, state.objective) - now };
      })
      .filter((x) => x.gain > -Infinity)
      .sort((a, b) => b.gain - a.gain || b.s.rank - a.s.rank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prep, evaluation, state.moves, state.objective, date, dropName, kind]);
  const addName = addOptions.some((x) => x.s.name === formAdd) ? formAdd : (addOptions[0]?.s.name ?? "");

  function addMove() {
    if (!date || !addName || !dropName) return;
    const move: PlannedMove = {
      id: newMoveId(),
      kind,
      date,
      add: addName,
      drop: dropName === "__open" ? null : dropName,
    };
    update({ moves: [...state.moves, move] });
    setFormAdd("");
    setFormDrop("");
  }

  // ---- render ----
  if (!league.weekSchedule) {
    return (
      <p className="caption">
        No schedule for this week in the export yet — the planner appears after the next
        data refresh.
      </p>
    );
  }
  if (win.dates.length === 0) {
    return (
      <p className="caption">
        No days left in this matchup that a move could still change.
        {league.seasonOver ? " The season is over." : ""}
      </p>
    );
  }

  // Move numbers follow the order the moves happen, as in the moves list.
  const moveNo = new Map(evaluation.applied.map((m, i) => [m.id, i + 1]));
  const addedBy = new Map(evaluation.applied.map((m) => [m.add, m]));
  const droppedBy = new Map(
    evaluation.applied.filter((m) => m.drop).map((m) => [m.drop as string, m])
  );
  // One colour per move, in the order they happen — on the list, on the pickup's days and
  // on the days the dropped player loses (owner, 2026-10-29: the spreadsheet's colours).
  const colorOf = (id: string) => ((moveNo.get(id) ?? 1) - 1) % MOVE_COLORS;
  const plannable = new Set(win.dates);
  const { kept, moved } = orderRows(evaluation.rows, evaluation.applied, lineup);
  const colSpan = win.days.length + 4;
  // Protect / unprotect from the grid itself: the same list as Streamers' chips, so a
  // change here moves both sections (owner, 2026-10-29).
  const toggleProtect = (name: string) => {
    const next = new Set(settings.untouchables);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    updateSettings({ untouchables: [...next] });
  };
  const signed = (v: number, dp = 0) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(dp)}`;
  const invalidMoves = state.moves.filter((m) => evaluation.invalid.has(m.id));

  function renderRow(r: PlanRow) {
    const [code, sev] = playerStatus(r.status);
    const addM = addedBy.get(r.name);
    const dropM = droppedBy.get(r.name);
    const delta = r.starts.size - r.baseStarted;
    return (
      <tr key={r.name}>
        <td className="pl-slot">{r.added ? "+" : (lineup.get(r.name)?.label ?? "")}</td>
        <td className="pl-can">
          {/* Star = keeper (protected, never dropped); crossing arrows = a streaming slot
              Optimize may drop. A pickup from the plan is always a streaming slot. */}
          {r.added ? (
            <span className="pl-can-ic is-droppable" title={`${r.name} is a streamer`}>
              <ShuffleIcon size={14} />
            </span>
          ) : (
            <button
              type="button"
              className={`pl-can-ic ${protect.has(r.name) ? "is-keeper" : "is-droppable"}`}
              aria-pressed={protect.has(r.name)}
              aria-label={
                protect.has(r.name)
                  ? `${r.name}: keeper — click to make droppable`
                  : `${r.name}: droppable — click to keep`
              }
              title={
                protect.has(r.name)
                  ? "Keeper — never dropped. Click to make droppable."
                  : "Droppable — a streaming slot. Click to keep."
              }
              onClick={() => toggleProtect(r.name)}
            >
              {protect.has(r.name) ? <StarIcon size={14} /> : <ShuffleIcon size={14} />}
            </button>
          )}
        </td>
        <td className="ws-player">
          <PlayerLink name={r.name} />
          {code && <span className={`ws-st ${sev}`}> {code}</span>}
          {addM && (
            <span className={`pl-chip pl-c${colorOf(addM.id)}`}>
              #{moveNo.get(addM.id)} {isAdd(addM) ? "added" : "activated"}{" "}
              {dayLabel(addM.date).split(" ")[0]}
            </span>
          )}
          {dropM && (
            <span className={`pl-chip pl-chip-drop pl-c${colorOf(dropM.id)}`}>
              #{moveNo.get(dropM.id)} dropped {dayLabel(dropM.date).split(" ")[0]}
            </span>
          )}
        </td>
        {win.days.map((d) => (
          <GridCell
            key={d}
            row={r}
            d={d}
            game={win.teams[r.nbaTeam]?.[d]}
            plannable={plannable.has(d)}
            today={d === win.today}
            addColor={addM ? colorOf(addM.id) : null}
            dropColor={dropM ? colorOf(dropM.id) : null}
          />
        ))}
        <td className="num mono">
          {r.starts.size}
          {delta !== 0 && (
            <span className={`pl-delta ${delta > 0 ? "up" : "down"}`}> {signed(delta)}</span>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="pl">

      <div className="metrics metrics-slim">
        <Tile
          label="Started games"
          value={String(evaluation.started)}
          sub={`${signed(evaluation.started - evaluation.baseStarted)} vs no moves`}
        />
        <Tile
          label="Expected cats"
          value={evaluation.expectedCats.toFixed(2)}
          sub={`${signed(evaluation.expectedCats - evaluation.baseCats, 2)} vs no moves`}
        />
        <Tile
          label="Win chance"
          value={winPctText(planWin)}
          sub={`${signed((planWin - baseWin) * 100, 1)} pts vs no moves`}
        />
        <Tile
          label="Moves"
          value={`${planned} / ${maxMoves}`}
          sub={`${acq ? `${acq.used} of ${acq.max} already used` : "limit unknown"}${
            activations ? ` · ${activations} activation${activations > 1 ? "s" : ""}` : ""
          }`}
        />
      </div>

      {/* The settings fold away behind "Filters" on a phone; the two actions never do. */}
      <div className="pl-bar">
        <FilterBar
          className="controls pl-controls"
          summary={`${state.objective === "cats" ? "Win the matchup" : "Most games"} · ${maxMoves} moves`}
        >
          <div className="segmented" role="radiogroup" aria-label="Optimize for">
            {(
              [
                ["cats", "Win the matchup"],
                ["games", "Most games"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={state.objective === k}
                className={`seg${state.objective === k ? " seg-on" : ""}`}
                onClick={() => update({ objective: k })}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="pl-inline">
            Moves to plan
            <select
              className="field field-select"
              value={maxMoves}
              onChange={(e) => update({ maxMoves: Number(e.target.value) })}
            >
              {Array.from({ length: Math.max(15, maxMoves + 1) }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                  {i === movesLeft && acq ? " (left this week)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.hasOpenSpot}
              onChange={(e) => updateSettings({ hasOpenSpot: e.target.checked })}
            />
            I have an open roster spot
          </label>
        </FilterBar>
        <div className="pl-actions">
          <button
            type="button"
            className="dg-btn on"
            onClick={optimize}
            disabled={busy}
          >
            {busy ? "Optimizing…" : planned ? "Optimize remaining" : "Optimize"}
          </button>
          <button
            type="button"
            className="dg-btn"
            onClick={() => update({ moves: [] })}
            disabled={state.moves.length === 0}
          >
            Clear plan
          </button>
        </div>
      </div>
      {win.rosterLocked && (
        <p className="caption">
          Today&rsquo;s games have started, so the earliest a move can count is tomorrow.
        </p>
      )}

      <div className="pl-layout">
        <div className="pl-moves-col">
          <h3 className="pl-h">Moves</h3>
          {evaluation.applied.length === 0 && invalidMoves.length === 0 ? (
            <p className="caption">
              No moves planned. Press Optimize, or add one below.
            </p>
          ) : (
            <ol className="pl-moves">
              {evaluation.applied.map((m) => {
                const mg = marginal.get(m.id);
                const fa = prep.pool.get(m.add);
                return (
                  <li key={m.id} className={`pl-move pl-c${colorOf(m.id)}`}>
                    <span className="pl-num">{moveNo.get(m.id)}</span>
                    <div className="pl-move-body">
                      <div>
                        <span className="pl-date">{dayLabel(m.date)}</span>{" "}
                        {isAdd(m) ? "Add" : "Activate"} <PlayerLink name={m.add} />{" "}
                        <span className="pl-team">{isAdd(m) ? fa?.nbaTeam : "from IR"}</span>
                        {", "}
                        {m.drop ? (
                          <>
                            drop <PlayerLink name={m.drop} />
                          </>
                        ) : (
                          <em>open spot</em>
                        )}
                      </div>
                      <div className="pl-move-gain">
                        {mg
                          ? `${signed(mg.games)} games · ${signed(mg.cats, 2)} cats`
                          : "a later move depends on this one"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="dg-btn sm"
                      aria-label={`Remove move ${moveNo.get(m.id)}`}
                      onClick={() => update({ moves: state.moves.filter((x) => x.id !== m.id) })}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
              {invalidMoves.map((m) => (
                <li key={m.id} className="pl-move pl-move-bad">
                  <span className="pl-num">!</span>
                  <div className="pl-move-body">
                    <div>
                      <span className="pl-date">{dayLabel(m.date)}</span>{" "}
                      {isAdd(m) ? "Add" : "Activate"} {m.add}
                      {m.drop ? `, drop ${m.drop}` : ""}
                    </div>
                    <div className="pl-move-gain">{evaluation.invalid.get(m.id)}</div>
                  </div>
                  <button
                    type="button"
                    className="dg-btn sm"
                    onClick={() => update({ moves: state.moves.filter((x) => x.id !== m.id) })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}

          <h3 className="pl-h">Add a move</h3>
          <div className="pl-form">
            {stillOnIr.length > 0 && (
              <div className="segmented" role="radiogroup" aria-label="Move type">
                {(
                  [
                    ["add", "Pick up"],
                    ["activate", "Activate from IR"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    className={`seg${kind === k ? " seg-on" : ""}`}
                    onClick={() => {
                      setFormKind(k);
                      setFormAdd("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <label>
              <span>Day</span>
              <select
                className="field field-select"
                value={date}
                onChange={(e) => setFormDate(e.target.value)}
              >
                {win.dates.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{kind === "activate" ? "Activate" : "Add"}</span>
              <select
                className="field field-select"
                value={addName}
                onChange={(e) => setFormAdd(e.target.value)}
              >
                {addOptions.map(({ s, games, gain }) => (
                  <option key={s.name} value={s.name}>
                    {s.name} · {s.nbaTeam} · {games}g ·{" "}
                    {state.objective === "games"
                      ? `${signed(Math.round(gain))} starts`
                      : `${signed(gain, 2)} cats`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Drop</span>
              <select
                className="field field-select"
                value={dropName}
                onChange={(e) => setFormDrop(e.target.value)}
              >
                {openLeft > 0 && <option value="__open">Open roster spot</option>}
                {dropOptions.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                    {protect.has(r.name) && !r.added ? " (protected)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="dg-btn"
              onClick={addMove}
              disabled={!addName || !dropName}
            >
              Add move
            </button>
          </div>
        </div>

        <div className="pl-grid-col">
          <div className="table-scroll">
            <table className="sheet ws-table pl-table">
              <thead>
                <tr>
                  <th className="pl-slot">Slot</th>
                  <th
                    className="pl-can"
                    title="Star = keeper, never dropped. Arrows = droppable streaming slot. Click to switch — shared with Streamers' Protect list."
                  >
                    Keep
                  </th>
                  <th>Player</th>
                  {win.days.map((d) => (
                    <th
                      key={d}
                      className={`ws-day${d === win.today ? " ws-today" : ""}${
                        plannable.has(d) ? "" : " ws-past"
                      }`}
                    >
                      {dayLabel(d)}
                    </th>
                  ))}
                  <th className="num" title="Started games from the first day a move can change">
                    Starts
                  </th>
                </tr>
              </thead>
              <tbody>
                {kept.map((r) => renderRow(r))}
                {moved.length > 0 && (
                  <tr className="pl-group">
                    <td colSpan={colSpan}>Moves — who goes out, who comes in</td>
                  </tr>
                )}
                {moved.map((r) => renderRow(r))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td />
                  <td className="ws-foot-l">Starts, with plan</td>
                  {win.days.map((d) => {
                    const x = evaluation.perDay.find((p) => p.date === d);
                    return (
                      <td
                        key={d}
                        className={`ws-count${x && x.playing > win.slots ? " ws-over" : ""}${
                          x && x.started > x.baseStarted ? " pl-gain" : ""
                        }`}
                        title={
                          x && x.playing > win.slots
                            ? `${x.playing} players have games for ${win.slots} spots`
                            : undefined
                        }
                      >
                        {x ? `${x.started}/${win.slots}` : ""}
                      </td>
                    );
                  })}
                  <td className="num mono">{evaluation.started}</td>
                </tr>
                <tr className="pl-foot-base">
                  <td />
                  <td />
                  <td className="ws-foot-l">Starts, no moves</td>
                  {win.days.map((d) => {
                    const x = evaluation.perDay.find((p) => p.date === d);
                    return (
                      <td key={d} className="ws-count">
                        {x ? `${x.baseStarted}/${win.slots}` : ""}
                      </td>
                    );
                  })}
                  <td className="num mono">{evaluation.baseStarted}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function GridCell({
  row,
  d,
  game,
  plannable,
  today,
  addColor,
  dropColor,
}: {
  row: PlanRow;
  d: string;
  game: string | undefined;
  plannable: boolean;
  today: boolean;
  /** Colour of the move that added him, or null. */
  addColor: number | null;
  /** Colour of the move that dropped him, or null. */
  dropColor: number | null;
}) {
  const onRoster = (row.from == null || row.from <= d) && (row.until == null || d < row.until);
  let cls = "ws-cell";
  let title: string | undefined;
  if (!plannable) {
    // A day already played (or locked): what happened then is banked, not planned.
    // A pickup was not on the roster yet, so his row stays empty.
    cls += " ws-past";
    if (row.added) return <td className={cls}>—</td>;
    if (game) cls += " ws-game";
  } else if (!onRoster) {
    cls += " pl-off";
  } else if (row.starts.has(d)) {
    cls += " ws-game";
  } else if (row.playing.has(d)) {
    cls += " ws-sits";
    title = `${row.name} has a game but sits — more players than starting spots`;
  } else if (game) {
    cls += " ws-out";
    title = `${row.name} is not expected to play`;
  }
  if (plannable && onRoster && addColor != null) cls += ` pl-span pl-c${addColor}`;
  if (plannable && !onRoster && dropColor != null && row.until != null && d >= row.until) {
    cls += ` pl-lost pl-c${dropColor}`;
  }
  if (today) cls += " ws-today";
  return (
    <td className={cls} title={title}>
      {game ?? "—"}
    </td>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono">{value}</div>
      {sub && <div className="metric-delta mono">{sub}</div>}
    </div>
  );
}

const MOVE_COLORS = 8;


/**
 * The grid's two groups: players no move touches, in today's lineup order (by value when
 * the live feed has no slots yet); then, move by move, the
 * player going out above the one coming in, so each pair reads together. A pickup who is
 * later dropped himself appears once, at his own add.
 */
function orderRows(rows: PlanRow[], moves: PlannedMove[], lineup: LineupOrder) {
  const byName = new Map(rows.map((r) => [r.name, r]));
  const touched = new Set(moves.flatMap((m) => [m.add, m.drop ?? ""]));
  const kept = byLineup(
    rows.filter((r) => !touched.has(r.name)),
    lineup,
    (a, b) => b.value - a.value
  );
  const moved: PlanRow[] = [];
  const seen = new Set<string>();
  for (const m of moves) {
    for (const name of [m.drop, m.add]) {
      const r = name ? byName.get(name) : undefined;
      if (r && !seen.has(r.name)) {
        seen.add(r.name);
        moved.push(r);
      }
    }
  }
  return { kept, moved };
}

/** The form's default drop: the lowest-value player you have not protected. */
function lowestDroppable(rows: PlanRow[], protect: Set<string>): PlanRow | undefined {
  const ok = rows.filter((r) => r.added || !protect.has(r.name));
  return ok.sort((a, b) => a.value - b.value)[0];
}
