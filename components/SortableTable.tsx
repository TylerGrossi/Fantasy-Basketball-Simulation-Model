"use client";

import { useMemo, useState } from "react";

export interface SortCol {
  key: string;
  label: string;
  /** Right-aligned, monospace tabular figures. */
  num?: boolean;
  /**
   * A shorter spelling of `label`, used at <=768px only.
   *
   * Header text sets the column width under `table-layout: fixed`, so one long word can
   * squeeze every other column on a phone — "Acquisitions" is the widest header in the
   * app. Both spellings are in the markup and CSS picks one, so there is no width
   * detection and no flash of the wrong label; the full word is what a screen reader and
   * the desktop table get.
   */
  shortLabel?: string;
  /**
   * Bold the best value in this column, the way a reference table marks a leader.
   *
   * Ranked on `lead` when a cell supplies one and on `sort` otherwise, over EVERY row —
   * not the visible page, so a paged table still marks the real leader rather than the
   * best row that happens to be on screen.
   */
  leader?: boolean;
}

export interface SortCell {
  /** What to order by — kept apart from `text` so "185-92-8" can sort by win %. */
  sort: number | string;
  text: string;
  /** Optional per-cell colour, e.g. luck green/red. */
  color?: string;
  /**
   * What to RENDER, when the cell is more than text — a linked player name, a badge.
   *
   * `text` is still required and still does all the work that is not painting: sorting,
   * leader comparison, and the tie check. Keeping them separate means a cell can become a
   * link without any of that logic learning what a React element is.
   */
  node?: React.ReactNode;
  /**
   * What to rank by for `leader`, when that differs from `sort`. `null` opts the cell out
   * of the running entirely — an unqualified rate, a player under the games minimum.
   *
   * Exists because the two are genuinely different questions: a career table sorts by the
   * per-game average on screen but crowns the player with the biggest TOTAL.
   */
  lead?: number | null;
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

  /**
   * The leading row id(s) per `leader` column, computed over ALL rows.
   *
   * A Set rather than one id so a tie bolds every row that shares the best value, instead
   * of silently keeping whichever came first.
   *
   * HOW TIES ARE DECIDED depends on whether the column supplies an explicit `lead`:
   *
   *   - **No `lead`** — the ranking runs on `sort`, which is the value on screen, so ties
   *     are widened to anything printing the same `text`. Two averages that both read
   *     "10.0" are identical to the reader, and bolding one of them looks like a bug
   *     whatever their third decimals say.
   *   - **Explicit `lead`** — ranked and printed in DIFFERENT units (the career table
   *     ranks on career total and prints a per-game average), so `text` says nothing about
   *     the ranking and must not widen anything. Matching it bolded Westbrook for assists
   *     because his average happened to print the same as the total leader's, which is the
   *     precise claim the column is not making.
   */
  const leaders = useMemo(() => {
    const out: Record<string, Set<string | number>> = {};
    for (const c of cols) {
      if (!c.leader) continue;
      let best = -Infinity;
      let ids = new Set<string | number>();
      let bestText = "";
      let ranksOnShownValue = true;
      for (const r of rows) {
        const cell = r.cells[c.key];
        if (!cell || cell.lead === null) continue;
        const explicit = cell.lead != null;
        const v = explicit ? cell.lead! : typeof cell.sort === "number" ? cell.sort : NaN;
        if (!Number.isFinite(v)) continue;
        if (explicit) ranksOnShownValue = false;
        if (v > best) {
          best = v;
          bestText = cell.text;
          ids = new Set([r.id]);
        } else if (v === best) {
          ids.add(r.id);
        }
      }
      if (best > 0) {
        if (ranksOnShownValue) {
          for (const r of rows) {
            const cell = r.cells[c.key];
            if (cell && cell.lead !== null && cell.text === bestText) ids.add(r.id);
          }
        }
        out[c.key] = ids;
      }
    }
    return out;
  }, [rows, cols]);

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
                    {c.shortLabel ? (
                      <>
                        <span className="th-full">{c.label}</span>
                        <span className="th-short" aria-hidden="true">{c.shortLabel}</span>
                      </>
                    ) : (
                      c.label
                    )}
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
                const leads = leaders[c.key]?.has(r.id) ?? false;
                return (
                  <td
                    key={c.key}
                    className={[c.num ? "num" : "", leads ? "is-leader" : ""]
                      .filter(Boolean)
                      .join(" ") || undefined}
                    style={cell?.color ? { color: cell.color } : undefined}
                  >
                    {/* <strong>, not weight alone: leading the column is a fact about the
                        number, so it survives a screen reader and forced-colors mode. */}
                    {leads ? (
                      <strong>{cell?.node ?? cell?.text ?? ""}</strong>
                    ) : (
                      (cell?.node ?? cell?.text ?? "")
                    )}
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
