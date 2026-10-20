import { NextResponse } from "next/server";
import { DraftFeedError } from "@/lib/espnDraft";
import { SEASON_SIMS, getDraftSeason } from "@/lib/draftSeason";
import { SIM_VERSION } from "@/lib/seasonSim";

/**
 * The Draft Recap's season projection, computed ON THE SERVER and cached.
 *
 * It used to run in the browser: 5,000 seasons froze the page for seconds on a laptop and
 * far longer on a phone. The draft is final, so the answer only changes with the picks or
 * the projections; lib/draftSeason.ts computes it once and caches it (shared with the
 * Agent's draft tools), and the response is CDN-cacheable for an hour.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const ds = await getDraftSeason();
    if (!ds) return NextResponse.json({ results: null, reason: "no picks yet" });
    return NextResponse.json(
      { results: ds.results, version: SIM_VERSION, sims: SEASON_SIMS },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (e) {
    const status = e instanceof DraftFeedError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
