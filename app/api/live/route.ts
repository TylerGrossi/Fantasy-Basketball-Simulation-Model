import { NextResponse } from "next/server";
import { liveMatchup } from "@/lib/liveMatchup";

/**
 * The LIVE half of the two-tier data split: current banked category totals for one
 * matchup. The ESPN work lives in lib/liveMatchup.ts, shared with the server pages that
 * seed their first paint with it (LiveSeed); this route is the browser's poll.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = Number(url.searchParams.get("period"));
  const teamId = Number(url.searchParams.get("teamId"));
  // `fast=1`: Game Day, which polls every 30s during games and wants a fresher shared
  // window. A separate URL, so it does not shorten the cache for the other pages.
  const fast = url.searchParams.get("fast") === "1";
  if (!Number.isFinite(period) || !Number.isFinite(teamId)) {
    return NextResponse.json(
      { error: "period and teamId are required" },
      { status: 400 }
    );
  }

  const { status, body } = await liveMatchup(period, teamId);
  return NextResponse.json(body, {
    status,
    // Small shared cache window: repeated loads within a minute reuse the response,
    // but the numbers still track games finishing through the evening. Game Day's
    // `fast` requests get 15s (owner, 2026-10-21). Errors are never cached.
    headers:
      status === 200
        ? {
            "cache-control": fast
              ? "public, s-maxage=15, stale-while-revalidate=30"
              : "public, s-maxage=60, stale-while-revalidate=120",
          }
        : undefined,
  });
}
