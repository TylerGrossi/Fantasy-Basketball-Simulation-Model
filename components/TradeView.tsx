"use client";

import { useMemo, useState } from "react";
import type { LeagueData, PoolPlayer } from "@/lib/league";
import { allPlayCats, scorableCategories, teamAgg, type Agg } from "@/lib/playerPool";

/**
 * A give-and-get trade board, then buy-low / sell-high ideas.
 *
 * The simulator leads because it is what the page is FOR; the trend lists underneath are
 * where you go for an idea when you don't already have one. Each side is a panel you build
 * by clicking names — the two dropdowns this replaces hid both rosters behind a menu, so
 * you could not see what you were trading against what.
 *
 * The verdict is deliberately not just "which pile of value is bigger". The category table
 * shows your WHOLE roster before and after, because a trade that wins on value can still
 * gut the one category you were carrying, and the all-play record is that same idea at
 * league scale — how the new roster would score against everyone every week, so schedule
 * luck stays out of it. All client-side; every click recomputes instantly.
 */

const SHIFT_CATS = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO"] as const;

/**
 * How many of the league's best are off the buy-low list.
 *
 * A slumping superstar is not a buy-low candidate, he is just a superstar having a bad
 * month — his owner knows exactly what he has and will not sell at a discount, so listing
 * Shai or Anthony Edwards as a "target" is advice you can't act on. The same scarcity
 * premium is spelled out in the Agent's system instruction; this is the list obeying it.
 * Ranked among ROSTERED players only — a free agent is not someone you trade for.
 */
const ELITE_COUNT = 20;

/**
 * How many players count toward a team's category totals — the league's
 * ten-counted-players-per-day cap.
 *
 * Summing the WHOLE roster is what made the all-play record nonsense: rosters here run
 * from 13 to 16 players, so the comparison was 13 men's production against 16 and the
 * bigger bench won regardless of talent. VJ Maxx — the best team in the league at 68%
 * real all-play — came out 40-41-0, below .500, while the 16-man roster ranked 7th in
 * the actual standings topped the list at 54-27-0. Ranking each side's best ten removes
 * roster size from the answer and puts the order back in line with the real standings.
 */
const COUNTED = 10;

/** The ten most valuable players — a team's counting lineup. */
const lineup = (players: PoolPlayer[]) =>
  [...players].sort((a, b) => b.value - a.value).slice(0, COUNTED);

