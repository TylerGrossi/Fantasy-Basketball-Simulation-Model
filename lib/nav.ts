/**
 * Navigation structure — one definition, used by both the desktop header and the mobile
 * bottom bar.
 *
 * Mirrors the Streamlit app's FLAT_NAV / NAV_SECTIONS. Desktop and mobile deliberately
 * differ ("a website is not a phone app"), and the groupings differ too — on mobile
 * Schedule lives under Season and Playoff Odds under Tools, while on desktop Schedule is
 * a top-level link and Playoff Odds sits in the Tools dropdown. That divergence is
 * intentional, carried over from the original.
 */

export interface NavLink {
  kind: "link";
  label: string;
  href: string;
}

export interface NavMenu {
  kind: "menu";
  label: string;
  items: Array<{ label: string; href: string }>;
}

export type NavEntry = NavLink | NavMenu;

/** Pages reached from the "This Week" menu. */
export const WEEK_PAGES = [
  { label: "Scoreboard", href: "/scoreboard" },
  { label: "Matchup", href: "/matchup" },
  { label: "Streamers", href: "/streamers" },
  { label: "Bench", href: "/bench" },
  { label: "Roster", href: "/roster" },
];


/** Desktop header: brand, then these, then the Settings gear. */
export const FLAT_NAV: NavEntry[] = [
  { kind: "link", label: "Season Summary", href: "/season" },
  {
    kind: "menu",
    label: "Current Matchup",
    items: WEEK_PAGES.map((p) => ({ label: p.label, href: p.href })),
  },
  { kind: "link", label: "Schedule", href: "/schedule" },
  {
    kind: "menu",
    label: "Stats",
    items: [
      { label: "Season", href: "/season-stats" },
      { label: "League", href: "/league-stats" },
    ],
  },
  {
    kind: "menu",
    label: "Tools",
    items: [
      { label: "Draft Guide", href: "/draft" },
      { label: "Lineup", href: "/lineup" },
      { label: "Player Card", href: "/player" },
      { label: "Player Value", href: "/player-value" },
      { label: "Compare", href: "/compare" },
      { label: "Power Rankings", href: "/rankings" },
      { label: "Playoff Odds", href: "/playoffs" },
      { label: "Trade Simulator", href: "/trade" },
    ],
  },
  // Agent is a top-level header tab on desktop but lives under Tools on mobile — the
  // same split the Streamlit app used. It is the one page you go to with a question
  // rather than a page you browse, so it earns the header slot on a wide screen.
  { kind: "link", label: "Agent", href: "/agent" },
];

export const SEASON_PAGES = [
  { label: "Summary", href: "/season" },
  { label: "Season Stats", href: "/season-stats" },
  { label: "League Stats", href: "/league-stats" },
  { label: "Schedule", href: "/schedule" },
];

/**
 * Mobile Tools sub-row, in owner-specified order. The FIRST entry is what the Tools icon
 * opens to (see SECTIONS below) — keep `landing` pointing at it. Lineup and Playoff Odds
 * weren't in that ordering, so they keep the tail; Playoff Odds is dropped entirely in the
 * offseason by navFor. Agent used to lead this row, but it earns its own bottom-bar icon
 * now (see SECTIONS) — Settings lives on the Home tile grid instead of here.
 */
export const TOOLS_PAGES = [
  { label: "Player Value", href: "/player-value" },
  { label: "Trade", href: "/trade" },
  { label: "Player Card", href: "/player" },
  { label: "Compare", href: "/compare" },
  { label: "Rankings", href: "/rankings" },
  { label: "Lineup", href: "/lineup" },
  { label: "Draft", href: "/draft" },
  { label: "Playoff Odds", href: "/playoffs" },
];

export type SectionKey = "home" | "week" | "season" | "tools" | "agent";

export interface Section {
  key: SectionKey;
  label: string;
  /** Where the section's icon navigates to. */
  landing: string;
  pages: Array<{ label: string; href: string }>;
}

