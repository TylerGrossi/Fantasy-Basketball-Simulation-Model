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
      { label: "Player Card", href: "/player" },
      { label: "Player Value", href: "/player-value" },
      { label: "Compare", href: "/compare" },
      { label: "Power Rankings", href: "/rankings" },
      { label: "Playoff Odds", href: "/playoffs" },
      { label: "Trade Simulator", href: "/trade" },
    ],
  },
];

export const SEASON_PAGES = [
  { label: "Summary", href: "/season" },
  { label: "Season Stats", href: "/season-stats" },
  { label: "League Stats", href: "/league-stats" },
  { label: "Schedule", href: "/schedule" },
];

export const TOOLS_PAGES = [
  { label: "Player Card", href: "/player" },
  { label: "Player Value", href: "/player-value" },
  { label: "Compare", href: "/compare" },
  { label: "Rankings", href: "/rankings" },
  { label: "Playoff Odds", href: "/playoffs" },
  { label: "Trade", href: "/trade" },
];

export type SectionKey = "home" | "week" | "season" | "tools" | "settings";

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
  { key: "tools", label: "Tools", landing: "/player-value", pages: TOOLS_PAGES },
  {
    key: "settings",
    label: "Settings",
    landing: "/settings",
    pages: [{ label: "Settings", href: "/settings" }],
  },
];

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
