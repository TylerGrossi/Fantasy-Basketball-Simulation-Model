/**
 * Distribution of likely final category scores.
 *
 * This is the EXACT Poisson-binomial distribution, not a histogram of simulated
 * outcomes — so there is no sampling noise in it. Ties are absent by construction:
 * two continuous projections are equal with probability zero, so every outcome is
 * k-(n-k).
 */

interface Props {
  /** dist[k] = P(exactly k categories won). */
  distribution: number[];
  /** Total scored categories. */
  total: number;
  /** How many columns to show, centred on the most likely outcomes. */
  show?: number;
}

const PLOT_H = 190;

export default function ScoreDistribution({ distribution, total, show = 10 }: Props) {
  const all = distribution.map((p, k) => ({ k, p }));
  // Keep the `show` most likely, then order them left-to-right by score so the shape
  // reads as a distribution rather than a ranking.
  const top = [...all]
    .sort((a, b) => b.p - a.p)
    .slice(0, show)
    .sort((a, b) => a.k - b.k);
  const peak = Math.max(...top.map((o) => o.p)) || 1;

  return (
    <div className="dist">
      <div className="dist-plot">
        {top.map(({ k, p }) => {
          const lost = total - k;
          const color =
            k > lost ? "var(--good)" : k < lost ? "var(--bad)" : "var(--ink-3)";
          return (
            <div className="dist-col" key={k}>
              <div className="dist-pct">{(p * 100).toFixed(1)}%</div>
              <div className="dist-slot" style={{ height: PLOT_H }}>
                <div
                  className="dist-bar"
                  style={{
                    height: Math.max(2, (p / peak) * PLOT_H),
                    background: color,
                  }}
                  title={`${k}-${lost}: ${(p * 100).toFixed(1)}%`}
                />
              </div>
              <div className="dist-label">
                {k}-{lost}
              </div>
            </div>
          );
        })}
      </div>
      <div className="dist-axis eyebrow">score outcome (you – opponent)</div>
    </div>
  );
}
