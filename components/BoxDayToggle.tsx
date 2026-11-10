"use client";

import { useState, type ReactNode } from "react";

/**
 * A finished week's team panel: the box score, or the same players' value day by day
 * (owner, 2026-11-10). Both views are rendered on the server and handed in; this only
 * decides which one shows, so switching costs nothing and ships no data.
 */
export default function BoxDayToggle({
  box,
  days,
  hasDays,
}: {
  box: ReactNode;
  days: ReactNode;
  /** False when the week has no day-by-day lines: the toggle is left out. */
  hasDays: boolean;
}) {
  const [view, setView] = useState<"box" | "days">("box");
  if (!hasDays) return <>{box}</>;
  return (
    <>
      <div className="bdt-bar">
        <div className="bdt-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "box"} onClick={() => setView("box")}>
            Box score
          </button>
          <button type="button" aria-pressed={view === "days"} onClick={() => setView("days")}>
            Day by day
          </button>
        </div>
      </div>
      {view === "box" ? box : days}
    </>
  );
}
