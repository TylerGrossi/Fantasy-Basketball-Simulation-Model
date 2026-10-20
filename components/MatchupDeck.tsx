"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The panel under the scoreboard on Current Matchup: the box scores, the week's schedule
 * grid and the two rosters, one at a time behind ESPN-style tabs (owner, 2026-10-20).
 *
 * A link to `/scoreboard#schedule` or `#roster` opens on that tab — that is where the old
 * /roster URL now lands. All three panels stay mounted (hidden, not unmounted) so
 * switching back to one keeps its scroll and toggle state.
 */
const TABS = [
  { key: "box", label: "Box Score" },
  { key: "schedule", label: "Schedule" },
  { key: "roster", label: "Roster" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function MatchupDeck({
  box,
  schedule,
  roster,
}: {
  box: ReactNode;
  schedule: ReactNode;
  roster: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("box");

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "");
      if (h === "schedule" || h === "roster") setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const panels: Record<TabKey, ReactNode> = { box, schedule, roster };

  return (
    <section className="md" id="deck">
      {/* Anchors for the hash links, so #schedule / #roster scroll here as well as
          selecting the tab. */}
      <span id="schedule" className="md-anchor" aria-hidden="true" />
      <span id="roster" className="md-anchor" aria-hidden="true" />
      <div className="md-tabs" role="tablist" aria-label="Matchup detail">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`md-tab${tab === t.key ? " md-tab-on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.key} role="tabpanel" hidden={tab !== t.key} className="md-panel">
          {panels[t.key]}
        </div>
      ))}
    </section>
  );
}
