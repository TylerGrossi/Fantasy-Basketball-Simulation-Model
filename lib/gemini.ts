/**
 * Gemini over plain `fetch` — no SDK dependency.
 *
 * The Streamlit assistant used `google-genai` and its *automatic* function calling. Here
 * the loop is written out by hand, which is a deliberate trade: the whole agent is ~200
 * lines of REST against an API this app already needs a key for, versus adding a
 * dependency to a project whose entire package.json is next + react. It also puts the
 * model-rotation and tool-execution behaviour where it can be read.
 *
 * MODEL ROTATION (ported from legacy/assistant.py): every free-tier model has its own
 * small daily/RPM quota, so a chain is tried in order and a 429 moves to the next one.
 * Each turn restarts at the top of the chain — quotas are mostly per-MINUTE, so a model
 * that was exhausted a turn ago is usually free again, and without the reset the chain
 * would creep down to the weakest model and stay there.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * The fallback chain, quality first, ending on the high-quota lite models as a safety
 * net. Overridable with GEMINI_MODELS (comma-separated) so the chain can be retuned
 * without a deploy — the free-tier model list changes more often than this code does.
 */
export const DEFAULT_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
];

export function models(): string[] {
  const raw = process.env.GEMINI_MODELS?.trim();
  if (!raw) return DEFAULT_MODELS;
  const list = raw.split(",").map((m) => m.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_MODELS;
}

export function apiKey(): string {
  return (process.env.GEMINI_API_KEY ?? "").trim();
}

export interface Part {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: { result: string }; id?: string };
  /**
   * Gemini 3 hands back an opaque `thoughtSignature` on the part that carries a function
   * call, and REJECTS the follow-up request if it isn't echoed back verbatim. Losing it
   * is a 400 on the second round-trip — the model calls a tool, the tool answers, and the
   * turn dies with no output. Never rebuild a model part by hand; pass the original
   * through untouched.
   */
  thoughtSignature?: string;
}

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

/** A 429 from any model means "this one is out of quota", not "the request was wrong". */
class RateLimited extends Error {}

