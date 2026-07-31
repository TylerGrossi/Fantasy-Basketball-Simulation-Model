/**
 * Weekly power-rank movement — inline SVG, ported from legacy/visualizations.py.
 *
 * One polyline per team with rank 1 at the top; your team in cobalt and thick, everyone
 * else a muted hairline so the shape of your season is what stands out. Native <title>
 * elements give per-line hover tooltips.
 */

interface Props {
  weeks: number[];
  teams: Array<{ teamId: number; teamName: string; rankHistory: number[] }>;
  yourTeamId: number;
}

const W = 900;
const H = 420;
const PAD_L = 42;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 34;

export default function RankTrendChart({ weeks, teams, yourTeamId }: Props) {
  if (!weeks.length || !teams.length) {
    return <p className="caption">Not enough weeks played to chart a trend.</p>;
  }

  const n = Math.max(teams.length, 1);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const px = (i: number) =>
    weeks.length === 1 ? PAD_L + plotW / 2 : PAD_L + (plotW * i) / (weeks.length - 1);
  const py = (rank: number) => PAD_T + (plotH * (rank - 1)) / Math.max(1, n - 1);

  const line = (hist: number[]) =>
    hist
      .map((r, i) => (i < weeks.length && r != null ? `${px(i).toFixed(1)},${py(r).toFixed(1)}` : ""))
      .filter(Boolean)
      .join(" ");

  const you = teams.find((t) => t.teamId === yourTeamId);
  const others = teams.filter((t) => t.teamId !== yourTeamId);
  const step = Math.max(1, Math.floor(weeks.length / 12));

  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "0.2rem",
        }}
      >
        <span className="eyebrow">power rank</span>
        <span className="eyebrow">week</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Weekly power ranking movement"
        style={{ display: "block" }}
      >
        {Array.from({ length: n }, (_, k) => k + 1).map((rank) => (
          <g key={rank}>
            <line
              x1={PAD_L}
              y1={py(rank)}
              x2={W - PAD_R}
              y2={py(rank)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 10}
              y={py(rank) + 4}
              textAnchor="end"
              style={{ fontFamily: "var(--mono)", fontSize: 11, fill: "var(--ink-3)" }}
            >
              {rank}
            </text>
          </g>
        ))}
        {weeks.map((w, i) =>
          i % step === 0 || i === weeks.length - 1 ? (
            <text
              key={w}
              x={px(i)}
              y={H - PAD_B + 20}
              textAnchor="middle"
              style={{ fontFamily: "var(--mono)", fontSize: 11, fill: "var(--ink-3)" }}
            >
              {w}
            </text>
          ) : null
        )}
        {others.map((t) => (
          <polyline
            key={t.teamId}
            points={line(t.rankHistory)}
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth={1.2}
            strokeOpacity={0.45}
            strokeLinejoin="round"
          >
            <title>{t.teamName}</title>
          </polyline>
        ))}
        {you && (
          <>
            <polyline
              points={line(you.rankHistory)}
              fill="none"
              stroke="var(--cobalt)"
              strokeWidth={3.2}
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              <title>{you.teamName}</title>
            </polyline>
            {you.rankHistory.map((r, i) =>
              i < weeks.length && r != null ? (
                <circle key={i} cx={px(i)} cy={py(r)} r={3.4} fill="var(--cobalt)">
                  <title>{`${you.teamName} — week ${weeks[i]}: #${r}`}</title>
                </circle>
              ) : null
            )}
          </>
        )}
      </svg>
    </div>
  );
}
