/**
 * Calendar-day helpers shared by the live matchup code, the schedule grid, Streamers, the
 * Agent's tools and the live route. The NBA schedule, the export's matchup window and
 * ESPN's scoreboard all run on EASTERN calendar days, so "today" is always Eastern here,
 * whatever the browser's or server's own timezone.
 */

/** YYYY-MM-DD in Eastern time. */
export function etDate(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Wed 10/21" from an ISO date, read as a calendar day (no timezone shift). */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${m}/${d}`;
}

/** Inclusive list of ISO dates from start to end (capped at three weeks). */
export function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (d <= last && out.length < 21) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
