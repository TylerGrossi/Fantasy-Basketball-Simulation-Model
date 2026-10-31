import { NextResponse } from "next/server";
import { DraftFeedError, fetchDraftFeed } from "@/lib/espnDraft";
import { loadFrozenDraft } from "@/lib/draftSeason";

/**
 * The live draft feed for the Draft Guide: every pick made so far in the draft league,
 * plus the pick order and which team is the owner's. The ESPN fetch itself lives in
 * lib/espnDraft.ts, shared with app/api/draft/season.
 *
 * Same pattern as app/api/live — cookies from the server environment only. The draft
 * league is DRAFT_LEAGUE_ID (see engine/config.py), written to .env.local by `npm run env`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // After the draft the saved feed is the answer (scripts/freeze_draft_recap.mjs).
    const frozen = await loadFrozenDraft();
    return NextResponse.json(frozen?.feed ?? (await fetchDraftFeed()));
  } catch (e) {
    const status = e instanceof DraftFeedError ? e.status : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
