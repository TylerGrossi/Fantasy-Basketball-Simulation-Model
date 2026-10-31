"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * "Jakob Poeltl" -> "J. Poeltl"; suffixes stay ("Darius Acuff Jr." -> "D. Acuff Jr.").
 * A one-word name is returned as it is.
 */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/**
 * Text that falls back to a shorter spelling ONLY when the full one does not fit
 * (owner, 2026-10-30: "if things get cut off then do first initial and last name").
 *
 * Measured, not guessed from a character count: the full text renders first, and if it
 * overflows its box the short one replaces it before paint (useLayoutEffect, so there is no
 * visible flash). A ResizeObserver re-tries the full text whenever the box changes size,
 * so widening the window brings the full names back.
 *
 * The box must be width-constrained by its parent; this span carries its own ellipsis in
 * case even the short form does not fit.
 */
export default function FitText({ full, short, className }: { full: string; short: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [useShort, setUseShort] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!useShort && full !== short && el.scrollWidth > el.clientWidth + 1) setUseShort(true);
  }, [useShort, full, short]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === last) return;
      last = el.clientWidth;
      setUseShort(false); // re-measure the full text at the new width
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <span ref={ref} className={`fit-text${className ? ` ${className}` : ""}`} title={useShort ? full : undefined}>
      {useShort ? short : full}
    </span>
  );
}
