"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  WEEK_PAGES,
  indexHref,
  isActive,
  isIndexed,
  labelForPath,
  navFor,
  pageLabelFor,
  sectionFor,
  type NavEntry,
  type SectionKey,
} from "@/lib/nav";
import { ChevronIcon, ChevronLeftIcon, SECTION_ICONS, SettingsIcon } from "./Icons";

/**
 * Navigation. Desktop and mobile intentionally differ — carried over from the Streamlit
 * app's rule that "a website is not a phone app".
 *
 *  - DESKTOP: one flat header row — brand (= Home), a text link per page, Stats/Tools
 *    dropdowns, and the Settings gear at the right. No icons on the links; icons are a
 *    mobile pattern.
 *  - MOBILE: no top header. A fixed bottom icon bar (one per section), and INDEX-AND-DRILL
 *    above it — This Week / Season / Tools open a contents screen (`/browse/<key>`,
 *    SectionIndex.tsx) and a page opens from there under a back row naming its index.
 *
 * The back row REPLACED a fixed strip of text links that scrolled sideways. On Season it
 * carried twelve items and showed about five, so History's last three pages could only be
 * reached by a swipe with no cue that there was anything to swipe to. It also cost 56px
 * of every screen on every page in the section, and changed length between sections, so
 * the top of the screen never became a landmark. The index shows all twelve at once, with
 * a figure on each; the back row costs 40px and only appears one level down.
 *
 * Both layouts are rendered and shown/hidden by CSS breakpoint, so there is no width
 * detection and no flash of the wrong layout.
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
   * The mobile back row: shown one level DOWN from an index, never on the index itself
   * and never in Home or Agent, which have none.
   *
   * The label comes from the unfiltered lookup in lib/nav.ts, so a page that is hidden
   * from the menus (a bookmark to /playoffs in the offseason, /lineup on a phone) still
   * gets a named back row rather than a bare chevron.
   */
  const onIndex = isIndexed(section) && pathname === indexHref(section);
  /*
   * WHERE YOU CAME FROM, so back means back.
   *
   * The row used to always point at the section index, which is right when you drilled in
   * from there and wrong the moment you didn't: tapping a player in the Season Stats table
   * opens the Player Card, which lives in Tools, and "back" then threw you into the Tools
   * index — a screen you had never seen, with no way to return to the table you were
   * reading. Player names are linked from a dozen tables, so this was the common path.
   *
   * Recorded in an effect rather than read from history, because the browser's history
   * entry cannot tell us the LABEL, and a back row that says where it goes is the whole
   * point. On a cold load (a shared link, a refresh) there is no previous page and it
   * falls back to the section index, which is the right answer when nothing preceded it.
   */
  const prevRef = useRef<string | null>(null);
  const stackRef = useRef<string[]>([]);
  const [prev, setPrev] = useState<{ href: string; label: string } | null>(null);
  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = pathname;
    if (!from || from === pathname) return;
    /*
     * A STACK, not just "the last page" — that was a loop.
     *
     * Remembering only where you came from is symmetric, so Compare → Player Card set
     * back to Compare, and following it set back to the Player Card: the two pages
     * pointed at each other and there was no way out of the pair. Popping on a return
     * makes going back UNWIND, so Compare → Player Card → back lands on Compare with the
     * stack empty again, and the next back falls through to the section index.
     */
    const stack = stackRef.current;
    if (stack.length && stack[stack.length - 1] === pathname) stack.pop();
    else stack.push(from);

    const top = stack[stack.length - 1];
    const label = top ? labelForPath(top) : null;
    setPrev(top && label ? { href: top, label } : null);
  }, [pathname]);

  /*
   * WHERE YOU LEFT EACH TAB.
   *
   * Switching to Tools, reading a player card, then going to Season and back to Tools
   * dropped you on the Tools index again — the app forgot the screen you were on the
   * moment you glanced at something else. Each section now remembers its last page, so a
   * tab returns you to it, the way every native tab bar behaves.
   *
   * Tapping the tab you are ALREADY on still goes to its index. That is the escape hatch:
   * without it there would be no way back to the index from a page four taps deep, since
   * the tab would just re-open the page you are looking at.
   *
   * State, not a ref, because the bar's hrefs have to re-render when it changes — a ref
   * would keep pointing at wherever you were when the bar last painted. Deliberately NOT
   * persisted: on a cold load every tab opens on its index, which is the right default
   * for a session that has no history yet.
   */
  const [lastSeen, setLastSeen] = useState<Partial<Record<SectionKey, string>>>({});
  useEffect(() => {
    setLastSeen((prev) => (prev[section] === pathname ? prev : { ...prev, [section]: pathname }));
  }, [pathname, section]);

  const back =
    isIndexed(section) && !onIndex && activeSection
      ? {
          href: prev?.href ?? indexHref(section),
          label: prev?.label ?? activeSection.label,
          here: pageLabelFor(pathname),
        }
      : null;

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

      {/*
        Mobile back row. Sticky rather than fixed: it has to stay reachable on a long
        page, but it is part of the document, so it takes its 40px out of the flow once
        instead of being an offset every page's padding has to be told about — which is
        exactly the coupling the old fixed sub-row created (`body:has(.sub-row) .page`).
      */}
      {back && (
        <nav className="crumb" aria-label="Back">
          <Link href={back.href} className="crumb-back">
            <ChevronLeftIcon size={13} />
            {back.label}
          </Link>
          {back.here && <span className="crumb-here">{back.here}</span>}
        </nav>
      )}

      {/* ---------------- mobile bottom bar ---------------- */}
      <nav className="bottom-nav" aria-label="Sections">
        {sections.map((s) => {
          const Icon = SECTION_ICONS[s.key];
          // The tab you are on resets to its index; every other tab resumes.
          const href = s.key === section ? s.landing : (lastSeen[s.key] ?? s.landing);
          return (
            <Link
              key={s.key}
              href={href}
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
