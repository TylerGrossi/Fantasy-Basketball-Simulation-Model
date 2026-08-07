/**
 * Win-probability gauge — inline SVG, ported from legacy/visualizations.py.
 *
 * Same geometry as the Streamlit version: a 180-degree track carrying the three tinted
 * confidence bands, the value arc drawn narrower on top, an outer 0-100 scale, and a
 * threshold tick. Scales with its container via viewBox.
 */

const CX = 180;
const CY = 186;
const R = 132;
const BAND_W = 34;
const BAR_W = 21;
const L = Math.PI * R;

/**
 * Round any number that reaches an SVG attribute.
 *
 * An unrounded float here is a HYDRATION MISMATCH: React serialises it at limited
 * precision into the server HTML while the client keeps the full double, the two strings
 * differ, and React declines to patch it. It only bites when the gauge shows a real
 * probability — while the season was over every value was exactly 0 or 1 and every
 * product was a whole number, so nothing ever disagreed.
 */
const n2 = (v: number) => v.toFixed(2);
const TRACK = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

const BANDS: Array<[string, number, number]> = [
  ["var(--bad)", 0, 0.4],
  ["var(--clay)", 0.4, 0.6],
  ["var(--good)", 0.6, 1],
];

function polar(t: number, radius: number): [number, number] {
  const ang = Math.PI * t;
  return [CX - radius * Math.cos(ang), CY - radius * Math.sin(ang)];
}

export default function WinProbabilityGauge({ percent }: { percent: number }) {
  const pct = Math.max(0, Math.min(100, percent));
  const frac = pct / 100;
  const tone = pct >= 50 ? "var(--good)" : "var(--bad)";
  const [tx1, ty1] = polar(frac, R - BAND_W / 2);
  const [tx2, ty2] = polar(frac, R + BAND_W / 2);

  return (
    <div style={{ maxWidth: 360, margin: "0 auto 0.6rem" }}>
      <svg
        viewBox="0 0 360 212"
        width="100%"
        role="img"
        aria-label={`Win probability ${pct.toFixed(0)} percent`}
        style={{ display: "block" }}
      >
        <path d={TRACK} fill="none" stroke="var(--line)" strokeWidth={BAND_W} strokeOpacity={0.5} />
        {BANDS.map(([color, start, end]) => (
          <path
            key={String(start)}
            d={TRACK}
            fill="none"
            stroke={color}
            strokeWidth={BAND_W}
            strokeOpacity={0.16}
            strokeDasharray={`${n2((end - start) * L)} ${n2(L)}`}
            strokeDashoffset={n2(-start * L)}
          />
        ))}
        <path
          d={TRACK}
          fill="none"
          stroke={tone}
          strokeWidth={BAR_W}
          strokeDasharray={`${n2(frac * L)} ${n2(L)}`}
        />
        {[0, 20, 40, 60, 80, 100].map((v) => {
          const t = v / 100;
          const [x1, y1] = polar(t, R + BAND_W / 2);
          const [x2, y2] = polar(t, R + BAND_W / 2 + 6);
          const [lx, ly] = polar(t, R + BAND_W / 2 + 19);
          return (
            <g key={v}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-3)" strokeWidth={1} />
              <text
                x={lx}
                y={ly + 4}
                textAnchor="middle"
                style={{ fontFamily: "var(--mono)", fontSize: 12, fill: "var(--ink-3)" }}
              >
                {v}
              </text>
            </g>
          );
        })}
        <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="var(--ink)" strokeWidth={3} />
        <text
          x={CX}
          y={CY - 10}
          textAnchor="middle"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 50,
            fontWeight: 700,
            fill: "var(--ink)",
          }}
        >
          {pct.toFixed(0)}%
        </text>
      </svg>
    </div>
  );
}
