"use client";

import { useMemo, useState } from "react";

export interface SortCol {
  key: string;
  label: string;
  /** Right-aligned, monospace tabular figures. */
  num?: boolean;
}

export interface SortCell {
  /** What to order by — kept apart from `text` so "185-92-8" can sort by win %. */
  sort: number | string;
  text: string;
  /** Optional per-cell colour, e.g. luck green/red. */
  color?: string;
}

export interface SortRow {
  id: string | number;
  /** Your own team, highlighted so it is findable in a ten-row table. */
  highlight?: boolean;
  cells: Record<string, SortCell>;
}

interface Props {
  cols: SortCol[];
  rows: SortRow[];
  /** Column to sort on first. */
  defaultKey: string;
  /** Descending by default — false for rank-style columns where 1 comes first. */
  defaultDesc?: boolean;
  /** Extra class on the table, e.g. `sheet-tight` for a wide one that must fit. */
  className?: string;
  /**
   * Rows per page. Omit for an unpaged table.
   *
   * Paging happens AFTER sorting, over the whole row set, so sorting a paged table
   * reorders all 196 players and shows the new top — not just a reshuffle of the 50
   * that happened to be on screen. Cutting the list server-side (the first attempt)
   * could not do that: the rows the client never received could never sort into view.
   */
  pageSize?: number;
}

/**
 * A sortable table, the equivalent of the legacy app's `render_sortable_table`.
 *
 * Sorting is view state over rows the server already computed, so this is the only part
 * that needs to be a client component — the page around it stays server-rendered and the
 * league object never crosses the boundary.
 */
export default function SortableTable({
  cols,
  rows,
  defaultKey,
  defaultDesc = true,
  className,
  pageSize,
}: Props) {
  const [sort, setSort] = useState({ key: defaultKey, desc: defaultDesc });
  const [page, setPage] = useState(0);
  const [all, setAll] = useState(false);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const av = a.cells[sort.key]?.sort ?? 0;
      const bv = b.cells[sort.key]?.sort ?? 0;
      const d =
        typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv))
          : av - bv;
      return sort.desc ? -d : d;
    });
    return out;
  }, [rows, sort]);

  const paged = !!pageSize && !all;
  const pages = paged ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  // Clamped rather than reset: shrinking the row set should not throw away the reader's
  // place, but it must not leave them on a page that no longer exists either.
  const current = Math.min(page, pages - 1);
  const start = paged ? current * pageSize : 0;
  const visible = paged ? sorted.slice(start, start + pageSize) : sorted;

  const click = (c: SortCol) => {
    setSort((s) =>
      // Same column flips; a new one opens the way that column is most useful —
      // biggest first for numbers, A-Z for text.
      s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: !!c.num }
    );
    // Back to the top of the new order — staying on page 4 of a list that just re-sorted
    // shows an arbitrary slice of it.
    setPage(0);
  };

  const table = (
    <div className="table-scroll">
      <table className={`sheet sortable${className ? ` ${className}` : ""}`}>
        <thead>
          <tr>
            {cols.map((c) => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  className={c.num ? "num" : undefined}
                  aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                >
                  <button type="button" className="th-sort" onClick={() => click(c)}>
                    {c.label}
                    <span className={`sort-caret ${active ? "on" : ""}`} aria-hidden="true">
                      {active ? (sort.desc ? "▾" : "▴") : "▾"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id} className={r.highlight ? "row-you" : undefined}>
              {cols.map((c) => {
                const cell = r.cells[c.key];
                return (
                  <td
                    key={c.key}
                    className={c.num ? "num" : undefined}
                    style={cell?.color ? { color: cell.color } : undefined}
                  >
                    {cell?.text ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (!pageSize || sorted.length <= pageSize) return table;

  return (
    <>
      {table}
      <div className="pager">
        <span className="pager-count">
          {all
            ? `All ${sorted.length}`
            : `${start + 1}–${Math.min(start + pageSize, sorted.length)} of ${sorted.length}`}
        </span>
        {!all && (
          <span className="pager-nav">
            <button
              type="button"
              className="pager-btn"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
            >
              ‹ Prev
            </button>
            <span className="pager-page">
              Page {current + 1} of {pages}
            </span>
            <button
              type="button"
              className="pager-btn"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
            >
              Next ›
            </button>
          </span>
        )}
        <button
          type="button"
          className="pager-btn pager-all"
          onClick={() => {
            setAll((v) => !v);
            setPage(0);
          }}
        >
          {all ? "Show pages" : "Show all"}
        </button>
      </div>
    </>
  );
}
