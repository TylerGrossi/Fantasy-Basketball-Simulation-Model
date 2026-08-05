"use client";

import { useMemo, useState } from "react";
import MultiSelect from "./MultiSelect";
import { POSITION_ORDER, headshotUrl, playerStatus } from "@/lib/playerPool";
import {
  NINE_CAT,
  scoreProjections,
  type DraftRow,
  type ProjectedLine,
} from "@/lib/projection";

/**
 * The draft board: every projected player, ranked, cut into tiers, with the projection's
 * reasoning attached to each row.
 *
 * The row list is deliberately the same shape as Player Value's — a ranked strip you can
 * tap open — because it is the same gesture applied to a different number, and inventing
 * a second interaction for it would only make the two pages feel unrelated. What is new
 * is the tier rule between rows, the projected-vs-actual pair inside the card, and the
 * punt controls, which are the reason a draft board is not just a sorted table.
 *
 * All scoring happens here, in the browser: ~290 players x 14 categories, twice, is
 * sub-millisecond, so punting a category is instant rather than a page load.
 */

type Basis = "League" | "9-cat";
type RankBy = "total" | "perGame";

export default function DraftBoardView({
  lines,
  leagueCats,
  lowerIsBetter,
  poolSize,
  season,
}: {
  lines: ProjectedLine[];
  leagueCats: string[];
  lowerIsBetter: string[];
  poolSize: number;
  season: number;
}) {
  const [name, setName] = useState("");
  const [positions, setPositions] = useState<string[]>([]);
  const [basis, setBasis] = useState<Basis>("League");
  const [punts, setPunts] = useState<string[]>([]);
  const [rankBy, setRankBy] = useState<RankBy>("total");
  const [minGames, setMinGames] = useState(20);

  const allCats = basis === "League" ? leagueCats : NINE_CAT.filter((c) => leagueCats.includes(c));
  const categories = useMemo(
    () => allCats.filter((c) => !punts.includes(c)),
    [allCats, punts]
  );

  const rows = useMemo(
    () =>
      scoreProjections(lines, {
        categories,
        lowerIsBetter,
        poolSize,
        rankBy,
      }),
    [lines, categories, lowerIsBetter, poolSize, rankBy]
  );

  const positionOptions = useMemo(() => {
    const present = new Set(lines.flatMap((l) => l.eligibleSlots).filter(Boolean));
    return [
      ...POSITION_ORDER.filter((p) => present.has(p)),
      ...[...present].filter((p) => !POSITION_ORDER.includes(p)).sort(),
    ];
  }, [lines]);

  // Filtering happens AFTER ranking, never before it: the rank shown is the player's
  // rank on the board, not their rank among centres who played 40 games. Filtering to a
  // position should tell you where those players sit in the draft, which is the whole
  // question being asked of it.
  const shown = useMemo(() => {
    const q = name.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (positions.length && !r.eligibleSlots.some((s) => positions.includes(s))) return false;
      if (r.gp < minGames) return false;
      return true;
    });
  }, [rows, name, positions, minGames]);

  const maxAbs = Math.max(1, ...rows.slice(0, poolSize).map((r) => Math.abs(metric(r, rankBy))));
  const nextSeason = `${season}-${String((season + 1) % 100).padStart(2, "0")}`;

  return (
    <>
      <div className="controls pv-filters">
        <div className="ms pv-f-name">
          <div className="ms-label">Player name</div>
          <input
            className="field"
            type="search"
            placeholder="Search…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Player name"
          />
        </div>
        <MultiSelect
          label="Position"
          options={positionOptions}
          selected={positions}
          onChange={setPositions}
          className="pv-f-pos"
        />
        <MultiSelect
          label="Punt categories"
          options={allCats}
          selected={punts}
          onChange={setPunts}
          className="dg-f-punt"
        />
        <div className="ms dg-f-basis">
          <div className="ms-label">Categories</div>
          <select
            className="field field-select"
            value={basis}
            onChange={(e) => setBasis(e.target.value as Basis)}
            aria-label="Category basis"
          >
            <option value="League">League ({leagueCats.length})</option>
            <option value="9-cat">9-cat</option>
          </select>
        </div>
        <div className="ms dg-f-rank">
          <div className="ms-label">Rank by</div>
          <select
            className="field field-select"
            value={rankBy}
            onChange={(e) => setRankBy(e.target.value as RankBy)}
            aria-label="Rank by"
          >
            <option value="total">Season value</option>
            <option value="perGame">Per game</option>
          </select>
        </div>
        <div className="ms dg-f-gp">
          <div className="ms-label">Min games</div>
          <select
            className="field field-select"
            value={minGames}
            onChange={(e) => setMinGames(Number(e.target.value))}
            aria-label="Minimum games played last season"
          >
            {[0, 10, 20, 40].map((g) => (
              <option key={g} value={g}>
                {g === 0 ? "Any" : `${g}+`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {punts.length > 0 && (
        <p className="dg-punt-note">
          Punting <strong>{punts.join(", ")}</strong> — those categories are removed from
          every player&rsquo;s value, so the board now ranks players by what they give you
          in the {categories.length} you are actually contesting.
        </p>
      )}

      {shown.length === 0 ? (
        <p className="caption">No players match these filters.</p>
      ) : (
        <div className="pv-list dg-list">
          {shown.map((r, i) => (
            <BoardRow
              key={`${r.name}-${r.playerId ?? i}`}
              r={r}
              rankBy={rankBy}
              maxAbs={maxAbs}
              // A tier heading is drawn whenever the tier changes between two VISIBLE
              // rows, so filtering to one position still shows which tier each of them
              // came from instead of a run of unlabelled rows.
              showTier={i === 0 || shown[i - 1].tier !== r.tier}
            />
          ))}
        </div>
      )}

      <div className="dg-method">
        <h2 className="dg-method-h">How these numbers were made</h2>
        <p>
          These are <strong>projections for {nextSeason}</strong>, not last season&rsquo;s
          totals re-sorted. Nobody publishes next-season numbers this early — ESPN&rsquo;s
          own projections do not appear until the preseason — so this is a model built
          from the league export, and it should be read as an estimate with a method
          rather than as a fact.
        </p>
        <p>
          The central idea: a per-game line is three things multiplied together —{" "}
          <em>production per minute</em>, <em>minutes per game</em>, and{" "}
          <em>games available</em> — and the model takes them apart before putting them
          back. Conflating them is what makes a raw ranking punish an injured star as
          though he had got worse, and reward a player whose minutes only rose because
          someone ahead of him got hurt.
        </p>
        <ol className="dg-steps">
          <li>
            <strong>Three seasons, weighted to the present.</strong> Production is blended
            across up to three seasons at roughly 60/25/15, newest first, and each season
            is discounted further by how much of it was actually played. One lost year
            bends the projection; it does not define it.
          </li>
          <li>
            <strong>Per-36, not per game.</strong> Every season is divided by its own
            minutes before blending, so what is carried forward is a rate of production
            rather than a rate times an opportunity. This is what keeps an injury out of
            the production estimate entirely.
          </li>
          <li>
            <strong>Role.</strong> Minutes are projected separately: mostly this
            season&rsquo;s, pulled back toward the player&rsquo;s earlier-season baseline —
            and pulled back harder when this season was short, because a star on a minutes
            restriction has not been demoted. That regression is also what deflates a
            player whose minutes spiked filling in for someone else.
          </li>
          <li>
            <strong>Sample size.</strong> Thin histories are pulled toward a
            position-specific baseline, measured in <em>minutes</em> rather than games —
            30 games at 34 minutes is real evidence and 30 games at 9 minutes is not. The
            baseline is a fringe regular, so an unknown does not float up for being unknown.
          </li>
          <li>
            <strong>Age.</strong> Growth below 25 (capped by how many seasons a player has
            already played), plateau to 28, decline after, accelerating past 33. Applied
            per stat group: rebounds, blocks and steals decline fastest, shooting and
            passing hold longest.
          </li>
          <li>
            <strong>Shooting luck.</strong> FG%, FT% and 3P% are shrunk toward a
            positional league rate in proportion to how few attempts they rest on — now
            over the whole three-year history, so a settled shooter is barely moved. Makes
            are rebuilt from attempts × the shrunk rate, so each card&rsquo;s shooting line
            is internally consistent.
          </li>
          <li>
            <strong>Availability.</strong> Games are projected from the three-year record
            on a <em>flatter</em> weighting than production — missed time is mostly
            one-off, so a single hurt season should not become a verdict — then halved
            against the field and docked for age and current injury.{" "}
            <em>Season value</em> multiplies per-game value by that durability;{" "}
            <em>per game</em> ignores it. Comparing the two rankings separates &ldquo;how
            good&rdquo; from &ldquo;how often&rdquo;.
          </li>
        </ol>
        <p>
          Value is a z-score against the top {poolSize} projected players — the pool that
          will actually be drafted — summed over{" "}
          {basis === "League"
            ? `this league's own ${leagueCats.length} scorable categories`
            : "the conventional nine categories"}
          . Percentage categories are volume-weighted, so a high rate on few attempts is
          worth little.
        </p>
        <p className="caption">
          Known limits: the pool is every rostered player plus the top free agents from
          last season, so it has no rookies and nobody who was out of the league. It has
          box scores, not depth charts — a player whose minutes rose because he won the job
          and one whose minutes rose because a teammate tore an ACL look identical here,
          and both are treated as partly persistent. It knows nothing about trades or
          signings made since the season ended. Treat the tiers as the output, and the
          exact ranks inside a tier as noise.
        </p>
      </div>
    </>
  );
}

function metric(r: DraftRow, rankBy: RankBy): number {
  return rankBy === "total" ? r.total : r.perGame;
}

function BoardRow({
  r,
  rankBy,
  maxAbs,
  showTier,
}: {
  r: DraftRow;
  rankBy: RankBy;
  maxAbs: number;
  showTier: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [code, sev] = playerStatus(r.status);
  const v = metric(r, rankBy);
  const positive = v >= 0;
  const width = Math.min(100, (Math.abs(v) / maxAbs) * 100);
  const shot = headshotUrl(r.playerId);

  // The move: how far the projection sits from where this season's line alone would put
  // them, on the same z-scale. This is the one number that answers "why isn't this just
  // last year's list", so it gets a place on the collapsed row.
  const move = r.perGame - r.actualValue;

  return (
    <>
      {showTier && (
        <div className="dg-tier">
          <span className="dg-tier-l">Tier {r.tier}</span>
          <span className="dg-tier-rule" />
        </div>
      )}
      <details className="pv-item dg-item" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="pv-sum dg-sum">
          <span
            className="pv-fill"
            style={{
              width: `${width.toFixed(1)}%`,
              background: positive ? "var(--cobalt)" : "var(--clay)",
            }}
          />
          <span className="pv-rank">{r.rank}</span>
          <span className="pv-name">{r.name}</span>
          {code && <span className={`pv-badge ${sev}`}>{code}</span>}
          <span className="pv-meta dg-slots">{r.eligibleSlots.join("/") || r.position}</span>
          <span className="dg-gp" title="Projected games played next season">
            {r.projGp} GP
          </span>
          <span
            className="pv-val"
            style={{ color: positive ? "var(--good)" : "var(--bad)" }}
          >
            {v >= 0 ? "+" : ""}
            {v.toFixed(1)}
          </span>
          <MoveChip v={move} />
        </summary>
        {open && (
          <div className="pv-detail dg-detail">
            <div className="pv-card">
              {shot ? (
                <div className="pv-shot" style={{ backgroundImage: `url('${shot}')` }} />
              ) : (
                <div className="pv-shot pv-shot-blank" />
              )}
              <div className="pv-chead">
                <div className="pv-cname">{r.name}</div>
                <div className="pv-csub">
                  <span className="pv-cmeta">
                    {[
                      r.nbaTeam,
                      r.eligibleSlots.join("/") || r.position,
                      r.age != null ? `Age ${r.age}` : null,
                      r.exp != null ? `${r.exp} yr${r.exp === 1 ? "" : "s"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="pv-badges">
                    <span className={`dg-conf dg-conf-${r.confidence}`}>
                      {r.confidence === "high"
                        ? "Solid sample"
                        : r.confidence === "low"
                          ? "Thin sample"
                          : "Fair sample"}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {r.drivers.length > 0 && (
              <ul className="dg-drivers">
                {r.drivers.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}

            {/* Projected against actual, side by side. Showing the projection alone would
                hide the only thing that makes this page different from a sorted table. */}
            <div className="table-scroll">
              <table className="dg-table">
                <thead>
                  <tr>
                    <th>Per game</th>
                    <th>GP</th>
                    <th>PTS</th>
                    <th>REB</th>
                    <th>AST</th>
                    <th>3PM</th>
                    <th>STL</th>
                    <th>BLK</th>
                    <th>TO</th>
                    <th>FG%</th>
                    <th>FT%</th>
                    <th>3P%</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="dg-actual">
                    <th scope="row">Last season</th>
                    <td>{r.gp}</td>
                    <Cells line={r.actual} fg={r.fgPct} ft={r.ftPct} tp={r.tpPct} />
                  </tr>
                  <tr className="dg-proj">
                    <th scope="row">Projected</th>
                    <td>{r.projGp}</td>
                    <Cells
                      line={r.proj}
                      fg={r.projFgPct}
                      ft={r.projFtPct}
                      tp={r.projTpPct}
                    />
                  </tr>
                </tbody>
              </table>
            </div>

            <CategoryBars z={r.z} />
          </div>
        )}
      </details>
    </>
  );
}

function Cells({
  line,
  fg,
  ft,
  tp,
}: {
  line: Record<string, number>;
  fg: number;
  ft: number;
  tp: number;
}) {
  const one = (k: string) => (line[k] ?? 0).toFixed(1);
  const pct = (v: number) => `${(v * 100).toFixed(1)}`;
  return (
    <>
      <td>{one("PTS")}</td>
      <td>{one("REB")}</td>
      <td>{one("AST")}</td>
      <td>{one("3PM")}</td>
      <td>{one("STL")}</td>
      <td>{one("BLK")}</td>
      <td>{one("TO")}</td>
      <td>{pct(fg)}</td>
      <td>{pct(ft)}</td>
      <td>{pct(tp)}</td>
    </>
  );
}

/**
 * Per-category z-scores as a diverging strip — where this player's value actually comes
 * from. It is what tells you whether a +2.0 is a balanced contributor or one elite
 * category carrying eight mediocre ones, which is the difference between a safe pick and
 * a build-defining one.
 */
function CategoryBars({ z }: { z: Record<string, number> }) {
  const entries = Object.entries(z);
  if (!entries.length) return null;
  const peak = Math.max(1, ...entries.map(([, v]) => Math.abs(v)));
  return (
    <div className="dg-bars">
      {entries.map(([cat, v]) => (
        <div className="dg-bar" key={cat}>
          <span className="dg-bar-l">{cat}</span>
          <span className="dg-bar-track">
            <span
              className="dg-bar-fill"
              style={{
                width: `${((Math.abs(v) / peak) * 50).toFixed(1)}%`,
                [v >= 0 ? "left" : "right"]: "50%",
                background: v >= 0 ? "var(--good)" : "var(--bad)",
              }}
            />
          </span>
          <span className="dg-bar-v">
            {v >= 0 ? "+" : ""}
            {v.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** How far the projection moved this player off their raw season line. Geometric, no emoji. */
function MoveChip({ v }: { v: number }) {
  if (v > 0.35) return <span className="pv-trend up" title="Projected up">&#9650;</span>;
  if (v < -0.35) return <span className="pv-trend down" title="Projected down">&#9660;</span>;
  return <span className="pv-trend flat" title="Projection close to last season">&ndash;</span>;
}
