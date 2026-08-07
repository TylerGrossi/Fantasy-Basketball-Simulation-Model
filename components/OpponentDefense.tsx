"use client";

import { useMemo } from "react";
import type { PoolPlayer } from "@/lib/league";
import { averageLine, usePlayerGames, type PlayerGame } from "@/lib/playerGames";
import { makeValuer } from "@/lib/percentiles";
import { useTeamDefense } from "@/lib/teamDefense";

/**
 * Whether he did it against anybody — his line split by the strength of the defence.
 *
 * This is the split that decides whether a season average is real. Feasting on the league's
 * worst defences and disappearing against the best is a recognisable and very common
 * profile, and it produces exactly the same season line as a player who was steady against
 * everyone. Only one of those two is someone you start in a playoff week against a good
 * team.
 *
 * Teams are cut into THIRDS by points allowed rather than ranked one to thirty: the
 * underlying number is not possession-adjusted (see `lib/teamDefense`), so it is honest at
 * the resolution of "tough / middling / soft" and not much finer.
 *
 * The value of each bucket is scored the same way every other split on this page is —
 * average the games, then run the line through the pool valuer.
 */

const TIERS = [
  { key: "top", label: "Top 10 defenses", lo: 1, hi: 10 },
  { key: "mid", label: "Middle 10", lo: 11, hi: 20 },
  { key: "bot", label: "Bottom 10 defenses", lo: 21, hi: 30 },
] as const;

export default function OpponentDefense({
  playerId,
  pool,
}: {
  playerId: number | null;
  pool: PoolPlayer[];
}) {
  const { games, loading } = usePlayerGames(playerId, pool);
  const defense = useTeamDefense();
  const value = useMemo(() => makeValuer(pool), [pool]);

  const rows = useMemo(() => {
    if (!defense) return [];
    return TIERS.map((t) => {
      const gs = games.filter((g) => {
        const d = defense.get(g.opp);
        return d ? d.rank >= t.lo && d.rank <= t.hi : false;
      });
      return { ...t, games: gs };
    }).filter((t) => t.games.length > 0);
  }, [games, defense]);

  if (!playerId) return null;

  const unmatched = defense
    ? games.filter((g) => !defense.get(g.opp)).length
    : 0;

  return (
    <section className="pd-sheet">
      <div className="pd-sheet-h">
        <h2>By Opponent Defense</h2>
        <span className="pd-sheet-n">teams ranked by points allowed</span>
      </div>

      {(loading || !defense) && <p className="pd-sheet-note">Loading…</p>}
      {!loading && defense && rows.length === 0 && (
        <p className="pd-sheet-note">No regular-season games on record.</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="sheet sheet-tight">
              <thead>
                <tr>
                  <th>Opponent tier</th>
                  <th className="num">GP</th>
                  <th className="num">PTS</th>
                  <th className="num">REB</th>
                  <th className="num">AST</th>
                  <th className="num">STL</th>
                  <th className="num">BLK</th>
                  <th className="num">TO</th>
                  <th className="num">Val</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const line = averageLine(r.games);
                  const { off, def } = value(line);
                  const v = off + def;
                  const c = (k: string) => Number(line[k] ?? 0).toFixed(1);
                  return (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      <td className="num">{r.games.length}</td>
                      <td className="num">{c("PTS")}</td>
                      <td className="num">{c("REB")}</td>
                      <td className="num">{c("AST")}</td>
                      <td className="num">{c("STL")}</td>
                      <td className="num">{c("BLK")}</td>
                      <td className="num">{c("TO")}</td>
                      <td className="num pd-split-v">
                        {v >= 0 ? "+" : ""}
                        {v.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="pd-shape-note">
            <Gap rows={rows} value={value} />
            {unmatched > 0 && ` ${unmatched} game${unmatched === 1 ? "" : "s"} against a team the ratings did not cover.`}
          </p>
        </>
      )}
    </section>
  );
}

/** The one sentence the table is read for: how much the level of opposition moved him. */
function Gap({
  rows,
  value,
}: {
  rows: Array<{ key: string; games: PlayerGame[] }>;
  value: ReturnType<typeof makeValuer>;
}) {
  const val = (key: string) => {
    const r = rows.find((x) => x.key === key);
    if (!r) return null;
    const { off, def } = value(averageLine(r.games));
    return off + def;
  };
  const top = val("top");
  const bot = val("bot");
  if (top == null || bot == null) return null;
  const gap = bot - top;
  return (
    <>
      Against the ten stingiest defences he was{" "}
      <strong>
        {top >= 0 ? "+" : ""}
        {top.toFixed(1)}
      </strong>
      , against the ten softest{" "}
      <strong>
        {bot >= 0 ? "+" : ""}
        {bot.toFixed(1)}
      </strong>{" "}
      — a gap of {Math.abs(gap).toFixed(1)}
      {Math.abs(gap) < 1.5 ? ", which is nothing: he showed up either way." : "."}
    </>
  );
}
