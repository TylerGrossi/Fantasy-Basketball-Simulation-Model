"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueData, PoolPlayer } from "@/lib/league";
import GameLog from "./GameLog";
import InjuryLog from "./InjuryLog";
import PlayerSearch from "./PlayerSearch";
import RollingValue from "./RollingValue";
import CategoryShape from "./CategoryShape";
import UsageEfficiency from "./UsageEfficiency";
import OpponentDefense from "./OpponentDefense";
import SimilarPlayers from "./SimilarPlayers";
import PlayerSplits from "./PlayerSplits";
import PlayerConsistency from "./PlayerConsistency";
import { headshotUrl, playerStatus, VALUE_BASES, type ValueBasis } from "@/lib/playerPool";
import {
  MIN_GP,
  STAT_GROUPS,
  formatStat,
  gamesFor,
  percentileRows,
  statValue,
  type PercentileRow,
  type StatKey,
} from "@/lib/percentiles";

/**
 * Global player search → the full profile: bio header, the season / 30D / 15D value
 * tiles with league rank, a two-column season-averages sheet, the last-10 game log, and
 * the injury / missed-games record.
 *
 * The bio (jersey, height/weight, age, experience, draft, birthplace) is NOT in the
 * export — it is one ESPN athlete lookup per player and there are ~290 of them, so like
 * the game log it is fetched client-side for the one player being looked at. The page
 * renders fully without it; the facts row just fills in when it arrives.
 */

interface Bio {
  team?: string;
  jersey?: string;
  position?: string;
  height?: string;
  weight?: string;
  age?: number;
  experience?: string;
  draft?: string;
  birthplace?: string;
}

const BIO_CACHE = new Map<number, Bio>();

type TabKey = "profile" | "splits" | "log";

/** The sections below the card, grouped by the question they answer. */
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "profile", label: "Profile" },
  { key: "splits", label: "Splits" },
  { key: "log", label: "Game Log" },
];

/** The basis chips spell out the window they select, so nothing beside them has to. */
const BASIS_LABEL: Record<ValueBasis, string> = {
  Regular: "Season Average",
  "30D": "30 Day Average",
  "15D": "15 Day Average",
};

