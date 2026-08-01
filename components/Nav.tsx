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
import { BasketballMark, ChevronIcon, SECTION_ICONS, SettingsIcon } from "./Icons";

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
  const subPages =
    activeSection && activeSection.pages.length > 1 && section !== "week"
      ? activeSection.pages
      : null;

  return (
    <>
      {/* ---------------- desktop header ---------------- */}
      <nav className="nav" aria-label="Main">
        <div className="nav-inner">
          <Link href="/" className="nav-brand">
            <BasketballMark />
            Fantasy Basketball
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
              <Icon size={20} />
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
