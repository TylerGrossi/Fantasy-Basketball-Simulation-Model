"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isCenter, recRank, valuePct } from "@/lib/draft";
import type { DraftRow } from "@/lib/projection";

/**
 * The Plan tab: a round-by-round draft plan in the shape of the owner's spreadsheet —
 * "If available" (the reach target), Options 1-3 and an ideal position for every pick,
 * and what actually happened (the live draft, or the mock when practising).
 *
 * Rebuilt 2026-10-19 for readability:
 *   - Cells read like a sheet, not a form: a name and a one-line meta. Click to edit.
 *   - Suggestions are LIVE, never written into the plan. Grey = suggested for your current
 *     slot, bold = yours. (The old "fill empty cells" button stored suggestions for one slot
 *     and they went stale the moment the slot changed — the plan is keyed by round.)
 *   - Each player is suggested once across the whole plan.
 *   - The plan records the slot it was made for, and says so if that no longer matches.
 *
 * Suggestion rule, round by round: Options are the best players on this board that ESPN's
 * market (ADP, else roto rank) says will still be there at the pick; "If available" is the
 * best one expected to go just BEFORE it. Every player used — yours or suggested — leaves
 * the pool for later rounds. During the draft, players already taken leave it too.
 */

type Row = DraftRow & { cons: number; market?: number };
type Cell = "dream" | "o1" | "o2" | "o3" | "pos";
type Plan = {
  slot?: number;
  rounds: Record<string, Partial<Record<Cell, string>>>;
  /** Client-side edit time, so the newer of the server and browser copies wins on load. */
  editedAt?: number;
};

export interface MinePick {
  round: number;
  pick: number;
  playerId: number;
}

const OPTION_STARS: Record<string, string> = { o1: "★★★", o2: "★★", o3: "★" };

