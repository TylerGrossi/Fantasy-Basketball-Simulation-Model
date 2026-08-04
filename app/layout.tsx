import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Nav from "@/components/Nav";
import { loadLeague } from "@/lib/loadLeague";
import "./globals.css";

const DESCRIPTION =
  "Monte Carlo simulation and live category win probability for an ESPN fantasy basketball league.";

/**
 * Where the site lives, for the ABSOLUTE urls a link preview needs — a relative
 * `/og.png` is not something Slack or iMessage can fetch, so Next needs a base to
 * resolve it against.
 *
 * Read from Vercel's build environment rather than hardcoded: the production domain
 * isn't recorded anywhere in this repo, and a wrong literal fails silently as a preview
 * with no image. `VERCEL_PROJECT_PRODUCTION_URL` is the stable production domain;
 * `VERCEL_URL` is the per-deployment one, so previews of a branch point at themselves.
 * Neither exists locally, where localhost is the right answer anyway.
 */
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // The browser tab. Spelled the way the logo does — one word, no space — so the tab, the
  // header lockup and the home-screen label all say the same name.
  title: "FBBSim",
  description: DESCRIPTION,
  // iOS "Add to Home Screen" reads the label from apple-mobile-web-app-title (NOT <title>,
  // and not the manifest — Safari ignores that for the home-screen name) and the icon from
  // app/apple-icon.png. Android takes both from app/manifest.ts; keep the two in sync.
  appleWebApp: { capable: true, title: "FBBSim", statusBarStyle: "default" },
  // What a shared link looks like in iMessage, Slack, WhatsApp, Discord, LinkedIn.
  // Without these a share is a bare url with no card at all.
  openGraph: {
    type: "website",
    siteName: "FBBSim",
    title: "FBBSim — Fantasy Basketball Simulator",
    description: DESCRIPTION,
    url: siteUrl,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "FBBSim — Fantasy Basketball Simulator",
      },
    ],
  },
  // Twitter/X reads its own tags and ignores the OpenGraph ones. `summary_large_image`
  // is what gets the full-width card instead of a thumbnail beside the text.
  twitter: {
    card: "summary_large_image",
    title: "FBBSim — Fantasy Basketball Simulator",
    description: DESCRIPTION,
    images: ["/og.png"],
  },
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
