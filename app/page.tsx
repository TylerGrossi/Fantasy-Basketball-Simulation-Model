import Link from "next/link";
import { loadLeague, myTeam } from "@/lib/loadLeague";
import {
  BroadcastIcon,
  TrophyIcon,
  ChartIcon,
  TableIcon,
  ClipboardDataIcon,
  CalendarIcon,
  GraphUpIcon,
  PersonBadgeIcon,
  ShuffleIcon,
  BracketIcon,
} from "@/components/Icons";

/**
 * Home / landing. Two entirely different pages behind one route.
 *
 * MOBILE is a launcher: a compact hero and a 3-up grid of single-tap tiles, matching the
 * Streamlit phone layout tile for tile.
 *
 * DESKTOP is a project page — what this is, how it works, and what is in it — because on
 * a laptop there is room to explain it to someone who has never seen it. It is written to
 * be SCANNED, not read: figures first, one line per claim, three columns wide. An earlier
 * version ran the same material as paragraphs in a 62-character column and read as an
 * essay with half the screen empty.
 *
 * Both are rendered and shown/hidden by breakpoint — no width detection, no flash of the
 * wrong layout.
 */

/**
 * The mobile tile grid — nine tiles, and the grid is 3-up, so each ROW is a group:
 *
 *   1. where things stand     Current Matchup · Schedule · Season Stats
 *   2. the numbers            League Stats · Power Rankings · Player Card
 *   3. things you act with    Player Value · Trade Simulator · Settings
 *
 * Season Summary is NOT here: it's in HIDDEN_ON_MOBILE (lib/nav.ts) because its champion
 * card + KPI row + wide standings table don't sit well on a phone. Player Card took the
 * freed slot to keep the grid at a full 3×3.
 *
 * Playoff Odds is deliberately NOT here. It is a forecast with nothing left to forecast
 * (the same reason IN_SEASON_ONLY drops it from the nav), and a launcher tile is exactly
 * the kind of standing link that gets a 50/50 number read as a verdict on a finished
 * bracket.
 *
 * Agent and Settings have no tile: both live in the MORE section on the bottom bar, which
 * is one tap from anywhere. Season Summary took the freed slot and leads the grid.
 */
const TILES = [
  // League Home leads in season (2026-10-20), as it does in the desktop header. Season
  // Summary is one tap further, in the Season index.
  { href: "/league", label: "League Home", Icon: TrophyIcon },
  { href: "/scoreboard", label: "Current Matchup", Icon: ChartIcon },
  { href: "/schedule", label: "Schedule", Icon: CalendarIcon },
  { href: "/season-stats", label: "Season Stats", Icon: ClipboardDataIcon },
  { href: "/league-stats", label: "League Stats", Icon: TableIcon },
  { href: "/rankings", label: "Power Rankings", Icon: BracketIcon },
  { href: "/player", label: "Player Card", Icon: PersonBadgeIcon },
  { href: "/player-value", label: "Player Value", Icon: GraphUpIcon },
  { href: "/trade", label: "Trade Simulator", Icon: ShuffleIcon },
];

const GAME_DAY_TILE = { href: "/gametime", label: "Game Time", Icon: BroadcastIcon };

/**
 * What the site is for, as the four questions it answers.
 *
 * Deliberately jargon-free — no "Poisson-binomial", no "z-score". Someone who has never
 * played fantasy basketball should finish this band knowing what the thing does. The
 * technical vocabulary lives one section down, in the flow, where it belongs.
 */
const ANSWERS: Array<[string, string, string, string]> = [
  [
    "Am I winning this week?",
    "A real probability for the current matchup, category by category, updating as games finish rather than after they do.",
    "/scoreboard#odds",
    "See the matchup",
  ],
  [
    "Which pickup actually helps?",
    "Every free agent scored against your exact matchup, not a generic ranking — the best add for this week is rarely the best player.",
    "/scoreboard#streamers",
    "Find a streamer",
  ],
  [
    "Is this trade any good?",
    "What a deal does to each category before you accept it, so a trade that looks even on names can be judged on effect.",
    "/trade",
    "Test a trade",
  ],
  [
    "Was I good, or lucky?",
    "An all-play record scores every team against every other team each week, separating a record you earned from one the schedule handed you.",
    "/season",
    "See the season",
  ],
];

