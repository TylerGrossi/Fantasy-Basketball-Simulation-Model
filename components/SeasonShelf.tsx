import { TrophyIcon } from "./Icons";
import { careerTotals, type CareerLog } from "@/lib/career";

/**
 * The /history landing page, as a shelf rather than a table.
 *
 * Six seasons across five different ESPN leagues is a career, not a dataset — nobody sorts
 * it, they read down it. The eight-column table it replaces spent most of its width on
 * columns that never got compared (league, team, players used) and buried the two things
 * the page is actually about: WHICH YEAR and HOW IT ENDED. The shelf leads with the year,
 * because the leagues change and the year is the only continuous axis, and marks the
 * titles in gold so three championships are visible without reading a single figure.
 *
 * The strip above it is deliberately slimmer than the app's standard tiles: on this page
 * the seasons are the subject and the career totals are the caption, which is the reverse
 * of how a 108px-tall 4-up row of tiles reads.
 */

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function ordinal(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Career totals, as two slim tiles. */
export function CareerStrip({ log }: { log: CareerLog }) {
  const t = careerTotals(log);
  const [w, l, ti] = t.record;
  /*
   * Two, not four. Seasons and Titles were both already countable off the shelf below —
   * six rows, three of them gold — and a tile that restates something visible directly
   * under it is a tile that stops the eye for nothing. What is left is the pair the shelf
   * genuinely cannot show: the totals ACROSS the six rows.
   *
   * Both are in CATEGORIES, which is why the win rate says so; the per-season records in
   * the shelf are the same unit.
   */
  return (
    <div className="metrics metrics-2 metrics-slim">
      <Tile label="All-time record" value={`${w}-${l}${ti ? `-${ti}` : ""}`} />
      <Tile label="Category win %" value={pct(t.winPct)} />
    </div>
  );
}

/** One row per season, newest first. */
export function SeasonShelf({ log }: { log: CareerLog }) {
  const seasons = [...log.seasons].sort((a, b) => b.season - a.season);

  return (
    <ol className="shelf">
      {seasons.map((s) => {
        const [w, l, t] = s.record;
        const finish = s.finalStanding || s.standing || 0;
        const champ = s.finalStanding === 1;
        return (
          <li key={`${s.leagueId}-${s.season}`} className={champ ? "sh sh-champ" : "sh"}>
            {/* Two digits either side: the century is the same for all of them and
                spending a third of the row's width restating it is what made the block
                need two lines. */}
            <span
              className="sh-yr mono"
              aria-label={`${s.season - 1}-${String(s.season % 100).padStart(2, "0")} season`}
            >
              {String((s.season - 1) % 100).padStart(2, "0")}-
              {String(s.season % 100).padStart(2, "0")}
            </span>

            <span className="sh-main">
              {/* The LEAGUE leads: these span five of them, and it is what tells two
                  seasons under the same team name apart. */}
              <b>{s.leagueName || s.teamName}</b>
              <em className="mono">
                {s.teamName}
                {" · "}
                {w}-{l}
                {t ? `-${t}` : ""}
                {/* Hidden on a phone — it is the one column from the old table with
                    nowhere else to live, and it is not worth a third line there. */}
                <span className="sh-wide"> · {s.players.length} players</span>
              </em>
            </span>

            {/* No "finish" caption under it. An ordinal on a season row is not ambiguous,
                and the word was repeated six times to say so. */}
            <span className={champ ? "sh-fin mono sh-gold" : "sh-fin mono"}>
              {champ && <TrophyIcon size={15} />}
              {finish ? ordinal(finish) : "—"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono">{value}</div>
    </div>
  );
}
