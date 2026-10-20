"use client";

import DraftRecap from "./DraftRecap";
import type { DraftData } from "@/lib/draft";

/**
 * The standalone Draft Recap page. DraftRecap fetches the real draft from /api/draft
 * itself. It grades the REAL draft only — the mock preview was removed at the owner's
 * request once ESPN published the picks — so it is handed an empty mock.
 */
export default function DraftRecapView({ data }: { data: DraftData }) {
  return (
    <DraftRecap
      lines={data.lines}
      league={data.league}
      live={null}
      mock={{ active: false, slot: 1, style: "espn", speedMs: 0, seed: 1, picks: [] }}
      myTeamId={data.league.myTeamId}
    />
  );
}
