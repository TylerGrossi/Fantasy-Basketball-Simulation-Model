"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import MultiSelect from "./MultiSelect";
import DraftPlan from "./DraftPlan";
import PlayerLink from "./PlayerLink";
import StatusBadge from "./StatusBadge";
import { POSITION_ORDER, headshotUrl } from "@/lib/playerPool";
import { NINE_CAT, scoreProjections, type DraftRow } from "@/lib/projection";
import {
  CONSENSUS_SOURCES,
  consensusRank,
  espnMarket,
  slotForPick,
  snakePicks,
  valuePct,
  type DraftData,
  type LiveDraft,
  type SourceKey,
  buildLineup,
  isCenter,
  recRank,
} from "@/lib/draft";
import {
  PERSONALITY_LABEL,
  botPick,
  gradeTeams,
  letterFor,
  personalityFor,
  type MockState,
  type MockStyle,
} from "@/lib/mockDraft";

/**
 * The draft board, built for draft night.
 *
 * Three jobs, top to bottom:
 *   1. WHERE AM I — the pick on the clock, your next two picks, and the live ESPN feed
 *      (polled through /api/draft) that removes drafted players on its own. Manual
 *      "Mine" / "Taken" marks cover a feed that is down, or a mock draft.
 *   2. WHERE IS THE VALUE — consensus (everyone but ESPN) against ESPN's market (ADP,
 *      else roto rank). ESPN rooms draft off ESPN's list, so "ESPN low, others high" is
 *      who falls; Val% prices a player at YOUR next pick.
 *   3. WHAT DO I NEED — your roster so far as per-category z totals, so the next pick can
 *      be chosen for the build, not only for the rank.
 *
 * All scoring runs here in the browser (~300 players x 15 categories): punting or
 * re-weighting a category re-ranks instantly.
 */

type Basis = "League" | "9-cat";
type SortKey =
  | "board"
  | "perGame"
  | "consensus"
  | "espn"
  | "adp"
  | "gap"
  | "val"
  | "fp"
  | "hb"
  | "hbLast"
  | "value"
  | "value25"
  | "gp"
  | "name";
type Marks = { taken: number[]; mine: number[] };

const WEIGHT_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const POLL_MS = 5000;

function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setV(JSON.parse(raw) as T);
    } catch {
      /* private mode etc. — fall back to the default */
    }
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [key]
  );
  return [v, set];
}

