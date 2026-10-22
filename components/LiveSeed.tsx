"use client";

import { useMemo, type ReactNode } from "react";
import { LiveSeedContext, toLiveResult } from "@/lib/useLiveTotals";

/**
 * Hands a server-fetched live payload (lib/liveMatchup.ts `liveSeed`) to every
 * `useLiveTotals` below it for the same matchup, so the page's first paint is already
 * live. Without it the page painted the export's snapshot and swapped in the live numbers
 * a second later — the scoreboard visibly jumped on every refresh (owner, 2026-10-21).
 *
 * `data` null (ESPN slow or down) renders children unseeded: the old snapshot-then-live
 * behaviour, which is the right fallback.
 */
export default function LiveSeed({
  period,
  teamId,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data,
  children,
}: {
  period: number;
  teamId: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any | null;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    const result = data ? toLiveResult(data) : null;
    return result ? { key: `${period}-${teamId}`, result } : null;
  }, [period, teamId, data]);
  return <LiveSeedContext.Provider value={value}>{children}</LiveSeedContext.Provider>;
}
