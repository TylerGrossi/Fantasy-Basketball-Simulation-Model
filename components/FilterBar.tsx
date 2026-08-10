"use client";

import { useId, useState } from "react";
import { ChevronIcon } from "./Icons";

/**
 * A page's filter row — inline on desktop, collapsed behind a "Filters" button on a phone.
 *
 * Every filtered view in the app had the same problem at 390px: four to six controls that
 * wrap to three or four rows and push the thing being filtered off the bottom of the
 * screen. You spend the whole first screen on controls you set once and then read past.
 *
 * So on mobile the row collapses to one 44px button and opens on demand. On desktop it
 * renders exactly as before — same `controls` / `pv-filters` classes on the same element,
 * so every existing width and flex rule still applies and nothing about the desktop layout
 * changes. The panel is always in the DOM (hidden with `display`, not unmounted), so the
 * filter state lives entirely in the caller and nothing is lost by closing it.
 *
 * `summary` is what the button says when it is shut — pass the active filters so the
 * collapsed state still reports what is being applied. Without it a closed bar is a
 * control that hides whether it is doing anything.
 */
export default function FilterBar({
  className = "controls",
  summary,
  children,
}: {
  /** The row's own classes, unchanged from before it was wrapped. */
  className?: string;
  /** Short description of the current selection, shown on the closed button. */
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className={`fbar${open ? " fbar-open" : ""}`}>
      <button
        type="button"
        className="fbar-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="fbar-label">Filters</span>
        {summary && <span className="fbar-summary">{summary}</span>}
        <ChevronIcon size={11} className="fbar-chev" />
      </button>
      <div id={id} className={`${className} fbar-panel`}>
        {children}
      </div>
    </div>
  );
}
