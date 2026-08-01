"use client";

import { useMemo, useState } from "react";
import type { LeagueData, PoolPlayer } from "@/lib/league";
import MultiSelect from "./MultiSelect";
import { allPlayCats, teamAgg, type Agg } from "@/lib/playerPool";

/**
 * Buy-low / sell-high trends, then a give-and-get trade simulator.
 *
 * The verdict is not just "which pile of value is bigger": the category table shows your
 * WHOLE roster before and after, because a trade that wins on value can still gut the one
 * category you were carrying. The all-play record above it is the same idea at league
 * scale — how the new roster would score against everyone every week, so schedule luck
 * stays out of the answer. All client-side; adding a player recomputes instantly.
 */

const SHIFT_CATS = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO"] as const;

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

  const byName = useMemo(
    () => new Map(pool.map((p) => [p.name, p])),
    [pool]
  );
  const mine = useMemo(
    () => pool.filter((p) => p.owner === myTeamName),
    [pool, myTeamName]
  );

  // Every OTHER team's aggregate, for the all-play category record. Free agents are not a
  // team, so they are excluded from the field even though they can be acquired.
  const otherAggs = useMemo(() => {
    const byTeam = new Map<string, PoolPlayer[]>();
    for (const p of pool) {
      if (p.owner === myTeamName || p.owner === "FA" || !p.owner) continue;
      const list = byTeam.get(p.owner) ?? [];
      list.push(p);
      byTeam.set(p.owner, list);
    }
    return [...byTeam.values()].map(teamAgg);
  }, [pool, myTeamName]);

  const myNames = useMemo(() => [...mine.map((p) => p.name)].sort(), [mine]);
  const otherNames = useMemo(
    () => [...pool.filter((p) => p.owner !== myTeamName).map((p) => p.name)].sort(),
    [pool, myTeamName]
  );

  if (!pool.length) {
    return <p className="caption">No player pool data — run the data export.</p>;
  }
  if (!mine.length) {
    return <p className="caption">No rostered players found for {myTeamName}.</p>;
  }

  // Sell high: your risers. Buy low: quality players slumping on someone else's roster.
  const risers = [...mine]
    .sort((a, b) => b.trend - a.trend)
    .slice(0, 5)
    .filter((p) => p.trend > 0.3);
  const targets = pool
    .filter(
      (p) =>
        p.owner !== myTeamName && p.owner !== "FA" && p.value > 3.0 && p.trend < -0.3
    )
    .sort((a, b) => a.trend - b.trend)
    .slice(0, 5);

  const giveP = give.map((n) => byName.get(n)).filter(Boolean) as PoolPlayer[];
  const getP = get.map((n) => byName.get(n)).filter(Boolean) as PoolPlayer[];

  const beforePlayers = mine;
  const afterPlayers = [
    ...mine.filter((p) => !give.includes(p.name)),
    ...getP,
  ];
  const before = teamAgg(beforePlayers);
  const after = teamAgg(afterPlayers);

  const valOut = giveP.reduce((a, p) => a + p.value, 0);
  const valIn = getP.reduce((a, p) => a + p.value, 0);
  const net = valIn - valOut;

  const [bw, bl, bt] = otherAggs.length ? allPlayCats(before, otherAggs) : [0, 0, 0];
  const [aw, al, at] = otherAggs.length ? allPlayCats(after, otherAggs) : [0, 0, 0];

  const active = give.length > 0 || get.length > 0;

  return (
    <>
      <h2>Buy Low / Sell High</h2>
      <div className="two-up">
        <div>
          <h3 className="trade-side trade-sell">Sell High — your risers</h3>
          {risers.length === 0 ? (
            <p className="caption">No one clearly overperforming right now.</p>
          ) : (
            risers.map((p) => <TrendLine key={p.name} p={p} good />)
          )}
        </div>
        <div>
          <h3 className="trade-side trade-buy">Buy Low — slumping targets</h3>
          {targets.length === 0 ? (
            <p className="caption">
              No obviously slumping quality players on other rosters.
            </p>
          ) : (
            targets.map((p) => <TrendLine key={p.name} p={p} />)
          )}
        </div>
      </div>

      <h2>Simulate a Trade</h2>
      <p className="caption">
        Pick players to give and receive, then see how your category strength moves.
      </p>
      <div className="controls">
        <MultiSelect
          label="You give"
          options={myNames}
          selected={give}
          onChange={setGive}
          placeholder="Nobody"
          searchable
          minWidth={220}
        />
        <MultiSelect
          label="You get"
          options={otherNames}
          selected={get}
          onChange={setGet}
          placeholder="Nobody"
          searchable
          minWidth={220}
        />
      </div>

      {!active ? (
        <p className="caption">Select at least one player to simulate a trade.</p>
      ) : (
        <>
          <div className="metrics metrics-3">
            <Metric label="Value out" value={valOut.toFixed(1)} sub="9-cat value sent" />
            <Metric label="Value in" value={valIn.toFixed(1)} sub="9-cat value received" />
            <Metric
              label="Net value"
              value={`${net >= 0 ? "+" : ""}${net.toFixed(1)}`}
              sub={net >= 0 ? "in your favour" : "against you"}
              tone={net > 0 ? "good" : net < 0 ? "bad" : undefined}
            />
          </div>

          <p className="caption">
            All-play category record <strong>{`${bw}-${bl}-${bt}`}</strong> →{" "}
            <strong
              style={{
                color:
                  net > 0 ? "var(--good)" : net < 0 ? "var(--bad)" : "var(--ink-2)",
              }}
            >
              {`${aw}-${al}-${at}`}
            </strong>{" "}
            (vs the rest of the league every week).
          </p>

          <div className="table-scroll trade-shift">
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
          <p className="caption">
            Per-game team totals (sum of projected per-game production). Green = the trade
            helps that category; red = it hurts.
          </p>
        </>
      )}
    </>
  );
}

const ratio = (a: Agg, made: string, att: string) => (a[att] ? a[made] / a[att] : 0);

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
  const flat = Math.abs(d) <= 1e-9;
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

function TrendLine({ p, good }: { p: PoolPlayer; good?: boolean }) {
  return (
    <div className="trade-line">
      <strong>{p.name}</strong>{" "}
      <span className="mono" style={{ color: good ? "var(--good)" : "var(--bad)" }}>
        {p.trend >= 0 ? "+" : ""}
        {p.trend.toFixed(1)}
      </span>{" "}
      <span style={{ color: "var(--ink-2)" }}>trend, value {p.value.toFixed(1)}</span>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div
        className="metric-value mono"
        style={tone ? { color: tone === "good" ? "var(--good)" : "var(--bad)" } : undefined}
      >
        {value}
      </div>
      {sub && <div className="metric-delta mono">{sub}</div>}
    </div>
  );
}
