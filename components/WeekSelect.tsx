"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The page title IS the week chooser.
 *
 * A custom menu rather than a native <select>: the popup height of a native select is
 * decided by the OS, and 21 weeks rendered as a full-height list running off the screen.
 * This one is capped and scrolls, opening near the current week.
 */
export default function WeekSelect({
  weeks,
  selected,
  current,
  path = "/scoreboard",
  param = "period",
  small = false,
}: {
  weeks: { period: number; label: string }[];
  selected: number;
  current: number;
  /** Where a pick goes: `${path}?${param}=N`, or bare `path` for `current`. */
  path?: string;
  param?: string;
  /** A subtitle-sized chooser under a page title (Weekly Recap) instead of the title. */
  small?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const label =
    weeks.find((w) => w.period === selected)?.label ?? `Matchup ${selected}`;

  // Close on outside click or Escape — a menu you can't dismiss is worse than no menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Open with the selected week in view rather than scrolled to the top.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "center" });
  }, [open]);

  if (weeks.length < 2) return small ? <p className="caption wr-sub">{label}</p> : <h1>{label}</h1>;

  const go = (p: number) => {
    setOpen(false);
    router.push(p === current ? path : `${path}?${param}=${p}`);
  };

  return (
    <div className="week-title-wrap" ref={ref}>
      {(() => {
        const btn = (
          <button
            type="button"
            className={small ? "week-title-btn week-sub-btn" : "week-title-btn"}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {label}
            <span className="week-title-caret" aria-hidden="true" />
          </button>
        );
        return small ? btn : <h1 className="week-title">{btn}</h1>;
      })()}
      {open && (
        <div className="week-menu" role="listbox" ref={listRef}>
          {weeks.map((w) => (
            <button
              key={w.period}
              type="button"
              role="option"
              aria-selected={w.period === selected}
              className="week-menu-item"
              onClick={() => go(w.period)}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
