"use client";

import { useMemo, useState } from "react";
import type { PoolPlayer } from "@/lib/league";
import {
  isAllStar,
  isRegularSeason,
  useGameLog,
  type EspnGameLog,
} from "@/lib/gamelog";
import { makeValuer, type StatLine } from "@/lib/percentiles";

/**
 * Rolling 9-cat value across the season, from the player's own box scores.
 *
 * The three rows of the window table above say where a player is NOW, at three zoom
 * levels. None of them say WHEN he got there — a +2.0 season value reads the same whether
 * he was steady all year or spent three months hurt and the last month as a star. This is
 * the shape between those points.
 *
 * SAME ENGINE AS THE CARD. Each point is a rolling average scored with `makeValuer`
 * against the season pool, which is the function behind Total Value directly above it, so
 * the right-hand end of this line lands on the player's recent form as the card reports
 * it. Rolling its own maths here would let the picture disagree with the number.
 *
 * The window and both axes are FIXED — none of them follow the basis chips. The chips pick
 * which single window the bars and the table report; this chart is the season-long view
 * behind all three, and it stays on one smoothing and one scale so any two players, or any
 * two readings of the same player, are directly comparable.
 *
 * Zero is the pool average by construction — a 9-cat value is a sum of z-scores centred on
 * the player pool — so the baseline is a real reference, not a drawn-in convention.
 *
 * Reads the shared game log from `lib/gamelog` — the same single request the game-log
 * table and the availability section below the card use.
 */

/**
 * The moving-average window, in games. FIXED — the basis chips do not change it.
 *
 * It briefly followed the chips, and that was wrong: this chart is the season-long view,
 * and the chips pick which single window the bars and the table are reporting. Letting
 * them also reshape the line meant the one element showing the whole season kept being
 * redrawn at a different smoothing, so two readings of the same player were never
 * comparable. The bars answer "how good right now"; this answers "what did the season look
 * like", and that question does not have a 15-day version.
 *
 * The count is deliberately absent from the chart's title: it is a smoothing choice, not a
 * fact about the player, and the hover tooltip already names the game each point lands on.
 */
const ROLL = 10;

/**
 * Games needed before the first point is plotted.
 *
 * The window EXPANDS up to `ROLL` rather than waiting for it to fill, so the line starts
 * near the player's first game instead of well into the season. But not at game one: a
 * single-game 9-cat value swings far enough to peg the axis, and a chart that opens pinned
 * to the floor because of one cold night is worse than one that starts a few games late.
 */
const MIN_SAMPLE = 5;

/**
 * FIXED AXES, identical for every player and every basis.
 *
 * The whole point of this chart is comparison — between two players, and between a
 * player's start and end of season. An axis that rescaled to fit each series would make
 * every player's peak touch the top of the box, so a replacement-level streamer and an MVP
 * would draw the same picture. Constant bounds mean height is meaningful on its own and
 * the eye can carry a shape from one card to the next.
 *
 * The bounds come from the pool: season values run -9.4 to +13.2, and the short windows,
 * which swing hardest, sit inside -9.9 to +11.2 at the 99th percentile. -12 to +18 clears
 * all of that. A genuine outlier beyond it is clamped to the frame rather than allowed to
 * rescale everything — see `clamp` below.
 */
const Y_MIN = -12;
const Y_MAX = 18;

/*
 * The x-axis is the player's OWN season, anchored to his first game and his last: the line
 * touches both edges of the plot whether he played 82 games or 41. It carries no ticks —
 * the horizontal is "start of season to now", which needs no numbering, and a game-number
 * axis invited reading across two cards as though the dates lined up. They never do;
 * players miss different nights. The y-axis is where comparability lives, and that one is
 * fixed.
 */

/* Chart box, in SVG user units. Rendered responsively via viewBox. */
const W = 320;
const H = 108;
const PAD_L = 26;
const PAD_R = 30;
const PAD_T = 8;
const PAD_B = 8;

/** One game: its box line, and when it was played (for the hover tooltip). */
interface Game {
  date: number;
  line: StatLine;
}

