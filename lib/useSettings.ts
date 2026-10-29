"use client";

import { useCallback, useEffect, useState } from "react";
import { remotePut, useRemotePull } from "./remoteSync";

/**
 * User settings, persisted in localStorage.
 *
 * The Streamlit app kept these in `st.session_state`, which meant they evaporated when the
 * server restarted — and on a free host that spins down every 15 minutes, that was often.
 * localStorage survives restarts, deploys and browser sessions, which is what "settings"
 * ought to mean.
 *
 * Nothing here is secret; credentials stay server-side in environment variables.
 *
 * CROSS-DEVICE (owner, 2026-10-29): also saved server-side through /api/sync (key
 * `settings`), so the keeper list set on a phone is the one the laptop sees. localStorage
 * is still the first paint; the server copy replaces it once fetched, and again whenever
 * the page comes back into view.
 */

export interface Settings {
  /** Which team the app analyses. Empty = fall back to the export's default. */
  teamName: string;
  /** Players never suggested as drops. */
  untouchables: string[];
  /** Treat an add as not requiring a drop. */
  hasOpenSpot: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  teamName: "",
  untouchables: [],
  hasOpenSpot: false,
};

const KEY = "fbb.settings.v1";
/**
 * Fired on every change so EVERY mounted useSettings sees it at once. Each call of the hook
 * holds its own copy, so without this a toggle in one section (the Week Planner's Can drop
 * column) did not reach another on the same page (Streamers' Protect chips) until reload.
 */
const EVENT = "fbb:settings";
/** The latest value, for when storage is blocked and cannot be re-read. */
let current: Settings | null = null;

function readStored(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Corrupt or unavailable storage (private mode).
  }
  return current ?? DEFAULT_SETTINGS;
}

/** Save locally, tell every mounted hook, and (unless it came FROM the server) upload. */
function apply(next: Settings, upload: boolean) {
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked — keep the in-memory value rather than throwing.
  }
  window.dispatchEvent(new CustomEvent<Settings>(EVENT, { detail: next }));
  if (upload) remotePut("settings", next);
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void, boolean] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // Server and first client render must match, so start from defaults and only apply
  // stored values after mount — otherwise React logs a hydration mismatch.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(readStored());
    setLoaded(true);
    const sync = (e: Event) => setSettings((e as CustomEvent<Settings>).detail);
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  // The server copy, when there is one, is the truth. First visit with sync switched on:
  // nothing stored yet, so this device's settings seed it.
  useRemotePull("settings", (got) => {
    if (!got?.configured) return;
    const local = readStored();
    if (got.value && typeof got.value === "object") {
      const remote = { ...DEFAULT_SETTINGS, ...(got.value as Partial<Settings>) };
      if (JSON.stringify(remote) !== JSON.stringify(local)) apply(remote, false);
    } else if (JSON.stringify(local) !== JSON.stringify(DEFAULT_SETTINGS)) {
      remotePut("settings", local);
    }
  });

  const update = useCallback((patch: Partial<Settings>) => {
    apply({ ...readStored(), ...patch }, true);
  }, []);

  return [settings, update, loaded];
}
