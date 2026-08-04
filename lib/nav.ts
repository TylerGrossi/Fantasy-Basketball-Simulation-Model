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
    /*
     * Named for its SCOPE, which is what actually separates the three header menus:
     * Current Matchup is this week, Tools is your team, League is everyone. Power
     * Rankings moved here from Tools for the same reason — it is a league-wide standing,
     * not something you operate on a player or a roster.
     *
     * Items are spelled out in full — "Season Stats", "League Stats" — so each one names
     * the page it opens rather than relying on the menu for half its meaning. The mild
     * "League > League Stats" repetition is worth it: these are the names used on the
     * pages themselves and everywhere else in the app.
     */
    label: "League",
    items: [
      { label: "Season Stats", href: "/season-stats" },
      { label: "League Stats", href: "/league-stats" },
      { label: "Power Rankings", href: "/rankings" },
    ],
  },
  {
    kind: "menu",
    label: "Tools",
    /*
     * Owner-specified order: Player Card, Player Value, Trade Simulator, Compare,
     * Lineup, Cheat Sheets — roughly most-used first.
     *
     * Draft Guide and Playoff Odds sit after them and are BOTH filtered out by navFor
     * (hidden, and offseason respectively), so neither shows today; they keep their
     * entries so the routes come back into the menu on their own terms rather than
     * needing to be re-added by hand.
     */
    items: [
      { label: "Player Card", href: "/player" },
      { label: "Player Value", href: "/player-value" },
      { label: "Trade Simulator", href: "/trade" },
      { label: "Compare", href: "/compare" },
      { label: "Lineup", href: "/lineup" },
      { label: "Cheat Sheets", href: "/cheat-sheets" },
      { label: "Draft Guide", href: "/draft" },
      { label: "Playoff Odds", href: "/playoffs" },
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
  // Follows the desktop move of Power Rankings out of Tools and into the stats group.
  { label: "Rankings", href: "/rankings" },
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
  { label: "Player Card", href: "/player" },
  { label: "Player Value", href: "/player-value" },
  { label: "Trade", href: "/trade" },
  { label: "Compare", href: "/compare" },
  { label: "Lineup", href: "/lineup" },
  { label: "Cheat Sheets", href: "/cheat-sheets" },
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
  // Opens on Player Card — the first entry of TOOLS_PAGES, so the sub-row's first tab is
  // the one already showing rather than a tab you have to go back to. Keep the two in
  // step if that order changes again.
  { key: "tools", label: "Tools", landing: "/player", pages: TOOLS_PAGES },
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
 * Pages hidden from every menu, at every point in the season. Owner's call, and the only
 * switch you need to touch to put one back — a page listed here is dropped from the
 * desktop dropdowns AND the mobile sub-row AND the offseason promotion below, so it
 * cannot reappear through one of the three while looking hidden in the other two.
 *
 * The ROUTE stays live, exactly as with IN_SEASON_ONLY: /draft still renders for anyone
 * with the link or a bookmark, and `sectionFor` still resolves it to Tools so a direct
 * visit keeps its sub-row. Hidden from the menus, not deleted.
 */
export const HIDDEN_FROM_NAV = ["/draft"];

/**
 * Pages kept out of the MOBILE navigation only — they lay out poorly on a phone and are
 * better read on a wide screen. Desktop keeps them exactly as they are.
 *
 * Same contract as HIDDEN_FROM_NAV: the routes stay live and `sectionFor` still resolves
 * them, so a link or bookmark works on a phone; they just aren't advertised there.
 */
export const HIDDEN_ON_MOBILE = ["/season", "/lineup"];

/**
 * The mirror image of IN_SEASON_ONLY: pages the offseason should lead with rather than
 * hide. The Draft Guide is the only Tools page whose subject is ahead of you instead of
 * behind you, so from April to October it is the reason to open the app — it moves to
 * the front of the Tools row and becomes what the Tools icon opens to. In season it
 * stays where it is, because then the timely page is the one about this week.
 */
const OFFSEASON_FIRST = "/draft";

/**
 * The nav for a given moment in the season: always minus HIDDEN_FROM_NAV, and in the
 * offseason also minus the forecast pages and led by the draft board.
 *
 * `sectionFor` deliberately keeps using the UNFILTERED sections, so a hidden or
 * out-of-season page still resolves to its section when someone opens it directly — the
 * pages are hidden from the menus, not disowned by them.
 */
export function navFor(seasonOver: boolean): { flat: NavEntry[]; sections: Section[] } {
  // HIDDEN_FROM_NAV applies in BOTH branches — an in-season early return that skipped it
  // would put a hidden page back in the menus for half the year.
  const keep = (href: string) =>
    !HIDDEN_FROM_NAV.includes(href) && (seasonOver ? !IN_SEASON_ONLY.includes(href) : true);
  // Offseason-only promotion. Gated on `seasonOver` rather than left to run always: with
  // /draft hidden it happens to be a no-op either way, but un-hiding it later must not
  // silently start reordering the in-season menus too.
  const first = <T extends { href: string }>(pages: T[]): T[] =>
    seasonOver
      ? [
          ...pages.filter((p) => p.href === OFFSEASON_FIRST),
          ...pages.filter((p) => p.href !== OFFSEASON_FIRST),
        ]
      : pages;
  return {
    flat: FLAT_NAV.flatMap<NavEntry>((e) => {
      if (e.kind === "link") return keep(e.href) ? [e] : [];
      const items = e.items.filter((i) => keep(i.href));
      return items.length ? [{ ...e, items: first(items) }] : [];
    }),
    // `sections` drive the MOBILE bottom bar and sub-rows only, so HIDDEN_ON_MOBILE is
    // applied here and nowhere else — the desktop `flat` menus above keep every page.
    sections: SECTIONS.map((s) => {
      const pages = first(
        s.pages.filter((p) => keep(p.href) && !HIDDEN_ON_MOBILE.includes(p.href))
      );
      // The landing has to follow the filter/reorder, or a section icon opens a page that
      // is no longer in the row it just opened — which is what would happen to Season,
      // whose landing was the now-hidden /season.
      const landing =
        s.key === "tools" && pages[0]?.href === OFFSEASON_FIRST
          ? OFFSEASON_FIRST
          : pages.some((p) => p.href === s.landing)
            ? s.landing
            : (pages[0]?.href ?? s.landing);
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
