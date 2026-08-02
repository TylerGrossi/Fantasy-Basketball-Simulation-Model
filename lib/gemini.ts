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
/*
 * Order is latency-aware, not just quality-ordered. Measured against this key
 * (trivial prompt, generateContent):
 *
 *   gemini-3.6-flash        429 in 0.15s   (out of quota — a cheap miss, so it stays
 *                                           first: when quota allows it is the best)
 *   gemini-3.5-flash        200 in 1.0s
 *   gemini-2.5-flash        200 in 0.5s
 *   *-flash-lite            200 in ~0.37s
 *   gemini-3-flash-preview  200 in 13.0s   <-- moved to LAST
 *
 * `gemini-3-flash-preview` was third, so any turn that rotated past 3.5-flash paid
 * thirteen seconds per round-trip to a preview model. A 429 costs 0.15s; a slow model
 * costs 13s on every step of the turn. Rank by "cost when it answers", not by version.
 */
export const DEFAULT_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
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

/* ------------------------------------------------------------------ usage tracking
 *
 * WHAT GOOGLE DOES AND DOESN'T TELL US. A successful response carries no quota headers
 * at all — there is no "credits remaining" number to read. A 429 is the only thing that
 * volunteers anything: its QuotaFailure names the daily LIMIT for that model and its
 * RetryInfo says how long to wait.
 *
 * So "used" here is what THIS SERVER has sent since it started, not what the key has
 * spent. Requests from the Streamlit app, another machine, or before a restart are
 * invisible to it, and the UI says so rather than dressing a local tally up as a
 * billing figure. It is still the useful half: it shows which model is answering, which
 * are locked out, and when they come back.
 */

export interface ModelUsage {
  model: string;
  /** Requests this process has sent today. */
  sent: number;
  ok: number;
  rateLimited: number;
  /** Daily cap, learned from a 429's QuotaFailure. Null until one arrives. */
  limit: number | null;
  /** When a rate-limited model is expected back. */
  retryAt: string | null;
  /** Mean round-trip of its successful calls — the number that made us reorder. */
  avgMs: number | null;
  lastUsed: string | null;
}

interface Counter {
  sent: number;
  ok: number;
  rateLimited: number;
  limit: number | null;
  retryAt: number | null;
  totalMs: number;
  lastUsed: number | null;
}

/** Google's free-tier day rolls over at midnight Pacific, so the counters key on that. */
function quotaDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Held on `globalThis`, not in a module-level `const`.
 *
 * Next gives each route handler its own module registry, so /api/agent and
 * /api/agent/models each got their OWN copy of this map — the status endpoint reported
 * zeros for models the agent route had just watched rate-limit, and the panel showed
 * "unused" for three models that were actually out of quota. A global is shared by
 * everything in the process, which is what makes the two routes agree.
 *
 * Still per-PROCESS: a restart resets it, and on a serverless host each instance counts
 * only its own calls. That is why the browser also keeps a running total.
 */
interface UsageStore {
  day: string;
  counters: Map<string, Counter>;
}
const store: UsageStore = ((globalThis as Record<string, unknown>).__geminiUsage ??= {
  day: quotaDay(),
  counters: new Map<string, Counter>(),
}) as UsageStore;

function counter(model: string): Counter {
  const today = quotaDay();
  const usage = store.counters;
  if (today !== store.day) {
    usage.clear();
    store.day = today;
  }
  let c = usage.get(model);
  if (!c) {
    c = { sent: 0, ok: 0, rateLimited: 0, limit: null, retryAt: null, totalMs: 0, lastUsed: null };
    usage.set(model, c);
  }
  return c;
}

/** Everything the status panel needs: the chain in order, plus what each model has done. */
export function usageSnapshot(): { day: string; models: ModelUsage[] } {
  const day = quotaDay();
  return {
    day,
    models: models().map((model) => {
      const c = counter(model);
      return {
        model,
        sent: c.sent,
        ok: c.ok,
        rateLimited: c.rateLimited,
        limit: c.limit,
        retryAt: c.retryAt && c.retryAt > Date.now() ? new Date(c.retryAt).toISOString() : null,
        avgMs: c.ok ? Math.round(c.totalMs / c.ok) : null,
        lastUsed: c.lastUsed ? new Date(c.lastUsed).toISOString() : null,
      };
    }),
  };
}

/** Midnight Pacific, when Google's free-tier daily counters reset. */
function nextQuotaReset(): number {
  const now = new Date();
  const pacific = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const midnight = new Date(pacific);
  midnight.setHours(24, 0, 0, 0);
  return now.getTime() + (midnight.getTime() - pacific.getTime());
}