export default function TradeView({
  league,
  myTeamName,
}: {
  league: LeagueData;
  myTeamName: string;
}) {
  const pool = league.seasonData.playerPool ?? [];
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [mineQuery, setMineQuery] = useState("");
  const [theirQuery, setTheirQuery] = useState("");
  /** "" = every other team; otherwise the one owner you're negotiating with. */
  const [withTeam, setWithTeam] = useState("");

  const byName = useMemo(() => new Map(pool.map((p) => [p.name, p])), [pool]);
  const mine = useMemo(
    () => pool.filter((p) => p.owner === myTeamName).sort((a, b) => b.value - a.value),
    [pool, myTeamName]
  );
  const theirs = useMemo(
    () =>
      pool
        .filter((p) => p.owner && p.owner !== myTeamName && p.owner !== "FA")
        .sort((a, b) => b.value - a.value),
    [pool, myTeamName]
  );
  const owners = useMemo(
    () => [...new Set(theirs.map((p) => p.owner))].sort(),
    [theirs]
  );

  // Every OTHER team's aggregate, for the all-play category record.
  const otherAggs = useMemo(() => {
    const byTeam = new Map<string, PoolPlayer[]>();
    for (const p of theirs) {
      const list = byTeam.get(p.owner) ?? [];
      list.push(p);
      byTeam.set(p.owner, list);
    }
    return [...byTeam.values()].map((roster) => teamAgg(lineup(roster)));
  }, [theirs]);

  const eliteNames = useMemo(
    () => new Set(theirs.slice(0, ELITE_COUNT).map((p) => p.name)),
    [theirs]
  );

  // The league's own scoring categories, minus any the player pool can't produce (TW).
  const cats = useMemo(
    () => scorableCategories(league.categories ?? []),
    [league.categories]
  );

  if (!pool.length) {
    return <p className="caption">No player pool data — run the data export.</p>;
  }
  if (!mine.length) {
    return <p className="caption">No rostered players found for {myTeamName}.</p>;
  }

  const giveP = give.map((n) => byName.get(n)).filter(Boolean) as PoolPlayer[];
  const getP = get.map((n) => byName.get(n)).filter(Boolean) as PoolPlayer[];

  // Both sides of the comparison are counting lineups, not whole rosters — see COUNTED.
  // It also makes the "after" honest: acquiring a star pushes your tenth man out of the
  // lineup rather than stacking his production on top of everyone else's.
  const myRosterAfter = [...mine.filter((p) => !give.includes(p.name)), ...getP];
  const before = teamAgg(lineup(mine));
  const after = teamAgg(lineup(myRosterAfter));

  const valOut = giveP.reduce((a, p) => a + p.value, 0);
  const valIn = getP.reduce((a, p) => a + p.value, 0);
  const net = valIn - valOut;
  const active = giveP.length > 0 || getP.length > 0;

  const lower = league.lowerIsBetter ?? ["TO"];
  const [bw, bl, bt] = otherAggs.length
    ? allPlayCats(before, otherAggs, cats, lower)
    : [0, 0, 0];
  const [aw, al, at] = otherAggs.length
    ? allPlayCats(after, otherAggs, cats, lower)
    : [0, 0, 0];
  const catSwing = aw - bw;

  const toggle = (list: string[], set: (v: string[]) => void, name: string) =>
    set(list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);

  const matches = (p: PoolPlayer, q: string) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      p.name.toLowerCase().includes(s) ||
      p.nbaTeam.toLowerCase().includes(s) ||
      p.position.toLowerCase().includes(s)
    );
  };

  // Sell high: your risers. Buy low: quality, slumping, NOT elite.
  const risers = mine
    .slice()
    .sort((a, b) => b.trend - a.trend)
    .slice(0, 5)
    .filter((p) => p.trend > 0.3);
  const targets = theirs
    .filter((p) => p.value > 3.0 && p.trend < -0.3 && !eliteNames.has(p.name))
    .sort((a, b) => a.trend - b.trend)
    .slice(0, 5);

  return (
    <>
      <div className="trade-board">
        <Side
          title="You give"
          subtitle={myTeamName}
          tone="out"
          selected={giveP}
          total={valOut}
          query={mineQuery}
          onQuery={setMineQuery}
          candidates={mine.filter((p) => matches(p, mineQuery))}
          isOn={(n) => give.includes(n)}
          onToggle={(n) => toggle(give, setGive, n)}
          onClear={() => setGive([])}
        />

        <Side
          title="You get"
          subtitle={withTeam || `${owners.length} other teams`}
          tone="in"
          selected={getP}
          total={valIn}
          query={theirQuery}
          onQuery={setTheirQuery}
          candidates={theirs.filter(
            (p) => (!withTeam || p.owner === withTeam) && matches(p, theirQuery)
          )}
          isOn={(n) => get.includes(n)}
          onToggle={(n) => toggle(get, setGet, n)}
          onClear={() => setGet([])}
          showOwner={!withTeam}
          filter={
            <select
              className="field field-select trade-team"
              value={withTeam}
              onChange={(e) => setWithTeam(e.target.value)}
              aria-label="Trade with"
            >
              <option value="">All teams</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          }
        />
      </div>

      {/* Verdict and category shift are ONE card spanning the board: the verdict alone
          was a full-width bar holding one number at the far left, and the table alone was
          a narrow column in a lot of empty page. Side by side they fill the width and the
          answer sits next to its working. */}
      {active ? (
        <div className="trade-result">
          <div className="tr-verdict">
            <span className="eyebrow">Net value</span>
            <span
              className="tv-net-num mono"
              style={{ color: net > 0 ? "var(--good)" : net < 0 ? "var(--bad)" : "var(--ink)" }}
            >
              {net >= 0 ? "+" : ""}
              {net.toFixed(1)}
            </span>
            <dl className="tr-facts">
              <div>
                <dt>Out</dt>
                <dd className="mono">
                  {valOut.toFixed(1)}{" "}
                  <span className="tr-count">
                    ({giveP.length} {giveP.length === 1 ? "player" : "players"})
                  </span>
                </dd>
              </div>
              <div>
                <dt>In</dt>
                <dd className="mono">
                  {valIn.toFixed(1)}{" "}
                  <span className="tr-count">
                    ({getP.length} {getP.length === 1 ? "player" : "players"})
                  </span>
                </dd>
              </div>
              {/* NOT called "all-play": that name belongs to the exact season figure on
                  the standings page, and putting it on a current-roster snapshot invited
                  a comparison between two numbers that were never the same statistic. */}
              <div>
                <dt title={`Categories won against all ${otherAggs.length} other rosters as they stand today`}>
                  Cats vs league
                </dt>
                <dd className="mono">
                  {`${bw}-${bl}-${bt}`} →{" "}
                  <strong
                    style={{
                      color:
                        catSwing > 0
                          ? "var(--good)"
                          : catSwing < 0
                            ? "var(--bad)"
                            : "var(--ink-2)",
                    }}
                  >
                    {`${aw}-${al}-${at}`}
                  </strong>
                  {catSwing !== 0 && (
                    <span className="tr-count">
                      {" "}
                      ({catSwing > 0 ? "+" : ""}
                      {catSwing})
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          <div className="tr-shift">
            <div className="table-scroll">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Now</th>
                    <th className="num">After</th>
                    <th className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {SHIFT_CATS.map((c) => (
                    <ShiftRow
                      key={c}
                      label={c}
                      now={before[c] ?? 0}
                      next={after[c] ?? 0}
                      lowerIsBetter={c === "TO"}
                    />
                  ))}
                  {(
                    [
                      ["FG%", "FGM", "FGA"],
                      ["FT%", "FTM", "FTA"],
                    ] as Array<[string, string, string]>
                  ).map(([label, made, att]) => (
                    <ShiftRow
                      key={label}
                      label={label}
                      now={ratio(before, made, att) * 100}
                      next={ratio(after, made, att) * 100}
                      pct
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="trade-result trade-result-idle">
          <span className="caption" style={{ margin: 0 }}>
            Pick at least one player on either side to see the verdict.
          </span>
        </div>
      )}
      {active && (
        <p className="caption">
          Per-game totals for your best {COUNTED} — the league counts ten players a day, so
          comparing whole rosters would just reward the deeper bench. Green = the trade
          helps that category; red = it hurts. <strong>Cats vs league</strong> is how those
          ten score against every other roster <em>as it stands today</em>, over{" "}
          {cats.length} of the league&rsquo;s {(league.categories ?? []).length} categories
          — it is a snapshot, not the season all-play on the standings page, which is the
          record those teams actually posted week by week.
        </p>
      )}

      <h2>Buy Low / Sell High</h2>
      <div className="two-up">
        <div>
          <h3 className="trade-side trade-sell">Sell High — your risers</h3>
          {risers.length === 0 ? (
            <p className="caption">No one clearly overperforming right now.</p>
          ) : (
            risers.map((p) => (
              <TrendLine key={p.name} p={p} good onAdd={() => toggle(give, setGive, p.name)} />
            ))
          )}
        </div>
        <div>
          <h3 className="trade-side trade-buy">Buy Low — slumping targets</h3>
          {targets.length === 0 ? (
            <p className="caption">
              No obviously slumping quality players on other rosters.
            </p>
          ) : (
            targets.map((p) => (
              <TrendLine key={p.name} p={p} onAdd={() => toggle(get, setGet, p.name)} />
            ))
          )}
        </div>
      </div>
    </>
  );
}

const ratio = (a: Agg, made: string, att: string) => (a[att] ? a[made] / a[att] : 0);

/** One side of the trade: what's on the block, then everyone you could add. */
function Side({
  title,
  subtitle,
  tone,
  selected,
  total,
  query,
  onQuery,
  candidates,
  isOn,
  onToggle,
  onClear,
  showOwner,
  filter,
}: {
  title: string;
  subtitle: string;
  tone: "in" | "out";
  selected: PoolPlayer[];
  total: number;
  query: string;
  onQuery: (v: string) => void;
  candidates: PoolPlayer[];
  isOn: (name: string) => boolean;
  onToggle: (name: string) => void;
  onClear: () => void;
  showOwner?: boolean;
  filter?: React.ReactNode;
}) {
  return (
    <section className={`trade-panel trade-panel-${tone}`}>
      <header className="tp-head">
        <div>
          <div className="eyebrow">{title}</div>
          <div className="tp-sub">{subtitle}</div>
        </div>
        <div className="tp-total mono">
          {total >= 0 ? "+" : ""}
          {total.toFixed(1)}
        </div>
      </header>

      <div className="tp-slot">
        {selected.length === 0 ? (
          <p className="tp-empty">Nobody yet — pick from the list below.</p>
        ) : (
          <>
            {selected.map((p) => (
              <button
                key={p.name}
                type="button"
                className="tp-pick"
                onClick={() => onToggle(p.name)}
                title="Remove"
              >
                <span className="tp-pick-name">{p.name}</span>
                <span className="tp-pick-meta">
                  {p.nbaTeam} · {p.position}
                </span>
                <span className="tp-pick-val mono">
                  {p.value >= 0 ? "+" : ""}
                  {p.value.toFixed(1)}
                </span>
                <span className="tp-pick-x" aria-hidden="true">
                  ×
                </span>
              </button>
            ))}
            <button type="button" className="tp-clear" onClick={onClear}>
              Clear side
            </button>
          </>
        )}
      </div>

      <div className="tp-controls">
        <input
          className="field"
          type="search"
          placeholder="Search name, team, position…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label={`Search players to ${title.toLowerCase()}`}
        />
        {filter}
      </div>

      <div className="tp-list">
        {candidates.length === 0 && <p className="tp-empty">No players match.</p>}
        {candidates.map((p) => (
          <button
            key={p.name}
            type="button"
            className={`tp-row ${isOn(p.name) ? "tp-row-on" : ""}`}
            onClick={() => onToggle(p.name)}
            aria-pressed={isOn(p.name)}
          >
            <span className="tp-row-name">{p.name}</span>
            <span className="tp-row-meta">
              {showOwner ? p.owner : `${p.nbaTeam} · ${p.position}`}
            </span>
            <span
              className="tp-row-val mono"
              style={{ color: p.value >= 0 ? "var(--good)" : "var(--bad)" }}
            >
              {p.value >= 0 ? "+" : ""}
              {p.value.toFixed(1)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ShiftRow({
  label,
  now,
  next,
  lowerIsBetter,
  pct,
}: {
  label: string;
  now: number;
  next: number;
  lowerIsBetter?: boolean;
  pct?: boolean;
}) {
  const d = next - now;
  // Flat means "rounds to nothing at the precision shown", not "exactly zero" — a swap
  // that moves steals by 0.04 was printing a meaningless, faintly alarming "-0.0".
  const flat = Math.abs(Number(d.toFixed(1))) === 0;
  const good = lowerIsBetter ? d < 0 : d > 0;
  const color = flat ? "var(--ink-2)" : good ? "var(--good)" : "var(--bad)";
  const f = (v: number) => `${v.toFixed(1)}${pct ? "%" : ""}`;
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{label}</td>
      <td className="num" style={{ color: "var(--ink-2)" }}>
        {f(now)}
      </td>
      <td className="num">{f(next)}</td>
      <td className="num" style={{ color }}>
        {flat ? "–" : `${d >= 0 ? "+" : ""}${f(d)}`}
      </td>
    </tr>
  );
}

/** A buy-low / sell-high line that puts the player straight onto the trade board. */
function TrendLine({
  p,
  good,
  onAdd,
}: {
  p: PoolPlayer;
  good?: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="trade-line">
      <div>
        <strong>{p.name}</strong>{" "}
        <span className="mono" style={{ color: good ? "var(--good)" : "var(--bad)" }}>
          {p.trend >= 0 ? "+" : ""}
          {p.trend.toFixed(1)}
        </span>{" "}
        <span style={{ color: "var(--ink-2)" }}>trend, value {p.value.toFixed(1)}</span>
      </div>
      <button type="button" className="chip trade-add" onClick={onAdd}>
        {good ? "Offer" : "Target"}
      </button>
    </div>
  );
}
