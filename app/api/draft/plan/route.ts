import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The owner's draft plan (the Plan tab), saved to a file so the laptop and the phone on
 * the same wifi edit ONE plan through the local dev server. localStorage alone would give
 * each device its own copy.
 *
 * Local only by nature: on Vercel the filesystem is read-only, the PUT fails, and the
 * Plan tab falls back to the browser copy and says so. That is acceptable for a one-night
 * personal tool; a durable store would be the upgrade if the plan ever needs to live on
 * the deployed site.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "scripts", "draft_inputs", "draft-plan.json");

export async function GET() {
  try {
    return NextResponse.json(JSON.parse(await readFile(FILE, "utf8")));
  } catch {
    return NextResponse.json({ rounds: {} });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || typeof body.rounds !== "object") {
      return NextResponse.json({ error: "expected { rounds: {...} }" }, { status: 400 });
    }
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify({ ...body, savedAt: new Date().toISOString() }, null, 2));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
