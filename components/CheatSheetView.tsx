"use client";

import { useMemo, useState } from "react";
import type { PoolPlayer } from "@/lib/league";
import {
  gpFor,
  isFreeAgent,
  MIN_GP_OPTIONS,
  playerStatus,
  VALUE_BASES,
  VALUE_COL,
  type ValueBasis,
} from "@/lib/playerPool";
import PlayerLink from "./PlayerLink";

/**
 * Draft-style cheat sheet: one ranked column per lineup slot, in the shape FantasyPros
 * uses — every player eligible there, best first, with your roster and the comparison
 * group shaded straight down the list.
 *
 * THREE columns, G/F/C, not the five base positions. These are the slots a lineup
 * actually has to fill, and at five columns the names ellipsis into uselessness on
 * anything narrower than a desktop. Each row carries the player's own positions
 * ("PG/SG") instead, so the detail the extra columns used to carry is still there.
 *
 * NO ranking-source picker. FantasyPros offers one because it aggregates other people's
 * rankings; here there is exactly one ranking — this app's own 9-cat value — so a
 * control with a single option would be furniture.
 */

interface Props {
  pool: PoolPlayer[];
  /** Fantasy team names, for the "compare" picker. */
  teams: string[];
  myTeam: string;
}

const SLOTS = ["G", "F", "C"] as const;

/** Backcourt -> frontcourt, not alphabetical — matches how a depth chart reads. */
const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];

/** Everyone unrostered, when this is the comparison group. */
const AVAILABLE = "__available__";


/** The player's own positions, and the only ones worth printing next to a G/F/C column. */
function positions(p: PoolPlayer): string[] {
  const raw = p.eligibleSlots?.length ? p.eligibleSlots : p.position ? [p.position] : [];
  const clean = Array.from(
    new Set(raw.map((s) => s.trim().toUpperCase()).filter((s) => POSITION_ORDER.includes(s)))
  );
  clean.sort((a, b) => POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b));
  return clean;
}

/**
 * Is this player legal at this slot?
 *
 * Reads `eligibleSlots` (which carries G/F directly), falling back to deriving them from
 * the base positions — an export predating `eligibleSlots` has only a single `position`,
 * and without the fallback G and F would come back empty rather than approximately right.
 */
function eligible(p: PoolPlayer, slot: string): boolean {
  const raw = p.eligibleSlots?.length ? p.eligibleSlots : p.position ? [p.position] : [];
  const e = new Set(raw.map((s) => s.trim().toUpperCase()).filter(Boolean));
  if (e.has(slot)) return true;
  if (slot === "G") return e.has("PG") || e.has("SG");
  if (slot === "F") return e.has("SF") || e.has("PF");
  return false;
}

