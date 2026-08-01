"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { AgentIcon } from "./Icons";

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
  web_search: "Searching the web",
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

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
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
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
    } catch {
      failed = "The connection dropped before I could answer. Please try again.";
    }

    const final = answer.trim() || failed || "I couldn't generate a response for that one.";
    setMessages([...next, { role: "assistant", content: final }]);
    setReply("");
    setStatus("");
    setStreaming(false);
  }

  const composer = (
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
            ? "Ask anything about your team or the NBA…"
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
      <button
        type="submit"
        className="asst-send"
        disabled={streaming || !configured || !draft.trim()}
      >
        {streaming ? "…" : "Send"}
      </button>
    </form>
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
            <code>legacy/config_secrets.py</code> and run <code>npm run env</code>, or set
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
      <div className="asst-bar">
        <button
          type="button"
          className="chip"
          onClick={() => {
            setMessages([]);
            setReply("");
            setStatus("");
          }}
          disabled={streaming}
        >
          Clear
        </button>
      </div>

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
