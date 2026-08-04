"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueData, PoolPlayer } from "@/lib/league";
import GameLog from "./GameLog";
import InjuryLog from "./InjuryLog";
import PlayerSearch from "./PlayerSearch";
import { headshotUrl, playerStatus, VALUE_BASES, type ValueBasis } from "@/lib/playerPool";

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
  college?: string;
  draft?: string;
  birthplace?: string;
}

const BIO_CACHE = new Map<number, Bio>();

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

      {p && <PlayerDetail p={p} pool={pool} bio={bio} season={league.season} />}
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
        const college = a.college;
        const next: Bio = {
          team: a.team?.displayName ?? "",
          jersey: a.displayJersey ?? (a.jersey ? `#${a.jersey}` : ""),
          position: a.position?.displayName ?? "",
          height: a.displayHeight ?? "",
          weight: a.displayWeight ?? "",
          age: a.age,
          experience: a.displayExperience ?? "",
          college:
            (typeof college === "string" ? college : college?.name) ?? "",
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
}: {
  p: PoolPlayer;
  pool: PoolPlayer[];
  bio: Bio;
  /** The export's season YEAR — ESPN keys its athlete/schedule records by it. */
  season: number;
}) {
  const [code, sev] = playerStatus(p.status);
  const shot = headshotUrl(p.playerId);
  const fantasyTeam = p.owner === "FA" ? "Free Agent" : p.owner;

  // Identity line: full team name (falls back to the roster abbrev), jersey, position.
  const ident = [bio.team || p.nbaTeam, bio.jersey, bio.position || p.position]
    .filter(Boolean)
    .join(" · ");

  const ranked = [...pool].sort((a, b) => b.value - a.value);
  const rank = ranked.findIndex((x) => x.name === p.name) + 1;

  const facts: Array<[string, string]> = [
    ["HT/WT", [bio.height, bio.weight].filter(Boolean).join(", ")],
    ["Age", bio.age ? String(bio.age) : ""],
    ["Experience", bio.experience ?? ""],
    ["College", bio.college ?? ""],
    ["Draft", bio.draft ?? ""],
    ["Born", bio.birthplace ?? ""],
  ];
  const shownFacts = facts.filter(([, v]) => v);

  /*
   * Which window the averages sheet shows. Same three choices, same labels, and the same
   * `ValueBasis` type as the Player Value page's basis menu — one vocabulary across the
   * app rather than a second one that means almost the same thing.
   *
   * The value TILES above deliberately keep showing all three at once: there the point is
   * comparing them, here the point is reading one line in detail.
   */
  const [basis, setBasis] = useState<ValueBasis>("Regular");
  const window_ = basis === "30D" ? p.last30 : basis === "15D" ? p.last15 : undefined;
  // A window is absent when the player had no games in it. Falling back to the season
  // line (and saying so) beats printing a column of zeros, which would read as "played
  // and produced nothing".
  const missing = basis !== "Regular" && !window_;

  const at = (k: string, seasonVal: number) =>
    window_ ? Number(window_[k] ?? 0) : seasonVal;
  // Percentages are RATES: recomputed from the window's own makes and attempts, never
  // carried over from the season.
  const rate = (made: string, att: string, seasonPct: number) => {
    if (!window_) return seasonPct;
    const a = Number(window_[att] ?? 0);
    return a > 0 ? Number(window_[made] ?? 0) / a : 0;
  };

  const stats: Array<[string, string]> = [
    ["Points", at("PTS", p.PTS).toFixed(1)],
    ["Field Goal %", (rate("FGM", "FGA", p.fgPct) * 100).toFixed(1)],
    ["Rebounds", at("REB", p.REB).toFixed(1)],
    ["Free Throw %", (rate("FTM", "FTA", p.ftPct) * 100).toFixed(1)],
    ["Assists", at("AST", p.AST).toFixed(1)],
    ["3-Point %", (rate("3PM", "3PA", p.tpPct) * 100).toFixed(1)],
    ["Steals", at("STL", p.STL).toFixed(1)],
    ["3-Pointers", at("3PM", p["3PM"]).toFixed(1)],
    ["Blocks", at("BLK", p.BLK).toFixed(1)],
    ["Turnovers", at("TO", p.TO).toFixed(1)],
    [
      "Stocks (stl+blk)",
      (at("STL", p.STL) + at("BLK", p.BLK)).toFixed(1),
    ],
    ["Double-Doubles", at("DD", p.DD).toFixed(1)],
  ];

  return (
    <div className="pd">
      <div className="pd-head">
        {shot ? (
          <div className="pv-shot" style={{ backgroundImage: `url('${shot}')` }} />
        ) : (
          <div className="pv-shot pv-shot-blank" />
        )}
        <div className="pd-id">
          <div className="pd-name">{p.name}</div>
          <div className="pd-team">{ident}</div>
          <div className="pd-status">
            <span>
              <span className={`pd-dot ${sev || "ok"}`} />
              {sev === "out" ? code || "Out" : sev === "day" ? code : "Active"}
            </span>
            <span className="pd-owner">
              Fantasy Team: <b>{fantasyTeam}</b>
            </span>
          </div>
        </div>
      </div>

      {shownFacts.length > 0 && (
        <div className="pd-bio">
          {shownFacts.map(([label, v]) => (
            <div className="pd-bio-f" key={label}>
              <span className="pd-bl">{label}</span>
              <span className="pd-bv">{v}</span>
            </div>
          ))}
        </div>
      )}

      <div className="pd-values">
        <ValueTile label="Value" value={p.value} note={`#${rank} of ${pool.length}`} />
        <ValueTile label="30D" value={p.recent} trend={p.trend} colored />
        <ValueTile label="15D" value={p.recent15} trend={p.trend15} colored />
      </div>

      <div className="pd-sec pd-sec-row">
        <span>
          {basis === "Regular" ? "Season averages" : `Last ${basis === "30D" ? 30 : 15} days`}{" "}
          <span>
            per game
            {window_?.gp ? ` · ${window_.gp} GP` : p.gp ? ` · ${p.gp} GP` : ""}
          </span>
        </span>
        <span className="controls pd-basis" role="group" aria-label="Averages basis">
          {VALUE_BASES.map((b) => (
            <button
              key={b}
              type="button"
              className={`chip${basis === b ? " chip-on" : ""}`}
              aria-pressed={basis === b}
              onClick={() => setBasis(b)}
            >
              {b === "Regular" ? "Season" : b}
            </button>
          ))}
        </span>
      </div>
      {missing && (
        <p className="caption pd-basis-note">
          No games in that window — showing the season line instead.
        </p>
      )}
      <div className="pd-stats">
        {stats.map(([label, v]) => (
          <div className="pd-stat" key={label}>
            <span className="pd-sl">{label}</span>
            <span className="pd-sv">{v}</span>
          </div>
        ))}
      </div>

      <div className="pd-log">
        <GameLog key={p.playerId ?? p.name} playerId={p.playerId} />
        <InjuryLog
          key={`inj-${p.playerId ?? p.name}`}
          playerId={p.playerId}
          season={season}
        />
      </div>
    </div>
  );
}

const toneOf = (v: number) =>
  v > 0 ? "var(--good)" : v < 0 ? "var(--bad)" : "var(--ink)";

function ValueTile({
  label,
  value,
  note,
  trend,
  colored,
}: {
  label: string;
  value: number;
  note?: string;
  trend?: number;
  colored?: boolean;
}) {
  return (
    <div className="pd-vtile">
      <span className="pd-vl">{label}</span>
      <span className="pd-vv" style={colored ? { color: toneOf(value) } : undefined}>
        {value >= 0 ? "+" : ""}
        {value.toFixed(1)}
      </span>
      {note && <span className="pd-vr">{note}</span>}
      {trend != null && (
        <span className="pd-vr" style={{ color: toneOf(trend) }}>
          {trend >= 0 ? "+" : ""}
          {trend.toFixed(1)} vs season
        </span>
      )}
    </div>
  );
}
