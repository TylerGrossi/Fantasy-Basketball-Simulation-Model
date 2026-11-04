"use client";

import { useMemo, useState } from "react";
import type { AvailabilityData, AvailabilityGame, AvailabilityPlayer } from "@/lib/availability";
import { availabilityTone } from "@/lib/availability";
import { dayLabel } from "@/lib/dates";
import PlayerLink from "./PlayerLink";
import SortableTable, { type SortCol, type SortRow } from "./SortableTable";

/** Every column sorts (owner, 2026-11-03); the table opens on chance to play, highest first. */
const COLS: SortCol[] = [
  { key: "player", label: "Player" },
  { key: "next", label: "Next game", num: true, title: "Chance he plays his next game" },
  { key: "status", label: "Status" },
  { key: "injury", label: "Injury" },
  { key: "matchup", label: "Matchup" },
  { key: "week", label: "This week", title: "Sorted by expected games: the chances added up" },
  { key: "why", label: "Why" },
];
/** Status, worst first, for sorting. */
const STATUS_RANK: Record<string, number> = {
  Out: 0, OUT: 0, INJURY_RESERVE: 0, SSPD: 0, Doubtful: 1, Questionable: 2, DAY_TO_DAY: 2.5,
  Probable: 3, Available: 4, "": 5,
};

/**
 * Will They Play (owner, 2026-11-03): every player's chance of playing his next game and
 * each game left this week, from the two models in scripts/injury/ (lib/availability.ts).
 * Default view is the players with any doubt; "Everyone" lists the healthy too.
 */
type Scope = "mine" | "rostered" | "free" | "all";
const SCOPES: Array<[Scope, string]> = [
  ["mine", "My team"],
  ["rostered", "Rostered"],
  ["free", "Free agents"],
  ["all", "All"],
];
/**
 * "At risk": any listed status, or under this chance for his next game. 85%, not higher:
 * even healthy regulars miss ~7% of games, so a healthy player reads 90-96% (2026-11-03).
 */
const AT_RISK = 0.85;

