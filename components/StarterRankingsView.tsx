import type { StarterRank } from "@/lib/playerPool";
import { headshotUrl } from "@/lib/playerPool";

/**
 * ESPN's "Starter Rankings" widget: one bar per starting slot, its height (and the rank
 * badge printed near the top) showing where your player there stands against the
 * league's other players in that slot — tallest/lowest-numbered is best. A pure
 * presentational component over `starterRankings()` (lib/playerPool.ts), which does the
 * actual ranking; no client state needed here, so this stays a server component.
 */
export default function StarterRankingsView({
  team,
  ranks,
}: {
  team: string;
  ranks: StarterRank[];
}) {
  // The one line of "so what" under the chart — the slot you're weakest at, matching
  // ESPN's own caption under this widget. Ties keep whichever comes first in display
  // order; there's nothing principled to break a tie on, and only one sentence fits.
  const worst = ranks
    .filter((r): r is StarterRank & { rank: number } => r.rank !== null)
    .sort((a, b) => b.rank - a.rank)[0];

  return (
    <section className="sr-card">
      <h2 className="sr-title">Starter Rankings Within Your League for: {team}</h2>

      <div className="sr-shots">
        {ranks.map((r) => {
          const url = headshotUrl(r.player?.playerId);
          return (
            <div className="sr-shot-col" key={r.slot}>
              <span
                className={`sr-shot${url ? "" : " sr-shot-blank"}`}
                style={url ? { backgroundImage: `url('${url}')` } : undefined}
                title={r.player?.name ?? "Empty"}
              />
            </div>
          );
        })}
      </div>

      <div className="sr-bars">
        {ranks.map((r) => {
          const pct = r.rank && r.poolSize ? ((r.poolSize - r.rank + 1) / r.poolSize) * 100 : 0;
          return (
            <div className="sr-bar-col" key={r.slot}>
              <div className="sr-bar-track">
                <div
                  className={`sr-bar-fill${r.rank ? "" : " sr-bar-empty"}`}
                  style={{ height: `${Math.max(pct, 6)}%` }}
                >
                  <span className="sr-bar-rank">{r.rank ? `#${r.rank}` : "—"}</span>
                </div>
              </div>
              <div className="sr-bar-label">{r.slot}</div>
            </div>
          );
        })}
      </div>

      {worst && (
        <p className="caption sr-insight">
          You have the #{worst.rank} {worst.slot} in the league.
        </p>
      )}
    </section>
  );
}
