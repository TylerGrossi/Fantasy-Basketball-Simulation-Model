/**
 * Navigation structure — one definition, used by both the desktop header and the mobile
 * bottom bar.
 *
 * Mirrors the Streamlit app's FLAT_NAV / NAV_SECTIONS. Desktop and mobile deliberately
 * differ ("a website is not a phone app"), and the groupings differ too — on mobile
 * Schedule and History sit in the Season row, while on desktop Schedule is inside the
 * League menu and History is a header tab of its own. That divergence is intentional,
 * carried over from the original.
 *
 * The desktop header reads: Season Summary · Current Matchup · League · Tools · History ·
 * Agent, then the Settings gear (rendered separately in Nav.tsx, not from this list).
 *
 * MOBILE IS INDEX-AND-DRILL. The bottom icons for This Week, Season and Tools do not open
 * a page — they open that section's INDEX (`/browse/<key>`), a list where every row names
 * a page, says what it answers, and carries the number you would have opened it for. A
 * page then opens with a back row to its index.
 *
 * That replaced a fixed top strip of text links which scrolled sideways: it held twelve
 * items on Season and showed about five, so History's last three pages were unreachable
 * without a swipe nothing prompted. The strip is gone, not shrunk — see `.crumb` and
 * `.idx` in globals.css, and SectionIndex.tsx.
 *
 * Home and Agent keep their old behaviour: Home is already a launcher and Agent is a
 * single page, so neither has anything to index.
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

/**
 * A page as the mobile index lists it.
 *
 * `blurb` is what the row answers, in a few words — the index has room for it and the old
 * strip did not, which is why "Season Stats" and "League Stats" used to be tellable apart
 * only by opening them. Kept short enough to sit on one line at 390px.
 *
 * `group` puts the row under a sub-heading. It is what let History's labels go back to
 * "Players" and "Managers": the group says which section they belong to, so the label
 * doesn't have to carry a "History: " prefix any more.
 */
export interface NavPage {
  label: string;
  href: string;
  blurb?: string;
  group?: string;
}

/** Pages reached from the "This Week" menu. */
export const WEEK_PAGES: NavPage[] = [
  { label: "Scoreboard", href: "/scoreboard", blurb: "Category totals, live from ESPN" },
  { label: "Matchup", href: "/matchup", blurb: "Win probability and the model behind it" },
  { label: "Streamers", href: "/streamers", blurb: "Every pickup scored against this week" },
  { label: "Bench", href: "/bench", blurb: "Who to play, and what sitting costs" },
  { label: "Roster", href: "/roster", blurb: "Your players, games left, averages" },
];


/**
 * The History section. `/history` leads and carries the career totals, so the menu's first
 * item is the page you land on rather than one you have to come back to.
 *
 * Labels are BARE here and prefixed only where the context needs it (see SEASON_PAGES,
 * which used to prefix all five and now sets `group` instead).
 */
export const HISTORY_PAGES: NavPage[] = [
  { label: "Seasons", href: "/history", blurb: "Every season you have played" },
  { label: "Players", href: "/history/players", blurb: "Career totals, all leagues" },
  { label: "Head to Head", href: "/history/head-to-head", blurb: "Your record against each manager" },
  { label: "Managers", href: "/history/managers", blurb: "All-time by manager" },
  { label: "Matchups", href: "/history/matchups", blurb: "Every week ever played" },
];

