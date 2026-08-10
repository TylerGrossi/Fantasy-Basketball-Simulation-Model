"use client";

import { useRouter } from "next/navigation";
import type { LeagueData } from "@/lib/league";
import { useSettings } from "@/lib/useSettings";
import { TEAM_COOKIE } from "@/lib/teamCookie";
import { DEFAULT_TEAM_NAME } from "@/lib/defaultTeam";

/**
 * Settings. Stored in localStorage, so they survive restarts and deploys — unlike the
 * Streamlit version, which kept them in server session state that a free-tier spin-down
 * wiped every 15 minutes.
 *
 * ESPN credentials are deliberately NOT here. They are server-side environment variables,
 * exactly as in the original.
 */
export default function SettingsView({
  league,
  poolSize,
}: {
  league: LeagueData;
  /** Counted server-side: this page's `league` is trimmed, so the pool isn't in it. */
  poolSize: number;
}) {
  const [settings, update, loaded] = useSettings();
  const router = useRouter();

  /**
   * The team lives in a cookie as well as localStorage: every page resolves it on the
   * SERVER while rendering, so a client-only value would paint the wrong team first.
   * router.refresh() re-runs the server render with the new cookie, with no full reload.
   */
  function chooseTeam(name: string) {
    update({ teamName: name });
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${TEAM_COOKIE}=${encodeURIComponent(name)}; path=/; max-age=${
      name ? oneYear : 0
    }; samesite=lax`;
    router.refresh();
  }

  return (
    <>
      <h2>Team</h2>
      <p className="caption">Which team in your league the app analyses.</p>
      <select
        className="field field-select"
        value={settings.teamName}
        onChange={(e) => chooseTeam(e.target.value)}
        disabled={!loaded}
        aria-label="Team"
        style={{ minWidth: 260 }}
      >
        {/* The app's real default is DEFAULT_TEAM_NAME, not the first team in the export
            — this said "Default (Born In The Darkness)" while every page was in fact
            analysing VJ Maxx. Falls back to the first team only if that name is not in
            this league, which is the same order resolveTeam uses. */}
        <option value="">
          Default (
          {league.teams.find((t) => t.name.trim() === DEFAULT_TEAM_NAME)?.name.trim() ??
            league.teams[0]?.name ??
            "—"}
          )
        </option>
        {league.teams.map((t) => (
          <option key={t.id} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>

      <h2>Roster</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.hasOpenSpot}
          onChange={(e) => update({ hasOpenSpot: e.target.checked })}
          disabled={!loaded}
        />
        I have an open roster spot
      </label>
      <p className="caption" style={{ marginTop: "0.5rem" }}>
        When set, the Streamers page will consider adding a player without dropping one.
      </p>

      <h2>Protected players</h2>
      <p className="caption">
        Never suggested as drops. Add them from the Streamers page; they persist here.
      </p>
      {settings.untouchables.length === 0 ? (
        <p className="caption">None yet.</p>
      ) : (
        <div className="chips">
          {settings.untouchables.map((n) => (
            <button
              key={n}
              type="button"
              className="chip chip-on"
              onClick={() =>
                update({ untouchables: settings.untouchables.filter((x) => x !== n) })
              }
            >
              {n} ×
            </button>
          ))}
        </div>
      )}

      <h2>Data</h2>
      <div className="table-scroll">
        <table className="sheet">
          <tbody>
            <Row label="League" value={String(league.season)} />
            <Row label="Matchup period" value={String(league.period)} />
            <Row
              label="Season"
              value={league.seasonOver ? "Complete" : "In progress"}
            />
            <Row
              label="Snapshot generated"
              value={new Date(league.generatedAt).toLocaleString()}
            />
            <Row label="Teams" value={String(league.teams.length)} />
            <Row
              label="Players in pool"
              value={String(poolSize)}
            />
          </tbody>
        </table>
      </div>
      <h2>Reset</h2>
      <button
        type="button"
        className="chip"
        onClick={() => update({ teamName: "", untouchables: [], hasOpenSpot: false })}
      >
        Reset settings to defaults
      </button>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ color: "var(--ink-2)" }}>{label}</td>
      <td className="num">{value}</td>
    </tr>
  );
}