/** Pull the cap and retry time out of a 429 body — the only quota facts on offer. */
function recordRateLimit(model: string, body: string) {
  const c = counter(model);
  c.rateLimited += 1;
  try {
    const details = (JSON.parse(body)?.error?.details ?? []) as Array<Record<string, unknown>>;
    let perDay = false;
    for (const d of details) {
      const type = String(d["@type"] ?? "");
      if (type.endsWith("QuotaFailure")) {
        const violation = (
          d.violations as Array<{ quotaValue?: string; quotaId?: string }> | undefined
        )?.[0];
        if (violation?.quotaValue) c.limit = Number(violation.quotaValue);
        // "GenerateRequestsPerDayPerProjectPerModel-FreeTier" vs a per-minute quota.
        perDay = /PerDay/i.test(violation?.quotaId ?? "");
      }
      if (type.endsWith("RetryInfo")) {
        const secs = Number(String(d.retryDelay ?? "").replace(/s$/, ""));
        if (Number.isFinite(secs)) c.retryAt = Date.now() + secs * 1000;
      }
    }
    // A DAILY quota comes back with a retryDelay of ~50s, which is nonsense for it: wait
    // that long and the model is still spent. Trusting it made the panel drop the
    // "rate limited" mark a minute after a 429, showing three models as fine while the
    // dashboard had them at 23/20 for the rest of the day. A day quota rests till reset.
    if (perDay) c.retryAt = nextQuotaReset();
  } catch {
    // Shape changed or body wasn't JSON — the counter still records the 429.
  }
}

async function post(model: string, body: unknown, stream: boolean): Promise<Response> {
  const url = `${ENDPOINT}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
  const c = counter(model);
  c.sent += 1;
  c.lastUsed = Date.now();
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey() },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    recordRateLimit(model, await res.text().catch(() => ""));
    throw new RateLimited(model);
  }
  if (res.ok) {
    c.ok += 1;
    // For a stream this is time-to-headers, not to the last token — which is the part
    // that decides whether a model feels responsive.
    c.totalMs += Date.now() - started;
  }
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
  /** Which model is answering — emitted as soon as one accepts the turn. */
  | { type: "model"; name: string }
  | { type: "error"; kind: "rate_limit" | "unavailable" };

export interface RunOptions {
  system: string;
  history: Content[];
  tools: { name: string; description: string; parameters: unknown }[];
  runTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Tool round-trips allowed before we stop. A trade question can legitimately use many. */
  maxSteps?: number;
  /**
   * Try this model first. The rest of the chain still follows it as a fallback — a
   * preference that returns 429 should degrade to an answer from another model, not to
   * no answer, and the `model` event says which one actually replied.
   */
  preferred?: string;
}

/** The chain for one turn, with an explicit preference promoted to the front. */
function chainFor(preferred?: string): string[] {
  const chain = models();
  if (!preferred || !chain.includes(preferred)) return chain;
  return [preferred, ...chain.filter((m) => m !== preferred)];
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
  const chain = chainFor(opts.preferred);
  const maxSteps = opts.maxSteps ?? 20;
  let sawRateLimit = false;

  /**
   * Tool results, memoised for the whole turn by name + arguments.
   *
   * The model re-asks for the same thing constantly — a measured follow-up turn made 17
   * calls that were only 8 distinct ones (lookup_player x7, list_players x3,
   * team_roster x2). Each repeat is pure latency, and for web_search it is a whole extra
   * Gemini round-trip. Keyed outside the model loop because a result does not depend on
   * which model asked for it, so a rotation does not re-run the work either.
   */
  const memo = new Map<string, Promise<string>>();
  const callTool = (name: string, args: Record<string, unknown>): Promise<string> => {
    const key = `${name}:${JSON.stringify(args)}`;
    let hit = memo.get(key);
    if (!hit) {
      hit = opts
        .runTool(name, args)
        .catch(() => `The ${name} tool failed. Answer without it, and say so.`);
      memo.set(key, hit);
    }
    return hit;
  };

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
        // The request was accepted, so this is the model handling the turn. Announced on
        // the first step only — a rotation mid-turn re-announces, which is the point.
        if (step === 0) yield { type: "model", name: model };

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

        // Announce every call first — a generator cannot yield from inside Promise.all,
        // and the UI wants the whole set of tools named up front anyway.
        for (const call of calls) yield { type: "tool", name: call.name };

        // CONCURRENTLY, not one after another. The model batches several calls per step
        // and they are independent; run sequentially, a step costs the SUM of its tools,
        // and with two web searches in one step that alone was tens of seconds.
        const results = await Promise.all(calls.map((c) => callTool(c.name, c.args)));
        const responses: Part[] = calls.map((call, i) => ({
          // The id pairs a response with its call — required once the model issues
          // several tool calls in one turn, which it does for a trade question.
          functionResponse: { name: call.name, response: { result: results[i] }, id: call.id },
        }));
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
      if (emitted) {
        // We keep the text already sent — but SAY that it stopped early. The common
        // shape is a preamble ("let me look that up") followed by tool calls, and a
        // failure on the next round-trip left that preamble standing as if it were the
        // whole answer. A truncated answer presented as complete is worse than an error.
        yield {
          type: "error",
          kind: err instanceof RateLimited ? "rate_limit" : "unavailable",
        };
        return;
      }
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
