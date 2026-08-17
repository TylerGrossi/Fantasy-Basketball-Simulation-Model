"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { AgentIcon } from "./Icons";
import ModelBar, { type UsageSnapshot } from "./ModelBar";

/**
 * The Agent chat page — the Streamlit assistant's UI, rebuilt.
 *
 * Empty state is the greeting + composer + four suggestion chips, vertically centred like
 * a fresh chatbot; once there are messages the composer moves to a fixed bottom bar and
 * the conversation scrolls above it. Replies stream token by token over SSE from
 * /api/agent, and a small line names each tool as the model calls it — the Streamlit
 * version just showed a spinner, and "Looking up Nikola Jokic" is the difference between
 * a wait that reads as progress and one that reads as a hang.
 */

const SUGGESTIONS: Array<[string, string]> = [
  [
    "My weak categories",
    "What are my team's weakest categories this season, and which ones should I target on the waiver wire?",
  ],
  ["Best free agents", "Who are the best available free agents right now by overall value?"],
  ["Trending up", "Which players are trending up the most over the last 15 days?"],
  [
    "Latest NBA news",
    "What's the latest NBA news and any notable injuries or trades right now?",
  ],
];

/** Tool name → what to say while it runs. */
const TOOL_LABELS: Record<string, string> = {
  lookup_player: "Looking up a player",
  list_players: "Ranking players",
  compare_players: "Comparing players",
  team_category_ranks: "Checking category ranks",
  team_roster: "Reading a roster",
  list_teams: "Listing teams",
  power_rankings: "Reading power rankings",
  find_players: "Searching for players",
  league_rosters: "Surveying every roster",
  web_search: "Searching the web",
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

/** How long a stream may go silent before we give up on it. */
const STALL_MS = 90_000;

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/New_York",
    }).format(new Date())
  );
  return hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
}

