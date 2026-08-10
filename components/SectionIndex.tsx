import Link from "next/link";
import type { NavPage } from "@/lib/nav";
import { ChevronRightIcon } from "./Icons";

/**
 * A section's contents page — the mobile "index" half of index-and-drill.
 *
 * Every row is a page: its name, what it answers, and THE NUMBER YOU WOULD HAVE OPENED IT
 * FOR. That last part is the whole point. A list of links is a menu you read past; a list
 * of links carrying "#1", "8–6–1", "9 this week" answers the common question before the
 * tap, and turns navigation into the first screen of data rather than a toll on the way
 * to it.
 *
 * A row with no preview is fine and common — Compare and Trade take an input before they
 * have anything to say, so inventing a figure for them would be noise. The column simply
 * stays empty and the layout does not shift, because the grid reserves nothing for it.
 *
 * SERVER COMPONENT, deliberately: it renders plain links and takes its figures already
 * computed, so nothing here reaches the client payload. Do not make it interactive
 * without re-reading the trimLeague note in lib/loadLeague.ts.
 */

export interface IndexStat {
  /** The figure itself, already formatted. Empty or absent renders nothing. */
  value?: string;
  /**
   * Colour, by MEANING not by sign: "good" for a result in your favour, "bad" against,
   * "plain" for a count that is neither. Most rows are plain — a preview that is mostly
   * green reads as a scoreboard and stops being scannable.
   */
  tone?: "good" | "bad" | "plain";
  /** Optional second line under the figure, e.g. "of 10" or "vs last week". */
  note?: string;
}

export default function SectionIndex({
  title,
  caption,
  pages,
  stats,
}: {
  title: string;
  caption?: string;
  pages: NavPage[];
  /** Keyed by href. Every key is optional; a page with no entry renders without a figure. */
  stats?: Record<string, IndexStat | undefined>;
}) {
  /*
   * Group the pages while preserving order. `group` is undefined for the section's own
   * pages and set for anything folded in (History, inside Season), so the ungrouped run
   * comes first and keeps its heading off the screen entirely — a lone "This Week"
   * heading directly under the "This Week" title is a word said twice.
   */
  const groups: Array<{ name: string | null; items: NavPage[] }> = [];
  for (const p of pages) {
    const name = p.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(p);
    else groups.push({ name, items: [p] });
  }

  return (
    <div className="idx-page">
      <header className="idx-head">
        <h1>{title}</h1>
        {caption && <p className="idx-caption">{caption}</p>}
      </header>

      {groups.map((g) => (
        <section key={g.name ?? "_"} className="idx-group">
          {g.name && <h2 className="idx-group-title">{g.name}</h2>}
          <div className="idx">
            {g.items.map((p) => {
              const s = stats?.[p.href];
              return (
                <Link key={p.href} href={p.href} className="idx-row">
                  <span className="idx-name">
                    <strong>{p.label}</strong>
                    {p.blurb && <em>{p.blurb}</em>}
                  </span>
                  {s?.value && (
                    <span className={`idx-stat idx-${s.tone ?? "plain"}`}>
                      <b>{s.value}</b>
                      {s.note && <i>{s.note}</i>}
                    </span>
                  )}
                  <ChevronRightIcon size={13} className="idx-chev" />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
