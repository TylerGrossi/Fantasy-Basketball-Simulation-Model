import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DraftFeedError, fetchDraftFeed } from "@/lib/espnDraft";
import type { DraftData } from "@/lib/draft";
import { scoreProjections } from "@/lib/projection";
import { SIM_VERSION, replacementLine, roundWeight, simulateSeason, type SimPlayer } from "@/lib/seasonSim";

/**
 * The Draft Recap's season projection, computed ON THE SERVER and cached.
 *
 * It used to run in the browser: 5,000 seasons is ~5 s on a laptop and far longer on a
 * phone, all on the main thread, so the Recap froze on every open. The draft is final, so
 * the answer only changes when the picks or the projections do: it is computed once per
 * (picks, draft.json export) and kept in memory, and the response is CDN-cacheable for an
 * hour. The browser just fetches ~1 KB of finished numbers.
 *
 * Inputs mirror the Recap exactly: neutral scoring (league categories, no weights or
 * punts), round weights blended with a replacement-level line, the real schedule.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 10,000 seasons (owner, 2026-10-19): affordable because it runs once and is cached.
const SIMS = 10000;
let cache: { key: string; body: unknown } | null = null;

export async function GET() {
  try {
    const feed = await fetchDraftFeed();
    if (!feed.picks.length) return NextResponse.json({ results: null, reason: "no picks yet" });

    const file = path.join(process.cwd(), "public", "data", "draft.json");
    const data = JSON.parse(await readFile(file, "utf8")) as DraftData;
    const key = `v${SIM_VERSION}|${SIMS}|${data.generatedAt}|${feed.picks.map((p) => `${p.pick}:${p.teamId}:${p.playerId}`).join(",")}`;

    if (!cache || cache.key !== key) {
      const { league, lines } = data;
      const nTeams = league.teams.length || 8;
      const rows = scoreProjections(lines, {
        categories: league.categories,
        lowerIsBetter: league.lowerIsBetter,
        poolSize: nTeams * (league.rounds || 13),
        rankBy: "total",
      });
      const byId = new Map(rows.map((r) => [r.playerId, r]));
      const rosters = new Map<number, SimPlayer[]>(feed.teams.map((t) => [t.id, []]));
      for (const p of feed.picks) {
        const r = byId.get(p.playerId);
        if (r) rosters.get(p.teamId)?.push({ line: r, weight: roundWeight(p.round) });
      }
      const drafted = new Set(feed.picks.map((p) => p.playerId));
      const repl = replacementLine(rows.filter((r) => r.playerId == null || !drafted.has(r.playerId)));
      const t0 = Date.now();
      const results = simulateSeason(
        rosters,
        league.schedule ?? [],
        league.categories,
        league.lowerIsBetter,
        repl,
        league.playoffTeams || 4,
        SIMS
      );
      cache = { key, body: { results, version: SIM_VERSION, sims: SIMS, ms: Date.now() - t0, computedAt: new Date().toISOString() } };
    }
    return NextResponse.json(cache.body, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (e) {
    const status = e instanceof DraftFeedError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