export default function AgentView({
  teamName,
  configured = true,
}: {
  teamName: string;
  /** False when the server has no GEMINI_API_KEY — the page says so instead of failing. */
  configured?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Which model answered last, and which one to ask for first. The preference persists
  // in this browser — it is a per-person choice, not a server setting.
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [preferred, setPreferred] = useState("");
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  useEffect(() => {
    try {
      setPreferred(localStorage.getItem("agent.model") ?? "");
    } catch {
      // Private mode or storage disabled — auto is a fine default.
    }
  }, []);
  const choose = (m: string) => {
    setPreferred(m);
    try {
      localStorage.setItem("agent.model", m);
    } catch {
      // Not worth surfacing; the choice simply won't outlive the tab.
    }
  };
  // Rendered on the server too, so the greeting word can't come from the first render.
  const [hello, setHello] = useState("Hello");
  useEffect(() => setHello(greeting()), []);

  // Follow the conversation as it grows, the way every chat app does.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, reply, status]);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || streaming || !configured) return;
    const next: Message[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setDraft("");
    setReply("");
    setStatus("Thinking");
    setStreaming(true);

    let answer = "";
    let failed: string | null = null;

    /**
     * A stream that stops arriving must not spin forever.
     *
     * There is no timeout on a ReadableStream: if the connection dies quietly — a dev
     * server recompiling mid-request will do it, so will a dropped network — `read()`
     * simply never resolves and the page sits on "Ranking players…" until it is
     * reloaded. The watchdog is armed per CHUNK, not per request, so a genuinely long
     * answer that is still producing tokens is never cut off; only silence is.
     */
    const controller = new AbortController();
    abortRef.current = controller;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort("stalled"), STALL_MS);
    };

    try {
      arm();
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, model: preferred || undefined }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        failed =
          detail?.error ??
          "Something went wrong reaching the assistant. Try again in a moment.";
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          arm(); // something arrived — reset the silence timer
          buffer += decoder.decode(value, { stream: true });
          // Line-ending agnostic on purpose — see the note in lib/gemini.ts.
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? "";
          for (const evt of events) {
            const line = evt.split(/\r?\n/).find((l) => l.startsWith("data:"));
            if (!line) continue;
            let payload: { type?: string; value?: string; name?: string; kind?: string };
            try {
              payload = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (payload.type === "text" && payload.value) {
              answer += payload.value;
              setStatus("");
              setReply(answer);
            } else if (payload.type === "model") {
              setActiveModel(payload.name ?? null);
            } else if (payload.type === "usage") {
              // Comes from the process that served the turn; the bar merges it into the
              // browser's own running total (see ModelBar for why that is the durable one).
              setUsage(payload as unknown as UsageSnapshot);
            } else if (payload.type === "tool") {
              setStatus(TOOL_LABELS[payload.name ?? ""] ?? "Working");
            } else if (payload.type === "error") {
              failed =
                payload.kind === "rate_limit"
                  ? "I've hit Gemini's free-tier rate limit for the moment. Give it a minute and try again."
                  : "I couldn't reach a working model for that one right now. Please try again in a moment.";
            }
          }
        }
      }
    } catch (err) {
      const stopped = controller.signal.reason === "stopped";
      failed = stopped
        ? "Stopped."
        : controller.signal.aborted
          ? "That turn went quiet for 90 seconds, so I stopped waiting. Try again — if it keeps happening the server is probably restarting mid-answer."
          : "The connection dropped before I could answer. Please try again.";
      if (stopped && !answer.trim()) failed = "Stopped before I got anywhere.";
      void err;
    } finally {
      clearTimeout(watchdog);
      abortRef.current = null;
    }

    // A partial answer plus a failure is NOT a complete answer. `answer || failed`
    // dropped the notice whenever a single token had streamed, so a turn that died after
    // "let me look that up" was presented as the finished reply. Keep both.
    const partial = answer.trim();
    const final = partial
      ? failed
        ? `${partial}\n\n*${failed}*`
        : partial
      : failed || "I couldn't generate a response for that one.";
    setMessages([...next, { role: "assistant", content: final }]);
    setReply("");
    setStatus("");
    setStreaming(false);
  }

  /** Back to the empty state — the greeting, chips and centred composer. */
  const reset = () => {
    setMessages([]);
    setReply("");
    setStatus("");
  };

  const composer = (
    <div className="asst-composer-wrap">
      <form
        className="asst-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
      <textarea
        ref={boxRef}
        className="asst-input"
        rows={2}
        placeholder={
          configured
            ? // Two words shorter than it reads: at 14px the old wording still wrapped on
              // a 360px phone, and no size that fits there is large enough to read.
              "Ask about your team or the NBA…"
            : "The assistant is not configured"
        }
        aria-label="Message"
        disabled={!configured}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        // Enter sends, Shift+Enter is a newline — the convention every chat app uses.
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void ask(draft);
          }
        }}
      />
      {/* While a turn is running the send button becomes Stop — a long answer you no
          longer want should not have to be waited out or reloaded away. */}
      {streaming ? (
        <button
          type="button"
          className="asst-send asst-stop"
          onClick={() => abortRef.current?.abort("stopped")}
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          className="asst-send"
          disabled={!configured || !draft.trim()}
        >
          Send
        </button>
      )}
      </form>
      {/* Footer row under the composer. Because the composer is pinned once a
          conversation exists, anything here is reachable from any scroll position —
          which is exactly what the old top-right Clear chip was not. "New chat" rather
          than "Clear": same action, named for the intent instead of the destruction. */}
      {(configured || Boolean(messages.length)) && (
        <div className="asst-foot">
          {messages.length > 0 && (
            <button
              type="button"
              className="asst-newchat"
              onClick={reset}
              disabled={streaming}
            >
              New chat
            </button>
          )}
          {configured && (
            <ModelBar
              active={activeModel}
              preferred={preferred}
              onPreferred={choose}
              usage={usage}
            />
          )}
        </div>
      )}
    </div>
  );

  if (!messages.length) {
    return (
      <div className="asst asst-empty">
        <div className="asst-hero">
          <div className="asst-hero-badge">
            <AgentIcon size={30} />
          </div>
          <h1>
            {hello}, {teamName}
          </h1>
          <p>
            Your fantasy basketball assistant. Ask about player values, waiver pickups,
            trades, or category strengths — I read your league&rsquo;s real data and can
            search the web for live NBA news.
          </p>
        </div>
        {!configured && (
          <div className="notice" style={{ maxWidth: 680, margin: "0.8rem auto 0" }}>
            The assistant needs a <strong>GEMINI_API_KEY</strong> on the server. Put it in{" "}
            <code>engine/config_secrets.py</code> and run <code>npm run env</code>, or set
            it in the host&rsquo;s environment. Everything else in the app works without it.
          </div>
        )}
        {composer}
        <div className="asst-chips">
          {SUGGESTIONS.map(([label, prompt]) => (
            <button
              key={label}
              type="button"
              className="chip"
              onClick={() => void ask(prompt)}
              disabled={!configured}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="asst">
      <div className="asst-thread">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div className="asst-user" key={i}>
              {m.content}
            </div>
          ) : (
            <div className="asst-reply" key={i}>
              <Markdown text={m.content} />
            </div>
          )
        )}
        {streaming && (
          <div className="asst-reply">
            {reply && <Markdown text={reply} />}
            {status && (
              <div className="asst-status">
                <span className="asst-dot" />
                {status}…
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {composer}
    </div>
  );
}
