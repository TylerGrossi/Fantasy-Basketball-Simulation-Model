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
  // "defenses" is dropped: the column is headed Tier and the panel is headed Opponent
  // Defense, so the word appeared three times on one small table — and it was what made
  // this the widest column.
  { key: "top", label: "Top 10", lo: 1, hi: 10 },
  { key: "mid", label: "Middle 10", lo: 11, hi: 20 },
  { key: "bot", label: "Bottom 10", lo: 21, hi: 30 },
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
                  <th>Tier</th>
                  <th className="num">GP</th>
                  <th className="num">PTS</th>
                  <th className="num">REB</th>
                  <th className="num">AST</th>
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
          {/* The "against the ten stingiest… a gap of N" sentence used to sit here. The
              three tiers are the comparison and the table already prints them; the
              sentence restated two of its own rows in prose. Only the uncovered-games
              caveat remains, because nothing else on the panel says it. */}
          {unmatched > 0 && (
            <p className="pd-shape-note">
              {unmatched} game{unmatched === 1 ? "" : "s"} against a team the ratings did
              not cover.
            </p>
          )}
        </>
      )}
    </section>
  );
}

