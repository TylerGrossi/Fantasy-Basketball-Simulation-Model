import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Nav from "@/components/Nav";
import { loadLeague } from "@/lib/loadLeague";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantasy Basketball",
  description:
    "Monte Carlo simulation and live category win probability for an ESPN fantasy basketball league.",
  // iOS "Add to Home Screen" reads the label from apple-mobile-web-app-title (NOT <title>,
  // and not the manifest — Safari ignores that for the home-screen name) and the icon from
  // app/apple-icon.png. Android takes both from app/manifest.ts; keep the two in sync.
  appleWebApp: { capable: true, title: "FBB Sim", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F4F3EF",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Only the boolean crosses into the client component — never the league object, which
  // would be serialised into the payload of EVERY page (see trimLeague in loadLeague.ts).
  const { seasonOver } = await loadLeague();
  return (
    <html lang="en">
      <body>
        {/* Nav reads ?period to keep the week selection across This Week links, and
            `useSearchParams` opts a component out of static prerendering unless it sits
            under a Suspense boundary — without this the build fails on /_not-found. */}
        <Suspense>
          <Nav seasonOver={seasonOver} />
        </Suspense>
        {/*
          The DESKTOP scroll container. The header sits outside it, so it spans the whole
          window while this box owns the scrollbar — see `.app-scroll` in globals.css for
          why the scrolling had to move off the viewport to get a full-width header and a
          layout that never shifts at the same time. On mobile this is `display: contents`
          and the document scrolls natively, as before.
        */}
        <div className="app-scroll">
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}
