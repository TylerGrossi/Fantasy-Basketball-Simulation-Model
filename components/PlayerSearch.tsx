"use client";

import { useMemo, useState } from "react";
import type { PoolPlayer } from "@/lib/league";

/**
 * Type-to-filter player picker, shared by every page that has to choose one out of the
 * ~290-player pool (Player Card, Compare).
 *
 * Replaces a `<select>` of all of them. A native select is a scroll-only list on a phone —
 * no way to type — so finding a player meant flicking through hundreds of rows; on desktop
 * it only jumped by first letter. This matches anywhere in the name and also on team and
 * position, so "curry", "gsw" and "pg" all find something useful, and each row shows team
 * and position so two players with similar names are still distinguishable.
 *
 * Deliberately an `<input>` + list rather than `<datalist>`: Safari and Firefox render
 * datalist inconsistently and it cannot show the team/position line under each name.
 *
 * ONE implementation on purpose. This started as a copy inside PlayerCardView and was
 * pulled out the moment Compare needed the same thing — the repo has already been bitten
 * by two copies of a widget drifting apart (see components/BoxScoreSheet.tsx).
 */
export default function PlayerSearch({
  pool,
  value,
  onPick,
  label = "Search for a player",
  exclude,
}: {
  pool: PoolPlayer[];
  /** The currently chosen name — shown as the placeholder, not the value. */
  value: string;
  onPick: (name: string) => void;
  label?: string;
  /** A name to leave out, so Compare can't offer the player already on the other side. */
  exclude?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = exclude ? pool.filter((p) => p.name !== exclude) : pool;
    if (!q) return base.slice(0, 50);
    return base
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.nbaTeam.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [pool, query, exclude]);

  const choose = (n: string) => {
    onPick(n);
    setQuery("");
    setOpen(false);
    setActive(0);
  };

  return (
    <div className="pd-ac">
      <input
        type="text"
        className="field pd-ac-input"
        // The chosen player shows as the PLACEHOLDER rather than the value, so the field
        // is always ready to type into — having to clear a name first is exactly the
        // friction this replaced.
        placeholder={value || "Search players"}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        // onClick as well as onFocus: after picking someone the input KEEPS focus, so a
        // later click fires no focus event and the list stayed shut — you had to click
        // away and back to add a second player. Adding two players to one side is the
        // normal case on the trade board, so this was squarely on the main path.
        onClick={() => setOpen(true)}
        // A click on a result would otherwise be lost: blur fires first and unmounts the
        // list before the click lands.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            choose(matches[active].name);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <ul className="pd-ac-list" role="listbox" aria-label={label}>
          {matches.map((m, i) => (
            <li key={m.name} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`pd-ac-opt${i === active ? " pd-ac-on" : ""}`}
                // mousedown, not click: it fires before blur, so the pick registers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m.name);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="pd-ac-n">{m.name}</span>
                <span className="pd-ac-m">
                  {[m.nbaTeam, m.position].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
