"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Which model is answering, how each one is doing today, and a way to choose.
 *
 * WHAT THESE NUMBERS ARE, EXACTLY. Google publishes no remaining-credits figure: a
 * successful call returns no quota headers at all, and a 429 is the only response that
 * volunteers anything — the model's daily limit and when to retry.
 *
 * So this panel does NOT show a quota balance, and an earlier version that did was
 * wrong in the worst way: it rendered "1/20 sent" for a model the AI Studio dashboard
 * showed at 23/20. The count is only what this app sent, and Google meters the KEY —
 * across the Streamlit app, other machines, scripts, and anything sent before the server
 * last restarted. A fraction of the daily cap therefore reads as "19 left" when the true
 * answer is "none". The dashboard is the only authority, and the footer links to it.
 *
 * What is honest here, and all that is claimed:
 *   - which model answered (observed)
 *   - which are rate-limited and when they said to retry (from a real 429)
 *   - each model's daily cap, once a 429 has named it
 *   - requests THIS SESSION, labelled as such, never as a fraction
 *   - measured latency, which is why the chain is ordered the way it is
 */

export interface ModelUsage {
  model: string;
  sent: number;
  ok: number;
  rateLimited: number;
  limit: number | null;
  retryAt: string | null;
  avgMs: number | null;
  lastUsed: string | null;
}

export interface UsageSnapshot {
  day: string;
  models: ModelUsage[];
}

const AUTO = "";
const STORE = "agent.usage";

const label = (m: string) => m.replace(/^gemini-/, "");

/**
 * "in 40s" for a per-minute limit, "tomorrow" for a daily one — the two are hours apart
 * and a bare clock time reads identically for both.
 */
function backLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  if (ms < 90_000) return `in ${Math.ceil(ms / 1000)}s`;
  if (ms < 6 * 3_600_000)
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return "tomorrow";
}

/** A model is "resting" while its published retry time is still in the future. */
const resting = (u: ModelUsage) =>
  Boolean(u.retryAt && new Date(u.retryAt).getTime() > Date.now());

function load(): UsageSnapshot | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as UsageSnapshot) : null;
  } catch {
    return null;
  }
}

/** Merge a server snapshot into the stored one, keeping the larger count per model. */
function merge(stored: UsageSnapshot | null, fresh: UsageSnapshot): UsageSnapshot {
  // A new quota day wipes the slate — that is what Google does at midnight Pacific.
  const base = stored && stored.day === fresh.day ? stored.models : [];
  const byModel = new Map(base.map((m) => [m.model, m]));
  for (const f of fresh.models) {
    const old = byModel.get(f.model);
    byModel.set(f.model, {
      ...f,
      sent: Math.max(f.sent, old?.sent ?? 0),
      ok: Math.max(f.ok, old?.ok ?? 0),
      rateLimited: Math.max(f.rateLimited, old?.rateLimited ?? 0),
      limit: f.limit ?? old?.limit ?? null,
      avgMs: f.avgMs ?? old?.avgMs ?? null,
      retryAt: f.retryAt ?? old?.retryAt ?? null,
      lastUsed: f.lastUsed ?? old?.lastUsed ?? null,
    });
  }
  return { day: fresh.day, models: [...byModel.values()] };
}

export default function ModelBar({
  active,
  preferred,
  onPreferred,
  usage,
}: {
  /** The model that answered the last turn, from the stream's `model` event. */
  active: string | null;
  preferred: string;
  onPreferred: (model: string) => void;
  /** Latest server snapshot, or null before the first turn of this session. */
  usage: UsageSnapshot | null;
}) {
  const [chain, setChain] = useState<string[]>([]);
  const [totals, setTotals] = useState<UsageSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setTotals(load()), []);

  // The chain (order and membership) is a server fact; counts are not — see the header.
  useEffect(() => {
    let live = true;
    fetch("/api/agent/models")
      .then((r) => r.json())
      .then((d: { chain?: string[]; day?: string; models?: ModelUsage[] }) => {
        if (!live) return;
        setChain(d.chain ?? []);
        // The server's own view, merged in on load — it knows which models are resting
        // even when this browser has never sent a turn.
        if (d.day && d.models?.length) {
          setTotals((prev) => {
            const next = merge(prev, { day: d.day!, models: d.models! });
            try {
              localStorage.setItem(STORE, JSON.stringify(next));
            } catch {
              // Storage unavailable — the tally just won't survive the tab.
            }
            return next;
          });
        }
      })
      .catch(() => {
        // The bar is a nicety; a failure here must not disturb the chat.
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!usage) return;
    setTotals((prev) => {
      const next = merge(prev, usage);
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Storage unavailable — the tally just won't survive the tab.
      }
      return next;
    });
  }, [usage]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!chain.length) return null;

  const stats = new Map((totals?.models ?? []).map((m) => [m.model, m]));
  const shown = active ?? (preferred || null);

  return (
    <div className="modelbar" ref={box}>
      <button
        type="button"
        className="modelbar-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Model in use — click to choose one"
      >
        <span className="modelbar-dot" />
        {shown ? label(shown) : "auto"}
        {preferred && <span className="modelbar-pin">pinned</span>}
      </button>

      {open && (
        <div className="modelbar-panel">
          <div className="modelbar-head">
            <span className="eyebrow">Model</span>
            <span className="modelbar-note">first choice; falls back if busy</span>
          </div>

          <button
            type="button"
            className={`modelbar-row ${preferred === AUTO ? "modelbar-row-on" : ""}`}
            onClick={() => {
              onPreferred(AUTO);
              setOpen(false);
            }}
          >
            <span className="modelbar-name">Auto</span>
            <span className="modelbar-meta">try the chain in order</span>
          </button>

          {chain.map((model) => {
            const u = stats.get(model);
            const out = u ? resting(u) : false;
            return (
              <button
                key={model}
                type="button"
                className={`modelbar-row ${preferred === model ? "modelbar-row-on" : ""}`}
                onClick={() => {
                  onPreferred(model);
                  setOpen(false);
                }}
                title={
                  out && u?.retryAt
                    ? `Rate limited until ${new Date(u.retryAt).toLocaleTimeString()}`
                    : ""
                }
              >
                <span className={`modelbar-name ${out ? "modelbar-out" : ""}`}>
                  {label(model)}
                  {model === active && <span className="modelbar-tag">answering</span>}
                </span>
                <span className="modelbar-meta mono">
                  {/* Never "n/limit": our count and Google's are different quantities,
                      and pairing them invents a remaining balance. Cap and session
                      count are shown as the separate facts they are. */}
                  {out
                    ? `rate limited${u?.retryAt ? ` · back ${backLabel(u.retryAt)}` : ""}`
                    : [
                        u?.limit ? `${u.limit}/day cap` : null,
                        u && u.sent > 0 ? `${u.sent} this session` : null,
                        u?.avgMs != null ? `${(u.avgMs / 1000).toFixed(1)}s` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                </span>
              </button>
            );
          })}

          {/* Say exactly what the count is, because it is not a balance. */}
          <p className="modelbar-foot">
            No quota balance is shown because Google publishes none — a rate-limit reply
            is the only thing that reveals a cap. Google meters the <em>key</em>, so the
            Streamlit app, other machines and earlier runs all count against it and are
            invisible here;{" "}
            <a
              href="https://aistudio.google.com/usage"
              target="_blank"
              rel="noopener noreferrer"
            >
              AI Studio
            </a>{" "}
            has the real usage.
          </p>
        </div>
      )}
    </div>
  );
}
