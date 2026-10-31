import { readFile } from "node:fs/promises";
import path from "node:path";
import DraftRecapView from "@/components/DraftRecapView";
import type { DraftData } from "@/lib/draft";

/**
 * Draft Recap: who won the draft in the draft league (engine/config.py DRAFT_LEAGUE_ID).
 * Its own page since 2026-10-19 (it began as a tab inside the Draft Guide). Projections
 * come from public/data/draft.json; the picks and the season simulation from the saved
 * snapshot, public/data/draft-recap.json (scripts/freeze_draft_recap.mjs).
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
  // No daily-export playoff odds here any more (owner, 2026-10-30): the recap is what the
  // draft looked like the night it happened, so Proj record, Win % and Playoff % are the
  // draft-night simulation saved in public/data/draft-recap.json, and they never move.
  return (
    <>
      <h1>Draft Recap</h1>
      <p className="caption">
        {data
          ? `${data.league.name} · who won the draft, graded on this league's ${data.league.categories.length} categories.`
          : "No draft data — run `python scripts/build_draft.py`."}
      </p>
      {data && <DraftRecapView data={data} />}
    </>
  );
}
