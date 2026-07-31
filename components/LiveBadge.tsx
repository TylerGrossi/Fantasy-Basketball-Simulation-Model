import type { LiveState } from "@/lib/useLiveTotals";

/**
 * Says which data you are actually looking at. A silent fallback to stale data is worse
 * than a slow page, so the failure case names the timestamp it is showing instead of
 * pretending to be live.
 */
export default function LiveBadge({
  state,
  fetchedAt,
  generatedAt,
}: {
  state: LiveState;
  fetchedAt: string | null;
  generatedAt: string;
}) {
  const label =
    state === "frozen"
      ? `Demo — frozen snapshot from ${new Date(generatedAt).toLocaleString()}, not live`
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
