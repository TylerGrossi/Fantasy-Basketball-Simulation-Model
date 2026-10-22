"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { winPctText, type LeagueData, type Matchup, type PlayerRow } from "@/lib/league";
import { periodLabel as quarter, type GameDayData, type NbaGame, type Play } from "@/lib/gameday";
import { nightImpact } from "@/lib/gamedayImpact";
import { useLiveWin } from "@/lib/useLiveSides";
import { useLiveTotals, type TodayLine } from "@/lib/useLiveTotals";
import PlayerLink from "./PlayerLink";

/**
 * GAME DAY (2026-10-21) — ESPN's FantasyCast / FantasyPros' Game Day, for a head-to-head
 * category league.
 *
 * One screen for a night of games, no page scroll on a laptop: Current Matchup's
 * scoreboard on top, a strip of tonight's games (pick one and everything below narrows to
 * it), then EVERY player's line tonight beside the play-by-play of every game. Your
 * players and your opponent's are highlighted wherever they appear, and one filter
 * (All / matchup / you / them / free agents) narrows both panes at once. FantasyCast shows one
 * roster at a time and no plays; this shows the whole night with your matchup lit up in
 * it, and the title row carries what the night has done to your odds.
 *
 * Two feeds, deliberately:
 *   - /api/live (fantasy; 30s while games are on, 60s otherwise): what COUNTS — live
 *     totals and each roster's single-day lines with lineup slot. Every number about
 *     your matchup comes from here.
 *   - /api/gameday (NBA; 10s while games are on, 30s otherwise): the games themselves —
 *     scores, clocks, who is on the floor, every box line and the play-by-play.
 * The NBA side is fresher but knows nothing about lineup slots, so a benched player's
 * plays are shown (and marked) but never added to anything.
 */

const ET = "America/New_York";
/*
 * How often each feed is re-read (owner, 2026-10-21: faster while games are on). With
 * nothing in progress — before tip-off, after the last final — there is nothing to
 * refresh, so the slower rates hold.
 */
const GAMEDAY_MS = 30_000;
const GAMEDAY_LIVE_MS = 10_000;
const TOTALS_MS = 60_000;
const TOTALS_LIVE_MS = 30_000;
const FEED_PAGE = 40;

type Side = "you" | "opp";
/** Who a player belongs to: your matchup's two sides, a free agent, or another team. */
type Owner = Side | "fa" | "other";
/** "matchup" = both sides of your matchup, yours and theirs together. */
type Filter = "all" | "matchup" | Side | "fa";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  oppId: number;
  /** Player name -> ESPN id, for both rosters. */
  ids: Record<string, number>;
  /** ESPN id -> owning fantasy team id, for every rostered player in the league. */
  owners: Record<string, number>;
  /** Fantasy team id -> its ESPN abbreviation ("TyGr"), for the owner column. */
  teamAbbrevs: Record<string, string>;
  live: boolean;
  /** "Week 3 · You vs Them", beside the title. */
  subtitle: string;
  /** Current Matchup's scoreboard, rendered by the page — the top of this one too. */
  header: ReactNode;
}

/* ---------------------------------------------------------------- NBA poller */

function useGameDay(ids: number[], games: string[], enabled: boolean) {
  const [data, setData] = useState<GameDayData | null>(null);
  const [error, setError] = useState(false);
  const key = ids.join(",");
  // Sorted so picking the same games in another order is the same request.
  const picked = [...games].sort().join(",");
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // `games`: every play of the picked games, not just the slate's newest.
    const url = `/api/gameday?ids=${key}${picked ? `&games=${picked}` : ""}`;
    let t: ReturnType<typeof setTimeout> | undefined;
    // Rescheduled after each response rather than on a fixed interval, so the rate
    // follows the slate: every 10s while any game is in progress, 30s otherwise.
    const load = async () => {
      let inPlay = false;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as GameDayData;
        inPlay = d.games.some((g) => g.state === "in");
        if (alive) {
          setData(d);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
      if (alive) t = setTimeout(load, inPlay ? GAMEDAY_LIVE_MS : GAMEDAY_MS);
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key, picked, enabled]);
  return { data, error };
}

/* ------------------------------------------------------------------- helpers */

