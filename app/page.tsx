import Link from "next/link";
import { loadLeague, myTeam } from "@/lib/loadLeague";
import { TrophyIcon, ChartIcon, TableIcon, BracketIcon } from "@/components/Icons";

/**
 * Home / landing.
 *
 * Desktop gets the centred hero + four descriptive cards; mobile gets a compact 2-up grid
 * of single-tap tiles sized to fit one phone screen without scrolling. Both are rendered
 * and shown/hidden by breakpoint — no width detection, no flash of the wrong layout.
 *
 * The card set, order, copy and icons match the Streamlit home page deliberately: this is
 * the page the owner compares the migration against.
 */

const CARDS = [
  {
    href: "/season",
    title: "Season Summary",
    short: "Season",
    desc: "Final standings, champion & all-play",
    Icon: TrophyIcon,
  },
  {
    href: "/scoreboard",
    title: "Current Matchup",
    short: "This Week",
    desc: "Weekly matchup, win % & category sims",
    Icon: ChartIcon,
  },
  {
    href: "/league-stats",
    title: "League Stats",
    short: "League",
    desc: "Team records & category totals",
    Icon: TableIcon,
  },
];

/**
 * The fourth card is seasonal. While a season is running it is Playoff Odds — the
 * question everyone is actually asking. In the offseason that page is hidden from the
 * nav (see IN_SEASON_ONLY), so linking it here would be the one dead end on the landing
 * page; Power Rankings takes the slot instead, which keeps the grid at four and the
 * 2-up phone tiles square.
 */
const PLAYOFF_CARD = {
  href: "/playoffs",
  title: "Playoff Odds",
  short: "Playoffs",
  desc: "Championship probabilities",
  Icon: BracketIcon,
};

const RANKINGS_CARD = {
  href: "/rankings",
  title: "Power Rankings",
  short: "Rankings",
  desc: "All-play strength & weekly movement",
  Icon: BracketIcon,
};

export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const standing = league.seasonData?.standings?.find((s) => s.teamId === me.id);
  const yr = `${league.season - 1}–${String(league.season).slice(2)}`;
  const leagueName = league.leagueName?.trim() || "Your League";
  const status = league.seasonOver ? "Season complete" : "Season in progress";
  const cards = [...CARDS, league.seasonOver ? RANKINGS_CARD : PLAYOFF_CARD];

  return (
    <>
      {/* ---------------- desktop ---------------- */}
      <div className="home-desktop">
        <div className="home-hero">
          <div className="home-eyebrow">
            {leagueName} &middot; {status}
          </div>
          <h1 className="home-title">Fantasy Basketball Simulator</h1>
          <p className="home-sub">
            Monte Carlo projections and season analytics for your ESPN league. You&rsquo;re
            analyzing <strong>{me.name}</strong>.
          </p>
        </div>
        <div className="home-cards">
          {cards.map(({ href, title, desc, Icon }) => (
            /* The whole cell is the link — the visible "Open" button is the affordance the
               Streamlit page had, but the card above it is clickable too. */
            <Link key={href} href={href} className="home-cell">
              <span className="home-card">
                <span className="home-card-icon">
                  <Icon size={34} />
                </span>
                <span className="home-card-title">{title}</span>
                <span className="home-card-desc">{desc}</span>
              </span>
              <span className="home-card-open">Open</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ---------------- mobile ---------------- */}
      <div className="home-mobile">
        <div className="home-hero">
          <div className="home-eyebrow">
            {leagueName} &middot; {status}
          </div>
          <h1 className="home-title">{me.name}</h1>
          <p className="home-sub">
            {standing ? `${standing.wins}-${standing.losses}-${standing.ties} · ` : ""}
            {yr} {league.seasonOver ? "complete" : `· matchup ${league.period}`}
          </p>
        </div>
        <div className="home-tiles">
          {cards.map(({ href, short, Icon }) => (
            <Link key={href} href={href} className="home-tile">
              <Icon size={24} />
              <span>{short}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