async function post(model: string, body: unknown, stream: boolean): Promise<Response> {
  const url = `${ENDPOINT}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey() },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new RateLimited(model);
  if (!res.ok) {
    // Carry the body: Gemini puts the actual reason (bad schema, unknown model, key
    // problem) in it, and "HTTP 400" alone sends you looking in the wrong place.
    const detail = await res.text().catch(() => "");
    throw new Error(`${model}: HTTP ${res.status} ${detail.slice(0, 400)}`);
  }
  return res;
}

/**
 * Pull `data:` payloads out of an SSE body as they arrive.
 *
 * Gemini separates events with **CRLF** (`\r\n\r\n`), not `\n\n`. Splitting on `\n\n`
 * silently matches nothing, so every event stays in the buffer and the stream looks
 * empty — the model answers, and the app reports that no model could be reached. Split
 * on the line-ending-agnostic form and never assume LF.
 */
async function* sse(res: Response): AsyncGenerator<Record<string, unknown>> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events are separated by a blank line; anything after the last one is a partial.
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.split(/\r?\n/).find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        yield JSON.parse(payload);
      } catch {
        // A malformed chunk is not worth failing a whole answer over.
      }
    }
  }
}

function partsOf(chunk: Record<string, unknown>): Part[] {
  const candidates = (chunk.candidates ?? []) as Array<{ content?: { parts?: Part[] } }>;
  return candidates[0]?.content?.parts ?? [];
}

export type AgentEvent =
  | { type: "text"; value: string }
  | { type: "tool"; name: string }
  | { type: "error"; kind: "rate_limit" | "unavailable" };

export interface RunOptions {
  system: string;
  history: Content[];
  tools: { name: string; description: string; parameters: unknown }[];
  runTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Tool round-trips allowed before we stop. A trade question can legitimately use many. */
  maxSteps?: number;
}

/**
 * Run one turn: stream text as it arrives, execute any tool calls, loop until the model
 * answers without asking for another tool.
 *
 * Recovery rule, same as the Python: a failure BEFORE any text has been emitted is
 * recoverable — rotate to the next model and retry the turn from the same history. Once
 * text has gone out to the browser we cannot un-send it, so we stop and keep what we have.
 */
export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent> {
  const chain = models();
  const maxSteps = opts.maxSteps ?? 20;
  let sawRateLimit = false;

  for (const model of chain) {
    const working: Content[] = [...opts.history];
    let emitted = false;
    try {
      for (let step = 0; step < maxSteps; step++) {
        const body = {
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: working,
          tools: [{ functionDeclarations: opts.tools }],
          generationConfig: { temperature: 0.4 },
        };
        const res = await post(model, body, true);

        const calls: Array<{ name: string; args: Record<string, unknown>; id?: string }> = [];
        const modelParts: Part[] = [];
        for await (const chunk of sse(res)) {
          for (const part of partsOf(chunk)) {
            // The part goes back into the history EXACTLY as it arrived (see the
            // thoughtSignature note on Part) — only the text is also surfaced.
            if (part.text) {
              emitted = true;
              modelParts.push(part);
              yield { type: "text", value: part.text };
            }
            if (part.functionCall?.name) {
              calls.push({
                name: part.functionCall.name,
                args: part.functionCall.args ?? {},
                id: part.functionCall.id,
              });
              modelParts.push(part);
            }
          }
        }

        if (!calls.length) {
          if (emitted) return;
          // Some models stream nothing at all while deciding to give up. Rotating is
          // cheaper than retrying the same model, and the next one usually answers.
          break;
        }

        working.push({ role: "model", parts: modelParts });
        const responses: Part[] = [];
        for (const call of calls) {
          yield { type: "tool", name: call.name };
          let result: string;
          try {
            result = await opts.runTool(call.name, call.args);
          } catch {
            result = `The ${call.name} tool failed. Answer without it, and say so.`;
          }
          responses.push({
            // The id pairs a response with its call — required once the model issues
            // several tool calls in one turn, which it does for a trade question.
            functionResponse: { name: call.name, response: { result }, id: call.id },
          });
        }
        // Function results go back as a USER turn: the Gemini content schema only has
        // "user" and "model" roles, and the tool output is an input to the model.
        working.push({ role: "user", parts: responses });
      }
      if (emitted) return;
    } catch (err) {
      if (err instanceof RateLimited) sawRateLimit = true;
      // Surfaced in the server log only. A silent rotation through seven models makes a
      // genuine request error (a bad tool schema, say) look like "everything is down".
      else console.error("[agent]", model, err instanceof Error ? err.message : err);
      if (emitted) return;
      // Any other failure (400, 500, network) — try the next model in the chain.
    }
  }

  yield { type: "error", kind: sawRateLimit ? "rate_limit" : "unavailable" };
}

/**
 * Google Search grounding, as its OWN isolated call.
 *
 * Grounding cannot be combined with function declarations in a single request, so the
 * chat sees `web_search` as an ordinary tool and this taps Google underneath it —
 * exactly the arrangement the Streamlit version arrived at.
 */
export async function webSearch(query: string): Promise<string> {
  if (!query.trim()) return "No search query was given.";
  const body = {
    contents: [{ role: "user", parts: [{ text: query }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 },
  };
  for (const model of models()) {
    try {
      const res = await post(model, body, false);
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: string } }> };
        }>;
      };
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!text) return `No clear web result found for "${query}".`;
      const cites: string[] = [];
      for (const ch of cand?.groundingMetadata?.groundingChunks ?? []) {
        const title = ch.web?.title;
        if (title && !cites.includes(title)) cites.push(title);
      }
      return cites.length ? `${text}\n\nSources: ${cites.slice(0, 4).join(", ")}` : text;
    } catch (err) {
      if (err instanceof RateLimited) continue; // this model is spent; try the next
      return "Web search is unavailable right now.";
    }
  }
  return "Web search is rate-limited right now - try again in a bit.";
}
