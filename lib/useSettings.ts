"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * User settings, persisted in localStorage.
 *
 * The Streamlit app kept these in `st.session_state`, which meant they evaporated when the
 * server restarted — and on a free host that spins down every 15 minutes, that was often.
 * localStorage survives restarts, deploys and browser sessions, which is what "settings"
 * ought to mean.
 *
 * Nothing here is secret; credentials stay server-side in environment variables.
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

export function useSettings(): [Settings, (patch: Partial<Settings>) => void, boolean] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // Server and first client render must match, so start from defaults and only apply
  // stored values after mount — otherwise React logs a hydration mismatch.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch {
      // Corrupt or unavailable storage (private mode) — defaults are fine.
    }
    setLoaded(true);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked — keep the in-memory value rather than throwing.
      }
      return next;
    });
  }, []);

  return [settings, update, loaded];
}
