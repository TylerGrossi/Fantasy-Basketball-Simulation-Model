import { createToolRunner, systemInstruction, TOOL_DECLARATIONS } from "@/lib/agentTools";
import { runAgent, apiKey, usageSnapshot, webSearch, type Content } from "@/lib/gemini";
import { loadConsistency, loadLeague, myTeam } from "@/lib/loadLeague";

/**
 * The Agent's server half: one chat turn, streamed back as SSE.
 *
 * The API key never leaves this process, which is the whole reason the tool loop runs
 * here rather than in the browser. The league numbers the tools return come from the
 * checked-in export, so a turn costs one Gemini call per tool round-trip and zero ESPN
 * traffic.
 *
 * STATELESS BY DESIGN: the client posts the whole conversation each turn. The Streamlit
 * version kept a live chat object in server session state, which a serverless deploy has
 * nowhere to put — and which the free tier's 15-minute spin-down would have thrown away
 * mid-conversation anyway. Tool calls and their results are NOT carried across turns,
 * only the visible messages; the model re-calls what it needs, and the alternative is
 * paying for a growing transcript of raw tool dumps on every turn.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * A tool-heavy question can need several model round-trips.
 *
 * Was 60, which is what broke follow-up questions: a measured second turn took 75s
 * (17 tool calls including two web searches) and the platform killed the function
 * mid-stream, which surfaces as "something went wrong reaching the assistant" with no
 * clue why. The turn itself was fine. Tool memoisation and concurrent execution in
 * lib/gemini.ts cut the common case well under this, but the ceiling has to sit above
 * the worst case, not the average. NOTE: Vercel's hobby tier caps at 60s regardless —
 * on that plan the real fix is the speed work, not this number.
 */
export const maxDuration = 300;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  if (!apiKey()) {
    return Response.json(
      { error: "GEMINI_API_KEY is not set on the server." },
      { status: 503 }
    );
  }

  let messages: ChatMessage[];
  let preferred: string | undefined;
  try {
    const body = (await req.json()) as { messages?: ChatMessage[]; model?: string };
    messages = (body.messages ?? []).filter(
      (m) => m && (m.role === "user" || m.role === "assistant") && m.content?.trim()
    );
    // A preference, not a pin: an unknown or exhausted model still falls back down the
    // chain, and the `model` event tells the client which one actually answered.
    preferred = body.model?.trim() || undefined;
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "The last message must be from the user." }, { status: 400 });
  }

  const league = await loadLeague();
  const me = await myTeam(league);
  // 25 KB, read once per turn, and only player_game_detail touches it — see loadLeague.
  const consistency = await loadConsistency();
  const runTool = createToolRunner(league, me.name, webSearch, consistency);

  const history: Content[] = messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const evt of runAgent({
          system: systemInstruction(me.name, league.seasonOver, league.season),
          history,
          tools: TOOL_DECLARATIONS,
          runTool,
          preferred,
        })) {
          send(evt);
        }
      } catch (err) {
        // Never swallow this. The client can only ever say "something went wrong", so if
        // the reason is not in the server log it is nowhere — and a real fault (bad tool
        // schema, timeout, key problem) looks identical to a rate limit.
        console.error("[agent route]", err instanceof Error ? err.stack : err);
        send({ type: "error", kind: "unavailable" });
      } finally {
        // The usage snapshot rides out on the SAME stream that did the work. A separate
        // endpoint cannot see these counters — Next gives each route its own module
        // instance — so it reported zeros for a turn that had just spent quota.
        send({ type: "usage", ...usageSnapshot() });
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
