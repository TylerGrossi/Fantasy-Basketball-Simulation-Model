import type { StarterRank } from "@/lib/playerPool";

/**
 * "Strength by Position": one bar per slot, length = where this team's starter there
 * sits in the league, strongest first. Green at or above the league median, red below.
 *
 * The same numbers as the bar chart beside it, read the other way round. That chart is
 * ordered by BOARD position (PG, SG, SF…) so a slot is where you expect it; this one is
 * ordered by strength, which is the question "where am I strong, where am I thin?" — the
 * one thing the board order deliberately refuses to answer.
 *
 * Bars are PERCENTILE, not raw rank, which is what lets a UTIL slot (one of thirty) sit
 * on the same axis as a position slot (one of ten). The three UTIL slots collapse into a
 * single averaged row for the same reason ESPN shows one: three near-identical bars
 * would crowd out the seven that vary.
 */
export default function StrengthByPosition({ ranks }: { ranks: StarterRank[] }) {
  const pctOf = (r: StarterRank) =>
    r.rank && r.poolSize ? (r.poolSize - r.rank + 1) / r.poolSize : 0;

  const rows: Array<{ slot: string; pct: number }> = [];
  const utils: number[] = [];
  for (const r of ranks) {
    if (r.slot.startsWith("Util")) utils.push(pctOf(r));
    else rows.push({ slot: r.slot, pct: pctOf(r) });
  }
  if (utils.length) {
    rows.push({ slot: "UTIL", pct: utils.reduce((a, b) => a + b, 0) / utils.length });
  }
  rows.sort((a, b) => b.pct - a.pct);

  return (
    <section className="sbp-card">
      <h3 className="sbp-title">Strength by Position</h3>
      <div className="sbp-rows">
        {rows.map((r) => (
          <div className="sbp-row" key={r.slot}>
            <span className="sbp-label">{r.slot}</span>
            <span className="sbp-track">
              {/* Floored so the weakest slot still reads as a bar rather than as missing
                  data — a zero-width fill looks like the row failed to render. */}
              <span
                className={`sbp-fill ${r.pct >= 0.5 ? "sbp-good" : "sbp-bad"}`}
                style={{ width: `${Math.max(r.pct * 100, 7)}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
