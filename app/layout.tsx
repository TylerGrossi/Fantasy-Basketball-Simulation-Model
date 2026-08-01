import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Nav from "@/components/Nav";
import { loadLeague } from "@/lib/loadLeague";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantasy Basketball",
  description:
    "Monte Carlo simulation and live category win probability for an ESPN fantasy basketball league.",
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
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