export default function DraftBoardView({ data }: { data: DraftData }) {
  const { league, lines, sources } = data;
  const nTeams = league.teams.length || 8;
  const rounds = league.rounds || 13;
  const leagueCats = league.categories;
  const store = `fbb-draft-${league.id}`;

  /* ---------------- filters & scoring ---------------- */
  const [name, setName] = useState("");
  const [positions, setPositions] = useState<string[]>([]);
  const [basis, setBasis] = useState<Basis>("League");
  const [punts, setPunts] = useStored<string[]>(`${store}-punts`, []);
  const [weights, setWeights] = useStored<Record<string, number>>(`${store}-weights`, {});
  const [showMore, setShowMore] = useState(false);
  const [allCols, setAllCols] = useStored<boolean>(`${store}-allcols`, false);
  const [drawer, setDrawer] = useState<"value" | "team" | "mock" | null>(null);
  // Default order is ESPN's rank (owner, 2026-10-19): the order the room actually drafts in.
  const [sort, setSort] = useState<SortKey>("espn");
  // Column-header sorting: click a header to sort by it, click again to reverse.
  // `desc` flips the column's NATURAL order (ranks ascend, values descend).
  const [desc, setDesc] = useState(false);
  const sortBy = (k: SortKey) => {
    if (k === sort) setDesc(!desc);
    else {
      setSort(k);
      setDesc(false);
    }
  };
  const [hideDrafted, setHideDrafted] = useState(true);
  const [srcLabels, setSrcLabels] = useStored<string[]>(
    `${store}-sources`,
    CONSENSUS_SOURCES.filter((s) => s.key !== "hbLast").map((s) => s.label)
  );
  const use: SourceKey[] = CONSENSUS_SOURCES.filter((s) => srcLabels.includes(s.label)).map(
    (s) => s.key
  );

  const allCats = basis === "League" ? leagueCats : NINE_CAT.filter((c) => leagueCats.includes(c));
  const categories = useMemo(() => allCats.filter((c) => !punts.includes(c)), [allCats, punts]);

  const scored = useMemo(
    () =>
      scoreProjections(lines, {
        categories,
        lowerIsBetter: league.lowerIsBetter,
        poolSize: nTeams * rounds,
        // ALWAYS season value: r.rank feeds consensus, Gap, Val, the stars and the Plan,
        // so it must not move when the display sort changes. "Per game" sorts by
        // r.perGame below instead.
        rankBy: "total",
        weights,
      }),
    [lines, categories, league.lowerIsBetter, nTeams, rounds, weights]
  );

  /* ---------------- draft state: live feed + manual marks ---------------- */
  const [live, setLive] = useState<LiveDraft | null>(null);
  const [liveOn, setLiveOn] = useStored<boolean>(`${store}-live`, true);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [marks, setMarks] = useStored<Marks>(`${store}-marks`, { taken: [], mine: [] });
  const [slotOverride, setSlotOverride] = useStored<number | null>(`${store}-slot`, null);
  // Mock draft: its own picks, never mixed with the live feed or the manual marks.
  const [mock, setMock] = useStored<MockState>(`${store}-mock`, {
    active: false,
    slot: 1,
    style: "espn",
    speedMs: 400,
    seed: 1,
    picks: [],
  });
  const mockOn = mock.active;
  const [view, setView] = useStored<"board" | "plan" | "recap">(`${store}-view`, "board");
  // "recap" moved to its own page (/draft-recap); a stored "recap" falls back to the board.
  const shownView = view === "recap" ? "board" : view;
  // ?view=plan / ?view=board opens a tab directly (bookmarkable, and testable headless).
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (v === "plan" || v === "board") setView(v);
  }, [setView]);

  useEffect(() => {
    if (!liveOn || mockOn) return;
    let stop = false;
    let failures = 0;
    let finished = false;
    let lastSig = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (ms: number) => {
      if (!stop) timer = setTimeout(tick, ms);
    };
    async function tick() {
      // A hidden tab does not need the feed; check again shortly instead of fetching.
      if (typeof document !== "undefined" && document.hidden) return schedule(POLL_MS);
      try {
        const r = await fetch("/api/draft", { cache: "no-store" });
        const j = (await r.json()) as LiveDraft;
        if (stop) return;
        if (!r.ok || j.error) {
          failures++;
          setLiveErr(j.error ?? `HTTP ${r.status}`);
        } else {
          failures = 0;
          setLiveErr(null);
          // Only re-render when the draft actually moved.
          const sig = `${j.picks.length}|${j.inProgress}|${j.drafted}|${j.pickOrder.join(",")}`;
          if (sig !== lastSig) {
            lastSig = sig;
            setLive(j);
          }
          finished = j.drafted;
        }
      } catch (e) {
        if (stop) return;
        failures++;
        setLiveErr(String(e));
      }
      // Finished drafts stop polling; repeated errors back off (5s, 10s, 20s ... 60s).
      if (finished) return;
      schedule(failures ? Math.min(60000, POLL_MS * 2 ** Math.min(failures, 4)) : POLL_MS);
    }
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [liveOn, mockOn]);

  const myTeamId = live?.myTeamId ?? league.myTeamId;
  const pickOrder = live?.pickOrder?.length ? live.pickOrder : league.pickOrder;
  const feedSlot = myTeamId != null ? pickOrder.indexOf(myTeamId) + 1 : 0;
  const mySlot = mockOn ? mock.slot : (slotOverride ?? (feedSlot > 0 ? feedSlot : 1));
  const myPicks = useMemo(() => snakePicks(mySlot, nTeams, rounds), [mySlot, nTeams, rounds]);
  const teamName = useMemo(
    () =>
      mockOn
        ? new Map(
            Array.from({ length: nTeams }, (_, i) => [
              i + 1,
              `Bot ${i + 1} (${PERSONALITY_LABEL[personalityFor(i + 1, mock.style)]})`,
            ])
          )
        : new Map((live?.teams ?? league.teams).map((t) => [t.id, t.abbrev || t.name])),
    [mockOn, mock.style, nTeams, live, league.teams]
  );

  /** playerId -> who has him. -1 = taken by someone (manual mark). */
  const owner = useMemo(() => {
    const m = new Map<number, number>();
    // In a mock the "team id" is the draft slot.
    if (mockOn) {
      for (const p of mock.picks) m.set(p.playerId, p.slot);
      return m;
    }
    for (const p of live?.picks ?? []) m.set(p.playerId, p.teamId);
    for (const id of marks.taken) if (!m.has(id)) m.set(id, -1);
    for (const id of marks.mine) if (!m.has(id)) m.set(id, myTeamId ?? -2);
    return m;
  }, [live, marks, myTeamId, mockOn, mock.picks]);

  const livePicks = live?.picks.length ?? 0;
  // While the feed is connected its count IS the draft; manual marks only stand in for a
  // feed that is off or failing. (Taking the max let stale test marks push the pick ahead.)
  // ESPN's league API returns NO picks while a draft is live (they arrive only after it
  // ends: learned on draft night, 2026-10-19), so an empty feed must not override marks.
  const feedUp = liveOn && live != null && !liveErr && livePicks > 0;
  const currentPick = mockOn ? mock.picks.length + 1 : feedUp ? livePicks + 1 : owner.size + 1;
  const draftOver = currentPick > nTeams * rounds;
  const nextMine = myPicks.find((p) => p >= currentPick) ?? myPicks[myPicks.length - 1];
  const afterMine = myPicks.find((p) => p > nextMine);
  const onClockSlot = slotForPick(currentPick, nTeams);

  const isMine = (id: number | null) =>
    id != null &&
    (mockOn
      ? owner.get(id) === mock.slot
      : owner.get(id) === myTeamId || (owner.get(id) === -2 && marks.mine.includes(id)));

  const toggle = (kind: "taken" | "mine", id: number) => {
    const has = marks[kind].includes(id);
    const other = kind === "taken" ? "mine" : "taken";
    setMarks({
      ...marks,
      [kind]: has ? marks[kind].filter((x) => x !== id) : [...marks[kind], id],
      [other]: marks[other].filter((x) => x !== id),
    } as Marks);
  };

  /* ---------------- value maths ---------------- */
  type Row = DraftRow & { cons: number; market?: number; gap?: number; val: number };
  const rows: Row[] = useMemo(
    () =>
      scored.map((r) => {
        const cons = consensusRank(r, r.rank, use);
        const market = espnMarket(r);
        return {
          ...r,
          cons,
          market,
          gap: market != null ? market - cons : undefined,
          val: valuePct(cons, nextMine),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scored, use.join(), nextMine]
  );

  const available = useMemo(
    () => rows.filter((r) => r.playerId == null || !owner.has(r.playerId)),
    [rows, owner]
  );

  /*
   * Recommended picks for YOUR next pick, as stars: 3 = first choice, 2 = second,
   * 1 = third and the other live options (up to five). Same rule as the Plan tab's
   * Options, so the two never disagree:
   *   - on the clock: the best available on this board, full stop (a player who fell
   *     past his ADP is exactly who you want);
   *   - otherwise: the best of those ESPN's market says will still be there at your pick.
   */
  const stars = useMemo(() => {
    const out = new Map<number, number>();
    if (draftOver) return out;
    const onClock = nextMine === currentPick;
    const centers = rows.filter((r) => isMine(r.playerId) && isCenter(r)).length;
    const cands = available
      .filter((r) => r.playerId != null)
      .filter((r) => onClock || (r.market ?? r.cons * 1.2) >= nextMine - 1.5)
      .sort((a, b) => recRank(a, centers) - recRank(b, centers))
      .slice(0, 5);
    cands.forEach((r, i) => out.set(r.playerId as number, i === 0 ? 3 : i === 1 ? 2 : 1));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, nextMine, currentPick, draftOver, rows, owner]);

  /** The last five picks in the current mode (mock, or the live feed), newest first. */
  const recentPicks = useMemo(() => {
    const src = mockOn
      ? mock.picks.map((p) => ({ pick: p.pick, playerId: p.playerId, team: p.slot }))
      : (live?.picks ?? []).map((p) => ({ pick: p.pick, playerId: p.playerId, team: p.teamId }));
    return [...src]
      .sort((a, b) => b.pick - a.pick)
      .slice(0, 5)
      .map((p) => {
        const r = rows.find((x) => x.playerId === p.playerId);
        const mine = mockOn ? p.team === mock.slot : p.team === myTeamId;
        return {
          pick: p.pick,
          name: r ? `${r.name} · ${r.eligibleSlots.join("/")}` : `Player ${p.playerId}`,
          team: mine ? "You" : mockOn ? `Bot ${p.team}` : (teamName.get(p.team) ?? `Team ${p.team}`),
          mine,
        };
      });
  }, [mockOn, mock.picks, mock.slot, live, rows, myTeamId, teamName]);

  /* ---------------- mock draft: bots, actions, grade ---------------- */
  const byId = useMemo(() => new Map(rows.map((r) => [r.playerId, r])), [rows]);
  const myTurn = !draftOver && onClockSlot === mySlot;

  useEffect(() => {
    if (!mockOn || draftOver || onClockSlot === mock.slot) return;
    const t = setTimeout(() => {
      const picks = [...mock.picks];
      const taken = new Set(picks.map((p) => p.playerId));
      // Speed 0 runs every bot up to your next turn in one go; otherwise one pick a tick.
      for (;;) {
        const pk = picks.length + 1;
        if (pk > nTeams * rounds) break;
        const slot = slotForPick(pk, nTeams);
        if (slot === mock.slot) break;
        const avail = rows.filter((r) => r.playerId != null && !taken.has(r.playerId));
        const roster = picks
          .filter((p) => p.slot === slot)
          .map((p) => byId.get(p.playerId))
          .filter((r): r is Row => r != null);
        const choice = botPick(
          avail,
          roster,
          personalityFor(slot, mock.style),
          Math.ceil(pk / nTeams),
          mock.seed,
          pk
        );
        if (!choice || choice.playerId == null) break;
        picks.push({ pick: pk, slot, playerId: choice.playerId });
        taken.add(choice.playerId);
        if (mock.speedMs > 0) break;
      }
      setMock({ ...mock, picks });
    }, mock.speedMs);
    return () => clearTimeout(t);
  }, [mockOn, mock, draftOver, onClockSlot, rows, byId, nTeams, rounds, setMock]);

  const startMock = (slot: number) =>
    setMock({ ...mock, active: true, slot, picks: [], seed: Math.floor(Math.random() * 1e9) });
  const draftPlayer = (id: number) =>
    setMock({ ...mock, picks: [...mock.picks, { pick: currentPick, slot: mock.slot, playerId: id }] });
  const undoMine = () => {
    const last = [...mock.picks].reverse().find((p) => p.slot === mock.slot);
    if (last) setMock({ ...mock, picks: mock.picks.filter((p) => p.pick < last.pick) });
  };

  const grades = useMemo(() => {
    if (!mockOn || !mock.picks.length) return [];
    const rosters = new Map<number, Row[]>();
    for (let s = 1; s <= nTeams; s++) rosters.set(s, []);
    for (const p of mock.picks) {
      const r = byId.get(p.playerId);
      if (r) rosters.get(p.slot)?.push(r);
    }
    return gradeTeams(rosters, categories, weights);
  }, [mockOn, mock.picks, byId, nTeams, categories, weights]);
  const myGrade = grades.find((g) => g.slot === mock.slot);

  const shown = useMemo(() => {
    const q = name.trim().toLowerCase();
    const base = (hideDrafted ? available : rows).filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (positions.length && !r.eligibleSlots.some((s) => positions.includes(s))) return false;
      return true;
    });
    const NA = 99999;
    const key: Record<SortKey, (r: Row) => number> = {
      board: (r) => r.rank,
      perGame: (r) => -r.perGame,
      consensus: (r) => r.cons,
      espn: (r) => r.espnRank ?? NA,
      adp: (r) => r.adp ?? NA,
      gap: (r) => (r.gap == null ? NA : -r.gap),
      val: (r) => -r.val,
      fp: (r) => r.fpRank ?? NA,
      hb: (r) => r.hbRank ?? NA,
      hbLast: (r) => r.hbLastRank ?? NA,
      value: (r) => -r.total,
      value25: (r) => (Number.isNaN(r.actualTotal) ? NA : -r.actualTotal),
      gp: (r) => -r.projGp,
      name: () => 0,
    };
    const sorted =
      sort === "name"
        ? [...base].sort((a, b) => a.name.localeCompare(b.name))
        : [...base].sort((a, b) => key[sort](a) - key[sort](b));
    // Reversing keeps players a source does not list at the BOTTOM either way — a
    // missing Hashtag rank is not "the worst rank".
    if (!desc) return sorted;
    const missing = sorted.filter((r) => key[sort](r) === NA);
    return [...sorted.filter((r) => key[sort](r) !== NA).reverse(), ...missing];
  }, [rows, available, hideDrafted, name, positions, sort, desc]);

  // The value board only considers players a sane drafter would take soon: consensus
  // inside the next two rounds of picks from now.
  const horizon = currentPick + nTeams * 2;
  const steals = useMemo(
    () =>
      available
        .filter((r) => r.gap != null && r.cons <= horizon && r.gap >= 3)
        .sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0))
        .slice(0, 3),
    [available, horizon]
  );
  const fades = useMemo(
    () =>
      available
        .filter((r) => r.market != null && r.market <= horizon && (r.gap ?? 0) <= -6)
        .sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0))
        .slice(0, 3),
    [available, horizon]
  );

  const myRows = rows.filter((r) => isMine(r.playerId));
  const teamZ = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of allCats) out[c] = myRows.reduce((a, r) => a + (r.z[c] ?? 0), 0);
    return out;
  }, [myRows, allCats]);

  const positionOptions = useMemo(() => {
    const present = new Set(lines.flatMap((l) => l.eligibleSlots).filter(Boolean));
    return POSITION_ORDER.filter((p) => present.has(p));
  }, [lines]);

  const maxAbs = Math.max(1, ...rows.slice(0, nTeams * rounds).map((r) => Math.abs(r.total)));
  const [open, setOpen] = useState<number | null>(null);

  /* ---------------- render ----------------
   * Table-first layout (owner, 2026-10-19: "the table is the main thing"). One slim
   * toolbar, an optional drawer for the secondary panels, one filter row, then the board.
   * Everything that used to sit open above the table is still here, one click away.
   */
  const nearPick = (r: Row) => {
    const m = r.market ?? r.cons;
    return m >= nextMine - nTeams * 2 && m <= nextMine + nTeams * 2;
  };
  const colCount = allCols ? 15 : 12;
  const liveText = !liveOn
    ? "Sync off"
    : liveErr
      ? "Feed error"
      : live
        ? live.inProgress
          ? `Live · ${livePicks} picks`
          : live.drafted
            ? "Draft finished"
            : "Connected"
        : "Connecting…";
  const activeFilters =
    punts.length + (basis !== "League" ? 1 : 0) + (Object.values(weights).some((w) => w !== 1) ? 1 : 0) +
    (hideDrafted ? 0 : 1);

  return (
    <>
      {/* ---- Toolbar: view, mode, where the draft is ---- */}
      <div className={`dg-toolbar${mockOn ? " is-mock" : ""}`}>
        <div className="dg-seg" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={shownView === "board"} className={`dg-seg-b${shownView === "board" ? " on" : ""}`} onClick={() => setView("board")}>
            Board
          </button>
          <button type="button" role="tab" aria-selected={view === "plan"} className={`dg-seg-b${view === "plan" ? " on" : ""}`} onClick={() => setView("plan")}>
            Plan
          </button>
        </div>
        <div className="dg-seg" role="tablist" aria-label="Draft mode">
          <button type="button" role="tab" aria-selected={!mockOn} className={`dg-seg-b${!mockOn ? " on" : ""}`} onClick={() => setMock({ ...mock, active: false })}>
            Live
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mockOn}
            className={`dg-seg-b${mockOn ? " on" : ""}`}
            onClick={() => (mock.picks.length ? setMock({ ...mock, active: true }) : startMock(mySlot))}
          >
            Mock
          </button>
        </div>

        <div className="dg-clock">
          {draftOver ? (
            <strong>Draft complete</strong>
          ) : (
            <>
              <span className="dg-clock-k">On the clock</span>
              <strong className="dg-mono">#{currentPick}</strong>
              <span className="dg-clock-sub">
                Rd {Math.ceil(currentPick / nTeams)}
                {onClockSlot === mySlot ? " · you" : ""}
              </span>
            </>
          )}
        </div>
        {!draftOver && (
          <div className="dg-clock">
            <span className="dg-clock-k">You pick</span>
            <strong className="dg-mono">
              {nextMine}
              {afterMine ? `, ${afterMine}` : ""}
            </strong>
            <span className={`dg-clock-sub${nextMine === currentPick ? " up" : ""}`}>
              {nextMine === currentPick ? "You're up" : `in ${nextMine - currentPick}`}
            </span>
          </div>
        )}

        <div className="dg-toolbar-end">
          {!mockOn && (
            <>
              <label className="dg-inline">
                Slot
                <select
                  className="field field-select dg-compact"
                  value={mySlot}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setSlotOverride(v === feedSlot ? null : v);
                  }}
                >
                  {Array.from({ length: nTeams }, (_, i) => i + 1).map((s) => (
                    <option key={s} value={s}>
                      {s}
                      {s === feedSlot ? " (ESPN)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={`dg-live-pill ${!liveOn ? "" : liveErr ? "bad" : live ? "ok" : ""}`}
                onClick={() => setLiveOn(!liveOn)}
                title={liveErr ? `ESPN feed error: ${liveErr}. Click to turn sync ${liveOn ? "off" : "on"}.` : `Live ESPN sync is ${liveOn ? "on" : "off"}. Click to toggle.`}
              >
                <span className="dg-dot" aria-hidden="true" />
                {liveText}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mock controls: a second, quieter row only while practising */}
      {mockOn && (
        <div className="dg-subbar">
          <span className="dg-subbar-k">Practice room</span>
          <label className="dg-inline">
            Slot
            <select
              className="field field-select dg-compact"
              value={mock.slot}
              onChange={(e) => {
                const v = e.target.value;
                startMock(v === "r" ? 1 + Math.floor(Math.random() * nTeams) : Number(v));
              }}
            >
              {Array.from({ length: nTeams }, (_, i) => i + 1).map((sl) => (
                <option key={sl} value={sl}>
                  {sl}
                </option>
              ))}
              <option value="r">Random</option>
            </select>
          </label>
          <label className="dg-inline">
            Bots
            <select
              className="field field-select dg-compact"
              value={mock.style}
              onChange={(e) =>
                setMock({ ...mock, style: e.target.value as MockStyle, picks: [], seed: Math.floor(Math.random() * 1e9) })
              }
            >
              <option value="espn">ESPN ADP</option>
              <option value="mixed">Mixed</option>
              <option value="experts">Experts</option>
            </select>
          </label>
          <label className="dg-inline">
            Speed
            <select
              className="field field-select dg-compact"
              value={mock.speedMs}
              onChange={(e) => setMock({ ...mock, speedMs: Number(e.target.value) })}
            >
              <option value={0}>Instant</option>
              <option value={400}>Fast</option>
              <option value={1500}>Watch</option>
            </select>
          </label>
          <button type="button" className="dg-btn" onClick={undoMine} disabled={!mock.picks.some((p) => p.slot === mock.slot)}>
            Undo pick
          </button>
          <button type="button" className="dg-btn" onClick={() => startMock(mock.slot)}>
            Restart
          </button>
          {myGrade && draftOver && (
            <span className="dg-subbar-grade">
              Grade <strong>{letterFor(myGrade.place, nTeams)}</strong> · {myGrade.place}
              {ordinal(myGrade.place)} of {nTeams}
            </span>
          )}
        </div>
      )}

      {shownView === "plan" ? (
        <DraftPlan
          rows={rows}
          myPicks={myPicks}
          mySlot={mySlot}
          currentPick={currentPick}
          owner={owner}
          isMine={isMine}
          results={
            mockOn
              ? mock.picks
                  .filter((p) => p.slot === mock.slot)
                  .map((p) => ({ round: Math.ceil(p.pick / nTeams), pick: p.pick, playerId: p.playerId }))
              : (live?.picks ?? [])
                  .filter((p) => p.teamId === myTeamId)
                  .map((p) => ({ round: p.round, pick: p.pick, playerId: p.playerId }))
          }
          resultLabel={mockOn ? "Mock result" : "Drafted"}
          storeKey={`${store}-plan`}
          centersHeld={myRows.filter(isCenter).length}
        />
      ) : (
        <>
          {/* ---- Drawer chips: the secondary panels, closed by default ---- */}
          <div className="dg-chips">
            <button type="button" className={`dg-chip dg-narrow-only${drawer === "value" ? " on" : ""}`} onClick={() => setDrawer(drawer === "value" ? null : "value")}>
              Value targets <span className="dg-chip-n">{steals.length}</span>
            </button>
            <button type="button" className={`dg-chip dg-narrow-only${drawer === "team" ? " on" : ""}`} onClick={() => setDrawer(drawer === "team" ? null : "team")}>
              Your team <span className="dg-chip-n">{myRows.length}</span>
            </button>
            {mockOn && (
              <button type="button" className={`dg-chip${drawer === "mock" ? " on" : ""}`} onClick={() => setDrawer(drawer === "mock" ? null : "mock")}>
                Draft grid
              </button>
            )}
            <span className="dg-legend" title={`Recommended for pick ${nextMine}`}>
              <span className="dg-stars s3">{"★★★"}</span>
              <span className="dg-stars s2">{"★★"}</span>
              <span className="dg-stars s1">{"★"}</span> picks for #{nextMine}
            </span>
          </div>

          {drawer === "value" && (
            <div className="dg-drawer dg-panels dg-narrow-only">
              <section className="dg-panel">
                <h2 className="dg-h">ESPN low, others high</h2>
                <p className="dg-note">
                  The consensus likes them more than ESPN&rsquo;s market, so they tend to fall.{" "}
                  <em>Take at</em> is your last pick before his ESPN ADP.
                </p>
                <ValueList rows={steals} myPicks={myPicks} currentPick={currentPick} onPick={setOpen} />
              </section>
              <section className="dg-panel">
                <h2 className="dg-h">ESPN high, others low</h2>
                <p className="dg-note">Let someone else reach for these.</p>
                <ValueList rows={fades} myPicks={myPicks} currentPick={currentPick} onPick={setOpen} />
              </section>
            </div>
          )}
          {drawer === "team" && (
            <div className="dg-drawer dg-narrow-only">
              <section className="dg-panel">
                {myRows.length === 0 ? (
                  <p className="dg-note">
                    Your picks appear here from the live feed, the Mine button, or a mock.
                  </p>
                ) : (
                  <div className="dg-team">
                    <PosCounter players={myRows} />
                  <Lineup players={myRows} slots={league.rosterSlots} />
                    <div>
                      <CategoryBars z={teamZ} />
                      <p className="dg-note">
                        Weakest:{" "}
                        <strong>
                          {Object.entries(teamZ)
                            .filter(([c]) => !punts.includes(c))
                            .sort((a, b) => a[1] - b[1])
                            .slice(0, 3)
                            .map(([c]) => c)
                            .join(", ")}
                        </strong>
                      </p>
                    </div>
                  </div>
                )}
                {!mockOn && (marks.taken.length > 0 || marks.mine.length > 0) && (
                  <button
                    type="button"
                    className="dg-btn"
                    onClick={() => {
                      if (confirm("Clear every manual Mine / Taken mark?")) setMarks({ taken: [], mine: [] });
                    }}
                  >
                    Clear manual marks ({marks.taken.length + marks.mine.length})
                  </button>
                )}
              </section>
            </div>
          )}
          {drawer === "mock" && mockOn && (
            <div className="dg-drawer">
              <MockResults
                picks={mock.picks}
                mySlot={mock.slot}
                nTeams={nTeams}
                rounds={rounds}
                byId={byId}
                teamName={teamName}
                grades={grades}
                categories={categories}
                currentPick={currentPick}
              />
            </div>
          )}

          <div className="dg-layout">
          <div className="dg-main">
          {/* ---- One filter row; the rest behind "More" ---- */}
          <div className="dg-filters">
            <input
              className="field dg-search"
              type="search"
              placeholder="Search players…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Search players"
            />
            <div className="dg-posbar" role="group" aria-label="Position">
              {["All", ...positionOptions].map((p) => {
                const on = p === "All" ? positions.length === 0 : positions.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    className={`dg-pos-b${on ? " on" : ""}`}
                    onClick={() =>
                      setPositions(p === "All" ? [] : on ? positions.filter((x) => x !== p) : [...positions, p])
                    }
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <label className="dg-inline">
              Sort
              <select
                className="field field-select dg-compact"
                value={["board", "perGame", "consensus", "gap", "espn", "adp"].includes(sort) ? sort : ""}
                onChange={(e) => {
                  setSort(e.target.value as SortKey);
                  setDesc(false);
                }}
              >
                {!["board", "perGame", "consensus", "gap", "espn", "adp"].includes(sort) && <option value="">Column</option>}
                <option value="espn">ESPN rank</option>
                <option value="adp">ESPN ADP</option>
                <option value="consensus">Consensus</option>
                <option value="gap">Value vs ESPN</option>
                <option value="board">Board</option>
                <option value="perGame">Board, per game</option>
              </select>
            </label>
            <button type="button" className={`dg-btn${showMore ? " on-soft" : ""}`} onClick={() => setShowMore(!showMore)}>
              More filters{activeFilters ? ` (${activeFilters})` : ""}
            </button>
            <label className="dg-inline dg-filters-end">
              <input type="checkbox" checked={allCols} onChange={(e) => setAllCols(e.target.checked)} />
              All sources
            </label>
          </div>

          {showMore && (
            <div className="dg-more">
              <MultiSelect label="Punt categories" options={allCats} selected={punts} onChange={setPunts} className="dg-ms" />
              <MultiSelect
                label="Consensus uses"
                options={CONSENSUS_SOURCES.map((s) => s.label)}
                selected={srcLabels}
                onChange={setSrcLabels}
                placeholder="Board only"
                className="dg-ms"
              />
              <div className="ms">
                <div className="ms-label">Categories</div>
                <select className="field field-select" value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
                  <option value="League">League ({leagueCats.length})</option>
                  <option value="9-cat">9-cat</option>
                </select>
              </div>
              <label className="dg-inline dg-f-check">
                <input type="checkbox" checked={hideDrafted} onChange={(e) => setHideDrafted(e.target.checked)} />
                Hide drafted
              </label>
              <div className="dg-weights">
                <span className="ms-label">Category weights</span>
                {allCats.map((c) => (
                  <label key={c} className="dg-inline">
                    {c}
                    <select
                      className="field field-select dg-compact"
                      value={weights[c] ?? 1}
                      onChange={(e) => setWeights({ ...weights, [c]: Number(e.target.value) })}
                    >
                      {WEIGHT_STEPS.map((w) => (
                        <option key={w} value={w}>
                          x{w}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <button type="button" className="dg-btn" onClick={() => setWeights({})}>
                  Reset
                </button>
              </div>
            </div>
          )}
          {(punts.length > 0 || Object.values(weights).some((w) => w !== 1)) && (
            <p className="dg-punt-note">
              {punts.length > 0 && (
                <>
                  Punting <strong>{punts.join(", ")}</strong>.{" "}
                </>
              )}
              {Object.entries(weights)
                .filter(([, w]) => w !== 1)
                .map(([c, w]) => `${c} x${w}`)
                .join(", ")}
            </p>
          )}

          {/* ---- The board ---- */}
          <div className="table-scroll dg-scroll">
            <table className="sheet dg-board">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <SortTh k="name" cur={sort} desc={desc} on={sortBy} className="dg-sticky" left>
                    Player
                  </SortTh>
                  <SortTh k="espn" cur={sort} desc={desc} on={sortBy} title="ESPN roto rank: the order an ESPN room drafts in">
                    ESPN
                  </SortTh>
                  <SortTh k="adp" cur={sort} desc={desc} on={sortBy} title="ESPN average draft position">
                    ADP
                  </SortTh>
                  <SortTh k="consensus" cur={sort} desc={desc} on={sortBy} title="Consensus of the sources you picked (never ESPN)">
                    Cons
                  </SortTh>
                  {allCols && (
                    <>
                      <SortTh k="fp" cur={sort} desc={desc} on={sortBy} title="FantasyPros expert consensus">
                        FP
                      </SortTh>
                      <SortTh k="hb" cur={sort} desc={desc} on={sortBy} title="Hashtag 2026-27 projections, top 30, your categories">
                        HB
                      </SortTh>
                      <SortTh k="hbLast" cur={sort} desc={desc} on={sortBy} title="Hashtag last season, your categories (pasted)">
                        HB&rsquo;26
                      </SortTh>
                    </>
                  )}
                  <SortTh k="gap" cur={sort} desc={desc} on={sortBy} title="ESPN market minus consensus. Positive = ESPN is low on him = value">
                    Gap
                  </SortTh>
                  <SortTh k="val" cur={sort} desc={desc} on={sortBy} title={`Value % if taken at your next pick (${nextMine}); shown for players near that pick`}>
                    Val
                  </SortTh>
                  <SortTh k="board" cur={sort} desc={desc} on={sortBy} title="This board: your league's categories, ESPN projections">
                    Board
                  </SortTh>
                  <SortTh k="value25" cur={sort} desc={desc} on={sortBy} title="2025-26 ACTUAL value: last season's line on the same scale, x games actually played">
                    25-26 Value
                  </SortTh>
                  <SortTh k="value" cur={sort} desc={desc} on={sortBy} title="Projected 2026-27 value: projected z-sum x projected games">
                    Proj Value
                  </SortTh>
                  <SortTh k="gp" cur={sort} desc={desc} on={sortBy} title="Projected games">
                    GP
                  </SortTh>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const id = r.playerId ?? -1;
                  const who = r.playerId != null ? owner.get(r.playerId) : undefined;
                  const mine = isMine(r.playerId);
                  const tierBreak =
                    (sort === "board" || sort === "perGame") && !desc && i > 0 && shown[i - 1].tier !== r.tier;
                  // Faded, not labelled: expected to be gone before your pick.
                  const gone =
                    nextMine !== currentPick && r.market != null && r.market < nextMine - 1.5 && who == null;
                  const v = r.total;
                  const st = r.playerId != null ? stars.get(r.playerId) : undefined;
                  return (
                    <Fragment key={`${r.name}-${id}`}>
                      {tierBreak && (
                        <tr className="dg-tier-row">
                          <td colSpan={colCount}>Tier {r.tier}</td>
                        </tr>
                      )}
                      <tr
                        className={`dg-row${who != null ? (mine ? " is-mine" : " is-taken") : ""}${gone ? " is-gone" : ""}${st ? " is-rec" : ""}${open === id ? " is-open" : ""}`}
                        onClick={() => setOpen(open === id ? null : id)}
                      >
                        <td className="num dg-dim">{i + 1}</td>
                        <td className="dg-sticky">
                          <div className="dg-pname">
                            <span className="dg-nm">{r.name}</span>
                            {st && (
                              <span
                                className={`dg-stars s${st}`}
                                title={`Recommended for pick ${nextMine}: ${st === 3 ? "first choice" : st === 2 ? "second choice" : "also in play"}`}
                              >
                                {"★".repeat(st)}
                              </span>
                            )}
                            <StatusBadge status={r.status} />
                            {r.rookie && <span className="dg-tag" title="Rookie">R</span>}
                          </div>
                          <div className="dg-sub">
                            {r.eligibleSlots.join("/") || r.position} · {r.nbaTeam}
                            {who != null && (
                              <span className="dg-owner"> · {mine ? "yours" : who > 0 ? teamName.get(who) : "taken"}</span>
                            )}
                          </div>
                        </td>
                        <td className="num dg-strong">{r.espnRank ?? "—"}</td>
                        <td className="num">{r.adp != null ? r.adp.toFixed(0) : "—"}</td>
                        <td className="num">{r.cons.toFixed(0)}</td>
                        {allCols && (
                          <>
                            <td className="num dg-dim">{r.fpRank ?? "—"}</td>
                            <td className="num dg-dim">{r.hbRank ?? "—"}</td>
                            <td className="num dg-dim">{r.hbLastRank ?? "—"}</td>
                          </>
                        )}
                        <td className={`num ${gapClass(r.gap)}`}>{r.gap != null ? signed(r.gap, 0) : "—"}</td>
                        <td
                          className={`num ${nearPick(r) ? (r.val >= 10 ? "good" : r.val <= -25 ? "bad" : "") : "dg-dim"}`}
                          title={nearPick(r) ? `${signed(r.val, 0)}% at pick ${nextMine}` : undefined}
                        >
                          {/* Capped: a % of a small pick number explodes (consensus 52 at
                              pick 8 is -544%), and past -100% it only says "reach". */}
                          {!nearPick(r) ? "—" : r.val <= -100 ? "≤-100%" : `${signed(Math.min(r.val, 100), 0)}%`}
                        </td>
                        <td className="num dg-dim">{r.rank}</td>
                        <td
                          className={`num ${Number.isNaN(r.actualTotal) ? "dg-dim" : r.actualTotal >= 0 ? "" : "bad"}`}
                          title={Number.isNaN(r.actualTotal) ? "No 2025-26 line" : `${r.gp} games played in 2025-26`}
                        >
                          {Number.isNaN(r.actualTotal) ? "—" : signed(r.actualTotal, 1)}
                        </td>
                        <td className="num dg-valcell">
                          <span
                            className="dg-vbar"
                            style={{
                              width: `${Math.min(100, (Math.abs(v) / maxAbs) * 100).toFixed(0)}%`,
                              background: v >= 0 ? "var(--cobalt)" : "var(--clay)",
                            }}
                          />
                          <span className="dg-vnum">{signed(v, 1)}</span>
                        </td>
                        <td className="num dg-dim">{r.projGp}</td>
                        <td className="dg-acts" onClick={(e) => e.stopPropagation()}>
                          {mockOn ? (
                            r.playerId != null &&
                            who == null && (
                              <button type="button" className="dg-btn sm on dg-act-draft" disabled={!myTurn} onClick={() => draftPlayer(id)}>
                                Draft
                              </button>
                            )
                          ) : (
                            r.playerId != null &&
                            (who == null || marks.mine.includes(id) || marks.taken.includes(id)) && (
                              <>
                                <button
                                  type="button"
                                  className={`dg-btn sm${marks.mine.includes(id) ? " on" : ""}`}
                                  onClick={() => toggle("mine", id)}
                                >
                                  Mine
                                </button>
                                <button
                                  type="button"
                                  className={`dg-btn sm${marks.taken.includes(id) ? " on" : ""}`}
                                  onClick={() => toggle("taken", id)}
                                >
                                  Taken
                                </button>
                              </>
                            )
                          )}
                        </td>
                      </tr>
                      {open === id && (
                        <tr className="dg-detail-row">
                          <td colSpan={colCount}>
                            <Detail r={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && <p className="caption">No players match these filters.</p>}
          </div>

          {/* ---- Your team, pinned on the right (wide screens) ---- */}
          <aside className="dg-side" aria-label="Your team">
            <div className="dg-side-in">
              {recentPicks.length > 0 && (
                <div className="dg-side-log">
                  <div className="dg-side-h">
                    <h2 className="dg-h">Last picks</h2>
                    <span className="dg-dim">{mockOn ? "mock" : "live"}</span>
                  </div>
                  <ol className="dg-log">
                    {recentPicks.map((p) => (
                      <li key={p.pick} className={p.mine ? "is-me" : ""}>
                        <span className="dg-log-pk dg-mono">#{p.pick}</span>
                        <span className="dg-log-nm">{p.name}</span>
                        <span className="dg-log-tm">{p.team}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="dg-side-h">
                <h2 className="dg-h">Your team</h2>
                <span className="dg-dim dg-mono">
                  {myRows.length}/{rounds}
                </span>
              </div>
              {myRows.length === 0 ? (
                <>
                  <PosCounter players={[]} />
                  <Lineup players={[]} slots={league.rosterSlots} />
                  <p className="dg-note">Fills in from the live feed, the Mine button, or a mock.</p>
                </>
              ) : (
                <>
                  <PosCounter players={myRows} />
                  <Lineup players={myRows} slots={league.rosterSlots} />
                  <CategoryBars z={teamZ} />
                  <p className="dg-note">
                    Weakest:{" "}
                    <strong>
                      {Object.entries(teamZ)
                        .filter(([c]) => !punts.includes(c))
                        .sort((a, b) => a[1] - b[1])
                        .slice(0, 3)
                        .map(([c]) => c)
                        .join(", ")}
                    </strong>
                  </p>
                </>
              )}
              <div className="dg-side-block">
                <div className="dg-side-h">
                  <h2 className="dg-h">Value targets</h2>
                  <span className="dg-dim" title="ESPN's market is lower on them than the consensus">ESPN low</span>
                </div>
                <SideValue rows={steals} myPicks={myPicks} currentPick={currentPick} onPick={setOpen} />
                {fades.length > 0 && (
                  <>
                    <h3 className="dg-h3">Let others reach</h3>
                    <SideValue rows={fades} myPicks={myPicks} currentPick={currentPick} onPick={setOpen} />
                  </>
                )}
              </div>
              {mockOn && (
                <div className="dg-side-block">
                  <div className="dg-side-h">
                    <h2 className="dg-h">Mock standings</h2>
                    <span className="dg-dim">{draftOver ? "final" : "so far"}</span>
                  </div>
                  {grades.length === 0 ? (
                    <p className="dg-note">Standings appear after the first pick.</p>
                  ) : (
                    <>
                      <table className="sheet dg-vtable dg-side-table">
                        <thead>
                          <tr>
                            <th className="num">#</th>
                            <th>Team</th>
                            <th className="num">W-L-T</th>
                            <th className="num">Gr</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...grades]
                            .sort((a, b) => a.place - b.place)
                            .map((g) => (
                              <tr key={g.slot} className={g.slot === mock.slot ? "dg-me" : ""}>
                                <td className="num">{g.place}</td>
                                <td>{g.slot === mock.slot ? "You" : `Bot ${g.slot}`}</td>
                                <td className="num">
                                  {fmtW(g.wins)}-{fmtW(g.losses)}-{fmtW(g.ties)}
                                </td>
                                <td className="num">{letterFor(g.place, grades.length)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {myGrade && (
                        <div className="dg-catranks">
                          {categories.map((c) => (
                            <span
                              key={c}
                              className={`dg-cr${myGrade.catRank[c] <= 2 ? " good" : myGrade.catRank[c] >= nTeams - 1 ? " bad" : ""}`}
                              title={`${c}: ${myGrade.catRank[c]} of ${nTeams}`}
                            >
                              {c} <b>{myGrade.catRank[c]}</b>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {!mockOn && (marks.taken.length > 0 || marks.mine.length > 0) && (
                <button
                  type="button"
                  className="dg-btn sm"
                  onClick={() => {
                    if (confirm("Clear every manual Mine / Taken mark?")) setMarks({ taken: [], mine: [] });
                  }}
                >
                  Clear manual marks ({marks.taken.length + marks.mine.length})
                </button>
              )}
            </div>
          </aside>
          </div>

          <details className="dg-method">
            <summary>How these numbers work</summary>
            <p>
              <strong>Projections</strong> are ESPN&rsquo;s own {league.season - 1}-
              {String(league.season % 100).padStart(2, "0")} per-game projections, with manual
              adjustments for news since (shown on each player&rsquo;s card). ESPN does not
              project <strong>DD</strong> or <strong>TW</strong>: DD comes from each
              player&rsquo;s own rate, TW from his team&rsquo;s win rate last season pulled 40%
              toward .500.
            </p>
            <p>
              <strong>Board</strong> ranks those projections on this league&rsquo;s{" "}
              {leagueCats.length} categories (z-scores against the top {nTeams * rounds}, percentages
              weighted by volume, times projected games). <strong>Cons</strong> averages the
              sources under &ldquo;Consensus uses&rdquo;, never ESPN. <strong>Gap</strong> is
              ESPN&rsquo;s market minus consensus: positive means ESPN is low on him.{" "}
              <strong>Val</strong> is (pick &minus; consensus) &divide; pick at your next pick,
              shown only for players near it. Faded rows are expected to be gone before your
              pick; stars are the recommended picks for it.
            </p>
            <p className="caption">
              Sources: ESPN ({sources.espn}); FantasyPros ECR ({sources.fantasypros ?? "unavailable"});
              Hashtag projections, {sources.hashtag ?? "unavailable"}; Hashtag last season,{" "}
              {sources.hashtagLast ?? "not provided"}. Exported{" "}
              {data.generatedAt.slice(0, 16).replace("T", " ")} UTC.
              {league.unknownStatIds.length > 0 && ` Unscored stat ids: ${league.unknownStatIds.join(", ")}.`}
            </p>
          </details>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- pieces */

function signed(v: number, d: number): string {
  const s = Math.abs(v).toFixed(d);
  if (Number(s) === 0) return (0).toFixed(d);
  return v > 0 ? `+${s}` : `-${s}`;
}

/**
 * The pick you would actually spend on a player: your LAST pick before ESPN's market says
 * he goes (waiting any longer risks losing him), and never one already gone. Falls back to
 * your next pick when he will not last that long.
 */
function targetPick(market: number | undefined, myPicks: number[], currentPick: number): number {
  const open = myPicks.filter((p) => p >= currentPick);
  if (!open.length) return currentPick;
  if (market == null) return open[0];
  const before = open.filter((p) => p <= market);
  return before.length ? before[before.length - 1] : open[0];
}

function gapClass(g?: number): string {
  if (g == null) return "dg-dim";
  if (g >= 8) return "good";
  if (g <= -8) return "bad";
  return "";
}

function ValueList({
  rows,
  myPicks,
  currentPick,
  onPick,
}: {
  rows: (DraftRow & { cons: number; market?: number; gap?: number })[];
  myPicks: number[];
  currentPick: number;
  onPick: (id: number) => void;
}) {
  if (!rows.length) return <p className="dg-note dg-dim">Nothing stands out right now.</p>;
  return (
    <div className="dg-vscroll">
    <table className="sheet dg-vtable">
      <thead>
        <tr>
          <th>Player</th>
          <th className="num">Cons</th>
          <th className="num">ESPN</th>
          <th className="num">Gap</th>
          <th className="num" title="Your last pick before ESPN's ADP for him">Take at</th>
          <th className="num" title="(pick - consensus) / pick, at that pick">Val</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} onClick={() => r.playerId != null && onPick(r.playerId)} className="dg-row">
            <td>
              {r.name} <span className="dg-dim">{r.eligibleSlots.join("/")}</span>
            </td>
            <td className="num">{r.cons.toFixed(0)}</td>
            <td className="num">{r.market != null ? r.market.toFixed(0) : "—"}</td>
            <td className={`num ${gapClass(r.gap)}`}>{r.gap != null ? signed(r.gap, 0) : "—"}</td>
            {(() => {
              const t = targetPick(r.market, myPicks, currentPick);
              const v = valuePct(r.cons, t);
              return (
                <>
                  <td className="num">{t}</td>
                  <td className={`num ${v >= 10 ? "good" : v <= -25 ? "bad" : ""}`}>{signed(v, 0)}%</td>
                </>
              );
            })()}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

let outlookCache: Record<string, string> | null = null;
let outlookPromise: Promise<Record<string, string>> | null = null;
function loadOutlooks(): Promise<Record<string, string>> {
  if (outlookCache) return Promise.resolve(outlookCache);
  outlookPromise ??= fetch("/data/draft-outlooks.json")
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((j) => (outlookCache = j as Record<string, string>));
  return outlookPromise;
}

function Detail({ r }: { r: DraftRow & { cons: number } }) {
  const [outlook, setOutlook] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (r.playerId != null)
      void loadOutlooks().then((o) => live && setOutlook(o[String(r.playerId)] ?? ""));
    return () => {
      live = false;
    };
  }, [r.playerId]);
  const shot = headshotUrl(r.playerId);
  const hasActual = Object.keys(r.actual).length > 0;
  return (
    <div className="dg-detail">
      <div className="pv-card">
        {shot ? <div className="pv-shot" style={{ backgroundImage: `url('${shot}')` }} /> : <div className="pv-shot pv-shot-blank" />}
        <div className="pv-chead">
          <div className="pv-cname">
            <PlayerLink name={r.name} />
          </div>
          <div className="pv-csub">
            <span className="pv-cmeta">
              {[
                r.nbaTeam,
                r.eligibleSlots.join("/") || r.position,
                r.age != null ? `Age ${r.age}` : null,
                r.exp != null ? (r.exp === 0 ? "Rookie" : `${r.exp} yrs`) : null,
                r.projMin != null ? `${r.projMin.toFixed(1)} proj min` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
      </div>
      {r.drivers.length > 0 && (
        <ul className="dg-drivers">
          {r.drivers.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <div className="dg-ranks">
        <span>Board {r.rank}</span>
        <span>Consensus {r.cons.toFixed(1)}</span>
        <span>ESPN roto {r.espnRank ?? "—"}</span>
        <span>ESPN points {r.espnStdRank ?? "—"}</span>
        <span>ADP {r.adp ?? "—"}</span>
        <span>FantasyPros {r.fpRank ?? "—"}</span>
        <span>Hashtag {r.hbRank ?? "—"}</span>
        <span>Hashtag &rsquo;26 {r.hbLastRank ?? "—"}</span>
      </div>
      <div className="table-scroll">
        <table className="sheet dg-table">
          <thead>
            <tr>
              <th>Per game</th>
              {["GP", "PTS", "REB", "AST", "3PM", "STL", "BLK", "TO", "DD", "TW", "FG%", "FT%", "3P%"].map((h) => (
                <th key={h} className="num">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasActual && (
              <tr className="dg-dim">
                <th scope="row">Last season</th>
                <StatCells gp={r.gp} line={r.actual} pct={[r.fgPct, r.ftPct, r.tpPct]} />
              </tr>
            )}
            <tr>
              <th scope="row">Projected</th>
              <StatCells gp={r.projGp} line={r.proj} pct={[r.projFgPct, r.projFtPct, r.projTpPct]} />
            </tr>
          </tbody>
        </table>
      </div>
      <CategoryBars z={r.z} />
      {outlook && <p className="dg-outlook">{outlook}</p>}
    </div>
  );
}

function StatCells({ gp, line, pct }: { gp: number; line: Record<string, number>; pct: number[] }) {
  const one = (k: string, d = 1) => (line[k] ?? 0).toFixed(d);
  return (
    <>
      <td className="num">{gp}</td>
      <td className="num">{one("PTS")}</td>
      <td className="num">{one("REB")}</td>
      <td className="num">{one("AST")}</td>
      <td className="num">{one("3PM")}</td>
      <td className="num">{one("STL")}</td>
      <td className="num">{one("BLK")}</td>
      <td className="num">{one("TO")}</td>
      <td className="num">{one("DD", 2)}</td>
      <td className="num">{one("TW", 2)}</td>
      {pct.map((p, i) => (
        <td key={i} className="num">
          {(p * 100).toFixed(1)}
        </td>
      ))}
    </>
  );
}

/** Per-category z as a diverging strip — where the value comes from. */
function CategoryBars({ z }: { z: Record<string, number> }) {
  const entries = Object.entries(z);
  if (!entries.length) return null;
  const peak = Math.max(1, ...entries.map(([, v]) => Math.abs(v)));
  return (
    <div className="dg-bars">
      {entries.map(([cat, v]) => (
        <div className="dg-bar" key={cat}>
          <span className="dg-bar-l">{cat}</span>
          <span className="dg-bar-track">
            <span
              className="dg-bar-fill"
              style={{
                width: `${((Math.abs(v) / peak) * 50).toFixed(1)}%`,
                [v >= 0 ? "left" : "right"]: "50%",
                background: v >= 0 ? "var(--good)" : "var(--bad)",
              }}
            />
          </span>
          <span className="dg-bar-v">{signed(v, 1)}</span>
        </div>
      ))}
    </div>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

type GradeRow = ReturnType<typeof gradeTeams>[number];

/**
 * The mock's projected standings and draft grid (round x team). Shown during the mock as
 * well as after it, because "where would I finish if it ended now" is the useful question
 * at every turn, not only at the end.
 */
function MockResults({
  picks,
  mySlot,
  nTeams,
  rounds,
  byId,
  teamName,
  grades,
  categories,
  currentPick,
}: {
  picks: { pick: number; slot: number; playerId: number }[];
  mySlot: number;
  nTeams: number;
  rounds: number;
  byId: Map<number | null, DraftRow & { cons: number }>;
  teamName: Map<number, string>;
  grades: GradeRow[];
  categories: string[];
  currentPick: number;
}) {
  const byPick = new Map(picks.map((p) => [p.pick, p]));
  const mine = picks
    .filter((p) => p.slot === mySlot)
    .map((p) => ({ p, r: byId.get(p.playerId) }))
    .filter((x): x is { p: (typeof picks)[number]; r: DraftRow & { cons: number } } => x.r != null);
  const values = [...mine].sort((a, b) => b.p.pick - b.r.cons - (a.p.pick - a.r.cons));
  const me = grades.find((g) => g.slot === mySlot);
  return (
    <section className="dg-mock">
      <div className="dg-panels dg-narrow-only">
        <div className="dg-panel">
          <h2 className="dg-h">
            Projected standings{currentPick <= nTeams * rounds ? " (so far)" : ""}
          </h2>
          <p className="dg-note">
            Category all-play: every team&rsquo;s per-category z total against every other
            team&rsquo;s, the way a category week is decided.
          </p>
          {grades.length === 0 ? (
            <p className="dg-note dg-dim">Standings appear after the first pick.</p>
          ) : (
            <div className="dg-vscroll">
              <table className="sheet dg-vtable">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Team</th>
                    <th className="num">W-L-T</th>
                    <th className="num">Pct</th>
                    <th className="num">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {[...grades]
                    .sort((a, b) => a.place - b.place)
                    .map((g) => (
                      <tr key={g.slot} className={g.slot === mySlot ? "dg-me" : ""}>
                        <td className="num">{g.place}</td>
                        <td>{g.slot === mySlot ? `You (slot ${g.slot})` : teamName.get(g.slot)}</td>
                        <td className="num">
                          {fmtW(g.wins)}-{fmtW(g.losses)}-{fmtW(g.ties)}
                        </td>
                        <td className="num">{(g.pct * 100).toFixed(0)}%</td>
                        <td className="num">{letterFor(g.place, grades.length)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="dg-panel">
          <h2 className="dg-h">Your categories</h2>
          {!me ? (
            <p className="dg-note">Make a pick to see where you rank in each category.</p>
          ) : (
            <div className="dg-catranks">
              {categories.map((c) => (
                <span
                  key={c}
                  className={`dg-cr${me.catRank[c] <= 2 ? " good" : me.catRank[c] >= nTeams - 1 ? " bad" : ""}`}
                  title={`${c}: ${me.catRank[c]} of ${nTeams}`}
                >
                  {c} <b>{me.catRank[c]}</b>
                </span>
              ))}
            </div>
          )}
          {values.length > 0 && (
            <>
              <h3 className="dg-h3">Your picks vs consensus</h3>
              <ul className="dg-roster">
                {values.map(({ p, r }) => {
                  const d = p.pick - r.cons;
                  return (
                    <li key={p.pick}>
                      <span>
                        <span className="dg-dim">#{p.pick}</span> {r.name}
                      </span>
                      <span className={d >= 3 ? "dg-good" : d <= -8 ? "dg-bad" : "dg-dim"}>
                        {d >= 0 ? `value +${d.toFixed(0)}` : `reach ${d.toFixed(0)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
      <div className="table-scroll dg-grid-wrap">
        <table className="sheet dg-grid">
          <thead>
            <tr>
              <th className="num">Rd</th>
              {Array.from({ length: nTeams }, (_, i) => (
                <th key={i} className={i + 1 === mySlot ? "dg-me" : ""}>
                  {i + 1 === mySlot ? "You" : `Bot ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rounds }, (_, r) => (
              <tr key={r}>
                <td className="num dg-dim">{r + 1}</td>
                {Array.from({ length: nTeams }, (_, i) => {
                  const slot = i + 1;
                  const pk = r * nTeams + (r % 2 === 0 ? slot : nTeams - slot + 1);
                  const p = byPick.get(pk);
                  const row = p ? byId.get(p.playerId) : undefined;
                  return (
                    <td
                      key={i}
                      className={`${slot === mySlot ? "dg-me" : ""}${pk === currentPick ? " dg-onclock" : ""}`}
                      title={row ? `#${pk} ${row.name}` : `#${pk}`}
                    >
                      {row ? row.name.split(" ").slice(-1)[0] : <span className="dg-dim">{pk}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A clickable, keyboard-reachable sort header. The arrow shows the active direction. */
function SortTh({
  k,
  cur,
  desc,
  on,
  title,
  className = "",
  left = false,
  children,
}: {
  k: SortKey;
  cur: SortKey;
  desc: boolean;
  on: (k: SortKey) => void;
  title?: string;
  className?: string;
  left?: boolean;
  children: React.ReactNode;
}) {
  const active = k === cur || (k === "board" && cur === "perGame");
  return (
    <th
      className={`${left ? "" : "num "}dg-sort${active ? " on" : ""} ${className}`.trim()}
      title={title ? `${title} (click to sort)` : "Click to sort"}
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
    >
      <button type="button" className="dg-sort-b" onClick={() => on(k)}>
        {children}
        <span className="dg-sort-i" aria-hidden="true">
          {active ? (desc ? "\u25B2" : "\u25BC") : ""}
        </span>
      </button>
    </th>
  );
}

/** The sidebar's compact value list: player, Gap, and the pick to take him at. */
function SideValue({
  rows,
  myPicks,
  currentPick,
  onPick,
}: {
  rows: (DraftRow & { cons: number; market?: number; gap?: number })[];
  myPicks: number[];
  currentPick: number;
  onPick: (id: number) => void;
}) {
  if (!rows.length) return <p className="dg-note dg-dim">Nothing stands out right now.</p>;
  return (
    <table className="sheet dg-vtable dg-side-table">
      <thead>
        <tr>
          <th>Player</th>
          <th className="num" title="ESPN market minus consensus">Gap</th>
          <th className="num" title="Your last pick before his ESPN ADP">Take</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="dg-row" onClick={() => r.playerId != null && onPick(r.playerId)}>
            <td>
              {r.name} <span className="dg-dim">{r.eligibleSlots.join("/")}</span>
            </td>
            <td className={`num ${gapClass(r.gap)}`}>{r.gap != null ? signed(r.gap, 0) : "\u2014"}</td>
            <td className="num">{targetPick(r.market, myPicks, currentPick)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Your roster as a lineup, the way ESPN draws it: every starting slot from the league's
 * settings (PG, SG, SF, PF, C, G, F, UTIL x3), filled by the best eligible player, then
 * the bench. An empty slot reads "Empty" — that is what still needs filling.
 */
function Lineup({
  players,
  slots,
}: {
  players: (DraftRow & { cons?: number })[];
  slots: string[];
}) {
  const ordered = [...players].sort((a, b) => a.rank - b.rank);
  const lineup = buildLineup(ordered, slots.length ? slots : ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL", "UTIL", "UTIL", "Bench", "Bench", "Bench"]);
  return (
    <table className="dg-lineup">
      <tbody>
        {lineup.map((row, i) => (
          <tr key={i} className={`${row.slot === "Bench" ? "is-bench" : ""}${row.slot === "Bench" && lineup[i - 1]?.slot !== "Bench" ? " first-bench" : ""}`}>
            <th scope="row">{row.slot === "Bench" ? "BE" : row.slot === "UTIL" ? "UT" : row.slot}</th>
            {row.player ? (
              <>
                <td className="dg-lu-nm">{row.player.name}</td>
                <td className="dg-lu-pos">{row.player.eligibleSlots.join("/")}</td>
              </>
            ) : (
              <td className="dg-lu-empty" colSpan={2}>
                Empty
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** How many of your players can play each position — the gaps are what to draft next. */
function PosCounter({ players }: { players: { eligibleSlots: string[] }[] }) {
  return (
    <div className="dg-poscount" aria-label="Position counts">
      {POSITION_ORDER.map((pos) => {
        const n = players.filter((r) => r.eligibleSlots.includes(pos)).length;
        return (
          <span key={pos} className={`dg-pc${n === 0 && players.length > 0 ? " zero" : ""}`} title={`${n} player${n === 1 ? "" : "s"} eligible at ${pos}`}>
            <span className="dg-pc-l">{pos}</span>
            <b>{n}</b>
          </span>
        );
      })}
    </div>
  );
}

/** All-play counts are weighted by category weight, so they can be fractional. */
function fmtW(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
