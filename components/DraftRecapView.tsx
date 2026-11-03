"use client";

import DraftRecap, { type PlayoffModelRow } from "./DraftRecap";
import type { DraftData, LiveDraft } from "@/lib/draft";
import type { SeasonResult } from "@/lib/seasonSim";

/**
 * The standalone Draft Recap page. The page hands over the frozen picks and season
 * simulation (public/data/draft-recap.json) so everything renders at once; without that
 * snapshot DraftRecap fetches both from /api/draft itself. It grades the REAL draft only — the mock preview was removed at the owner's
 * request once ESPN published the picks — so it is handed an empty mock.
 */
export default function DraftRecapView({
  data,
  playoffModel,
  live = null,
  season = null,
}: {
  data: DraftData;
  live?: LiveDraft | null;
  season?: SeasonResult[] | null;
  /** The Playoffs page's season simulation, per team id. See DraftRecap. */
  playoffModel?: Record<number, PlayoffModelRow>;
}) {
  return (
    <DraftRecap
      lines={data.lines}
      league={data.league}
      live={live}
      season={season}
      mock={{ active: false, slot: 1, style: "espn", speedMs: 0, seed: 1, picks: [] }}
      myTeamId={data.league.myTeamId}
      playoffModel={playoffModel}
    />
  );
}
