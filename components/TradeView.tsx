"use client";

import { useMemo, useState } from "react";
import type { LeagueData, PoolPlayer } from "@/lib/league";
import { teamAgg, type Agg } from "@/lib/playerPool";
import PlayerSearch from "./PlayerSearch";
import PlayerLink from "./PlayerLink";

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

  const eliteNames = useMemo(
    () => new Set(theirs.slice(0, ELITE_COUNT).map((p) => p.name)),
    [theirs]
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

  /*
   * A trade has ONE partner. The first player you take fixes whose team you are dealing
   * with, and everything downstream reads this rather than the dropdown: the search only
   * offers that roster, and the equalizer suggestions only come from it.
   *
   * Without this the board happily built a deal out of two different owners' players,
   * which is not a trade anyone can actually make — it looked like a filter default
   * ("All teams") but was really a way to produce an impossible offer.
   */
  const partner = getP[0]?.owner ?? "";
  const dealTeam = partner || withTeam;
  const theirRoster = theirs.filter((p) => !dealTeam || p.owner === dealTeam);

  /*
   * How many categories the deal improves vs hurts — the same nine rows the table shows,
   * counted once here so the headline and the table can never disagree.
   *
   * "Flat" is measured at the precision DISPLAYED (one decimal), matching ShiftRow: a
   * category that moves by 0.04 prints as "–" in the table, so counting it as a win up
   * here would be the summary contradicting the working directly beneath it.
   */
  const { catUp, catDown } = useMemo(() => {
    let up = 0;
    let down = 0;
    const tally = (now: number, next: number, lowerIsBetter = false) => {
      const d = Number((next - now).toFixed(1));
      if (d === 0) return;
      const good = lowerIsBetter ? d < 0 : d > 0;
      if (good) up += 1;
      else down += 1;
    };
    for (const c of SHIFT_CATS) tally(before[c] ?? 0, after[c] ?? 0, c === "TO");
    tally(ratio(before, "FGM", "FGA") * 100, ratio(after, "FGM", "FGA") * 100);
    tally(ratio(before, "FTM", "FTA") * 100, ratio(after, "FTM", "FTA") * 100);
    return { catUp: up, catDown: down };
  }, [before, after]);

  /** Net change in roster size — a 2-for-1 leaves a hole to fill off waivers. */
  const rosterDelta = getP.length - giveP.length;


  const toggle = (list: string[], set: (v: string[]) => void, name: string) =>
    set(list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);

  /*
   * Players who would level the deal.
   *
   * The gap is `net` (positive = the trade already favours you), so the balancing move is
   * a player worth roughly that much added to the LIGHTER side — yours when you're ahead,
   * theirs when you're behind. Ranked by how close each one gets the deal to even rather
   * than by value: the point is to balance, so a 3.0 next to a 3.2 gap beats a 9.0.
   *
   * Anyone already in the deal is excluded — offering a player you have on the board is
   * how the list starts reading as noise. When you're behind, the source is the PARTNER's
   * roster, not every other team: suggesting a player the other manager doesn't own would
   * propose the same impossible multi-team deal the board now prevents.
   */
  const equalizers = useMemo(() => {
    const gap = Math.abs(net);
    if (!active || gap < 0.05) return [];
    const source = net > 0 ? mine : theirRoster;
    const chosen = new Set([...give, ...get]);
    return source
      .filter((p) => !chosen.has(p.name) && p.value > 0)
      .map((p) => ({ p, off: Math.abs(p.value - gap) }))
      .sort((a, b) => a.off - b.off)
      .slice(0, 5)
      .map((x) => x.p);
  }, [net, active, mine, theirRoster, give, get]);

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
    <div className="trade-layout">
      <div className="trade-main">
      <div className="trade-board">
        <Side
          title="You give"
          subtitle={myTeamName}
          tone="out"
          pool={mine}
          selected={giveP}
          total={valOut}
          onAdd={(n) => toggle(give, setGive, n)}
          onRemove={(n) => toggle(give, setGive, n)}
          onClear={() => setGive([])}
        />

        <Side
          title="You get"
          subtitle={dealTeam || `pick a team`}
          tone="in"
          pool={theirRoster}
          selected={getP}
          total={valIn}
          onAdd={(n) => toggle(get, setGet, n)}
          onRemove={(n) => toggle(get, setGet, n)}
          onClear={() => {
            setGet([]);
            setWithTeam("");
          }}
          showOwner={false}
          filter={
            <select
              className="field field-select trade-team"
              value={dealTeam}
              /* Locked once someone is on the board: the partner is decided by who you
                 took, and silently switching teams under an existing offer would leave a
                 deal made of two different rosters. Clearing the side unlocks it. */
              disabled={!!partner}
              title={partner ? `Trading with ${partner} — clear this side to change` : undefined}
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

      {/* Which way the deal leans, as one sentence between the two sides — the number is
          already above in each side's total, so this says only what it MEANS. */}
      {active && (
        <div className={`trade-favors ${net > 0 ? "tf-you" : net < 0 ? "tf-them" : "tf-even"}`}>
          {Math.abs(net) < 0.05 ? (
            <>An even trade by value</>
          ) : net > 0 ? (
            <>&larr; Favors you by <strong>{net.toFixed(1)}</strong></>
          ) : (
            <>Favors the other side by <strong>{Math.abs(net).toFixed(1)}</strong> &rarr;</>
          )}
        </div>
      )}

      {/* Players to equalize: the gap is `net`, so the fix is a player worth about that
          much added to the LIGHTER side. Sorted by how close each one gets to level, not
          by value — the useful suggestion is the one that balances, not the best player. */}
      {active && equalizers.length > 0 && (
        <section className="trade-equal">
          <h3 className="trade-equal-h">
            Equalize
            <span className="tp-sub">
              add {net > 0 ? "to your side" : "to theirs"}
            </span>
          </h3>
          <div className="trade-equal-list">
            {equalizers.map((p) => (
              <button
                key={p.name}
                type="button"
                className="teq"
                onClick={() =>
                  net > 0 ? toggle(give, setGive, p.name) : toggle(get, setGet, p.name)
                }
                title={`Add ${p.name} to ${net > 0 ? "your side" : "their side"}`}
              >
                <span className="teq-plus" aria-hidden="true">
                  +
                </span>
                <span className="teq-name">{p.name}</span>
                <span className="teq-val mono">{p.value.toFixed(1)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Verdict ACROSS THE TOP, category shift underneath — the two used to sit side by
          side, which left the table in a narrow column while the verdict had a column of
          its own for three numbers. Three figures read fine as a row; the table wants the
          full width. */}
      {active ? (
        <div className="trade-result">
          {/*
            A row of equal tiles rather than one big number with two labels trailing after
            it. Net value keeps the emphasis (it is the headline), and the rest are the
            figures you would otherwise have to derive by reading the table underneath:
            how many categories move each way, and where the roster spots go.
          */}
          <div className="tr-verdict">
            <div className="tr-tile tr-tile-lead">
              <span className="eyebrow">Net value</span>
              <span
                className="tv-net-num mono"
                style={{ color: net > 0 ? "var(--good)" : net < 0 ? "var(--bad)" : "var(--ink)" }}
              >
                {net >= 0 ? "+" : ""}
                {net.toFixed(1)}
              </span>
              <span className="tr-count">
                {Math.abs(net) < 0.05
                  ? "even"
                  : net > 0
                    ? "in your favour"
                    : "in theirs"}
              </span>
            </div>

            <div className="tr-tile">
              <span className="eyebrow">Out</span>
              <span className="tr-tile-v mono">{valOut.toFixed(1)}</span>
              <span className="tr-count">
                {giveP.length} {giveP.length === 1 ? "player" : "players"}
              </span>
            </div>

            <div className="tr-tile">
              <span className="eyebrow">In</span>
              <span className="tr-tile-v mono">{valIn.toFixed(1)}</span>
              <span className="tr-count">
                {getP.length} {getP.length === 1 ? "player" : "players"}
              </span>
            </div>

            {/* The table below says which categories move; this says how many, so a deal
                can be read as "wins 6, loses 3" without counting rows by eye. */}
            <div className="tr-tile">
              <span className="eyebrow">Categories</span>
              <span className="tr-tile-v mono">
                <span style={{ color: "var(--good)" }}>{catUp}</span>
                <span className="tr-sep">/</span>
                <span style={{ color: "var(--bad)" }}>{catDown}</span>
              </span>
              <span className="tr-count">better / worse</span>
            </div>

            <div className="tr-tile">
              <span className="eyebrow">Roster spots</span>
              <span className="tr-tile-v mono">
                {rosterDelta > 0 ? "+" : ""}
                {rosterDelta}
              </span>
              <span className="tr-count">
                {mine.length} &rarr; {mine.length + rosterDelta}
              </span>
            </div>
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
      </div>

      {/*
        Trends rail. Same two lists as before (they were a full-width two-up block under
        the board), moved beside the board so an idea is visible WHILE you build a deal
        rather than after scrolling past the verdict — clicking one puts the player
        straight onto the right side of the board.
      */}
      <aside className="trade-rail">
        <h2 className="trade-rail-h">Trends</h2>

        <div className="eyebrow trade-rail-sec trade-sell">Sell high — your risers</div>
        {risers.length === 0 ? (
          <p className="caption">No one clearly overperforming right now.</p>
        ) : (
          risers.map((p) => (
            <TrendLine key={p.name} p={p} good onAdd={() => toggle(give, setGive, p.name)} />
          ))
        )}

        <div className="eyebrow trade-rail-sec trade-buy">Buy low — slumping targets</div>
        {targets.length === 0 ? (
          <p className="caption">No obviously slumping quality players on other rosters.</p>
        ) : (
          targets.map((p) => (
            <TrendLine key={p.name} p={p} onAdd={() => toggle(get, setGet, p.name)} />
          ))
        )}
      </aside>
    </div>
  );
}

const ratio = (a: Agg, made: string, att: string) => (a[att] ? a[made] / a[att] : 0);

/** One side of the trade: what's on the block, then everyone you could add. */
function Side({
  title,
  subtitle,
  tone,
  pool,
  selected,
  total,
  onAdd,
  onRemove,
  onClear,
  showOwner,
  filter,
}: {
  title: string;
  subtitle: string;
  tone: "in" | "out";
  /** Everyone eligible for this side — the search filters it; nothing is listed up front. */
  pool: PoolPlayer[];
  selected: PoolPlayer[];
  total: number;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onClear: () => void;
  showOwner?: boolean;
  filter?: React.ReactNode;
}) {
  const chosen = new Set(selected.map((p) => p.name));
  // Already-picked players drop out of the search rather than sitting there as a no-op
  // that silently removes them when tapped.
  const searchable = pool.filter((p) => !chosen.has(p.name));

  return (
    <section className={`trade-panel trade-panel-${tone}`}>
      {/*
        One line of chrome, not four. This had a two-line header block, a full `<table>`
        with its own PLAYER/VALUE header row, and a separate total row — a frame heavier
        than the one or two players it usually holds. Title, subtitle and the running
        total now share a single line, and the picks are plain rows underneath.
      */}
      <header className="tp-head">
        <span className="eyebrow tp-title">{title}</span>
        <span className="tp-sub">{subtitle}</span>
        <span className="tp-total mono">{total.toFixed(1)}</span>
      </header>

      <div className="tp-controls">
        <PlayerSearch
          pool={searchable}
          value=""
          onPick={onAdd}
          label={`Search players to ${title.toLowerCase()}`}
        />
        {filter}
      </div>

      <ul className="tp-picks">
        {selected.length === 0 && <li className="tp-empty">Search to add players.</li>}
        {selected.map((p) => (
          <li className="tp-pick" key={p.name}>
            <span className="tp-pick-id">
              <span className="tp-pick-name"><PlayerLink name={p.name} /></span>
              <span className="tp-pick-meta">
                {showOwner ? p.owner : `${p.nbaTeam} · ${p.position}`}
              </span>
            </span>
            <span className="tp-pick-val mono">{p.value.toFixed(1)}</span>
            <button
              type="button"
              className="tp-x"
              onClick={() => onRemove(p.name)}
              aria-label={`Remove ${p.name}`}
              title="Remove"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {selected.length > 1 && (
        <button type="button" className="tp-clear" onClick={onClear}>
          Clear side
        </button>
      )}
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
      {/* Name on its own line, the numbers under it. Inline, the name and the two figures
          wrapped mid-phrase at rail width ("value" on one line, "-1.8" on the next). */}
      <div className="tl-id">
        <strong className="tl-name"><PlayerLink name={p.name} /></strong>
        <span className="tl-nums">
          <span className="mono" style={{ color: good ? "var(--good)" : "var(--bad)" }}>
            {p.trend >= 0 ? "+" : ""}
            {p.trend.toFixed(1)}
          </span>{" "}
          trend &middot; value <span className="mono">{p.value.toFixed(1)}</span>
        </span>
      </div>
      <button type="button" className="chip trade-add" onClick={onAdd}>
        {good ? "Offer" : "Target"}
      </button>
    </div>
  );
}
