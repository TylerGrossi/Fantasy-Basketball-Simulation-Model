"use client";

import { useMemo } from "react";
import type { PoolPlayer } from "@/lib/league";
import { averageLine, usePlayerGames, type PlayerGame } from "@/lib/playerGames";
import { makeValuer } from "@/lib/percentiles";

/**
 * Splits — WHEN and WHERE a player was good, from his own game log.
 *
 * The card above answers "how good, overall". A season average hides everything that
 * makes a fantasy decision: a player who was replacement-level until January and a star
 * after it has the same season line as one who was steady and unremarkable throughout.
 *
 * Every split is valued the same way the rest of the card is — average the games in the
 * bucket into one line, then score that line with `makeValuer` against the season pool. So
 * a monthly value of +4.1 means exactly what +4.1 means anywhere else on the page.
 *
 * Buckets with too few games are still shown, with the count beside them, rather than
 * hidden: "he only played twice in March" is itself the answer sometimes.
 */

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });

interface Split {
  key: string;
  label: string;
  games: PlayerGame[];
}

/**
 * Rest buckets. Anything past two nights is one group — it stops mattering after that.
 *
 * Labels are DELIBERATELY SHORT. This column sets the table's width, and "Back-to-back"
 * and "2+ nights off" made it the widest thing on the card, pushing the five stat columns
 * into a sideways scroll. "B2B" is the standard shorthand; "1 day" and "2+ days" name the
 * rest rather than the nights, which is shorter and the way schedules are actually
 * discussed.
 */
function restLabel(rest: number | null): string | null {
  if (rest == null) return null;
  if (rest === 0) return "B2B";
  if (rest === 1) return "1 day";
  return "2+ days";
}

export default function PlayerSplits({
  playerId,
  pool,
}: {
  playerId: number | null;
  pool: PoolPlayer[];
}) {
  const { games, loading } = usePlayerGames(playerId, pool);
  const value = useMemo(() => makeValuer(pool), [pool]);

  const months: Split[] = useMemo(() => {
    const by = new Map<string, PlayerGame[]>();
    for (const g of games) {
      const list = by.get(g.month);
      if (list) list.push(g);
      else by.set(g.month, [g]);
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, gs]) => ({
        key,
        label: MONTH_FMT.format(new Date(gs[0].date)),
        games: gs,
      }));
  }, [games]);

  const situations: Split[] = useMemo(() => {
    const pick = (label: string, fn: (g: PlayerGame) => boolean) => ({
      key: label,
      label,
      games: games.filter(fn),
    });
    return [
      pick("Home", (g) => g.home),
      pick("Away", (g) => !g.home),
      pick("B2B", (g) => restLabel(g.rest) === "B2B"),
      pick("1 day", (g) => restLabel(g.rest) === "1 day"),
      pick("2+ days", (g) => restLabel(g.rest) === "2+ days"),
    ].filter((s) => s.games.length > 0);
  }, [games]);

  if (!playerId) return null;

  return (
    <section className="pd-sheet">
      <div className="pd-sheet-h">
        <h2>Splits</h2>
      </div>

      {loading && <p className="pd-sheet-note">Loading…</p>}
      {!loading && games.length === 0 && (
        <p className="pd-sheet-note">No regular-season games on record.</p>
      )}

      {games.length > 0 && (
        <div className="pd-split-cols">
          <SplitTable title="By month" rows={months} value={value} />
          <SplitTable title="By situation" rows={situations} value={value} />
        </div>
      )}
    </section>
  );
}

function SplitTable({
  title,
  rows,
  value,
}: {
  title: string;
  rows: Split[];
  value: ReturnType<typeof makeValuer>;
}) {
  if (!rows.length) return null;
  return (
    <div className="pd-split-block">
      <h3 className="pd-split-h">{title}</h3>
      <div className="table-scroll">
        <table className="sheet sheet-tight">
          <thead>
            <tr>
              <th>{title === "By month" ? "Month" : "Split"}</th>
              <th className="num">GP</th>
              <th className="num">MIN</th>
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
              const mins = r.games.reduce((a, g) => a + g.min, 0) / r.games.length;
              const cell = (k: string) => Number(line[k] ?? 0).toFixed(1);
              return (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td className="num">{r.games.length}</td>
                  <td className="num">{mins.toFixed(1)}</td>
                  <td className="num">{cell("PTS")}</td>
                  <td className="num">{cell("REB")}</td>
                  <td className="num">{cell("AST")}</td>
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
    </div>
  );
}
