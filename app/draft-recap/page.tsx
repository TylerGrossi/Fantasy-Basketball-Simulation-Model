import { readFile } from "node:fs/promises";
import path from "node:path";
import DraftRecapView from "@/components/DraftRecapView";
import type { DraftData } from "@/lib/draft";

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
