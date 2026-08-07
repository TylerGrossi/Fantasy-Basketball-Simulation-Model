import type { LiveState } from "@/lib/useLiveTotals";

/**
 * Says which data you are actually looking at.
 *
 * The badge earns its space in exactly two cases: the data is LIVE, or the data is NOT
 * REAL. A completed week shown from the export is neither — it is simply the final result,
 * and stamping "not live" on a finished matchup is noise about something nobody wondered.
 *
 * A silent fallback to stale data is still worse than a slow page, so the error case keeps
 * naming the timestamp it is showing rather than pretending to be current.
 */
export default function LiveBadge({
  state,
  fetchedAt,
  generatedAt,
  simulated = false,
}: {
  state: LiveState;
  fetchedAt: string | null;
  generatedAt: string;
  /** The numbers are synthetic (the mid-week preview). Always disclosed. */
  simulated?: boolean;
}) {
  // Not live, and the data is real — say nothing.
  if (state === "frozen" && !simulated) return null;

  const label =
    state === "frozen"
      ? "Simulated week — built from real rosters and averages, not live"
      : state === "live"
        ? `Live from ESPN${fetchedAt ? ` · ${fetchedAt}` : ""}`
        : state === "error"
          ? `Live update unavailable · showing data from ${new Date(generatedAt).toLocaleString()}`
          : "Loading live totals…";
  const dot = state === "live" ? "" : state === "error" ? "error" : "stale";
  return (
    /* Spacing via a class, not an inline style: inside `.sb-panel` the badge is a band
       of the scoreboard and needs the panel's own padding, and an inline margin would
       win against that rule no matter how specific it was. */
    <p className="live live-badge">
      <span className={`live-dot ${dot}`} />
      {label}
    </p>
  );
}
