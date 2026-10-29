"use client";

import { useEffect, useRef } from "react";

/**
 * Client side of /api/sync — the cross-device copy of Settings and the Week Planner
 * (owner, 2026-10-29). localStorage stays the first paint and the offline copy; the
 * server copy wins whenever it exists, and every change is written to both.
 *
 * Without storage configured (local dev, or before the Upstash integration is added) the
 * route answers `{configured: false}` and everything here is a no-op.
 */

type Got = { configured: boolean; value: unknown } | null;

// Several components read the same key on mount (every useSettings call): one request.
const inflight = new Map<string, Promise<Got>>();

export function remoteGet(key: string): Promise<Got> {
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = fetch(`/api/sync?key=${encodeURIComponent(key)}`, { cache: "no-store" })
    .then(async (r) => (r.ok ? ((await r.json()) as { configured: boolean; value?: unknown }) : null))
    .then((j) => (j ? { configured: j.configured, value: j.value ?? null } : null))
    .catch(() => null)
    .finally(() => setTimeout(() => inflight.delete(key), 1000));
  inflight.set(key, p);
  return p;
}

// Writes are debounced per key, so dragging through a run of edits is one request.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function remotePut(key: string, value: unknown) {
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fetch(`/api/sync?key=${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
        keepalive: true,
      }).catch(() => {
        // Offline: the local copy has it; the next change or pull reconciles.
      });
    }, 400)
  );
}

/** True while a write for `key` is still waiting to go out — don't pull over it. */
export const pendingWrite = (key: string) => timers.has(key);

/**
 * Pull `key` on mount and again whenever the page comes back into view — switching from
 * the phone to the laptop (or back to the tab) picks up what the other device saved.
 */
export function useRemotePull(key: string | null, onValue: (got: Got) => void) {
  const cb = useRef(onValue);
  cb.current = onValue;
  useEffect(() => {
    if (!key) return;
    const pull = () => {
      if (pendingWrite(key)) return;
      remoteGet(key).then((got) => cb.current(got));
    };
    pull();
    const onShow = () => document.visibilityState === "visible" && pull();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", pull);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", pull);
    };
  }, [key]);
}
