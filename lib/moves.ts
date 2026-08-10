import type { RecentMoveRow } from "./league";

/**
 * Turning the transaction FEED into transaction EVENTS.
 *
 * ESPN's activity list is one row per player moved, so a routine waiver claim arrives as
 * two unrelated rows — "Add Jeremiah Fears" and "Drop Daniss Jenkins" — that only a reader
 * who notices the identical timestamp can tell were the same decision. In a table sorted
 * by date they happen to land next to each other; the moment you filter to one move type,
 * or read on a phone where each row is its own card, the pairing is gone.
 *
 * ESPN's own app does not show it this way — its Recent Activity screen is a card per
 * transaction with the add and the drop inside it, which is the shape the data always had.
 *
 * THE JOIN KEY IS THE EXACT TIMESTAMP PLUS THE TEAM, and it is exact on purpose. Both
 * sides of a transaction carry the same instant to the millisecond
 * (`2026-04-05T12:10:01.363000-04:00`), because ESPN writes them from one event. A
 * tolerance window would be guessing, and would eventually merge two genuine moves a
 * second apart into one card that never happened. On the current export this collapses
 * **838 rows into 494 events**: 234 paired, 240 single, and 20 draft groups of six or
 * seven picks.
 */

export type MoveRow = RecentMoveRow & { value?: number | null };

export interface MoveGroup {
  /** Stable react key. */
  key: string;
  /** ISO timestamp of the transaction, as ESPN reported it. */
  date: string;
  team: string;
  adds: MoveRow[];
  drops: MoveRow[];
  drafted: MoveRow[];
  /** Any action this doesn't know about, carried through rather than dropped. */
  other: MoveRow[];
  /** What the card calls itself. */
  label: string;
}

const isAdd = (a: string) => a === "Add" || a === "Waiver Add";

/**
 * Group a (already filtered) feed into transactions, newest first.
 *
 * Input order is PRESERVED rather than re-sorted: the export is newest-first already, and
 * re-sorting here would quietly disagree with the table rendering the same rows.
 */
export function groupMoves(rows: MoveRow[]): MoveGroup[] {
  const by = new Map<string, MoveGroup>();
  const order: string[] = [];

  for (const r of rows) {
    const key = `${r.date}||${r.team}`;
    let g = by.get(key);
    if (!g) {
      g = {
        key,
        date: r.date,
        team: r.team,
        adds: [],
        drops: [],
        drafted: [],
        other: [],
        label: "",
      };
      by.set(key, g);
      order.push(key);
    }
    if (isAdd(r.action)) g.adds.push(r);
    else if (r.action === "Drop") g.drops.push(r);
    else if (r.action === "Draft") g.drafted.push(r);
    else g.other.push(r);
  }

  const out = order.map((k) => by.get(k)!);
  for (const g of out) g.label = labelFor(g);
  return out;
}

/**
 * The card's heading.
 *
 * Names what HAPPENED rather than restating the badges inside it — a card headed "Added /
 * Dropped" over a + line and a − line is the same fact three times. An unrecognised action
 * falls through to its own name, so a code this file has never seen shows up as itself
 * instead of vanishing (the `acquisitionType` lesson in AGENTS.md).
 */
function labelFor(g: MoveGroup): string {
  if (g.drafted.length) {
    return g.drafted.length > 1 ? `Drafted ${g.drafted.length} players` : "Drafted";
  }
  if (g.adds.length && g.drops.length) return "Added / Dropped";
  if (g.adds.length) return g.adds.length > 1 ? `Added ${g.adds.length}` : "Player Added";
  if (g.drops.length) return g.drops.length > 1 ? `Dropped ${g.drops.length}` : "Player Dropped";
  const names = [...new Set(g.other.map((r) => r.action))].filter(Boolean);
  return names.join(" / ") || "Move";
}

export interface MoveDay {
  /** `YYYY-MM-DD`, the league's own local day — see the note below. */
  key: string;
  /** "Sunday, 5 April". */
  label: string;
  groups: MoveGroup[];
}

/**
 * Group transactions under a day heading, so the date is written once instead of on every
 * row.
 *
 * THE DAY COMES OFF THE ISO STRING, not from a Date object. `new Date(iso).getDate()`
 * answers in the VIEWER's timezone, which differs between the server render and the
 * browser — that is a hydration mismatch, and worse, a transaction at 11pm could sort into
 * a different day on each side and split a card away from its own heading. Slicing the
 * date part uses the offset ESPN wrote, which is the league's day and is identical
 * everywhere.
 */
export function groupByDay(groups: MoveGroup[]): MoveDay[] {
  const days: MoveDay[] = [];
  for (const g of groups) {
    const key = (g.date || "").slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.key === key) last.groups.push(g);
    else days.push({ key, label: dayLabel(key), groups: [g] });
  }
  return days;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Sunday, 5 April 2026" from `2026-04-05`, formatted without touching the local clock. */
function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return "Undated";
  // UTC on purpose: this is a calendar date, not an instant, and building it in local time
  // would shift it a day for anyone west of the league's offset.
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "12:10 pm" — the time within the day heading's date. */
export function timeLabel(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso || "");
  if (!m) return "";
  let h = Number(m[1]);
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${suffix}`;
}