export default function PlayerCardView({
  league,
  initialName,
}: {
  league: LeagueData;
  /**
   * Who to open on, from `/player?name=…` — how every player name elsewhere in the app
   * links here. Already validated against the pool by the server page, so an unknown
   * name never reaches this component.
   */
  initialName?: string;
}) {
  const pool = league.seasonData.playerPool ?? [];
  // The export is sorted by value, so the first row is the top player — the same seed
  // the Streamlit page used, and the fallback when no player was asked for.
  const [name, setName] = useState(initialName || pool[0]?.name || "");
  const p = pool.find((x) => x.name === name);
  const bio = usePlayerBio(p?.playerId ?? null);

  /*
   * Keep the URL on the player being shown, so the address bar is a link worth copying.
   *
   * `history.replaceState`, not `router.replace`: the page already reads `?name=` on the
   * server, so routing would refetch the whole RSC payload — the league export included —
   * every time you pick someone. Nothing on screen depends on that round trip; the pool is
   * already in the client. This just relabels the address bar.
   *
   * Replace rather than push, so the Random button does not bury the previous page under a
   * dozen history entries you have to click back through.
   */
  useEffect(() => {
    if (!name) return;
    const url = `${window.location.pathname}?name=${encodeURIComponent(name)}`;
    window.history.replaceState(null, "", url);
  }, [name]);

  /*
   * FOLLOW `?name=` WHEN IT CHANGES.
   *
   * `useState(initialName)` seeds the player on first mount and ignores the prop ever
   * after. That is fine arriving from another page, and wrong once you are already here:
   * tapping a name in Similar Players is a client-side navigation to /player?name=… that
   * re-renders this component with a NEW initialName, and the card carried on showing the
   * player you tapped away from. Every player link on this page was a dead tap.
   *
   * Guarded on inequality so it cannot fight the replaceState above — that rewrites the
   * URL without changing the prop, so this effect does not re-run for it.
   */
  useEffect(() => {
    if (initialName && initialName !== name) setName(initialName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialName]);

  if (!pool.length) {
    return <p className="caption">No player pool data — run the data export.</p>;
  }

  return (
    <>
      <div className="controls pd-search">
        <PlayerSearch pool={pool} value={name} onPick={setName} />
        <button
          type="button"
          className="chip"
          onClick={() => setName(pool[Math.floor(Math.random() * pool.length)].name)}
          title="Show a random player."
        >
          Random
        </button>
      </div>

      {p && (
        <PlayerDetail
          p={p}
          pool={pool}
          bio={bio}
          season={league.season}
          onPick={setName}
        />
      )}
    </>
  );
}


/** One ESPN athlete lookup, cached per session. Absent bio simply renders nothing. */
function usePlayerBio(playerId: number | null): Bio {
  const [bio, setBio] = useState<Bio>(() =>
    playerId ? (BIO_CACHE.get(playerId) ?? {}) : {}
  );

  useEffect(() => {
    if (!playerId) {
      setBio({});
      return;
    }
    const cached = BIO_CACHE.get(playerId);
    if (cached) {
      setBio(cached);
      return;
    }
    let live = true;
    setBio({});
    fetch(
      `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}`
    )
      .then((r) => r.json())
      .then((data) => {
        const a = data?.athlete ?? {};
        const next: Bio = {
          team: a.team?.displayName ?? "",
          jersey: a.displayJersey ?? (a.jersey ? `#${a.jersey}` : ""),
          position: a.position?.displayName ?? "",
          height: a.displayHeight ?? "",
          weight: a.displayWeight ?? "",
          age: a.age,
          experience: a.displayExperience ?? "",
          draft: a.displayDraft ?? "",
          birthplace: a.displayBirthPlace ?? "",
        };
        BIO_CACHE.set(playerId, next);
        if (live) setBio(next);
      })
      .catch(() => {
        // The profile is complete without it — no error state to show.
      });
    return () => {
      live = false;
    };
  }, [playerId]);

  return bio;
}

function PlayerDetail({
  p,
  pool,
  bio,
  season,
  onPick,
}: {
  p: PoolPlayer;
  pool: PoolPlayer[];
  bio: Bio;
  /** The export's season YEAR — ESPN keys its athlete/schedule records by it. */
  season: number;
  /** Switch the whole card to another player — the scatter's dots are clickable. */
  onPick: (name: string) => void;
}) {
  const [code, sev] = playerStatus(p.status);
  const shot = headshotUrl(p.playerId);
  const fantasyTeam = p.owner === "FA" ? "Free Agent" : p.owner;

  // Identity line: full team name (falls back to the roster abbrev), jersey, position.
  const ident = [bio.team || p.nbaTeam, bio.jersey, bio.position || p.position]
    .filter(Boolean)
    .join(" · ");

  /*
   * ALWAYS FIVE ROWS, whether or not the player has the fact.
   *
   * These used to be filtered to the ones with a value, which made the block's height a
   * property of the player: anyone undrafted came up a row short and everything below —
   * the window table especially — slid up, so switching players moved the table under the
   * pointer.
   *
   * The same filter also hid the whole block until `usePlayerBio` resolved, so a card
   * jumped twice: once on mount and again when the fetch landed. Reserving the rows costs
   * a few dashes and makes the card's geometry identical for every player, before and
   * after the fetch.
   */
  const facts: Array<[string, string]> = [
    ["HT/WT", [bio.height, bio.weight].filter(Boolean).join(", ")],
    ["Age", bio.age ? String(bio.age) : ""],
    ["Experience", bio.experience ?? ""],
    // College was here and came out: it is the fact least likely to be looked up on a
    // fantasy card, and it was blank for every international player anyway. Draft covers
    // the same "where did he come from" ground with a date attached.
    ["Draft", bio.draft ?? ""],
    ["Born", bio.birthplace ?? ""],
  ];

  /*
   * Which window the averages sheet shows. Same three choices, same labels, and the same
   * `ValueBasis` type as the Player Value page's basis menu — one vocabulary across the
   * app rather than a second one that means almost the same thing.
   *
   * The value TILES above deliberately keep showing all three at once: there the point is
   * comparing them, here the point is reading one line in detail.
   */
  const [basis, setBasis] = useState<ValueBasis>("Regular");
  const [tab, setTab] = useState<TabKey>("profile");

  /*
   * Only offer a window the player has enough games in to mean something.
   *
   * A "30 Day Average" option that resolves to a column of dashes is worse than no option:
   * it invites the click and then refuses to answer. Season is always there — every player
   * in the pool has a season line, which is how they got into the pool.
   *
   * The test is `MIN_GP`, NOT "played at all". ESPN never returns a zero-game window: the
   * floor across all 289 players is 1, and those one-game rows come back with last-30 and
   * last-15 byte-identical, which is ESPN handing back the player's most recent game
   * rather than an honest empty window. So "has he played in the last 30 days" is a
   * question this data cannot answer, while "does he have enough games there to rank" is
   * the same question the bars and the window table already decide on.
   */
  const available = VALUE_BASES.filter(
    (b) => b === "Regular" || gamesFor(p, b) >= MIN_GP[b]
  );
  /*
   * The selection survives switching players, so it can point at a window the NEW player
   * never played. Resolved here rather than reset in an effect: an effect would render one
   * frame of the wrong window first, and this reads the same either way.
   */
  const active = available.includes(basis) ? basis : "Regular";

  // Every bar on the card, ranked against the league under the chosen basis. Recomputed
  // only when the player or the basis changes — it is a full pass over the pool per stat.
  const rows = useMemo(() => percentileRows(pool, p, active), [pool, p, active]);
  const byKey = new Map(rows.map((r) => [r.spec.key, r]));

  /*
   * Two panels, Baseball Savant's arrangement: WHO the player is on the left, HOW GOOD he
   * is on the right.
   *
   * The card used to be one column, which meant the identity block, the bio, the three
   * value tiles and the basis chips all had to be scrolled past before a single bar came
   * into view — the bars being the thing the page exists for. Splitting puts the fixed,
   * rarely-changing facts in a narrow rail and gives the whole remaining width to the
   * ranking, which is also what lets every bar be longer and therefore easier to compare.
   *
   * The two logs stay BELOW the split at full width: they are wide tables, and squeezing
   * them into either column would reintroduce the horizontal scroll this layout removes.
   */
  return (
    <div className="pd">
      <div className="pd-split">
        <aside className="pd-card">
          <div className="pd-head">
            {shot ? (
              <div className="pv-shot" style={{ backgroundImage: `url('${shot}')` }} />
            ) : (
              <div className="pv-shot pv-shot-blank" />
            )}
          </div>
          <div className="pd-id">
            <div className="pd-name">{p.name}</div>
            <div className="pd-team">{ident}</div>
            <div className="pd-status">
              <span>
                <span className={`pd-dot ${sev || "ok"}`} />
                {sev === "out" ? code || "Out" : sev === "day" ? code : "Active"}
              </span>
              {/* The team name alone — the "Fantasy Team:" label was the longest thing on
                  this line and the reason a long team name wrapped it onto a third row.
                  Nothing else on the card names a fantasy team, so it can't be mistaken
                  for anything else. */}
              <span className="pd-owner">
                <b>{fantasyTeam}</b>
              </span>
            </div>
          </div>

          <div className="pd-bio">
            {facts.map(([label, v]) => (
              <div className="pd-bio-f" key={label}>
                <span className="pd-bl">{label}</span>
                <span className={`pd-bv${v ? "" : " pd-bv-none"}`}>{v || "—"}</span>
              </div>
            ))}
          </div>

          <WindowTable p={p} />
          <RollingValue playerId={p.playerId} pool={pool} />
        </aside>

        <section className="pd-rank">
          <div className="pd-rank-head">
            {/*
              The window picker sits INSIDE the heading, so the title reads as one
              sentence describing exactly what is below it — "2025-26 Season Average
              League Percentile Rankings" — rather than as a title with a separate
              control floating beside it that you have to connect for yourself.

              A native <select> on purpose: it is keyboard- and screen-reader-correct for
              free, and on a phone it opens the platform picker instead of a hand-rolled
              menu that would have to re-solve focus, escape and outside-click.

              "2025-26", not ESPN's seasonId of 2026 — a basketball season spans two years,
              and every other page in the app labels it that way.
            */}
            {/*
              On a phone the heading is "Season Average Percentiles". The full sentence
              wrapped to two lines above a chart that is itself only a few lines tall, and
              the year is already stated at the top of the card — so the mobile spelling
              drops the year and the word "League" and keeps the part that names the
              control: the window picker stays in the heading at every width.
            */}
            <h2 className="pd-rank-h">
              <span className="pd-rank-yr">
                {season - 1}-{String(season % 100).padStart(2, "0")}{" "}
              </span>
              {available.length > 1 ? (
                <select
                  className="pd-rank-sel"
                  value={active}
                  onChange={(e) => setBasis(e.target.value as ValueBasis)}
                  aria-label="Averages window"
                >
                  {available.map((b) => (
                    <option key={b} value={b}>
                      {BASIS_LABEL[b]}
                    </option>
                  ))}
                </select>
              ) : (
                BASIS_LABEL[active]
              )}{" "}
              <span className="pd-rank-full">League Percentile Rankings</span>
              <span className="pd-rank-short">Percentiles</span>
            </h2>
          </div>

          {/* One 0-100 track for every bar, so a single scale strip heads them all.
              aria-hidden: each bar states its own percentile in text. */}
          <div className="pct-scale" aria-hidden="true">
            <span>Poor</span>
            <span>Average</span>
            <span>Great</span>
          </div>
          {STAT_GROUPS.map((group) => (
            <section className="pct-group" key={group.title}>
              <h3 className="pct-group-h">{group.title}</h3>
              {group.stats.map((spec) => {
                const row = byKey.get(spec.key);
                return row ? <PercentileBar key={spec.key} row={row} /> : null;
              })}
            </section>
          ))}
        </section>
      </div>

      {/*
        TABS, not one endless scroll.
        
        Ten sections stacked vertically meant the game log — the thing you scroll to
        most — sat four screens down, and nobody ever saw the sections in between. The
        grouping is by QUESTION rather than by data source: what kind of player he is,
        when he was good, how he shot, and the raw record.
      */}
      <div className="pd-tabs" role="tablist" aria-label="Player detail">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`pd-tab${tab === t.key ? " pd-tab-on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pd-sheets" role="tabpanel">
        {tab === "profile" && (
          <>
            <div className="pd-sheet-two">
              <CategoryShape player={p} pool={pool} />
              <SimilarPlayers player={p} pool={pool} />
            </div>
            <UsageEfficiency player={p} pool={pool} onPick={onPick} />
          </>
        )}

        {tab === "splits" && (
          <>
            <PlayerSplits key={`sp-${p.playerId ?? p.name}`} playerId={p.playerId} pool={pool} />
            <OpponentDefense key={`od-${p.playerId ?? p.name}`} playerId={p.playerId} pool={pool} />
            <PlayerConsistency
              key={`con-${p.playerId ?? p.name}`}
              playerId={p.playerId}
              pool={pool}
            />
          </>
        )}

        {tab === "log" && (
          <>
            <GameLog key={p.playerId ?? p.name} playerId={p.playerId} />
            <InjuryLog
              key={`inj-${p.playerId ?? p.name}`}
              playerId={p.playerId}
              season={season}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One percentile bar: label, track, filled bar with the percentile in a bubble at its
 * end, and the raw figure on the right.
 *
 * COLOUR IS DIVERGING, not sequential — the question a percentile answers is "which side
 * of league average, and by how far", which is polarity about a baseline. Three steps:
 * cobalt below, neutral around the middle, clay above. The two poles are the app's own
 * cobalt and clay, which clear CVD separation comfortably (ΔE 28 under protanopia) —
 * blue against orange is the one pair colour-blindness leaves alone.
 *
 * Intensity is deliberately NOT graded within a side, the way Baseball Savant grades it.
 * Length already carries magnitude precisely and the bubble prints the exact number, so
 * shading would be a third copy of the same variable — and the shades it needs cannot
 * hold a 2:1 contrast floor against this app's near-white card anyway.
 *
 * The 50th-percentile tick is what makes the diverging read work: without a marked
 * baseline "above average" is just a longer bar.
 */
function PercentileBar({ row }: { row: PercentileRow }) {
  const { spec, value, percentile, n } = row;
  const text = formatStat(spec, value);

  if (percentile == null) {
    /*
     * One label for every unrankable row, whatever made it unrankable — too few games in
     * the window, or no attempts to take a rate from. The distinction mattered to the code
     * and not to the reader: either way there is no standing to report, and two different
     * greyed-out phrases in the same column just invited working out which was which.
     *
     * The figure still prints when there is one; `formatStat` already renders a dash when
     * there is not.
     */
    return (
      <div className="pct-row">
        <span className="pct-label">{spec.label}</span>
        <span className="pct-value mono">{text}</span>
        <span className="pct-track pct-track-empty">
          <span className="pct-none">Not qualified</span>
        </span>
      </div>
    );
  }

  const tone =
    percentile >= 60 ? "hi" : percentile <= 40 ? "lo" : "mid";
  // Floored so a 0th-percentile bar is still a visible mark rather than nothing at all,
  // which would read as missing data — the case `percentile == null` above handles.
  const width = Math.max(percentile, 3);

  return (
    <div
      className="pct-row"
      title={`${spec.label}: ${text} — ${percentile}th percentile of ${n} qualified players${
        spec.lowerIsBetter ? " (fewer is better)" : ""
      }`}
    >
      <span className="pct-label">{spec.label}</span>
      <span className="pct-value mono">{text}</span>
      <span className="pct-track">
        <span className="pct-tick" aria-hidden="true" />
        <span className={`pct-fill pct-${tone}`} style={{ width: `${width}%` }}>
          <span className="pct-bubble mono">{percentile}</span>
        </span>
      </span>
    </div>
  );
}

const toneOf = (v: number) =>
  v > 0 ? "var(--good)" : v < 0 ? "var(--bad)" : "var(--ink)";

/**
 * Season, last 30 and last 15 as three rows of one table — the reference card's shape.
 *
 * This replaced three big value tiles. The tiles gave the value enormous type and said
 * nothing about WHY it was that number, so the only way to see what changed in a slump
 * was to flip the basis chips and hold two screens in your head. Three rows put the whole
 * trajectory in one glance: the same eight categories, three windows, value last.
 *
 * A window with no games prints dashes rather than zeros — no games is not a bad line.
 */
function WindowTable({ p }: { p: PoolPlayer }) {
  /*
   * A row prints whenever it has games. Nothing else.
   *
   * It used to be gated on `MIN_GP` — the threshold that decides whether a PERCENTILE can
   * be drawn — and that produced impossible tables. The bar differs per row (15 season, 5
   * for 30 days, 3 for 15), so a player with six games all year failed the season's bar of
   * fifteen while clearing the 30-day bar of five: a dashed-out Season line sitting above a
   * populated 30 Day line, claiming he played six games in the last month and none in the
   * season that contains it.
   *
   * The two questions are different. "What did he do" is a fact and belongs here whatever
   * the sample. "Can he be ranked against the league" needs a sample, and the bars already
   * answer it on their own by printing Not qualified. This table is the fact.
   */
  const rows = (
    [
      { label: "Season", basis: "Regular" },
      { label: "30 Day", basis: "30D" },
      { label: "15 Day", basis: "15D" },
    ] as Array<{ label: string; basis: ValueBasis }>
  ).map((r) => {
    const gp = gamesFor(p, r.basis);
    return { ...r, gp, has: gp > 0 };
  });
  const cats: StatKey[] = ["PTS", "REB", "AST", "STL", "BLK", "TO"];

  return (
    <div className="pd-wt-wrap">
      <table className="pd-wt">
        <thead>
          <tr>
            <th />
            <th>GP</th>
            {cats.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th className="pd-wt-val">Val</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.has ? statValue(p, "VALUE", r.basis) : null;
            return (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.has ? r.gp : "—"}</td>
                {cats.map((c) => {
                  const x = r.has ? statValue(p, c, r.basis) : null;
                  return <td key={c}>{x == null ? "—" : x.toFixed(1)}</td>;
                })}
                <td className="pd-wt-val">
                  {v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
