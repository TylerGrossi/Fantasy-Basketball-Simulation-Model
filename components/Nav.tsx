"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  WEEK_PAGES,
  isActive,
  navFor,
  sectionFor,
  type NavEntry,
} from "@/lib/nav";
import { ChevronIcon, SECTION_ICONS, SettingsIcon } from "./Icons";

/**
 * Navigation. Desktop and mobile intentionally differ — carried over from the Streamlit
 * app's rule that "a website is not a phone app".
 *
 *  - DESKTOP: one flat header row — brand (= Home), a text link per page, Stats/Tools
 *    dropdowns, and the Settings gear at the right. No icons on the links; icons are a
 *    mobile pattern.
 *  - MOBILE: no top header at all. A fixed bottom icon bar (one per section), a labelled
 *    sub-row for the section's pages, and the This Week rail as a sub-bar at the top.
 *
 * Both are rendered and shown/hidden by CSS breakpoint, so there is no width detection
 * and no flash of the wrong layout.
 *
 * `seasonOver` comes from the export via the layout rather than being read here: the
 * links have to be right in the FIRST paint (a header that drops an item after hydration
 * is a visible shuffle), and this is a client component.
 */
export default function Nav({ seasonOver = false }: { seasonOver?: boolean }) {
  const pathname = usePathname();
  // Keep the chosen week when moving between the This Week pages. Only Scoreboard can
  // render a past week today, but the selection has to survive the click either way.
  const period = useSearchParams().get("period");
  const { flat, sections } = navFor(seasonOver);
  const section = sectionFor(pathname);
  const activeSection = sections.find((s) => s.key === section);
  /*
   * The section's pages, as the mobile sub-row.
   *
   * "week" used to be excluded because This Week had its own rail. That rail no longer
   * renders, which left the five This Week pages with NO navigation between them on a
   * phone: the bottom bar drops you on Scoreboard and Matchup, Streamers, Bench and
   * Roster became unreachable. They use the same sub-row as Season and Tools now —
   * the pattern the app already has, rather than bringing the rail back.
   */
  const subPages =
    activeSection && activeSection.pages.length > 1 ? activeSection.pages : null;

  return (
    <>
      {/* ---------------- desktop header ---------------- */}
      <nav className="nav" aria-label="Main">
        <div className="nav-inner">
          {/*
            The brand lockup, reassembled from its parts: the ball, then "FBBSim" with the
            tagline stacked under it — the artwork's own arrangement.

            The TAGLINE IS TEXT, not part of the image. In the artwork it is 6% of the
            lockup's height, so any scale that fits a 62px header renders it about 2px tall
            — a grey smudge. As text its size is independent of the mark's, so it can be
            set at a readable 12px without the ball having to grow to match.

            Plain <img> rather than next/image: these are fixed-size static assets, and
            routing them through the optimizer would spend Vercel image quota to serve the
            same bytes. Intrinsic dimensions are declared so the row reserves its space on
            the first paint instead of reflowing once the images land.
          */}
          <Link
            href="/"
            className="nav-brand"
            aria-label="FBBSim — Fantasy Basketball Simulator, home"
          >
            <img
              src="/logo-mark.png"
              alt=""
              className="nav-mark"
              width={365}
              height={366}
            />
            <span className="nav-brand-stack">
              <img
                src="/logo-word.png"
                alt=""
                className="nav-word"
                width={577}
                height={126}
              />
              <span className="nav-tagline">Fantasy Basketball Simulator</span>
            </span>
          </Link>
          <div className="nav-links">
            {flat.map((entry) =>
              entry.kind === "link" ? (
                <Link
                  key={entry.href}
                  href={entry.href}
                  className="nav-link"
                  aria-current={isActive(entry, pathname) ? "page" : undefined}
                >
                  {entry.label}
                </Link>
              ) : (
                <NavDropdown key={entry.label} entry={entry} pathname={pathname} period={period} />
              )
            )}
          </div>
          <Link
            href="/settings"
            className="nav-gear"
            aria-label="Settings"
            aria-current={pathname === "/settings" ? "page" : undefined}
          >
            <SettingsIcon size={18} />
          </Link>
        </div>
      </nav>

      {/* Mobile section sub-row (Season / Tools). This Week uses the rail instead. */}
      {subPages && (
        <nav className="sub-row" aria-label={activeSection?.label}>
          {subPages.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="sub-link"
              aria-current={pathname === p.href ? "page" : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      )}

      {/* ---------------- mobile bottom bar ---------------- */}
      <nav className="bottom-nav" aria-label="Sections">
        {sections.map((s) => {
          const Icon = SECTION_ICONS[s.key];
          return (
            <Link
              key={s.key}
              href={s.landing}
              className="bottom-link"
              aria-current={section === s.key ? "page" : undefined}
            >
              <Icon size={28} />
              <span>{s.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/**
 * A header dropdown ("Stats", "Tools"), styled to look like a nav link.
 *
 * The panel is `position: fixed` and told where to go, rather than absolutely
 * positioned against the trigger. It has to be: `.nav-links` is `overflow-x: auto` so a
 * narrow desktop header scrolls sideways instead of wrapping, and a non-visible value on
 * ONE axis makes the other compute to `auto` too — which turned the row into a clipping
 * box 36px tall. The panel opened correctly, reported itself visible, and painted
 * nothing, because it was clipped by an ancestor whose overflow only exists for the
 * horizontal axis. A fixed element's containing block is the viewport, so it escapes
 * that clip without giving up the sideways scroll (nothing between here and the
 * viewport sets transform/filter/will-change, which would have re-trapped it).
 */
function NavDropdown({
  entry,
  pathname,
  period,
}: {
  entry: NavEntry & { kind: "menu" };
  pathname: string;
  period?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const active = isActive(entry, pathname);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (b) setPos({ left: b.left + b.width / 2, top: b.bottom + 9 });
  };

  // Keep it under its trigger if the viewport resizes or the header scrolls sideways.
  // Capture phase, so scrolling of `.nav-links` itself is caught and not just the page.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close on outside click or Escape — a menu you can't dismiss is worse than no menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Any navigation closes it.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="nav-menu" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="nav-link nav-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-current={active ? "page" : undefined}
        // Measured before the panel mounts, so it never paints a frame at the wrong spot.
        onClick={() => {
          if (!open) place();
          setOpen((v) => !v);
        }}
      >
        {entry.label}
        <ChevronIcon size={11} className="nav-chevron" />
      </button>
      {open && pos && (
        <div
          className="nav-menu-panel"
          role="menu"
          style={{ left: pos.left, top: pos.top }}
        >
          {entry.items.map((i) => (
            <Link
              key={i.href}
              href={period && WEEK_PAGES.some((w) => w.href === i.href) ? `${i.href}?period=${period}` : i.href}
              role="menuitem"
              className="nav-menu-item"
              aria-current={pathname === i.href ? "page" : undefined}
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