/** `"10-18"` -> `[10, 18]`. ESPN ships made-attempted as one string. */
function pair(s: string | undefined): [number, number] {
  const m = /^(\d+)-(\d+)$/.exec((s ?? "").trim());
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/**
 * REGULAR SEASON ONLY — no preseason, no play-in, no playoffs.
 *
 * This is a fantasy value, and the fantasy season is the NBA regular season: nothing a
 * player does in the postseason was ever scored in a matchup. Including it put a long tail
 * on every playoff run — 15 extra games for a deep run, 6 for a short one — that could not
 * be compared against anything on the card and pulled the end of the line away from the
 * Total Value printed above it.
 *
 * Oldest first — `GameLog` sorts newest first, which is right for a table and backwards
 * for a time series. Both read the same shared payload and parse it their own way.
 */
function parseGames(data: EspnGameLog): Game[] {
  const index: Record<string, number> = {};
  (data.labels ?? []).forEach((l, i) => (index[l] = i));
  const meta = data.events ?? {};
  const seen = new Set<string>();
  const out: Game[] = [];

  for (const st of data.seasonTypes ?? []) {
    if (!isRegularSeason(st.displayName ?? "")) continue;
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        if (seen.has(ev.eventId)) continue;
        seen.add(ev.eventId);

        /*
         * ESPN files the ALL-STAR GAME under the regular season, with "WORLD" as the
         * player's team. Left in it counts as a real game and drags a 19-point exhibition
         * into the average — Wembanyama had two such rows.
         */
        if (isAllStar(data, ev.eventId)) continue;

        const s = ev.stats ?? [];
        const at = (label: string) =>
          index[label] != null ? s[index[label]] : undefined;
        // A did-not-play row carries no minutes; counting it as a 0-0-0 game would drag
        // the average down for a night the player was never on the floor.
        const min = Number(at("MIN") ?? 0);
        if (!Number.isFinite(min) || min <= 0) continue;

        const [fgm, fga] = pair(at("FG"));
        const [tpm] = pair(at("3PT"));
        const [ftm, fta] = pair(at("FT"));
        out.push({
          date: +new Date(meta[ev.eventId]?.gameDate ?? 0),
          line: {
            PTS: Number(at("PTS") ?? 0),
            REB: Number(at("REB") ?? 0),
            AST: Number(at("AST") ?? 0),
            STL: Number(at("STL") ?? 0),
            BLK: Number(at("BLK") ?? 0),
            TO: Number(at("TO") ?? 0),
            "3PM": tpm,
            FGM: fgm,
            FGA: fga,
            FTM: ftm,
            FTA: fta,
          },
        });
      }
    }
  }
  out.sort((a, b) => a.date - b.date);
  return out;
}

const KEYS = ["PTS", "REB", "AST", "STL", "BLK", "TO", "3PM", "FGM", "FGA", "FTM", "FTA"];

/** One plotted point: the rolling value, and which game it was measured after. */
interface Point {
  game: number;
  v: number;
  date: number;
}

export default function RollingValue({
  playerId,
  pool,
}: {
  playerId: number | null;
  pool: PoolPlayer[];
}) {
  const { log, state } = useGameLog(playerId);
  const games = useMemo(() => (log ? parseGames(log) : null), [log]);
  const valuer = useMemo(() => makeValuer(pool), [pool]);

  /**
   * One point per game from `MIN_SAMPLE` on, each a trailing `ROLL`-game moving average.
   *
   * The game number rides along for the accessible label — the plot itself positions by
   * index, since the axis is "start of season to now" rather than a numbered scale.
   */
  const series = useMemo(() => {
    if (!games || games.length < MIN_SAMPLE) return [];
    const out: Point[] = [];
    for (let end = MIN_SAMPLE; end <= games.length; end++) {
      // Expanding until the window fills, trailing thereafter — so the line starts near
      // game one rather than at game ten.
      const win = games.slice(Math.max(0, end - ROLL), end);
      const avg: StatLine = {};
      for (const k of KEYS) {
        avg[k] = win.reduce((a, g) => a + Number(g.line[k] ?? 0), 0) / win.length;
      }
      const { off, def } = valuer(avg);
      // Dated by the LAST game in the window: this is what the player was worth as of
      // that night, which is how a trailing average is read.
      out.push({ game: end, v: off + def, date: games[end - 1].date });
    }
    return out;
  }, [games, valuer]);

  if (!playerId) return null;

  return (
    <div className="rv">
      <div className="rv-h">Rolling value</div>
      {state === "loading" && <p className="rv-note">Loading…</p>}
      {state === "error" && <p className="rv-note">Game log unavailable.</p>}
      {state === "done" && series.length < 2 && (
        <p className="rv-note">Not enough games played to plot a trend.</p>
      )}
      {series.length >= 2 && <Plot series={series} />}
    </div>
  );
}