/** Mobile bottom bar: one icon per section. */
export const SECTIONS: Section[] = [
  { key: "home", label: "Home", landing: "/", pages: [{ label: "Home", href: "/" }] },
  // This Week opens on the Scoreboard — the fast "current numbers" view.
  { key: "week", label: "This Week", landing: "/scoreboard", pages: WEEK_PAGES },
  { key: "season", label: "Season", landing: "/season", pages: SEASON_PAGES },
  // Opens on Player Value — the first entry of TOOLS_PAGES, so the sub-row's first tab is
  // the one already showing rather than a tab you have to go back to.
  { key: "tools", label: "Tools", landing: "/player-value", pages: TOOLS_PAGES },
  // Agent gets the 5th icon rather than sharing a row with Tools or Settings — it's the
  // page you go to with a question, not one you browse to among others. Settings, which
  // used to hold this slot, moved to a tile on the Home launcher instead (app/page.tsx).
  { key: "agent", label: "Agent", landing: "/agent", pages: [{ label: "Agent", href: "/agent" }] },
];

/**
 * Pages that only make sense while a season is being played. Playoff Odds is a
 * FORECAST — once the bracket is decided there is nothing left to forecast, and a
 * standing link to a page of coin-flip probabilities about a finished tournament invites
 * exactly the misreading that page's own banner has to argue against. The route stays
 * reachable (bookmarks, a link from Season Summary); it just leaves the menus.
 *
 * The Streamlit app conditions its nav the same way in the other direction —
 * `render_top_nav` drops "Season Summary" from FLAT_NAV until the season is over.
 */
export const IN_SEASON_ONLY = ["/playoffs"];

/**
 * The mirror image of IN_SEASON_ONLY: pages the offseason should lead with rather than
 * hide. The Draft Guide is the only Tools page whose subject is ahead of you instead of
 * behind you, so from April to October it is the reason to open the app — it moves to
 * the front of the Tools row and becomes what the Tools icon opens to. In season it
 * stays where it is, because then the timely page is the one about this week.
 */
const OFFSEASON_FIRST = "/draft";

/**
 * The nav for a given moment in the season: in the offseason, minus the forecast pages
 * and led by the draft board.
 *
 * `sectionFor` deliberately keeps using the UNFILTERED sections, so /playoffs still
 * resolves to Tools when someone opens it directly in the offseason — the page is hidden
 * from the menus, not disowned by them.
 */
export function navFor(seasonOver: boolean): { flat: NavEntry[]; sections: Section[] } {
  if (!seasonOver) return { flat: FLAT_NAV, sections: SECTIONS };
  const keep = (href: string) => !IN_SEASON_ONLY.includes(href);
  const first = <T extends { href: string }>(pages: T[]): T[] => [
    ...pages.filter((p) => p.href === OFFSEASON_FIRST),
    ...pages.filter((p) => p.href !== OFFSEASON_FIRST),
  ];
  return {
    flat: FLAT_NAV.flatMap<NavEntry>((e) => {
      if (e.kind === "link") return keep(e.href) ? [e] : [];
      const items = e.items.filter((i) => keep(i.href));
      return items.length ? [{ ...e, items: first(items) }] : [];
    }),
    sections: SECTIONS.map((s) => {
      const pages = first(s.pages.filter((p) => keep(p.href)));
      // The landing has to follow the reorder, or the Tools icon opens a page that is no
      // longer the first tab in the row it just opened.
      const landing =
        s.key === "tools" && pages[0]?.href === OFFSEASON_FIRST ? OFFSEASON_FIRST : s.landing;
      return { ...s, pages, landing };
    }),
  };
}

/** Which section owns a path (defaults to home). */
export function sectionFor(pathname: string): SectionKey {
  for (const s of SECTIONS) {
    if (s.key === "home") continue;
    if (s.pages.some((p) => p.href === pathname)) return s.key;
  }
  return "home";
}

/** True when a desktop nav entry should show as active. */
export function isActive(entry: NavEntry, pathname: string): boolean {
  if (entry.kind === "link") {
    // "Current Matchup" stays lit for ANY This Week page, not just the one it opens.
    if (entry.href === "/scoreboard") {
      return WEEK_PAGES.some((p) => p.href === pathname);
    }
    return entry.href === pathname;
  }
  return entry.items.some((i) => i.href === pathname);
}