export default function WillTheyPlayView({
  data,
  myTeamName,
}: {
  data: AvailabilityData | null;
  myTeamName: string;
}) {
  const [scope, setScope] = useState<Scope>("mine");
  const [atRisk, setAtRisk] = useState(true);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    // The fantasy season's last day (engine/config.py, carried in the data): a return
    // AFTER it is out for the season. Without it, nobody is hidden.
    const seasonEnd = data.seasonEnd ?? "9999-12-31";
    return data.players
      .filter((p) =>
        scope === "mine"
          ? p.owner === myTeamName
          : scope === "rostered"
            ? !!p.owner
            : scope === "free"
              ? !p.owner
              : true
      )
      .filter((p) => !atRisk || !!p.status || (p.next != null && p.next.p < AT_RISK))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.nbaTeam.toLowerCase() === q)
      // Out for the season (owner, 2026-11-03): ESPN's return date AFTER the fantasy
      // season's last day (Apr 4, 2027). Everyone due back by then shows, however far off
      // (an earlier 90-day / March 1 rule hid players who return in time for the
      // playoffs). Still in the data (0% in the projections; the agent can answer about
      // them) - just not listed here.
      .filter((p) => !p.expectedReturn || p.expectedReturn <= seasonEnd)
      // SECOND SORT (owner, 2026-11-03): ESPN's expected return, earliest first, then name.
      // The table's sort is stable, so among equal chances (every Out player's 0%) this
      // order survives whichever column and direction is chosen. No date sorts last.
      .sort(
        (a, b) =>
          (a.expectedReturn ?? "9999").localeCompare(b.expectedReturn ?? "9999") ||
          a.name.localeCompare(b.name)
      );
  }, [data, scope, atRisk, query, myTeamName]);

  if (!data) {
    return (
      <p className="caption">
        No availability data yet. The chances appear here after the next data refresh that
        includes the Will They Play models.
      </p>
    );
  }

  return (
    <>
      <p className="caption ctx">
        The chance each player plays, from {data.model.seasons} of NBA injury reports and box
        scores. On game day it reads the official injury report: the listed status, plus how
        often this player and his team have played when listed like this. Days ahead, before
        any report, it reads the schedule and his habits, such as sitting the second night of
        a back-to-back. A 60% means players in that spot played about 60% of the time.
        {data.reportTime ? ` Latest report: ${data.reportTime}.` : " No injury report yet today."}
      </p>

      <div className="controls wtp-controls">
        <div className="wtp-scopes" role="group" aria-label="Players">
          {SCOPES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`chip${scope === k ? " chip-on" : ""}`}
              aria-pressed={scope === k}
              onClick={() => setScope(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={atRisk} onChange={(e) => setAtRisk(e.target.checked)} />
          At risk only
        </label>
        <input
          className="field wtp-search"
          type="search"
          placeholder="Search players or a team (BOS)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search players"
        />
      </div>

      {rows.length === 0 ? (
        <p className="caption">
          {atRisk ? "Nobody here has any doubt about playing." : "No players match."}
        </p>
      ) : (
        <SortableTable
          className="wtp-table"
          cols={COLS}
          defaultKey="next"
          rows={rows.map((p): SortRow => row(p))}
        />
      )}
      <p className="bn-note ctx">
        Models trained through {data.model.trainedThrough}. Updated {fmtTime(data.generatedAt)}.
      </p>
    </>
  );
}

/** One player as sortable cells: each sorts on its number, renders its node. */
function row(p: AvailabilityPlayer): SortRow {
  // An Out player's Why is when he is due back (owner, 2026-11-03): ESPN's date, or the
  // first game this week the model gives him a chance in, else "No return date".
  const out = /^(Out|OUT|INJURY_RESERVE|SSPD)$/.test(p.status);
  // Anyone else with a status gets ESPN's estimated return after his reasons.
  const why = out
    ? returnText(p)
    : [...p.factors.slice(0, 2), ...(p.status && p.expectedReturn ? [`ESPN est. return ${shortDate(p.expectedReturn)}`] : [])].join("; ");
  const expected = p.week.reduce((a, g) => a + g.p, 0);
  return {
    id: p.name,
    cells: {
      player: {
        sort: p.name,
        text: p.name,
        node: (
          <span className="wtp-player">
            <PlayerLink name={p.name} />
            <span className="bn-note">
              {p.nbaTeam}
              {p.positions.length ? ` · ${p.positions.join(", ")}` : ""}
              {p.owner ? ` · ${p.owner}` : " · FA"}
            </span>
          </span>
        ),
      },
      next: {
        // Sorted on the WHOLE percent shown, so rows that read the same (a report "Out" is
        // 0.1%, an ESPN out 0.0% - both "0%") tie, and the return-date order decides.
        sort: p.next ? Math.round(p.next.p * 100) : -1,
        text: p.next ? `${Math.round(p.next.p * 100)}%` : "no game",
        node: p.next ? <Ring p={p.next.p} /> : <span className="bn-note">no game</span>,
      },
      status: {
        sort: STATUS_RANK[p.status] ?? 5,
        text: shortStatus(p.status),
        node: <span className={`wtp-status wtp-st-${statusTone(p.status)}`}>{shortStatus(p.status)}</span>,
      },
      injury: { sort: p.injury || "~", text: p.injury || "-", node: <span className="wtp-injury">{p.injury || "-"}</span> },
      matchup: {
        sort: p.next ? `${p.next.date} ${p.next.opp}` : "~",
        text: p.next ? `${dayLabel(p.next.date)} ${p.next.home ? "vs" : "@"} ${p.next.opp}` : "-",
        node: p.next ? (
          <span className="mono wtp-matchup">
            {dayLabel(p.next.date)} {p.next.home ? "vs" : "@"} {p.next.opp}
            {p.next.b2b && <span className="wtp-b2b" title="Second night of a back-to-back">B2B</span>}
          </span>
        ) : (
          "-"
        ),
      },
      week: { sort: expected, text: expected.toFixed(1), node: <Week games={p.week} /> },
      why: {
        sort: why || "~",
        text: why || "-",
        node: (
          <span className="wtp-why">
            {why || "-"}
            {p.record && p.record.listed >= 3 && (
              <span className="bn-note">
                {" "}
                (played {p.record.played} of {p.record.listed} when listed like this)
              </span>
            )}
          </span>
        ),
      },
    },
  };
}

/** The chance as a ring: the arc is the probability, the colour its bucket. */
function Ring({ p }: { p: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const tone = availabilityTone(p);
  return (
    <span className={`wtp-ring wtp-${tone}`} title={`${Math.round(p * 100)}% chance to play`}>
      <svg viewBox="0 0 36 36" width="54" height="54" aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="wtp-ring-bg" />
        {/* No arc under 1%: a zero-length stroke with round caps draws a stray dot. */}
        {p >= 0.01 && (
          <circle
            cx="18"
            cy="18"
            r={r}
            className="wtp-ring-arc"
            strokeDasharray={`${(p * c).toFixed(2)} ${c.toFixed(2)}`}
            transform="rotate(-90 18 18)"
          />
        )}
      </svg>
      <span className="wtp-ring-v mono">{Math.round(p * 100)}%</span>
    </span>
  );
}

/** This week's remaining games, one small cell per game. */
function Week({ games }: { games: AvailabilityGame[] }) {
  if (!games.length) return <span className="bn-note">-</span>;
  return (
    <span className="wtp-week">
      {games.map((g) => (
        <span
          key={g.date}
          className={`wtp-day wtp-${availabilityTone(g.p)}`}
          title={`${dayLabel(g.date)} ${g.home ? "vs" : "@"} ${g.opp}${g.b2b ? " (back-to-back)" : ""}: ${Math.round(g.p * 100)}%${g.source === "report" ? " (injury report)" : " (look-ahead)"}`}
        >
          <span className="wtp-day-d">{dayLabel(g.date).split(" ")[0]}</span>
          <span className="mono">{Math.round(g.p * 100)}</span>
        </span>
      ))}
    </span>
  );
}

/** "11/23", with the year only when it is not this one ("3/2/2027"). */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}${y !== new Date().getFullYear() ? `/${y}` : ""}`;
}

function returnText(p: AvailabilityPlayer): string {
  const back = p.factors.find((f) => f.startsWith("Expected back"));
  if (p.expectedReturn) {
    const [y, m, d] = p.expectedReturn.split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    });
    return `Expected back ${day} ${m}/${d}${y !== new Date().getFullYear() ? `/${y}` : ""} (ESPN)`;
  }
  return back ?? "No return date from ESPN";
}

const shortStatus = (s: string) =>
  ({ DAY_TO_DAY: "Day-to-day", OUT: "Out", INJURY_RESERVE: "IR", ACTIVE: "" } as Record<string, string>)[s] ??
  s;

function statusTone(s: string) {
  if (/^(Out|OUT|INJURY_RESERVE|Doubtful)$/.test(s)) return "bad";
  if (/^(Questionable|DAY_TO_DAY)$/.test(s)) return "mid";
  return "ok";
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " ET";
  } catch {
    return iso;
  }
}