/** Desktop header: brand, then these, then the Settings gear. */
export const FLAT_NAV: NavEntry[] = [
  { kind: "link", label: "Season Summary", href: "/season" },
  {
    kind: "menu",
    label: "Current Matchup",
    items: WEEK_PAGES.map((p) => ({ label: p.label, href: p.href })),
  },
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
      // Schedule leads: it is the page you open to ask "what happened / what's next",
      // which is a more common question than any of the stat tables under it. It used to
      // be a top-level header link and moved here to make room for History.
      { label: "Schedule", href: "/schedule" },
      { label: "Season Stats", href: "/season-stats" },
      { label: "League Stats", href: "/league-stats" },
      { label: "Power Rankings", href: "/rankings" },
      { label: "Rosters", href: "/league-rosters" },
      { label: "Recent Moves", href: "/recent-moves" },
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
  {
    kind: "menu",
    /*
     * Its own menu rather than an item under League: League means "everyone, this
     * season", and History is the opposite on both counts — one manager, every season,
     * across every league they have ever played in.
     *
     * Split into pages rather than one long one because the five tables answer different
     * questions; the player table alone is ~200 rows, and stacked together everything
     * below the first was scrolled past rather than read.
     */
    label: "History",
    items: HISTORY_PAGES,
  },
  // Agent is a top-level header tab on desktop but lives under Tools on mobile — the
  // same split the Streamlit app used. It is the one page you go to with a question
  // rather than a page you browse, so it earns the header slot on a wide screen.
  { kind: "link", label: "Agent", href: "/agent" },
];

/**
 * The Season index, in two groups.
 *
 * The History five used to be prefixed ("History: Head to Head") because they sat in a
 * flat strip that had no way to say where they came from. The index groups instead, so
 * they get their own names back — the sub-heading carries the meaning the prefix was
 * standing in for, and the labels stop being the longest thing on the screen.
 */
export const SEASON_PAGES: NavPage[] = [
  // Schedule leads, matching the desktop League menu where it leads for the same reason:
  // "what happened / what's next" is a more common question than any stat table under it.
  { label: "Schedule", href: "/schedule", blurb: "Week by week results" },
  { label: "Summary", href: "/season", blurb: "Standings, champion, schedule luck" },
  { label: "Season Stats", href: "/season-stats", blurb: "Category leaders and every player's line" },
  { label: "League Stats", href: "/league-stats", blurb: "Every team's totals and where they rank" },
  // Follows the desktop move of Power Rankings out of Tools and into the stats group.
  { label: "Rankings", href: "/rankings", blurb: "All-play strength and form" },
  // No longer promises "how they got it": the Acq column is hidden on a phone, which is
  // where this blurb is read.
  { label: "Rosters", href: "/league-rosters", blurb: "Every team's roster" },
  { label: "Recent Moves", href: "/recent-moves", blurb: "Adds, drops and trades, newest first" },
];

/**
 * The Tools index, in owner-specified order. Lineup and Playoff Odds weren't in that
 * ordering, so they keep the tail; Playoff Odds is dropped entirely in the offseason by
 * navFor. Agent is not here — it earns its own bottom-bar icon (see SECTIONS) — and
 * Settings lives on the Home tile grid instead.
 */
export const TOOLS_PAGES: NavPage[] = [
  { label: "Player Card", href: "/player", blurb: "Profile, value, form, last ten games" },
  { label: "Player Value", href: "/player-value", blurb: "Rostered and free agents by 9-cat value" },
  { label: "Trade", href: "/trade", blurb: "What a deal does to each category" },
  { label: "Compare", href: "/compare", blurb: "Two players side by side" },
  { label: "Lineup", href: "/lineup", blurb: "Who to start, and what each swap costs" },
  { label: "Cheat Sheets", href: "/cheat-sheets", blurb: "Ranked columns per position" },
  { label: "Draft", href: "/draft", blurb: "The board, by projected value" },
  { label: "Playoff Odds", href: "/playoffs", blurb: "Championship odds from a simulated bracket" },
];

/**
 * The MORE section: the three things that are not "this week", "the season" or "a tool".
 *
 * History moved here out of Season, where it never belonged — Season means *this* season
 * and everyone in it, History means one manager across every season and every league they
 * have played in. They were only together because Season had the spare room.
 *
 * Agent and Settings join it because neither justifies a fifth bottom-bar slot on its own:
 * Agent is one page and Settings is visited rarely, and between them they left the fifth
 * icon doing less work than any of the other four.
 */
export const MORE_PAGES: NavPage[] = [
  { label: "Agent", href: "/agent", blurb: "Ask about the league in plain English" },
  { label: "Settings", href: "/settings", blurb: "Your team, protected players, display" },
  ...HISTORY_PAGES.map((p) => ({ ...p, group: "History" })),
];

