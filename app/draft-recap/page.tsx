import { readFile } from "node:fs/promises";
import path from "node:path";
import DraftRecapView from "@/components/DraftRecapView";
import type { DraftData } from "@/lib/draft";
import { loadLeague } from "@/lib/loadLeague";

/**
 * Draft Recap: who won the draft in the draft league (engine/config.py DRAFT_LEAGUE_ID).
 * Its own page since 2026-10-19 (it began as a tab inside the Draft Guide). Projections
 * come from public/data/draft.json; the picks come live from /api/draft, client-side.
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
  // The Playoffs page's season simulation (the daily export): its playoff odds AND the
  // projected record behind them, so the recap's Proj record, Win % and Playoff % are
  // one model's numbers and agree with that page. Ids line up: same ESPN league.
  const league = await loadLeague();
  const playoffModel = Object.fromEntries(
    (league.seasonData.playoffOdds ?? []).map((o) => [
      o.teamId,
      { playoff: o.playoffProb / 100, record: o.projRecord?.length === 3 ? o.projRecord : undefined },
    ])
  );
  return (
    <>
      <h1>Draft Recap</h1>
      <p className="caption">
        {data
          ? `${data.league.name} · who won the draft, graded on this league's ${data.league.categories.length} categories.`
          : "No draft data — run `python scripts/build_draft.py`."}
      </p>
      {data && <DraftRecapView data={data} playoffModel={playoffModel} />}
    </>
  );
}
