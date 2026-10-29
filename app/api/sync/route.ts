import { NextResponse } from "next/server";

/**
 * CROSS-DEVICE SYNC (owner, 2026-10-29): the Week Planner's plan and the Settings (the
 * keeper / Protect list, the open-spot flag) saved server-side, so a phone and a laptop
 * share one copy. localStorage stays as each device's offline copy and first paint.
 *
 * Storage is Upstash Redis (Vercel Marketplace) over its REST API with plain `fetch` —
 * no SDK dependency. The integration writes `KV_REST_API_URL` / `KV_REST_API_TOKEN`
 * (older Upstash setups: `UPSTASH_REDIS_REST_URL` / `_TOKEN`); both are read. Without
 * them the route answers `{configured: false}` and the app behaves exactly as before.
 *
 * Single owner, no logins: the only keys accepted are `settings` and
 * `plan:<season>:<period>:<teamId>`, values are capped in size, and plans expire after
 * 30 days so old weeks clean themselves up.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY_OK = /^(settings|plan:\d{4}:\d{1,3}:\d{1,3})$/;
const MAX_BYTES = 64 * 1024;
const PLAN_TTL = 60 * 60 * 24 * 30;

async function redis(command: (string | number)[]) {
  const res = await fetch(URL_!, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json()) as { result: unknown };
}

function badKey(key: string | null): key is null {
  return !key || !KEY_OK.test(key);
}

export async function GET(request: Request) {
  if (!URL_ || !TOKEN) return NextResponse.json({ configured: false });
  const key = new URL(request.url).searchParams.get("key");
  if (badKey(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  try {
    const { result } = await redis(["GET", `fbb:${key}`]);
    return NextResponse.json(
      { configured: true, value: typeof result === "string" ? JSON.parse(result) : null },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "storage unavailable" }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!URL_ || !TOKEN) return NextResponse.json({ configured: false });
  const key = new URL(request.url).searchParams.get("key");
  if (badKey(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  try {
    JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "not json" }, { status: 400 });
  }
  try {
    const cmd = key.startsWith("plan:")
      ? ["SET", `fbb:${key}`, text, "EX", PLAN_TTL]
      : ["SET", `fbb:${key}`, text];
    await redis(cmd);
    return NextResponse.json({ configured: true, ok: true });
  } catch {
    return NextResponse.json({ error: "storage unavailable" }, { status: 502 });
  }
}