export type SectionKey = "home" | "week" | "season" | "tools" | "more";

/**
 * Sections that open an INDEX rather than a page on mobile — the three with more than one
 * page to their name. `/browse/[section]` renders them all; see app/browse.
 *
 * Home is deliberately absent: it already IS an index (the tile grid), so an index in
 * front of it would be a screen you tap through to reach another screen of links.
 */
export const INDEXED_SECTIONS = ["week", "season", "tools", "more"] as const;
export type IndexedSection = (typeof INDEXED_SECTIONS)[number];

export function indexHref(key: SectionKey): string {
  return `/browse/${key}`;
}

export function isIndexed(key: SectionKey): key is IndexedSection {
  return (INDEXED_SECTIONS as readonly string[]).includes(key);
}

export interface Section {
  key: SectionKey;
  label: string;
  /**
   * Where the section's icon navigates to. For the three indexed sections this is their
   * index, NOT a page — that is the whole of the index-and-drill change at this level.
   */
  landing: string;
  pages: NavPage[];
}

/** Mobile bottom bar: one icon per section. */
export const SECTIONS: Section[] = [
  { key: "home", label: "Home", landing: "/", pages: [{ label: "Home", href: "/" }] },
  /*
   * The three indexed sections open their index, not a page. Each used to land on a
   * chosen "first" page (Scoreboard, Season Summary, Player Card) with the rest of the
   * section in a strip above it; the index shows all of them at once instead, so there
   * is no first page to choose and no strip to keep in step with it.
   */
  { key: "week", label: "This Week", landing: indexHref("week"), pages: WEEK_PAGES },
  { key: "season", label: "Season", landing: indexHref("season"), pages: SEASON_PAGES },
  { key: "tools", label: "Tools", landing: indexHref("tools"), pages: TOOLS_PAGES },
  // The fifth icon is MORE: Agent, Settings and the five History pages. It used to be
  // Agent alone, which spent a permanent slot on a single page.
  { key: "more", label: "More", landing: indexHref("more"), pages: MORE_PAGES },
];

/**
 * Pages that only make sense while a season is being played. All three answer a question
 * about GAMES STILL TO COME, and once the last one is played the question is gone:
 *
 *   - **Playoff Odds** is a forecast, and there is nothing left to forecast. A standing
 *     link to coin-flip probabilities about a finished tournament invites exactly the
 *     misreading that page's own banner has to argue against.
 *   - **Streamers** ranks pickups by what they add over the rest of the week. With no
 *     games left every candidate adds exactly zero, so the page ranks nothing.
 *   - **Bench** decides who to start. There is nothing to start.
 *
 * These are not broken in the offseason — they are correct and empty, which is worse,
 * because an empty page reads as a bug rather than as an answer.
 *
 * The routes stay reachable (bookmarks, a direct link); they just leave the menus, and
 * they come back on their own the moment `seasonOver` flips.
 *
 * The Streamlit app conditions its nav the same way in the other direction —
 * `render_top_nav` drops "Season Summary" from FLAT_NAV until the season is over.
 */
export const IN_SEASON_ONLY = ["/playoffs", "/streamers", "/bench"];

/**
 * Pages hidden from every menu, at every point in the season. Owner's call, and the only
 * switch you need to touch to put one back — a page listed here is dropped from the
 * desktop dropdowns AND the mobile sub-row AND the offseason promotion below, so it
 * cannot reappear through one of the three while looking hidden in the other two.
 *
 * The ROUTE stays live, exactly as with IN_SEASON_ONLY: a page here still renders for
 * anyone with the link or a bookmark, and `sectionFor` still resolves it to its section
 * so a direct visit keeps its sub-row. Hidden from the menus, not deleted.
 *
 * /draft is hidden again: the projection model behind it is mid-rebuild and still ranks
 * players wrongly enough that the board would mislead (see the note in lib/projection.ts).
 * The route stays live to work on.
 */
export const HIDDEN_FROM_NAV = ["/draft"];