export default function CheatSheetView({ pool, teams, myTeam }: Props) {
  const [mine, setMine] = useState(myTeam);
  const [against, setAgainst] = useState<string>(AVAILABLE);
  const [filter, setFilter] = useState(false);
  const [hideInjured, setHideInjured] = useState(false);
  const [basis, setBasis] = useState<ValueBasis>("Regular");
  const [minGp, setMinGp] = useState(10);
  /** Mobile only — the bar becomes a collapsible drawer there (see .cs-bar-toggle). */
  const [mobileOpen, setMobileOpen] = useState(false);

  /**
   * Each column, ranked once and ranked FULLY — the rank is the player's place in the
   * complete column, not their place in what happens to be visible. Filtering then only
   * hides rows, so the numbers stay 3, 17, 19… and still mean "3rd best guard".
   * Renumbering the filtered list would quietly turn a scarcity signal into 1, 2, 3.
   */
  const columns = useMemo(() => {
    const col = VALUE_COL[basis];
    const ranked = [...pool].sort((a, b) => (b[col] ?? 0) - (a[col] ?? 0));
    return SLOTS.map((slot) => ({
      slot,
      rows: ranked.filter((p) => eligible(p, slot)).map((p, i) => ({ p, rank: i + 1 })),
    }));
  }, [pool, basis]);

  const isMine = (p: PoolPlayer) => p.owner === mine;
  const isAgainst = (p: PoolPlayer) =>
    against === AVAILABLE ? isFreeAgent(p) : p.owner === against;

  return (
    /* Controls and columns in ONE frame — the bar steers the sheet under it, and two
       separate cards read as two unrelated things. */
    <div className="cs-sheet">
      {/* Mobile only (CSS-gated) — the strip of six controls that fits fine on a desktop
          row has nowhere to go on a phone, so below 900px it collapses behind this toggle
          instead of wrapping into a multi-line tangle. */}
      <button
        type="button"
        className="cs-bar-toggle"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
      >
        Filters
        <span className="cs-bar-toggle-car" aria-hidden="true">{mobileOpen ? "▲" : "▼"}</span>
      </button>

      <div className={`cs-bar${mobileOpen ? " cs-bar-open" : ""}`}>
        <div className="cs-ctl">
          <span className="cs-ctl-l">Compare</span>
          <span className="cs-swatch cs-swatch-mine" aria-hidden="true" />
          <select
            className="field field-select"
            value={mine}
            onChange={(e) => setMine(e.target.value)}
            aria-label="Your team"
          >
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="cs-ctl">
          <span className="cs-ctl-l">to</span>
          <span className="cs-swatch cs-swatch-against" aria-hidden="true" />
          <select
            className="field field-select"
            value={against}
            onChange={(e) => setAgainst(e.target.value)}
            aria-label="Compare against"
          >
            <option value={AVAILABLE}>All Available Players</option>
            {teams
              .filter((t) => t !== mine)
              .map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
          </select>
        </div>

        <div className="cs-ctl">
          <span className="cs-ctl-l">Value</span>
          <select
            className="field field-select field-select-sm"
            value={basis}
            onChange={(e) => setBasis(e.target.value as ValueBasis)}
            aria-label="Value basis"
          >
            {VALUE_BASES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="cs-ctl">
          <span className="cs-ctl-l">Min GP</span>
          <select
            className="field field-select field-select-sm"
            value={minGp}
            onChange={(e) => setMinGp(Number(e.target.value))}
            aria-label="Minimum games played"
          >
            {MIN_GP_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Any" : n}
              </option>
            ))}
          </select>
        </div>

        <label className="cs-check">
          <input
            type="checkbox"
            checked={filter}
            onChange={(e) => setFilter(e.target.checked)}
          />
          Filter
        </label>

        <label className="cs-check">
          <input
            type="checkbox"
            checked={hideInjured}
            onChange={(e) => setHideInjured(e.target.checked)}
          />
          Hide injured
        </label>
      </div>

      <div className="cs-cols">
        {columns.map((col) => {
          let rows = filter ? col.rows.filter(({ p }) => isMine(p) || isAgainst(p)) : col.rows;
          if (hideInjured) rows = rows.filter(({ p }) => playerStatus(p.status)[1] !== "out");
          if (minGp > 0) rows = rows.filter(({ p }) => gpFor(p, basis) >= minGp);
          return (
            <section className="cs-col" key={col.slot}>
              <h2 className="cs-col-h">
                {col.slot}
                <span className="cs-col-n">{rows.length}</span>
              </h2>
              <div className="cs-list">
                {rows.length === 0 ? (
                  <p className="caption cs-empty">Nobody matches.</p>
                ) : (
                  rows.map(({ p, rank }) => {
                    const [code, sev] = playerStatus(p.status);
                    const tone = isMine(p)
                      ? " cs-row-mine"
                      : isAgainst(p)
                        ? " cs-row-against"
                        : "";
                    return (
                      <div className={`cs-row${tone}`} key={p.name}>
                        <span className="cs-rank">{rank}.</span>
                        <PlayerLink name={p.name} className="cs-name" />
                        <span className="cs-pos">{positions(p).join("/") || "—"}</span>
                        <span className="cs-team">{p.nbaTeam}</span>
                        <span className="cs-flag">
                          {code ? <span className={`pv-badge ${sev}`}>{code}</span> : null}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
