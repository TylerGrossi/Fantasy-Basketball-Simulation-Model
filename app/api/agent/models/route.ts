import { apiKey, models, usageSnapshot } from "@/lib/gemini";

/**
 * The model chain, in the order it will be tried, plus what this server has seen today.
 *
 * The counters live on `globalThis` (see lib/gemini.ts) precisely so this route can read
 * what the agent route observed. Without that they were separate module instances, and
 * this endpoint answered "zero requests" for models that had just rate-limited — which
 * showed up in the UI as "unused" beside three models that were actually out of quota.
 *
 * Still only this PROCESS's view: a restart clears it, and a serverless instance sees
 * only its own calls. The browser keeps its own running total on top, and /api/agent
 * ships a fresh snapshot at the end of every turn.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    configured: Boolean(apiKey()),
    chain: models(),
    ...usageSnapshot(),
  });
}
