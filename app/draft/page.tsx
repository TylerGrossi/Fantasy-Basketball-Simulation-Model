import { readFile } from "node:fs/promises";
import path from "node:path";
import DraftBoardView from "@/components/DraftBoardView";
import type { DraftData } from "@/lib/draft";

/**
 * The draft guide for the DRAFT league (engine/config.py DRAFT_LEAGUE_ID), built from
 * public/data/draft.json — ESPN's own 2026-27 projections plus outside rankings, exported
 * by scripts/build_draft.py.
 *
 * It used to run lib/projection.ts's home-grown model (`projectPool`) over last season's
 * player pool. That model is still in the repo, but it could not see rookies, trades or
 * anyone who missed last season, so the board now reads ESPN's projections and keeps only
 * the model's scoring half (`scoreProjections`), which re-scores them on this league's own
 * categories in the browser.
 *
 * Only the lines and the league metadata cross to the client; the outlooks (~55 KB of
 * prose) live in draft-outlooks.json and are fetched when a card is opened.
 */
async function loadDraft(): Promise<DraftData | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "draft.json");
    return JSON.parse(await readFile(file, "utf8")) as DraftData;
  } catch {
    return null;
  }
}

export default async function Page() {
  const data = await loadDraft();
  const season = data?.league.season ?? new Date().getFullYear();
  const label = `${season - 1}-${String(season % 100).padStart(2, "0")}`;

  return (
    <>
      <h1>Draft Guide</h1>
      <p className="caption">
        {data
          ? `${data.league.name} · ${data.league.teams.length} teams · ${data.league.rounds} rounds · ${label} projections, ranked on this league's ${data.league.categories.length} categories.`
          : "No draft data — run `python scripts/build_draft.py`."}
      </p>
      {data && <DraftBoardView data={data} />}
    </>
  );
}
