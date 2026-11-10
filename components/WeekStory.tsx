import { formatValue } from "@/lib/league";
import { dayLabel } from "@/lib/dates";
import { headshotUrl } from "@/lib/playerPool";
import RaceGrid from "./RaceGrid";
import type {
  DayScore,
  Margin,
  SideDetail,
  StandoutGame,
  StatLine,
  WeekForecast,
  WeekStoryData,
} from "@/lib/weekStory";

/**
 * "How the week played out" (owner, 2026-11-10): the analysis under a finished week's
 * category sheet. Numbers come from lib/weekStory.ts. Top to bottom:
 *
 *   pre-week forecast + score by day | category margins (with pre-week odds)
 *   category race       running lead per category (interactive: RaceGrid.tsx)
 *   standout games      each team's three best single games, with headshots
 *
 * `DayGrid` (each player's value day by day, and his week against his season) renders in
 * the team panels, behind a Box score / Day by day toggle (BoxDayToggle.tsx).
 *
 * SERVER components on purpose: plain SVG/HTML with native `<title>` tooltips, so nothing
 * here ships JavaScript or puts the logs in the page payload.
 *
 * Color follows the board: the team on the LEFT is cobalt, the team on the right clay.
 * Text stays in ink; color is only on the marks.
 */

interface Side {
  name: string;
  abbrev: string;
}

