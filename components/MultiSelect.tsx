"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A compact multi-select: a labelled button that opens a checkbox list.
 *
 * Stands in for `st.multiselect` on the Player Value filters and the Trade Simulator's
 * give/get pickers. A native `<select multiple>` is unusable for a 290-name list (no
 * search, ctrl-click to deselect), and a chip wall is worse — so it is a real popover
 * with an optional filter box, which is what the Streamlit widget behaved like.
 */
export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = "Any",
  searchable = false,
  minWidth = 150,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Adds a filter box above the list — worth it past ~30 options. */
  searchable?: boolean;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — a popover that can only be dismissed by
  // re-clicking its own trigger traps the pointer on a phone.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = (o: string) =>
    onChange(selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o]);

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <div className="ms" ref={box} style={{ minWidth }}>
      <div className="ms-label">{label}</div>
      <button
        type="button"
        className={`field field-select ms-trigger ${selected.length ? "ms-on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="ms-summary">{summary}</span>
        <span className="week-title-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="ms-panel">
          {searchable && (
            <input
              className="field ms-search"
              type="search"
              placeholder="Filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={`Filter ${label}`}
              autoFocus
            />
          )}
          <div className="ms-list">
            {shown.length === 0 && <div className="ms-empty">No matches.</div>}
            {shown.map((o) => (
              <label key={o} className="ms-opt">
                <input
                  type="checkbox"
                  checked={selected.includes(o)}
                  onChange={() => toggle(o)}
                />
                <span>{o}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button type="button" className="ms-clear" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
