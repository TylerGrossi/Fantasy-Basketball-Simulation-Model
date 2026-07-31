import type { Metadata, Viewport } from "next";
import Link from "next/link";
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

/**
 * Nav is plain links, not buttons that round-trip to a server. That alone removes the
 * whole class of "tab switch takes a second" problems the Streamlit version had: Next
 * prefetches each route, so navigation is client-side and instant.
 */
const NAV = [
  { href: "/", label: "Scoreboard" },
  { href: "/matchup", label: "Matchup" },
  { href: "/roster", label: "Roster" },
  { href: "/streamers", label: "Streamers" },
  { href: "/bench", label: "Bench" },
  { href: "/season", label: "Season" },
  { href: "/schedule", label: "Schedule" },
  { href: "/rankings", label: "Rankings" },
  { href: "/playoffs", label: "Playoffs" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <Link href="/" className="nav-brand">
              <BasketballMark />
              Fantasy Basketball
            </Link>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="nav-link">
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}

/** Inline SVG, as in the Streamlit build — no icon font, no network dependency. */
function BasketballMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="45" fill="#E06A3B" stroke="#1B1D22" strokeWidth="4" />
      <path d="M50 5 Q50 50 50 95" stroke="#1B1D22" strokeWidth="4" fill="none" />
      <path d="M5 50 Q50 50 95 50" stroke="#1B1D22" strokeWidth="4" fill="none" />
      <path d="M15 20 Q50 35 85 20" stroke="#1B1D22" strokeWidth="4" fill="none" />
      <path d="M15 80 Q50 65 85 80" stroke="#1B1D22" strokeWidth="4" fill="none" />
    </svg>
  );
}
