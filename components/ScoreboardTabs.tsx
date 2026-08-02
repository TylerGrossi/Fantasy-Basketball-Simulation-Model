"use client";

import { useState, type ReactNode } from "react";

/**
 * The three-way split ESPN's own matchup page uses: your box score, the head-to-head, the
 * opponent's box score. On MOBILE these are a segmented control, one panel visible at a
 * time (there is no room for three tables side by side). On DESKTOP all three render
 * stacked in one continuous page — the tab pills disappear and every panel shows at once
 * — which is why every panel is always in the DOM: CSS alone decides what's visible on a
 * wide screen, no re-render on resize.
 *
 * Content is passed in already-rendered (often from a SERVER component further up — a
 * server component's output can be handed to a client component as children/props, it
 * just can't import one) — this file only owns which panel is showing, not what's in them.
 */
export default function ScoreboardTabs({
  mineLabel,
  oppLabel,
  mine,
  matchup,
  opp,
}: {
  mineLabel: string;
  oppLabel: string;
  mine: ReactNode;
  matchup: ReactNode;
  opp: ReactNode;
}) {
  const [active, setActive] = useState<"mine" | "matchup" | "opp">("matchup");
  const tabs = [
    { key: "mine" as const, label: mineLabel },
    { key: "matchup" as const, label: "Matchup" },
    { key: "opp" as const, label: oppLabel },
  ];

  return (
    <div className="sbx">
      <div className="sbx-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`sbx-tab ${active === t.key ? "sbx-tab-active" : ""}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sbx-panels">
        <section
          role="tabpanel"
          className={`sbx-panel ${active === "mine" ? "sbx-panel-active" : ""}`}
        >
          {mine}
        </section>
        <section
          role="tabpanel"
          className={`sbx-panel ${active === "matchup" ? "sbx-panel-active" : ""}`}
        >
          {matchup}
        </section>
        <section
          role="tabpanel"
          className={`sbx-panel ${active === "opp" ? "sbx-panel-active" : ""}`}
        >
          {opp}
        </section>
      </div>
    </div>
  );
}