/**
 * The four steps a decision passes through, each tagged with the technique it uses.
 *
 * The techniques used to sit in a separate row of pills under this. They read as filler
 * detached from anything; naming each one against the step that uses it makes the same
 * point and costs no extra space.
 */
const FLOW: Array<[string, string, string]> = [
  [
    "Read",
    // Kept to ~100 characters so it sets three lines in a quarter-width column like the
    // other three steps — the original ran to four and left this card taller than its
    // neighbours. "account for injuries" also reads plainer than the "injury-aware" it
    // replaces, which matters in a band written to be jargon-free.
    "ESPN rosters, box scores and the NBA schedule. Games left account for injuries and the ten-per-day cap.",
    "ESPN API + schedule scrape",
  ],
  [
    "Project",
    "Each player's remaining production as a distribution rather than a point estimate: a mean and a variance per category.",
    "Gaussian moment matching",
  ],
  [
    "Solve",
    "Closed-form odds for all 15 categories, then the exact distribution of how many of them you win.",
    "Poisson-binomial DP",
  ],
  [
    "Decide",
    "Every lineup, waiver and trade option ranked by how far it moves that number. This is the part that wins weeks.",
    "League-category marginal value",
  ],
];

/**
 * The page directory: the IMPORTANT pages only, five per column in four columns (owner,
 * 2026-10-20) — the menus still carry everything else. Rows line up across columns
 * because every entry is the same height (see `.lp-dir-item`).
 *
 * `inSeason` marks pages that are meaningless once the bracket is done — the same rule
 * IN_SEASON_ONLY applies to the nav, so the directory can never advertise a dead end.
 */
const DIRECTORY: Array<{
  section: string;
  items: Array<{ href: string; name: string; desc: string; inSeason?: boolean }>;
}> = [
  {
    // League Home, then the one-page Current Matchup's sections in page order.
    section: "This Week",
    items: [
      { href: "/league", name: "League Home", desc: "Standings, scores, moves and risers at a glance." },
      { href: "/scoreboard", name: "Scoreboard", desc: "The matchup category by category, live from ESPN." },
      { href: "/scoreboard#schedule", name: "Week Schedule", desc: "Who plays each day, and days with too many players." },
      { href: "/scoreboard#odds", name: "Win Probability", desc: "Win odds, score distribution and projections." },
      { href: "/scoreboard#streamers", name: "Streamers", desc: "Every pick-up-and-drop pair scored against this week.", inSeason: true },
    ],
  },
  {
    section: "League",
    items: [
      { href: "/schedule", name: "Schedule", desc: "Week-by-week results, opponents and margins." },
      { href: "/season", name: "Season Summary", desc: "Standings, all-play and schedule luck, updated weekly." },
      { href: "/rankings", name: "Power Rankings", desc: "All-play strength, form and weekly movement." },
      { href: "/playoffs", name: "Playoff Odds", desc: "Playoff and title chances from the season simulation.", inSeason: true },
      { href: "/recent-moves", name: "Recent Moves", desc: "Every add, drop, waiver claim and trade, newest first." },
    ],
  },
  {
    // Player Card leads, then the Tools dropdown in lib/nav.ts order.
    section: "Players & Tools",
    items: [
      { href: "/player", name: "Player Card", desc: "Profile, value, recent form, last ten games." },
      { href: "/player-value", name: "Player Value", desc: "Rostered players and free agents by league value." },
      { href: "/trade", name: "Trade Simulator", desc: "What a trade does to your category strength." },
      { href: "/compare", name: "Compare", desc: "Two players side by side, category by category." },
      { href: "/draft-recap", name: "Draft Recap", desc: "Who won the draft: grades, steals and reaches." },
    ],
  },
  {
    section: "History & More",
    items: [
      { href: "/history", name: "Seasons", desc: "Every season you have played." },
      { href: "/history/head-to-head", name: "Head to Head", desc: "Your record against each manager." },
      { href: "/history/managers", name: "Managers", desc: "All-time standings by manager." },
      { href: "/agent", name: "Agent", desc: "Ask about the league in plain English." },
      { href: "/settings", name: "Settings", desc: "Your team, protected players and display." },
    ],
  },
];

