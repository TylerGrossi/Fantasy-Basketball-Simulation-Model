import {
  managerTable,
  myOwnerName,
  type CareerLog,
} from "@/lib/career";

/**
 * One chart per History page, sitting under that page's table.
 *
 * HAND-ROLLED HTML/CSS + INLINE SVG, no charting library, matching every other chart in
 * this app (see AGENTS.md: Plotly cost 4.87 MB and ~1s of main thread per chart page).
 * These are SERVER components with no JS at all — the hover tooltips are pure CSS on a
 * `.hc-hit:hover` rule, which is why the geometry is expressed in percentages rather than
 * measured pixels: an absolutely-positioned HTML tooltip has to land on the same spot the
 * mark did, and percentages are the one unit both layers agree on at any width.
 *
 * Where an SVG line overlays HTML dots (the career arc), the SVG uses a `0 0 100 100`
 * viewBox with `preserveAspectRatio="none"` so its coordinates ARE those percentages, and
 * `vector-effect="non-scaling-stroke"` so the stretch doesn't thicken the line.
 *
 * NO EXPLANATORY PROSE. Each chart gets a title, a legend, and at most one line of
 * numbers; the table directly above it carries every value, so nothing here is the only
 * way to read a number and nothing needs a paragraph to be understood.
 *
 * Colors do one job each. Cobalt/clay is the diverging pair (a warm and a cool pole with a
 * neutral gray middle); cobalt alone is the single-series and emphasis hue. Both were run
 * through the palette validator against this surface (#fcfbf8): worst pair ΔE 28.3 under
 * protanopia, 34.9 normal, all six checks pass.
 */

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                               */
/* -------------------------------------------------------------------------- */

function Figure({
  title,
  legend,
  children,
}: {
  title: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <figure className="hc">
      <figcaption className="hc-head">
        <div className="hc-title">{title}</div>
        {legend && <div className="hc-legend">{legend}</div>}
      </figcaption>
      {children}
    </figure>
  );
}

/** A legend entry: a colored mark beside text, never colored text. */
function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="hc-key">
      <span className="hc-swatch" style={{ background: color }} />
      {label}
    </span>
  );
}

const ord = (n: number) => {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};
const shortSeason = (s: number) =>
  `${String((s - 1) % 100).padStart(2, "0")}-${String(s % 100).padStart(2, "0")}`;

/* -------------------------------------------------------------------------- */
/* 1 · Career arc — finish by season (the Seasons page)                        */
/* -------------------------------------------------------------------------- */

/**
 * Where each season ended, with 1st at the TOP.
 *
 * The axis is inverted because that is how standings are read — a season that "went up"
 * must move up. A plain finish-vs-year line would put the championships at the bottom.
 *
 * Height is scaled to the deepest league ever played rather than to each league's own
 * size, so 4th of 12 sits above 4th of 6: the same ordinal is not the same season.
 *
 * One series, so no legend box. Titles are direct-labeled because they are the story;
 * every other finish is on the axis and in the table.
 */
