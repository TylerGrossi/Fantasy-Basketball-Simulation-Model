import { createToolRunner, systemInstruction, TOOL_DECLARATIONS } from "@/lib/agentTools";
import { runAgent, apiKey, webSearch, type Content } from "@/lib/gemini";
import { loadLeague, myTeam } from "@/lib/loadLeague";

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
// A tool-heavy question can need several model round-trips.
export const maxDuration = 60;

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
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };
    messages = (body.messages ?? []).filter(
      (m) => m && (m.role === "user" || m.role === "assistant") && m.content?.trim()
    );
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "The last message must be from the user." }, { status: 400 });
  }

  const league = await loadLeague();
  const me = await myTeam(league);
  const runTool = createToolRunner(league, me.name, webSearch);

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
        })) {
          send(evt);
        }
      } catch {
        send({ type: "error", kind: "unavailable" });
      } finally {
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
