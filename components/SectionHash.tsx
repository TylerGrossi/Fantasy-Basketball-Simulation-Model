"use client";

import { useEffect } from "react";

/**
 * Gives each section of a long page its own address (owner, 2026-10-30: "the different
 * sections in the current matchup should have their own url endpoints so I can go back
 * to that endpoint").
 *
 * 1. As you scroll, the address bar follows: /scoreboard#streamers while Streamers is the
 *    section at the top of the screen. `replaceState`, not `pushState`, so scrolling does
 *    not bury the previous page under a stack of history entries — and it passes Next's
 *    own `history.state` through untouched, which its router keeps there.
 * 2. Opening /scoreboard#streamers — typed, bookmarked, or coming BACK from a player card
 *    — lands on that section. The browser's own jump happens before the live data has
 *    loaded, and the scoreboard and box scores above grow when it does, pushing the
 *    section off screen; so the jump is repeated as the page settles, until you scroll
 *    yourself.
 *
 * The app scrolls inside `.app-scroll`, not the window (the root layout's shell), so that
 * is what is watched — and it is also why the browser never restored your place on Back:
 * it only restores the WINDOW's scroll position.
 */
/*
 * `offset`: how far down the screen a section's top may sit and still count as the one you
 * are reading. A jump lands a section ~175px down (the sticky header plus `.cm-sec`'s
 * scroll-margin), so this must sit below that, or the address flips straight back to the
 * section above the one you just opened.
 */
export default function SectionHash({ ids, offset = 240 }: { ids: string[]; offset?: number }) {
  useEffect(() => {
    // ---- 2: land on the section in the URL, and stay there while the page settles ----
    const target = decodeURIComponent(window.location.hash.slice(1));
    let userMoved = false;
    const stop = () => (userMoved = true);
    const jumps: Array<ReturnType<typeof setTimeout>> = [];
    if (target && ids.includes(target)) {
      for (const ms of [0, 400, 1200, 2500]) {
        jumps.push(
          setTimeout(() => {
            if (!userMoved) document.getElementById(target)?.scrollIntoView({ block: "start" });
          }, ms)
        );
      }
      window.addEventListener("wheel", stop, { passive: true });
      window.addEventListener("touchmove", stop, { passive: true });
      window.addEventListener("keydown", stop);
    }

    // ---- 1: keep the address on the section you are reading ----
    const scroller: HTMLElement | Window = document.querySelector<HTMLElement>(".app-scroll") ?? window;
    const scrolled = () => (scroller instanceof Window ? scroller.scrollY : scroller.scrollTop);
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let current = "";
        if (scrolled() > 40) {
          for (const id of ids) {
            const el = document.getElementById(id);
            if (el && el.getBoundingClientRect().top <= offset) current = id;
          }
        }
        const want = current ? `#${current}` : "";
        if (want !== window.location.hash) {
          const url = window.location.pathname + window.location.search + want;
          window.history.replaceState(window.history.state, "", url);
        }
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      jumps.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [ids, offset]);

  return null;
}
