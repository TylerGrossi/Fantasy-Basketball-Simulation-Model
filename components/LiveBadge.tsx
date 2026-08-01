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
      ? "Simulated mid-week state — built from real rosters and averages"
      : state === "live"
        ? `Live from ESPN${fetchedAt ? ` · ${fetchedAt}` : ""}`
        : state === "error"
          ? `Live update unavailable · showing data from ${new Date(generatedAt).toLocaleString()}`
          : "Loading live totals…";
  const dot = state === "live" ? "" : state === "error" ? "error" : "stale";
  return (
    <p className="live" style={{ margin: "0 0 0.6rem" }}>
      <span className={`live-dot ${dot}`} />
      {label}
    </p>
  );
}