export function CareerArcChart({ log }: { log: CareerLog }) {
  const seasons = log.seasons
    .filter((s) => (s.finalStanding || s.standing) > 0)
    .sort((a, b) => a.season - b.season)
    .map((s) => ({
      season: s.season,
      finish: s.finalStanding || s.standing,
      teams: (s.standings ?? []).length,
      team: s.teamName,
      record: s.record,
      league: s.leagueName,
    }));

  if (seasons.length < 2) return null;

  const worst = Math.max(...seasons.map((s) => Math.max(s.finish, s.teams || 0)), 2);

  /*
   * Headroom above 1st place.
   *
   * Without it the top gridline sits at 0% — the championship dots land on the very edge
   * of the plot and their "1st" labels, which ride ABOVE the dot, overlap the chart title.
   * The inset pushes the whole scale down so the best possible finish still has room for
   * its own label. It costs nothing: the axis ticks run through the same function, so the
   * gridlines move with the data and the scale stays linear.
   */
  const TOP_INSET = 16;
  const y = (finish: number) =>
    TOP_INSET + ((finish - 1) / (worst - 1)) * (100 - TOP_INSET);
  const x = (i: number) => ((i + 0.5) / seasons.length) * 100;

  const points = seasons
    .map((s, i) => `${x(i).toFixed(2)},${y(s.finish).toFixed(2)}`)
    .join(" ");

  // Three gridlines — first, mid-pack, last — is enough to read height off.
  const ticks = [1, Math.ceil(worst / 2), worst].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <Figure title="Where each season finished">
      <div className="hc-arc">
        <div className="hc-arc-axis">
          {ticks.map((t) => (
            <span key={t} className="hc-arc-tick" style={{ top: `${y(t)}%` }}>
              {ord(t)}
            </span>
          ))}
        </div>

        <div className="hc-arc-plot">
          {ticks.map((t) => (
            <div key={t} className="hc-grid-h" style={{ top: `${y(t)}%` }} />
          ))}

          {/* The connecting line only — the dots and their hit targets are HTML on top,
              so the tooltips need no JS. pointer-events:none keeps it out of the way. */}
          <svg
            className="hc-arc-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              points={points}
              fill="none"
              stroke="var(--cobalt)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {seasons.map((s, i) => {
            const [w, l, t] = s.record;
            const title = s.finish === 1;
            /* The end columns anchor their tooltip to the inside edge. This has to be a
               class on the element, NOT a :first-of-type/:last-of-type rule — the
               gridline divs are siblings of these and would claim both positions. */
            const edge =
              i === 0 ? " hc-tip-start" : i === seasons.length - 1 ? " hc-tip-end" : "";
            return (
              <div
                key={`${s.season}-${s.league}`}
                className={`hc-hit hc-arc-hit${edge}`}
                style={{
                  left: `${(i / seasons.length) * 100}%`,
                  width: `${100 / seasons.length}%`,
                }}
              >
                <span
                  className={`hc-dot${title ? " hc-dot-win" : ""}`}
                  style={{ top: `${y(s.finish)}%` }}
                />
                {title && (
                  <span className="hc-dot-label" style={{ top: `${y(s.finish)}%` }}>
                    1st
                  </span>
                )}
                <span className="hc-tip">
                  <b>{shortSeason(s.season)}</b>
                  <span className="hc-tip-r">
                    {ord(s.finish)}
                    {s.teams ? ` of ${s.teams}` : ""}
                  </span>
                  <span className="hc-tip-sub">{s.team}</span>
                  <span className="hc-tip-sub">
                    {w}-{l}
                    {t ? `-${t}` : ""}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hc-xaxis">
        {seasons.map((s) => (
          <span key={s.season}>{shortSeason(s.season)}</span>
        ))}
      </div>
    </Figure>
  );
}

/* -------------------------------------------------------------------------- */
/* 2 · Manager range — best to worst finish (the Managers page)                */
/* -------------------------------------------------------------------------- */

/**
 * Every manager's range of finishes: a bar from their best season to their worst, with a
 * dot at the average.
 *
 * EMPHASIS, not categorical — you are cobalt and everyone else is the de-emphasis gray,
 * because the question this page is actually asked is "where do I sit." Twenty-odd hues
 * would answer nothing and fail every CVD check.
 *
 * The range is the point: an average finish of 4th hides whether someone is reliably 4th
 * or alternates between 1st and 8th.
 */
export function ManagerRangeChart({ log }: { log: CareerLog }) {
  const me = myOwnerName(log);
  const rows = managerTable(log, me)
    .filter((m) => m.avgFinish > 0 && m.seasons >= 2 && m.owner && m.owner !== "?")
    .slice(0, 14);

  if (rows.length < 3) return null;
  const worst = Math.max(...rows.map((m) => m.worstFinish), 2);
  const pos = (v: number) => ((v - 1) / (worst - 1)) * 100;

  return (
    <Figure
      title="Best to worst finish"
      legend={
        <>
          <Key color="var(--cobalt)" label="You" />
          <Key color="var(--ink-3)" label="Everyone else" />
        </>
      }
    >
      <div className="hc-rank">
        {rows.map((m) => {
          const c = m.isYou ? "var(--cobalt)" : "var(--ink-3)";
          const left = pos(m.bestFinish);
          const width = Math.max(pos(m.worstFinish) - left, 1.2);
          return (
            <div key={m.owner} className={`hc-rank-row${m.isYou ? " hc-you" : ""}`}>
              <span className="hc-rank-name">{m.owner}</span>
              <span className="hc-hit hc-rank-track">
                <span
                  className="hc-range"
                  style={{ left: `${left}%`, width: `${width}%`, background: c }}
                />
                <span
                  className="hc-dot hc-dot-inline"
                  style={{ left: `${pos(m.avgFinish)}%`, background: c }}
                />
                <span className="hc-tip">
                  <b>{m.owner}</b>
                  <span className="hc-tip-r">{m.avgFinish.toFixed(1)} avg</span>
                  <span className="hc-tip-sub">
                    {ord(m.bestFinish)} best · {ord(m.worstFinish)} worst · {m.seasons}{" "}
                    seasons
                  </span>
                  <span className="hc-tip-sub">
                    {m.wins}-{m.losses}
                    {m.ties ? `-${m.ties}` : ""}
                    {m.titles ? ` · ${m.titles} title${m.titles === 1 ? "" : "s"}` : ""}
                  </span>
                </span>
              </span>
              <span className="hc-rank-v">{m.avgFinish.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
      <div className="hc-xaxis hc-xaxis-inset">
        <span>{ord(1)}</span>
        <span>{ord(worst)}</span>
      </div>
    </Figure>
  );
}