export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const yr = `${league.season - 1}–${String(league.season).slice(2)}`;
  const leagueName = league.leagueName?.trim() || "Your League";
  // Said only once it is over (owner, 2026-10-21): "Season in progress" is the default
  // state of the app and told nobody anything.
  const status = league.seasonOver ? "Season complete" : null;
  // In season, Game Day leads the phone grid in League Home's slot (owner, 2026-10-21);
  // League Home is one tap away in the Season index. Offseason there are no games, so
  // the slot goes back to League Home.
  const tiles = league.seasonOver
    ? TILES
    : TILES.map((t) => (t.href === "/league" ? GAME_DAY_TILE : t));
  const directory = DIRECTORY.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.inSeason || !league.seasonOver),
  }));

  return (
    <>
      {/* ---------------- desktop: the project page ---------------- */}
      <div className="home-desktop">
        <header className="lp-hero">
          <div className="lp-eyebrow">
            {leagueName}
            {status && <> &middot; {status}</>} &middot; {yr}
          </div>
          <h1 className="lp-title">Fantasy Basketball Simulator</h1>
          <p className="lp-sub">
            Turning a {league.teams.length}-team ESPN head-to-head category league into a
            probability problem: what are my odds this week, and which move improves them
            most? Built to answer that in the time it takes to click.
          </p>
        </header>

        {/*
          What the site is for, as the four questions it answers.
          Plain language and no jargon — the technical half is the flow below, and this
          band has to make sense to someone who has never played fantasy basketball.
        */}
        <section className="lp-ans-wrap">
          <h2>What it answers</h2>
          <div className="lp-ans">
            {ANSWERS.map(([q, a, href, cta]) => (
              <div className="lp-ans-item" key={q}>
                <h3>{q}</h3>
                <p>{a}</p>
                <Link href={href}>{cta}</Link>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-flow-wrap">
          <h2>From data to decision</h2>
          <div className="lp-flow">
            {FLOW.map(([head, body, tech], i) => (
              <div className="lp-step" key={head}>
                <span className="lp-step-n mono">{i + 1}</span>
                <h3>{head}</h3>
                <p>{body}</p>
                <span className="lp-step-tech mono">{tech}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-inside">
          <h2>What&rsquo;s inside</h2>
          <div className="lp-dir">
            {directory.map((g) => (
              <div className="lp-dir-col" key={g.section}>
                <h3>{g.section}</h3>
                {g.items.map((i) => (
                  <Link href={i.href} key={i.href} className="lp-dir-item">
                    <span className="lp-dir-name">{i.name}</span>
                    <span className="lp-dir-desc">{i.desc}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* The legacy app's footer, verbatim: one line of text, nothing else. The
            methodology note and the updated/record line that used to live here were
            two more things to read at the bottom of a page whose job was already done. */}
        <footer className="lp-foot">
          <span>Fantasy Basketball Simulator &middot; Data via ESPN</span>
        </footer>
      </div>

      {/* ---------------- mobile: the launcher ---------------- */}
      <div className="home-mobile">
        <div className="home-hero">
          <div className="home-eyebrow">
            {leagueName}
            {status && <> &middot; {status}</>}
          </div>
          <h1 className="home-title">Fantasy Basketball Simulator</h1>
          <p className="home-sub">
            Monte Carlo projections and season analytics for your ESPN league. You&rsquo;re
            analyzing <strong>{me.name}</strong>.
          </p>
        </div>
        <div className="home-tiles">
          {tiles.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className="home-tile">
              <Icon size={28} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