/** A change in win probability, in points to one decimal like the odds themselves. */
const pp = (d: number) => {
  const r = Math.round(d * 1000) / 10;
  return r === 0 ? "±0.0" : `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
};
const tipTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
/** When a play happened, to the second ("9:25:13 PM"), Eastern. */
const playTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

function gameStatus(g: NbaGame | undefined): string {
  if (!g) return "No game";
  if (g.state === "pre") return tipTime(g.start);
  if (g.state === "post") return g.detail || "Final";
  return g.detail;
}

/** Stat order for the box. */
const COLS = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO"] as const;

/** One of your matchup's players tonight, from the fantasy feed with the NBA box behind it. */
interface PlayerNight {
  side: Side;
  row: PlayerRow;
  id: number | undefined;
  game: NbaGame | undefined;
  /** In a counting lineup slot. Unknown (true) until the fantasy feed lands. */
  counted: boolean;
  /** Tonight's line by stat name, or null before his game. */
  line: Record<string, number> | null;
  min: number;
  onCourt: boolean;
}

/** A row of the box: any player tonight, yours, theirs or nobody's. */
interface BoxRow {
  key: string;
  name: string;
  team: string;
  owner: Owner;
  /** "TyGr", "FA", or the owning team's abbreviation. */
  ownerTag: string;
  game: NbaGame | undefined;
  counted: boolean;
  line: Record<string, number> | null;
  min: number;
  onCourt: boolean;
  /** Game Score (GS): the night valued on a single-game scale. Null before his game. */
  value: number | null;
}

/** Live first, then still to play (by tip), then final, then no game tonight. */
function gameOrder(g: NbaGame | undefined): number {
  if (!g) return 4e15;
  if (g.state === "in") return 0;
  if (g.state === "pre") return 1e15 + (Date.parse(g.start) || 0) / 1e3;
  return 3e15;
}

/* ---------------------------------------------------------------------- view */

export default function GameDayView(props: Props) {
  const { league, matchup, isHome, teamId, oppId, ids, owners, teamAbbrevs, live, subtitle, header } =
    props;
  const youRaw = isHome ? matchup.home : matchup.away;
  const oppRaw = isHome ? matchup.away : matchup.home;
  const youAbbrev = teamAbbrevs[String(teamId)] ?? "You";
  const oppAbbrev = teamAbbrevs[String(oppId)] ?? "Opp";

  const [filter, setFilter] = useState<Filter>("all");
  /*
   * LIVE (owner, 2026-10-21): only games in progress. A toggle beside the owner chips, not
   * one of them — "my players in live games" is the question, so it combines with the
   * owner filter (and with picked games) rather than replacing it.
   */
  const [liveOnly, setLiveOnly] = useState(false);
  /*
   * PHONE ONLY: which of the three panels is showing. A phone has room for one, so the
   * play feed, the box and the matchup scoreboard sit behind a segmented control (the
   * same `.sbx-tabs` Current Matchup uses) instead of stacking into one long scroll. The
   * feed leads — it is what this page is for. Desktop ignores it and shows all three.
   */
  const [phoneTab, setPhoneTab] = useState<"plays" | "box" | "matchup">("plays");
  /*
   * The picked games — empty = all of them. A click picks one game (or clears it, if it
   * was the only one picked); Ctrl/Cmd-click adds or removes a game, so any handful of
   * games can be watched together.
   */
  const [focus, setFocus] = useState<string[]>([]);
  const [feedShown, setFeedShown] = useState(FEED_PAGE);

  const trackedIds = useMemo(
    () =>
      [...youRaw.players, ...oppRaw.players]
        .map((p) => ids[p.name])
        .filter((x): x is number => x != null)
        .sort((a, b) => a - b),
    [youRaw, oppRaw, ids]
  );
  const { data: gd, error: gdError } = useGameDay(trackedIds, focus, live);
  const inFocus = (gameId: string | undefined) =>
    focus.length === 0 || (gameId != null && focus.includes(gameId));
  const games = useMemo(() => gd?.games ?? [], [gd]);
  // Fantasy totals every 30s while a game is in progress (and via the live route's
  // shorter `fast` cache), every 60s otherwise.
  const inPlay = games.some((g) => g.state === "in");
  const totals = useLiveTotals(
    league.period,
    teamId,
    youRaw.current,
    oppRaw.current,
    live,
    inPlay ? TOTALS_LIVE_MS : TOTALS_MS
  );

  const { outcome: winNow } = useLiveWin(league, matchup, isHome, teamId, live);
  const impact = useMemo(
    () =>
      nightImpact(
        league,
        youRaw,
        oppRaw,
        totals.you,
        totals.opp,
        totals.youToday,
        totals.oppToday,
        games,
        gd?.day ?? null
      ),
    [league, youRaw, oppRaw, totals.you, totals.opp, totals.youToday, totals.oppToday, games, gd]
  );

  /** Whose a player is, by ESPN id. */
  const ownerOf = useMemo(() => {
    return (id: string): Owner => {
      const o = owners[id];
      return o == null ? "fa" : o === teamId ? "you" : o === oppId ? "opp" : "other";
    };
  }, [owners, teamId, oppId]);

  /* ---- your matchup's players, tonight ---- */
  const nights = useMemo(() => {
    const gameOf = new Map<string, NbaGame>();
    for (const g of games) {
      gameOf.set(g.away.abbr, g);
      gameOf.set(g.home.abbr, g);
    }
    const nba = new Map((gd?.lines ?? []).map((l) => [l.id, l]));
    const build = (side: Side, rows: PlayerRow[], today: TodayLine[] | null): PlayerNight[] => {
      const byName = new Map((today ?? []).map((t) => [t.name, t]));
      return rows.map((row) => {
        const id = ids[row.name];
        const t = byName.get(row.name);
        const n = id != null ? nba.get(id) : undefined;
        // Fantasy line first (it is what counts); the NBA box covers the gap while the
        // fantasy feed is a poll behind.
        const line = t?.v
          ? Object.fromEntries(league.stats.map((s, i) => [s, t.v![i]]))
          : n
            ? n.line
            : null;
        return {
          side,
          row,
          id,
          game: gameOf.get(row.nbaTeam),
          counted: t ? t.counted : true,
          line,
          min: t?.v ? t.min : (n?.min ?? 0),
          onCourt: n?.onCourt ?? false,
        };
      });
    };
    return {
      you: build("you", youRaw.players, totals.youToday),
      opp: build("opp", oppRaw.players, totals.oppToday),
    };
  }, [games, gd, ids, league.stats, youRaw, oppRaw, totals.youToday, totals.oppToday]);

  /* ---- every player tonight: the NBA box, with your matchup's players merged in ---- */
  const box = useMemo(() => {
    const gameById = new Map(games.map((g) => [g.id, g]));
    const mine = new Map<string, PlayerNight>();
    for (const p of [...nights.you, ...nights.opp]) if (p.id != null) mine.set(String(p.id), p);
    const rows: BoxRow[] = [];
    const seen = new Set<string>();
    for (const l of gd?.lines ?? []) {
      const id = String(l.id);
      seen.add(id);
      const m = mine.get(id);
      const owner = m ? m.side : ownerOf(id);
      rows.push({
        key: id,
        name: m?.row.name ?? l.name,
        team: l.team,
        owner,
        ownerTag: ownerTagOf(owner, owners[id], teamAbbrevs),
        game: gameById.get(l.gameId),
        counted: m ? m.counted : true,
        line: m?.line ?? l.line,
        min: m?.line ? m.min : l.min,
        onCourt: l.onCourt,
        value: l.value,
      });
    }
    // Your matchup's players with no box line yet: their game has not started (or they
    // have no game tonight, which the footnote lists instead).
    for (const p of [...nights.you, ...nights.opp]) {
      if (!p.game || (p.id != null && seen.has(String(p.id)))) continue;
      rows.push({
        key: p.id != null ? String(p.id) : p.row.name,
        name: p.row.name,
        team: p.row.nbaTeam,
        owner: p.side,
        ownerTag: p.side === "you" ? youAbbrev : oppAbbrev,
        game: p.game,
        counted: p.counted,
        line: p.line,
        min: p.min,
        onCourt: p.onCourt,
        value: null,
      });
    }
    // Played tonight, best night first; then yet to play, by tip-off.
    return rows.sort(
      (a, b) =>
        Number(a.value == null) - Number(b.value == null) ||
        (b.value ?? 0) - (a.value ?? 0) ||
        gameOrder(a.game) - gameOrder(b.game)
    );
  }, [games, gd, nights, ownerOf, owners, teamAbbrevs, youAbbrev, oppAbbrev]);

  const nameOfId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [name, id] of Object.entries(ids)) m.set(String(id), name);
    for (const l of gd?.lines ?? []) m.set(String(l.id), l.name);
    return m;
  }, [ids, gd]);
  const benched = useMemo(
    () =>
      new Set(
        [...nights.you, ...nights.opp]
          .filter((p) => !p.counted && p.id != null)
          .map((p) => String(p.id))
      ),
    [nights]
  );

  /* ---- render ---- */
  // The headline is THE live win probability (useLiveWin), so it matches Current Matchup
  // to the decimal; tonight's move is measured from the tip-off odds on the same `.win`.
  const nowShare = winNow.win;
  const startShare = impact.start ? impact.start.win : null;

  const passes = (o: Owner) =>
    filter === "all" || o === filter || (filter === "matchup" && (o === "you" || o === "opp"));
  const liveIds = new Set(games.filter((g) => g.state === "in").map((g) => g.id));
  const isLive = (gameId: string | undefined) =>
    !liveOnly || (gameId != null && liveIds.has(gameId));
  const rows = box.filter((r) => inFocus(r.game?.id) && isLive(r.game?.id) && passes(r.owner));
  // Players off tonight are not in a live game, so they drop out with the Live filter.
  const offTonight = (
    liveOnly ? [] : filter === "matchup"
      ? [...nights.you, ...nights.opp]
      : filter === "you" || filter === "opp"
        ? nights[filter]
        : []
  ).filter((p) => !p.game);
  const feed = (gd?.plays ?? []).filter(
    (p) =>
      inFocus(p.gameId) &&
      isLive(p.gameId) &&
      (filter === "all" || Object.keys(p.credit).some((id) => passes(ownerOf(id))))
  );
  const pick = (id: string | null, multi = false) => {
    setFocus((f) => {
      if (id == null) return [];
      if (multi) return f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      return f.length === 1 && f[0] === id ? [] : [id];
    });
    setFeedShown(FEED_PAGE);
  };

  const updated =
    gd?.fetchedAt &&
    new Date(gd.fetchedAt).toLocaleTimeString("en-US", {
      timeZone: ET,
      hour: "numeric",
      minute: "2-digit",
    });

  /*
   * ONE SCREEN (owner, 2026-10-21): the page used to be a long scroll of stacked cards.
   * Now it is the Current Matchup scoreboard, a strip of every game (tap one and the
   * whole page narrows to it), one filter, and two panes side by side — the box and the
   * play feed — that fill the rest of the window and scroll inside themselves.
   */
  return (
    <div className={`gd gd-tab-${phoneTab}`}>
      {/* ------------------------------------------------------ title + odds */}
      <div className="gd-top">
        <h1>Game Day</h1>
        <span className="gd-top-sub">{subtitle}</span>
        <span className="gd-top-odds">
          <b className="mono">{winPctText(nowShare)}</b> to win the week
          {startShare != null && (
            <span
              className={`gd-delta mono ${nowShare - startShare > 0.005 ? "up" : nowShare - startShare < -0.005 ? "dn" : ""}`}
            >
              {pp(nowShare - startShare)} tonight
            </span>
          )}
        </span>
      </div>

      {/* The same scoreboard as Current Matchup, rendered by the page. */}
      <div className="gd-board">{header}</div>

      {/* ------------------------------------------------------ games strip */}
      <nav className="gd-strip" aria-label="Tonight's games">
        <button
          type="button"
          className={`gd-game gd-game-all${focus.length ? "" : " on"}`}
          onClick={() => pick(null)}
          aria-pressed={focus.length === 0}
          title="Click a game to show it; Ctrl/Cmd-click to add more games"
        >
          <span className="gd-game-status">
            <span
              className={`live-dot ${!live ? "stale" : gdError ? "error" : gd ? "" : "stale"}`}
            />
            {!live ? "Demo" : gdError ? "Retrying" : updated ? `Updated ${updated}` : "Loading"}
          </span>
          <span className="gd-game-all-label">All games</span>
          <span className="gd-game-who">
            {games.length ? `${games.length} tonight` : gd ? "None today" : ""}
          </span>
        </button>
        {[...games]
          .sort((a, b) => stateRank(a) - stateRank(b) || a.start.localeCompare(b.start))
          .map((g) => {
            const inGame = [...nights.you, ...nights.opp].filter((p) => p.game?.id === g.id);
            const mine = inGame.filter((p) => p.side === "you").length;
            const theirs = inGame.filter((p) => p.side === "opp").length;
            const on = focus.includes(g.id);
            return (
              <button
                type="button"
                key={g.id}
                className={`gd-game ${g.state}${on ? " on" : ""}`}
                onClick={(e) => pick(g.id, e.ctrlKey || e.metaKey)}
                aria-pressed={on}
                title={
                  inGame.map((p) => p.row.name + (p.counted ? "" : " (bench)")).join(", ") ||
                  undefined
                }
              >
                <span className="gd-game-status">
                  {g.state === "in" && <span className="live-dot" />}
                  {gameStatus(g)}
                </span>
                {[g.away, g.home].map((t) => (
                  <span className={`gd-game-team${t.winner ? " won" : ""}`} key={t.abbr}>
                    <span>{t.abbr}</span>
                    <span className="mono">{g.state === "pre" ? "" : t.score}</span>
                  </span>
                ))}
                <span className="gd-game-who">
                  {mine > 0 && <span className="gd-who you">{mine} {youAbbrev}</span>}
                  {theirs > 0 && <span className="gd-who opp">{theirs} {oppAbbrev}</span>}
                </span>
              </button>
            );
          })}
      </nav>

      {/* ------------------------------------------- one filter for both panes */}
      <div className="gd-filter">
        <div className="chips" role="group" aria-label="Show players">
          {(
            [
              ["all", "All"],
              ["matchup", "Matchup"],
              ["you", youAbbrev],
              ["opp", oppAbbrev],
              ["fa", "FA"],
            ] as const
          ).map(([k, label]) => (
            <button
              type="button"
              key={k}
              aria-pressed={filter === k}
              className={`chip gd-chip-${k}${filter === k ? " chip-on" : ""}`}
              onClick={() => {
                setFilter(k);
                setFeedShown(FEED_PAGE);
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={liveOnly}
            className={`chip gd-chip-live${liveOnly ? " chip-on" : ""}`}
            onClick={() => {
              setLiveOnly((v) => !v);
              setFeedShown(FEED_PAGE);
            }}
            title="Only games in progress — combines with the other filters"
          >
            <span className="live-dot" aria-hidden="true" /> Live
            {liveIds.size > 0 && <span className="gd-chip-n">{liveIds.size}</span>}
          </button>
        </div>
        <span className="gd-legend">
          <span className="gd-key you">{youAbbrev}</span>
          <span className="gd-key opp">{oppAbbrev}</span>
          <span className="gd-court" /> on the floor
        </span>
      </div>

      {/* --------------------------------------- phone: one panel at a time */}
      <div className="sbx-tabs gd-tabs" role="tablist" aria-label="Show">
        {(
          [
            ["plays", "Play by Play"],
            ["box", "Box Score"],
            ["matchup", "Matchup"],
          ] as const
        ).map(([k, label]) => (
          <button
            type="button"
            role="tab"
            key={k}
            aria-selected={phoneTab === k}
            className={`sbx-tab${phoneTab === k ? " sbx-tab-active" : ""}`}
            onClick={() => setPhoneTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------ box | play by play */}
      <div className="gd-panes">
        <section className="gd-card gd-pane gd-box">
          <div className="gd-pane-head">
            <span className="gd-pane-title">Box Score</span>
          </div>
          <div className="gd-pane-body">
            <BoxTable rows={rows} ready={!!gd} offTonight={offTonight} />
          </div>
        </section>

        <section className="gd-card gd-pane gd-feed">
          <div className="gd-pane-head">
            <span className="gd-pane-title">Play by Play</span>
          </div>
          <div className="gd-pane-body">
            {feed.length === 0 ? (
              <p className="caption">
                {gd ? "No plays yet — they appear here as the games go." : "Loading…"}
              </p>
            ) : (
              <ol className="gd-plays">
                {feed.slice(0, feedShown).map((p) => (
                  <PlayRow
                    key={`${p.gameId}-${p.seq}`}
                    play={p}
                    game={games.find((g) => g.id === p.gameId)}
                    ownerOf={ownerOf}
                    nameOf={nameOfId}
                    benched={benched}
                  />
                ))}
              </ol>
            )}
            {feed.length > feedShown && (
              <button
                type="button"
                className="gd-more"
                onClick={() => setFeedShown((n) => n + FEED_PAGE)}
              >
                Show {Math.min(FEED_PAGE, feed.length - feedShown)} more
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const stateRank = (g: NbaGame) => (g.state === "in" ? 0 : g.state === "pre" ? 1 : 2);

function ownerTagOf(owner: Owner, teamId: number | undefined, abbrevs: Record<string, string>) {
  if (owner === "fa") return "FA";
  return abbrevs[String(teamId)] ?? "—";
}

/** "A. Edwards" — the feed credits a few players per play, not a few full names. */
function shortName(name: string) {
  const parts = name.split(" ");
  return parts.length < 2 ? name : `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/**
 * The box's sortable columns: what each sorts by, and which way it opens. Numbers open
 * biggest first (turnovers too — "most" is what you are looking for), text A-Z. FG and FT
 * sort by makes. Players whose game has not started have no line and always sink to the
 * bottom, whichever way a stat column points.
 */
type BoxSort = "name" | "owner" | "game" | "MIN" | (typeof COLS)[number] | "FG" | "FT" | "value";
const BOX_COLS: Array<{ key: BoxSort; label: string; num?: true; title?: string }> = [
  { key: "name", label: "Player" },
  { key: "owner", label: "Owner" },
  { key: "game", label: "Game" },
  { key: "MIN", label: "MIN", num: true },
  ...COLS.map((c) => ({ key: c, label: c, num: true as const })),
  { key: "FG", label: "FG", num: true },
  { key: "FT", label: "FT", num: true },
  {
    // GS, not "Value" (owner, 2026-10-21): the Value everywhere else is a SEASON number on
    // the season scale; this is one night on a single-game scale, so it gets its own name.
    key: "value",
    label: "GS",
    num: true,
    title:
      "Game Score: tonight's line across all 15 league categories, against an average " +
      "player at the same point in the game, on a single-game scale",
  },
];

function sortValue(r: BoxRow, key: BoxSort): number | string | null {
  const l = r.line;
  switch (key) {
    case "name": return r.name;
    case "owner": return r.ownerTag;
    case "game": return gameOrder(r.game);
    case "MIN": return l ? r.min : null;
    case "FG": return l ? (l.FGM ?? 0) : null;
    case "FT": return l ? (l.FTM ?? 0) : null;
    case "value": return r.value;
    default: return l ? (l[key] ?? 0) : null;
  }
}

function BoxTable({
  rows: unsorted,
  ready,
  offTonight,
}: {
  rows: BoxRow[];
  ready: boolean;
  /** Your matchup's players with no game tonight: names, not a table of empty rows. */
  offTonight: PlayerNight[];
}) {
  // Null = the box's own order (best night first, then by tip-off).
  const [sort, setSort] = useState<{ key: BoxSort; desc: boolean } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return unsorted;
    const dir = sort.desc ? -1 : 1;
    return [...unsorted].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * dir;
    });
  }, [unsorted, sort]);
  const click = (c: (typeof BOX_COLS)[number]) =>
    setSort((s) => (s?.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: !!c.num }));
  const active = sort ?? { key: "value" as BoxSort, desc: true };

  return (
    <>
      {rows.length === 0 ? (
        <p className="caption">
          {ready ? "Nobody to show yet — lines appear as games tip off." : "Loading…"}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="sheet sortable gd-ptable">
            <thead>
              <tr>
                {BOX_COLS.map((c) => {
                  const on = active.key === c.key;
                  return (
                    <th
                      key={c.key}
                      className={c.num ? "num" : undefined}
                      title={c.title}
                      aria-sort={on ? (active.desc ? "descending" : "ascending") : "none"}
                    >
                      <button type="button" className="th-sort" onClick={() => click(c)}>
                        {c.label}
                        <span className={`sort-caret ${on ? "on" : ""}`} aria-hidden="true">
                          {on ? (active.desc ? "▾" : "▴") : "▾"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const l = r.line;
                return (
                  <tr
                    key={r.key}
                    className={`gd-own-${r.owner}${r.game?.state === "in" ? " gd-row-live" : ""}${r.counted ? "" : " row-muted"}`}
                  >
                    <td className="gd-pname">
                      {r.onCourt && r.game?.state === "in" && (
                        <span className="gd-court" title="On the floor" />
                      )}
                      <PlayerLink name={r.name} />
                      <span className="gd-team">{r.team}</span>
                      {!r.counted && <span className="gd-tag">Bench</span>}
                    </td>
                    <td>
                      <span className={`gd-owner ${r.owner}`}>{r.ownerTag}</span>
                    </td>
                    <td className="gd-gstat">
                      {r.game && (
                        <>
                          <span className="gd-opp">
                            {r.game.away.abbr === r.team ? `@${r.game.home.abbr}` : `v ${r.game.away.abbr}`}
                          </span>{" "}
                          {gameStatus(r.game)}
                        </>
                      )}
                    </td>
                    <td className="num">{l ? Math.round(r.min) : ""}</td>
                    {COLS.map((c) => (
                      <td className="num" key={c}>{l ? (l[c] ?? 0) : ""}</td>
                    ))}
                    <td className="num">{l ? `${l.FGM ?? 0}-${l.FGA ?? 0}` : ""}</td>
                    <td className="num">{l ? `${l.FTM ?? 0}-${l.FTA ?? 0}` : ""}</td>
                    <td className="num">
                      {r.value == null ? "" : `${r.value >= 0 ? "+" : ""}${r.value.toFixed(1)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {offTonight.length > 0 && (
        <p className="gd-foot gd-off">
          No game tonight:{" "}
          {offTonight.map((p, i) => (
            <span key={p.row.name}>
              {i > 0 && ", "}
              {p.row.name}
              {!p.counted && " (bench)"}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/** "+3 PTS", "+1 REB", "Miss FG" — what the play did for one player. */
function creditChips(c: Record<string, number>): Array<{ text: string; tone: "" | "neg" }> {
  const out: Array<{ text: string; tone: "" | "neg" }> = [];
  if (c.PTS) out.push({ text: `+${c.PTS} PTS`, tone: "" });
  if (c["3PM"]) out.push({ text: "+1 3PM", tone: "" });
  if (c.FGA && !c.FGM) out.push({ text: c["3PA"] ? "Miss 3PT" : "Miss FG", tone: "neg" });
  if (c.FTA && !c.FTM) out.push({ text: "Miss FT", tone: "neg" });
  for (const k of ["REB", "AST", "STL", "BLK"]) if (c[k]) out.push({ text: `+1 ${k}`, tone: "" });
  if (c.TO) out.push({ text: "+1 TO", tone: "neg" });
  return out;
}

function PlayRow({
  play,
  game,
  ownerOf,
  nameOf,
  benched,
}: {
  play: Play;
  game: NbaGame | undefined;
  ownerOf: (id: string) => Owner;
  nameOf: Map<string, string>;
  benched: Set<string>;
}) {
  const credited = Object.entries(play.credit);
  // The play is marked by your matchup's side in it, yours first.
  const owners = credited.map(([id]) => ownerOf(id));
  const mark = owners.includes("you") ? "you" : owners.includes("opp") ? "opp" : "";
  return (
    <li className={`gd-play ${mark}`}>
      <div className="gd-play-when mono">
        {/* The real time it happened (ESPN's wallclock, Eastern), then the game clock
            (owner, 2026-10-21). */}
        {play.at && !Number.isNaN(Date.parse(play.at)) && <>{playTime(play.at)} · </>}
        {quarter(play.period)} {play.clock}
        {game && <span> · {game.away.abbr} @ {game.home.abbr}</span>}
      </div>
      <div className="gd-play-text">{play.text}</div>
      <div className="gd-play-credit">
        {credited.map(([id, c], i) => (
          <span className={`gd-credit ${owners[i]}`} key={id}>
            <span className="gd-credit-name">
              {shortName(nameOf.get(id) ?? "")}
              {benched.has(id) && <em> (bench)</em>}
            </span>
            {creditChips(c).map((ch) => (
              <span className={`gd-chip ${ch.tone}`} key={ch.text}>
                {ch.text}
              </span>
            ))}
          </span>
        ))}
      </div>
    </li>
  );
}