export default function WeekStory({
  data,
  focus,
  opp,
}: {
  data: WeekStoryData;
  focus: Side;
  opp: Side;
}) {
  const hasDays = data.dates.length > 0;
  return (
    <section className="ws">
      <div className="wst-head">
        <h2 className="rc-box-title wst-title">How the week played out</h2>
        <Legend focus={focus} opp={opp} />
      </div>

      <div className="wst-two">
        <div className="wst-stack">
          {data.forecast && <ForecastStrip f={data.forecast} focus={focus} opp={opp} />}
          {hasDays && (
            <div className="wst-card">
              <h3 className="wst-h">Score by day</h3>
              <p className="wst-sub">The category score at the end of each day.</p>
              <ScoreByDay days={data.byDay} focus={focus} opp={opp} />
            </div>
          )}
        </div>
        <div className="wst-card">
          <h3 className="wst-h">Category margins</h3>
          <p className="wst-sub">
            Final margin in typical weekly spreads (1 = one standard deviation of team-weeks
            in that category). Short bars were close.
          </p>
          <Margins margins={data.margins} focus={focus} opp={opp} showPre={!!data.forecast} />
        </div>
      </div>

      {hasDays && (
        <div className="wst-card">
          <h3 className="wst-h wst-h-solo">Category race</h3>
          <RaceGrid race={data.race} focus={focus} opp={opp} />
        </div>
      )}

      {data.games.focus.length + data.games.opp.length > 0 && (
        <div className="wst-card">
          <h3 className="wst-h wst-h-solo">Standout games</h3>
          <div className="wst-pv">
            {([["focus", focus], ["opp", opp]] as const).map(([k, side]) => (
              <div className="wst-games" key={k}>
                <div className="wst-pv-team">
                  <i className={`wst-key ${k === "focus" ? "wst-key-f" : "wst-key-o"}`} />
                  {side.name}
                </div>
                {data.games[k].map((g, i) => (
                  <GameCard key={`${g.name}${g.date}`} g={g} rank={i + 1} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

    </section>
  );
}

function Legend({ focus, opp }: { focus: Side; opp: Side }) {
  return (
    <div className="wst-legend">
      <span>
        <i className="wst-key wst-key-f" />
        {focus.name}
      </span>
      <span>
        <i className="wst-key wst-key-o" />
        {opp.name}
      </span>
    </div>
  );
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
/** "+3.2" / "−1.4"; anything that rounds to zero reads "0.0", never "−0.0". */
const signed = (v: number, dp = 1) => {
  const r = Number(v.toFixed(dp));
  return r === 0 ? (0).toFixed(dp) : `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(dp)}`;
};

// ---- 5. forecast vs result ---------------------------------------------------------

function ForecastStrip({ f, focus, opp }: { f: WeekForecast; focus: Side; opp: Side }) {
  const oppExp = f.cats - f.expected;
  return (
    <div className="wst-card wst-fc">
      <div className="wst-fc-block wst-fc-odds">
        <span className="wst-fc-k">Pre-week win chance</span>
        <div className="wst-fc-split" title={`${focus.abbrev} ${pct(f.focusWin)}, ${opp.abbrev} ${pct(f.oppWin)}`}>
          <span className="mono">{focus.abbrev} {pct(f.focusWin)}</span>
          <div className="wst-fc-bar">
            <span className="wst-f" style={{ flexGrow: f.focusWin }} />
            <span className="wst-o" style={{ flexGrow: f.oppWin }} />
          </div>
          <span className="mono">{pct(f.oppWin)} {opp.abbrev}</span>
        </div>
      </div>
      <div className="wst-fc-block">
        <span className="wst-fc-k">Expected score</span>
        <span className="wst-fc-v mono">
          {f.expected.toFixed(1)}–{oppExp.toFixed(1)}
        </span>
      </div>
      <div className="wst-fc-block">
        <span className="wst-fc-k">Verdict</span>
        <span className="wst-fc-v">
          {f.upset ? (
            <span className="wst-fc-tag">Upset</span>
          ) : (
            <>As forecast</>
          )}
        </span>
      </div>
      <div className="wst-fc-block wst-fc-against">
        <span className="wst-fc-k">Went against the forecast</span>
        <span className="wst-fc-v wst-fc-cats">
          {f.against.length ? f.against.join(", ") : "None"}
        </span>
      </div>
    </div>
  );
}

// ---- 2. score by day -------------------------------------------------------------

function ScoreByDay({ days, focus, opp }: { days: DayScore[]; focus: Side; opp: Side }) {
  const total = (d: DayScore) => d.win + d.loss + d.tie || 1;

  return (
    <>
      <div className="wst-days">
        {days.map((d) => {
          const t = total(d);
          return (
            <div className="wst-day" key={d.date}>
              <span className="wst-day-l mono">{dayLabel(d.date)}</span>
              <div
                className="wst-day-bar"
                title={`${dayLabel(d.date)}: ${focus.abbrev} ${d.win}, ${opp.abbrev} ${d.loss}, tied ${d.tie}`}
              >
                {d.win > 0 && <span className="wst-seg wst-f" style={{ flexGrow: d.win / t }} />}
                {d.tie > 0 && <span className="wst-seg wst-t" style={{ flexGrow: d.tie / t }} />}
                {d.loss > 0 && <span className="wst-seg wst-o" style={{ flexGrow: d.loss / t }} />}
              </div>
              <span className="wst-day-s mono">
                {d.win}-{d.loss}-{d.tie}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- 3. margins ------------------------------------------------------------------

const Z_CAP = 3;
const CLOSE = 0.25;

function marginLabel(m: Margin): string {
  if (m.cat.includes("%")) return `${signed(m.raw * 100)}%`;
  const r = Math.round(m.raw);
  return `${r >= 0 ? "+" : "−"}${Math.abs(r).toLocaleString("en-US")}`;
}

function Margins({
  margins,
  focus,
  opp,
  showPre,
}: {
  margins: Margin[];
  focus: Side;
  opp: Side;
  showPre: boolean;
}) {
  return (
    <div className={`wst-mg ${showPre ? "wst-mg-pre" : ""}`}>
      <div className="wst-mg-row wst-mg-axis">
        <span />
        <div className="wst-mg-ends">
          <span>{opp.abbrev} better</span>
          <span>{focus.abbrev} better</span>
        </div>
        <span />
        {showPre && <span className="wst-mg-oddsh">Odds</span>}
      </div>
      {margins.map((m) => {
        const w = (Math.min(Math.abs(m.z), Z_CAP) / Z_CAP) * 50;
        const close = Math.abs(m.z) < CLOSE;
        const tie = Math.abs(m.raw) < 1e-9;
        // The WINNER's pre-week chance in this category; under 50% = it went against.
        const winPre = m.pre == null || tie ? null : m.raw > 0 ? m.pre : 1 - m.pre;
        return (
          <div
            className="wst-mg-row"
            key={m.cat}
            title={`${m.cat}: ${focus.abbrev} ${formatValue(m.cat, m.focus)}, ${opp.abbrev} ${formatValue(m.cat, m.opp)} (${signed(m.z, 2)} spreads)${m.pre != null ? `. Pre-week: ${focus.abbrev} ${pct(m.pre)}` : ""}`}
          >
            <span className="wst-mg-cat">{m.cat}</span>
            <div className="wst-mg-track">
              <span className="wst-mg-mid" />
              {!tie && (
                <span
                  className={`wst-mg-bar ${m.z > 0 ? "wst-f wst-mg-r" : "wst-o wst-mg-l"}`}
                  style={{ width: `max(${w.toFixed(2)}%, 3px)` }}
                />
              )}
            </div>
            <span className="wst-mg-v mono">
              {tie ? "tied" : marginLabel(m)}
              {close && !tie && <em className="wst-close">close</em>}
            </span>
            {showPre && (
              <span className={`wst-mg-odds mono ${winPre != null && winPre < 0.5 ? "wst-mg-against" : ""}`}>
                {winPre == null ? "—" : pct(winPre)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- 10. standout games ----------------------------------------------------------

/** "38 pts · 9 reb · 7 ast · 3 stl · 13/22 FG" — the parts of a line worth reading. */
export function lineSummary(l: StatLine): string {
  const r = (k: string) => Math.round(l[k] ?? 0);
  const parts = [`${r("PTS")} pts`, `${r("REB")} reb`, `${r("AST")} ast`];
  if (r("STL") >= 2) parts.push(`${r("STL")} stl`);
  if (r("BLK") >= 2) parts.push(`${r("BLK")} blk`);
  if (r("3PM") >= 3) parts.push(`${r("3PM")} 3pm`);
  parts.push(`${r("FGM")}/${r("FGA")} FG`);
  if (r("TO") >= 5) parts.push(`${r("TO")} to`);
  return parts.join(" · ");
}

function GameCard({ g, rank }: { g: StandoutGame; rank: number }) {
  const shot = headshotUrl(g.playerId);
  return (
    <div className="wst-game">
      <span className="wst-game-rank mono">{rank}</span>
      {shot ? (
        <span className="wst-game-shot" style={{ backgroundImage: `url('${shot}')` }} />
      ) : (
        <span className="wst-game-shot wst-game-shot-blank" />
      )}
      <div className="wst-game-body">
        <div className="wst-game-top">
          <span className="wst-game-name">{g.name}</span>
          <span className="wst-game-meta">{dayLabel(g.date)}</span>
        </div>
        <div className="wst-game-line mono">{lineSummary(g.line)}</div>
      </div>
      <span className="wst-game-gs mono" title="Game Score">
        {signed(g.gs)}
      </span>
    </div>
  );
}

// ---- 11. day-by-day grid (in each team panel) ------------------------------------

/** Game Score bands for a day cell: a strong night, a good one, a poor one, a bad one. */
const gsBand = (gs: number) =>
  gs >= 12 ? "wst-gs-up2" : gs >= 5 ? "wst-gs-up1" : gs <= -8 ? "wst-gs-dn2" : gs <= -3 ? "wst-gs-dn1" : "";

export function DayGrid({
  title,
  detail,
  dates,
  vsCap,
  side,
}: {
  title: string;
  detail: SideDetail;
  dates: string[];
  /** Shared bar scale for the vs-season column (both teams' grids). */
  vsCap: number;
  /** Which board color this team wears. */
  side: "focus" | "opp";
}) {
  if (!dates.length || !detail.players.length) return null;
  return (
    <>
      <h2 className="rc-box-title">{title}</h2>
      <div className="table-scroll">
        <table className="sheet wst-dg">
          <thead>
            <tr>
              <th>Player</th>
              {dates.map((d) => (
                <th className="num" key={d}>
                  {dayLabel(d)}
                </th>
              ))}
              <th className="num">GP</th>
              <th className="num">Total</th>
              <th className="wst-dg-vs-h" title="Per-game value this week minus season value (Player Value scale), 2+ games">
                Vs season
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.players.map((name) => {
              const row = detail.days[name] ?? {};
              return (
                <tr key={name}>
                  <td className="rc-player">{name}</td>
                  {dates.map((d) => {
                    const c = row[d];
                    if (!c) {
                      return (
                        <td className="num wst-dg-none" key={d}>
                          ·
                        </td>
                      );
                    }
                    return (
                      <td
                        className={`num ${gsBand(c.gs)}`}
                        key={d}
                        title={`${dayLabel(d)}: ${lineSummary(c.line)} · Game Score ${signed(c.gs)}`}
                      >
                        {signed(c.gs)}
                      </td>
                    );
                  })}
                  <td className="num wst-dg-gp">{Object.keys(row).length}</td>
                  <td className="num wst-dg-tot">
                    {signed(Object.values(row).reduce((a, c) => a + c.gs, 0))}
                  </td>
                  <VsCell w={detail.vsSeason[name]} cap={vsCap} cls={side === "focus" ? "wst-f" : "wst-o"} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="wst-key-note">
        Each counted game&rsquo;s value (Game Score, as on Game Day; 0 is the player
        pool&rsquo;s average game):
        <span className="wst-chip wst-gs-up2">+12 or more</span>
        <span className="wst-chip wst-gs-up1">+5 or more</span>
        <span className="wst-chip wst-gs-dn1">−3 or less</span>
        <span className="wst-chip wst-gs-dn2">−8 or less</span>
        <span className="wst-dg-dot">·</span> no counted game. Hover a cell for the line.
        Vs season: per-game value this week minus season value (Player Value scale),
        players with 2+ games.
      </p>
    </>
  );
}

/** The vs-season data bar: a diverging bar about zero, then the number. */
function VsCell({ w, cap, cls }: { w?: { week: number; season: number; gp: number; name: string }; cap: number; cls: string }) {
  if (!w) return <td className="wst-dg-vs wst-dg-none">—</td>;
  const d = w.week - w.season;
  const width = (Math.min(Math.abs(d), cap) / cap) * 50;
  return (
    <td
      className="wst-dg-vs"
      title={`${w.name}: ${w.week.toFixed(1)} this week vs ${w.season.toFixed(1)} season, ${w.gp} games`}
    >
      <div className="wst-dg-vs-in">
        <div className="wst-mg-track">
          <span className="wst-mg-mid" />
          <span
            className={`wst-mg-bar ${cls} ${d >= 0 ? "wst-mg-r" : "wst-mg-l"}`}
            style={{ width: `max(${width.toFixed(2)}%, 3px)` }}
          />
        </div>
        <span className="mono">{signed(d)}</span>
      </div>
    </td>
  );
}