/**
 * Pages kept out of the MOBILE navigation only — they lay out poorly on a phone and are
 * better read on a wide screen. Desktop keeps them exactly as they are.
 *
 * Same contract as HIDDEN_FROM_NAV: the routes stay live and `sectionFor` still resolves
 * them, so a link or bookmark works on a phone; they just aren't advertised there.
 *
 * /season came OFF this list: Season Summary is back in the mobile Season index. Only the
 * Lineup board is still desktop-only, and that one is a drag-and-drop surface rather than
 * a layout problem.
 */
export const HIDDEN_ON_MOBILE = ["/lineup"];

/**
 * The mirror image of IN_SEASON_ONLY: pages the offseason should lead with rather than
 * hide. The Draft Guide is the only Tools page whose subject is ahead of you instead of
 * behind you, so from April to October it is the reason to open the app — it moves to
 * the front of the Tools menu. In season it stays where it is, because then the timely
 * page is the one about this week.
 *
 * DESKTOP ONLY in practice, since /draft is in HIDDEN_ON_MOBILE: the promotion runs over
 * whatever survived filtering, and on mobile the draft board is already gone by then. On
 * mobile it only ever decides the ORDER of the Tools index now — the section's landing is
 * the index itself, so an un-hidden draft board would lead the list rather than replace
 * the screen the Tools icon opens.
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
    // `sections` drive the MOBILE bottom bar and the indexes only, so HIDDEN_ON_MOBILE is
    // applied here and nowhere else — the desktop `flat` menus above keep every page.
    sections: SECTIONS.map((s) => {
      const pages = first(
        s.pages.filter((p) => keep(p.href) && !HIDDEN_ON_MOBILE.includes(p.href))
      );
      /*
       * An indexed section's landing is its INDEX, which exists whatever survives the
       * filter — so the rule that used to chase the first surviving page (and get it
       * wrong for Season, whose /season landing is hidden on mobile) is gone. `first()`
       * still runs, because it decides the ORDER the index lists them in.
       */
      const landing = isIndexed(s.key)
        ? indexHref(s.key)
        : pages.some((p) => p.href === s.landing)
          ? s.landing
          : (pages[0]?.href ?? s.landing);
      return { ...s, pages, landing };
    }),
  };
}

/**
 * Which section owns a path (defaults to home).
 *
 * Uses the UNFILTERED sections on purpose: a hidden or out-of-season page opened directly
 * still resolves to its section, so its back row points somewhere real.
 */
export function sectionFor(pathname: string): SectionKey {
  // An index belongs to its own section — otherwise /browse/season resolves to "home"
  // and the Season icon fails to light up on the screen it just opened.
  const indexed = INDEXED_SECTIONS.find((k) => pathname === indexHref(k));
  if (indexed) return indexed;
  for (const s of SECTIONS) {
    if (s.key === "home") continue;
    if (s.pages.some((p) => p.href === pathname)) return s.key;
  }
  return "home";
}

/**
 * The name of the page at `pathname`, for the mobile back row.
 *
 * Read from the unfiltered SECTIONS for the same reason `sectionFor` is: a page reached
 * by link or bookmark while hidden from the menus still has a name, and a back row that
 * silently rendered without one would look like a bug on exactly those pages.
 */
export function pageLabelFor(pathname: string): string | null {
  for (const s of SECTIONS) {
    const hit = s.pages.find((p) => p.href === pathname);
    if (hit) return hit.label;
  }
  return null;
}

/**
 * A name for ANY in-app path, for the "back to where you were" row.
 *
 * Falls through page names, then the section indexes, then Home — so a back row always has
 * something to say. Returns null only for a path this nav has never heard of, and the
 * caller then falls back to the section index rather than printing a bare chevron.
 */
export function labelForPath(pathname: string): string | null {
  const page = pageLabelFor(pathname);
  if (page) return page;
  const indexed = INDEXED_SECTIONS.find((k) => pathname === indexHref(k));
  if (indexed) return SECTIONS.find((s) => s.key === indexed)?.label ?? null;
  if (pathname === "/") return "Home";
  return null;
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
