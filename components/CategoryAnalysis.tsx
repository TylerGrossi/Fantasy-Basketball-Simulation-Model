/**
 * Per-category win rates as a DIVERGING bar chart — the layout the Plotly version used:
 * category label on the left, a shared centre axis, your odds growing RIGHT in cobalt and
 * the opponent's LEFT in clay, with the percentage at the outer end of each bar.
 */

interface Props {
  categories: string[];
  /** P(you win), aligned to `categories`. */
  probs: number[];
}

const TICKS = ["100%", "75%", "50%", "25%", "0", "25%", "50%", "75%", "100%"];

export default function CategoryAnalysis({ categories, probs }: Props) {
  return (
    <div className="ca">
      <div className="ca-legend">
        <span>
          <i className="swatch" style={{ background: "var(--cobalt)" }} /> You
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--clay)" }} /> Opponent
        </span>
      </div>

      {categories.map((cat, i) => {
        const you = probs[i] * 100;
        const opp = 100 - you;
        return (
          <div className="ca-row" key={cat}>
            <div className="ca-label">{cat}</div>
            <div className="ca-track">
              <Half pct={opp} side="left" />
              <div className="ca-axis" />
              <Half pct={you} side="right" />
            </div>
          </div>
        );
      })}

      <div className="ca-row ca-axis-row">
        <div className="ca-label" />
        <div className="ca-ticks">
          {TICKS.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One side of the diverging bar. When a bar is too short to hold its own label the label
 * moves OUTSIDE, on the far side — putting it on the axis side would shove the bar off
 * the zero line.
 */
function Half({ pct, side }: { pct: number; side: "left" | "right" }) {
  const inside = pct >= 13;
  const label = `${Math.round(pct)}%`;
  // Rounded to keep the server and client HTML byte-identical. An unrounded float here
  // hydration-mismatches even WITH an explicit unit — the two ends serialise the same
  // number to different precision — and it only bites when a real probability is on
  // screen, which out of season means the phase preview.
  const width = `${Math.max(pct, 0).toFixed(2)}%`;
  const bar = (
    <div className={`ca-bar ca-bar-${side}`} style={{ width }}>
      {inside && <span className="ca-bar-text">{label}</span>}
    </div>
  );
  const outer = !inside && <span className="ca-out-text">{label}</span>;
  return (
    <div className={`ca-half ca-half-${side}`}>
      {side === "left" ? outer : null}
      {bar}
      {side === "right" ? outer : null}
    </div>
  );
}