/** Hold a value inside the fixed frame. See `Y_MIN` / `Y_MAX`. */
const clamp = (v: number) => Math.max(Y_MIN, Math.min(Y_MAX, v));

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function Plot({ series }: { series: Point[] }) {
  // Which point the pointer is over. Click also sets it, so the tooltip is reachable on
  // touch, where there is no hover at all — same approach as RankTrendChart.
  const [hover, setHover] = useState<number | null>(null);

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  /*
   * Positioned by GAME NUMBER, not by index in the series.
   *
   * The axis runs from game 1 to the player's last game, so the plot is his season end to
   * end. Indexing instead would silently shift everything left by `MIN_SAMPLE` games and
   * make the first plotted point sit at the origin as though it were game one.
   */
  const lastGame = series[series.length - 1].game;
  const x = (game: number) =>
    PAD_L + (lastGame === 1 ? plotW / 2 : (plotW * (game - 1)) / (lastGame - 1));
  const y = (v: number) => PAD_T + plotH * (1 - (clamp(v) - Y_MIN) / (Y_MAX - Y_MIN));

  const points = series
    .map((p) => `${x(p.game).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");
  const last = series[series.length - 1];

  // Constant, like the axis they sit on.
  const yTicks = [15, 10, 5, 0, -5, -10];

  const shown = hover != null ? series[hover] : null;

  return (
    <div className="rv-wrap">
      <svg
        className="rv-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${ROLL}-game moving average of 9-cat value across the season, currently ${last.v.toFixed(1)} after ${last.game} games`}
      >
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            y1={y(t)}
            x2={W - PAD_R}
            y2={y(t)}
            stroke={t === 0 ? "var(--line-strong)" : "var(--line-2)"}
            strokeWidth={1}
          />
          {/* Every other label, so six gridlines don't put six numbers down the side. */}
          {t % 10 === 0 && (
            <text className="rv-tick" x={PAD_L - 5} y={y(t) + 3} textAnchor="end">
              {t > 0 ? `+${t}` : t}
            </text>
          )}
        </g>
      ))}

      {/* Zero is the pool average, so it gets a name rather than just a heavier rule. */}
      <text className="rv-avg" x={W - PAD_R + 4} y={y(0) + 3}>
        AVG
      </text>

      <polyline
        points={points}
        fill="none"
        stroke="var(--cobalt)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* The end of the line used to carry a permanent dot marking the latest value. It
          came out: the line visibly stops there anyway, and the only other dot on this
          chart is the hover marker, so a second one that never moved read as a data point
          of its own rather than as punctuation. */}

      {/* Crosshair, drawn under the hit bands so it never steals the pointer. */}
      {hover != null && (
        <>
          <line
            x1={x(series[hover].game)}
            y1={PAD_T}
            x2={x(series[hover].game)}
            y2={H - PAD_B}
            stroke="var(--ink-3)"
            strokeWidth={1}
          />
          <circle
            cx={x(series[hover].game)}
            cy={y(series[hover].v)}
            r={3.5}
            fill="var(--cobalt)"
            stroke="var(--card)"
            strokeWidth={2}
          />
        </>
      )}

      {/*
        One hit band per point, tiling the plot midpoint-to-midpoint so there are no dead
        gaps and the NEAREST point always wins — with sixty games the marks themselves are
        far too small to aim at. Last in the DOM so they sit above every other element.

        `fill="transparent"`, NOT `fill="none"` — "none" is not painted at all and so
        receives no pointer events, which would make these silently inert.
      */}
      <g onMouseLeave={() => setHover(null)}>
        {series.map((p, i) => {
          const cx = x(p.game);
          const left = i === 0 ? PAD_L : (x(series[i - 1].game) + cx) / 2;
          const right =
            i === series.length - 1 ? W - PAD_R : (cx + x(series[i + 1].game)) / 2;
          return (
            <rect
              key={i}
              x={left}
              y={PAD_T}
              width={Math.max(right - left, 0.5)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover((h) => (h === i ? null : i))}
            />
          );
        })}
      </g>
      </svg>

      {shown && (
        <div
          className="rv-tip"
          style={{
            // Percent of the chart's width, so it tracks the crosshair at any rendered
            // size — the SVG scales to 100% but this tooltip is HTML and does not.
            left: `${(x(shown.game) / W) * 100}%`,
            // Flip across the midpoint so the panel never hangs off the narrow rail.
            transform: `translateX(${shown.game / lastGame > 0.5 ? "-100%" : "0"})`,
          }}
          role="tooltip"
        >
          <span className="rv-tip-v">
            {shown.v >= 0 ? "+" : ""}
            {shown.v.toFixed(1)}
          </span>
          <span className="rv-tip-d">{DATE_FMT.format(new Date(shown.date))}</span>
        </div>
      )}
    </div>
  );
}
