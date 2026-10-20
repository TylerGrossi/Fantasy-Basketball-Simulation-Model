"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A thin bar across the top that starts THE MOMENT an internal link is clicked and
 * finishes when the new page arrives.
 *
 * app/loading.tsx covers the wait once Next has the route's shell, but it can't help
 * before that: in `next dev` nothing is prefetched, so a click first waits on the server
 * (and on compiling the route), and without this the screen didn't react at all — it
 * read as a missed click. This runs purely in the browser off the click itself, so it
 * shows in dev and production alike.
 */
export default function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);

  // The new page has rendered: finish.
  useEffect(() => setPending(false), [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab/window
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      // Same page (or just a #hash): no navigation will happen to end the bar.
      if (url.pathname === location.pathname && url.search === location.search) return;
      setPending(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return pending ? <div className="nav-progress" aria-hidden="true" /> : null;
}