export default function DraftPlan({
  rows,
  myPicks,
  mySlot,
  currentPick,
  owner,
  isMine,
  results,
  resultLabel,
  storeKey,
  centersHeld,
}: {
  rows: Row[];
  myPicks: number[];
  mySlot: number;
  currentPick: number;
  /** playerId -> team (live) or slot (mock) that has him. */
  owner: Map<number, number>;
  /** The board's own "is this my player" rule (covers manual Mine marks). */
  isMine: (id: number | null) => boolean;
  /** Your picks in the current mode (live draft or mock). */
  results: MinePick[];
  resultLabel: string;
  storeKey: string;
  /** Centre-eligible players you already hold — feeds the centre boost. */
  centersHeld: number;
}) {
  /* ---------------- storage: server file first, browser copy as fallback ---------------- */
  const [plan, setPlan] = useState<Plan>({ rounds: {} });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "local">("idle");

  // Set once the user edits; a slow initial load must never overwrite that.
  const dirty = useRef(false);

  useEffect(() => {
    let alive = true;
    const local = (() => {
      try {
        const raw = localStorage.getItem(storeKey);
        return raw ? (JSON.parse(raw) as Plan) : null;
      } catch {
        return null;
      }
    })();
    fetch("/api/draft/plan", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((server: Plan | null) => {
        if (!alive || dirty.current) return;
        // The NEWER copy wins. On a read-only host (Vercel) the server copy is whatever was
        // deployed and never changes, so preferring it unconditionally would throw away
        // every edit kept on this device.
        const sTime = server?.editedAt ?? 0;
        const lTime = local?.editedAt ?? 0;
        const hasServer = server && Object.keys(server.rounds ?? {}).length > 0;
        if (hasServer && (!local || sTime >= lTime)) setPlan(server!);
        else setPlan(local ?? { rounds: {} });
      })
      .catch(() => alive && !dirty.current && setPlan(local ?? { rounds: {} }));
    return () => {
      alive = false;
    };
  }, [storeKey]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (draft: Plan) => {
    dirty.current = true;
    const next = { ...draft, editedAt: Date.now() };
    setPlan(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    if (timer.current) clearTimeout(timer.current);
    setSaveState("saving");
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/draft/plan", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        setSaveState(r.ok ? "saved" : "local");
      } catch {
        setSaveState("local");
      }
    }, 500);
  };

  const setCell = (round: number, cell: Cell, value: string) => {
    const cur = { ...(plan.rounds[round] ?? {}) };
    if (value.trim()) cur[cell] = value.trim();
    else delete cur[cell];
    save({ slot: mySlot, rounds: { ...plan.rounds, [round]: cur } });
  };

  const entryCount = Object.values(plan.rounds).reduce(
    (a, r) => a + Object.values(r ?? {}).filter(Boolean).length,
    0
  );
  const slotMismatch = entryCount > 0 && plan.slot !== mySlot;

  /* ---------------- lookups ---------------- */
  const byName = useMemo(() => new Map(rows.map((r) => [r.name.toLowerCase(), r])), [rows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.playerId, r])), [rows]);
  const find = (name?: string) => (name ? byName.get(name.trim().toLowerCase()) : undefined);

  /** Rank at primary position on this board ("PG7"). */
  const posRank = useMemo(() => {
    const out = new Map<number | null, string>();
    const seen: Record<string, number> = {};
    for (const r of [...rows].sort((a, b) => a.rank - b.rank)) {
      const pos = r.position || r.eligibleSlots[0] || "?";
      seen[pos] = (seen[pos] ?? 0) + 1;
      out.set(r.playerId, `${pos}${seen[pos]}`);
    }
    return out;
  }, [rows]);

  /* ---------------- live suggestions (never stored) ---------------- */
  const suggestions = useMemo(() => {
    const used = new Set<number | null>();
    // Your own entries are spoken for everywhere, so a suggestion never repeats them.
    for (const r of Object.values(plan.rounds)) {
      for (const k of ["dream", "o1", "o2", "o3"] as const) {
        const hit = find(r?.[k]);
        if (hit) used.add(hit.playerId);
      }
    }
    const out: Record<number, Partial<Record<"dream" | "o1" | "o2" | "o3", Row>>> = {};
    const expected = (r: Row) => r.market ?? r.cons * 1.2;
    // Centres the plan already "takes" count toward the boost's cap, round by round.
    let centers = centersHeld;
    myPicks.forEach((P, i) => {
      const round = i + 1;
      const pool = rows.filter(
        (r) =>
          !used.has(r.playerId) &&
          !(P >= currentPick && r.playerId != null && owner.has(r.playerId))
      );
      const opts = pool
        .filter((r) => expected(r) >= P - 1.5)
        .sort((a, b) => recRank(a, centers) - recRank(b, centers));
      const dream = pool
        .filter((r) => expected(r) < P - 1.5 && expected(r) >= P - 10)
        .sort((a, b) => recRank(a, centers) - recRank(b, centers))[0];
      const s: Partial<Record<"dream" | "o1" | "o2" | "o3", Row>> = {};
      for (const k of ["o1", "o2", "o3"] as const) {
        if (plan.rounds[round]?.[k]) continue;
        const pick = opts.find((r) => !used.has(r.playerId));
        if (pick) {
          s[k] = pick;
          used.add(pick.playerId);
        }
      }
      // The modelled pick for this round is Option 1 — yours if typed, else the suggestion.
      const taken = find(plan.rounds[round]?.o1) ?? s.o1;
      if (taken && isCenter(taken)) centers++;
      if (!plan.rounds[round]?.dream && dream && !used.has(dream.playerId)) {
        s.dream = dream;
        used.add(dream.playerId);
      }
      out[round] = s;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, myPicks, currentPick, owner, plan, byName, centersHeld]);

  /* ---------------- cells ---------------- */
  const [editing, setEditing] = useState<string | null>(null);

  const status = (r?: Row) => {
    if (!r || r.playerId == null) return "";
    if (isMine(r.playerId)) return " is-mine";
    return owner.has(r.playerId) ? " is-gone" : "";
  };

  const playerCell = (round: number, cell: "dream" | "o1" | "o2" | "o3", P: number) => {
    const id = `${round}-${cell}`;
    const typed = plan.rounds[round]?.[cell] ?? "";
    const sug = suggestions[round]?.[cell];
    const r = typed ? find(typed) : sug;
    const risky = r && (r.market ?? r.cons) < P - 1.5 && cell !== "dream";
    if (editing === id) {
      return (
        <td className="dg-pl-cell" key={id}>
          <input
            autoFocus
            className="dg-pl-in"
            list="dg-plan-players"
            defaultValue={typed}
            placeholder={sug?.name ?? "Player…"}
            onBlur={(e) => {
              setEditing(null);
              if (e.target.value.trim() !== typed) setCell(round, cell, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(null);
            }}
            aria-label={`Round ${round} ${cell}`}
          />
        </td>
      );
    }
    return (
      <td className={`dg-pl-cell${typed ? " typed" : " sug"}${status(r)}`} key={id}>
        <button type="button" className="dg-pl-b" onClick={() => setEditing(id)} title={typed ? "Your pick: click to change, clear to go back to the suggestion" : "Suggested: click to replace"}>
          {r ? (
            <>
              <span className="dg-pl-nm">{r.name}</span>
              <span className="dg-pl-meta">
                {r.eligibleSlots.join("/")} · ADP {r.adp != null ? r.adp.toFixed(0) : "—"}
                {risky && <span className="dg-pl-risk" title="Expected to be gone by this pick"> · gone?</span>}
              </span>
            </>
          ) : typed ? (
            <span className="dg-pl-nm">
              {typed} <span className="dg-pl-risk">not in pool</span>
            </span>
          ) : (
            <span className="dg-pl-empty">+</span>
          )}
        </button>
      </td>
    );
  };

  const posCell = (round: number) => {
    const id = `${round}-pos`;
    const typed = plan.rounds[round]?.pos ?? "";
    const o1 = find(plan.rounds[round]?.o1) ?? suggestions[round]?.o1;
    const sug = o1?.eligibleSlots.join("/") ?? "";
    if (editing === id) {
      return (
        <td className="dg-pl-cell dg-pl-pos" key={id}>
          <input
            autoFocus
            className="dg-pl-in"
            defaultValue={typed}
            placeholder={sug}
            onBlur={(e) => {
              setEditing(null);
              if (e.target.value.trim() !== typed) setCell(round, "pos", e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(null);
            }}
            aria-label={`Round ${round} ideal position`}
          />
        </td>
      );
    }
    return (
      <td className={`dg-pl-cell dg-pl-pos${typed ? " typed" : " sug"}`} key={id}>
        <button type="button" className="dg-pl-b" onClick={() => setEditing(id)}>
          <span className="dg-pl-nm">{typed || sug || "+"}</span>
        </button>
      </td>
    );
  };

  /* ---------------- results ---------------- */
  const resultFor = (round: number) => {
    const p = results.find((x) => x.round === round);
    const r = p ? byId.get(p.playerId) : undefined;
    return p && r ? { p, r, v: valuePct(r.cons, p.pick) } : null;
  };
  const total = results.reduce((a, p) => {
    const r = byId.get(p.playerId);
    return r ? a + valuePct(r.cons, p.pick) : a;
  }, 0);
  const nextMine = myPicks.find((x) => x >= currentPick);

  return (
    <section className="dg-plan">
      <div className="dg-plan-head">
        <span className="dg-plan-legend">
          <span className="dg-pl-key sug">Suggested</span>
          <span className="dg-pl-key typed">Yours</span>
          <span className="dg-pl-key is-mine">Drafted</span>
          <span className="dg-pl-key is-gone">Taken</span>
          <span className="dg-dim">Click any cell to change it.</span>
        </span>
        <span className="dg-plan-actions">
          <span className="dg-dim dg-plan-save">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "local" ? "Saved on this device only" : ""}
          </span>
          {entryCount > 0 && (
            <button
              type="button"
              className="dg-btn sm"
              onClick={() => {
                if (confirm(`Clear your ${entryCount} plan entries? Suggestions stay.`)) save({ slot: mySlot, rounds: {} });
              }}
            >
              Clear my entries
            </button>
          )}
        </span>
      </div>

      {slotMismatch && (
        <p className="dg-plan-warn">
          {plan.slot == null
            ? `Your ${entryCount} saved entries were made before the plan tracked draft slots, so they may not fit slot ${mySlot}.`
            : `Your ${entryCount} saved entries were made for slot ${plan.slot}; you are now slot ${mySlot}.`}{" "}
          <button type="button" className="dg-linkbtn" onClick={() => save({ slot: mySlot, rounds: {} })}>
            Clear them
          </button>{" "}
          to see fresh suggestions, or{" "}
          <button type="button" className="dg-linkbtn" onClick={() => save({ ...plan, slot: mySlot })}>
            keep them for slot {mySlot}
          </button>
          .
        </p>
      )}

      <datalist id="dg-plan-players">
        {rows.slice(0, 300).map((r) => (
          <option key={r.playerId ?? r.name} value={r.name} />
        ))}
      </datalist>

      <div className="table-scroll">
        <table className="sheet dg-pl-table">
          <thead>
            <tr>
              <th className="num">Rd</th>
              <th className="num">Pick</th>
              <th title="The best player expected to go just before this pick, in case he falls">If available</th>
              <th>
                Option 1 <span className="dg-stars s3">{OPTION_STARS.o1}</span>
              </th>
              <th>
                Option 2 <span className="dg-stars s2">{OPTION_STARS.o2}</span>
              </th>
              <th>
                Option 3 <span className="dg-stars s1">{OPTION_STARS.o3}</span>
              </th>
              <th>Pos</th>
              <th className="dg-pl-res">{resultLabel}</th>
            </tr>
          </thead>
          <tbody>
            {myPicks.map((P, i) => {
              const round = i + 1;
              const res = resultFor(round);
              return (
                <tr key={round} className={`${P === nextMine ? "dg-pl-next" : ""}${P < currentPick ? " dg-pl-done" : ""}`}>
                  <td className="num dg-dim">{round}</td>
                  <td className="num dg-pl-pick">{P}</td>
                  {playerCell(round, "dream", P)}
                  {playerCell(round, "o1", P)}
                  {playerCell(round, "o2", P)}
                  {playerCell(round, "o3", P)}
                  {posCell(round)}
                  <td className="dg-pl-res">
                    {res ? (
                      <>
                        <span className="dg-pl-nm">{res.r.name}</span>
                        <span className="dg-pl-meta">
                          {posRank.get(res.r.playerId)} ·{" "}
                          <span className={res.v >= 10 ? "dg-good" : res.v <= -25 ? "dg-bad" : ""}>
                            {res.v > 0 ? "+" : ""}
                            {Math.max(res.v, -100).toFixed(0)}%
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="dg-dim">{"—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {results.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={7} className="dg-dim">
                  Total value vs consensus
                </td>
                <td className={`dg-pl-res num ${total >= 0 ? "dg-good" : "dg-bad"}`}>
                  {total > 0 ? "+" : ""}
                  {total.toFixed(0)}%
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="caption">
        Options are the best players for your categories who should still be there at the
        pick (by ESPN ADP); &ldquo;If available&rdquo; is the best one expected to go just
        before it. Result value = (pick &minus; consensus) &divide; pick.
      </p>
    </section>
  );
}
