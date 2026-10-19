import { NextResponse } from "next/server";

/**
 * The live draft feed for the Draft Guide: every pick made so far in the draft league,
 * plus the pick order and which team is the owner's.
 *
 * Same pattern as app/api/live — ESPN's fantasy API over fetch, cookies from the server
 * environment only. The draft league is DRAFT_LEAGUE_ID (a different league from
 * ESPN_LEAGUE_ID; see engine/config.py), written to .env.local by `npm run env`.
 *
 * ESPN pre-creates every pick slot with `playerId: -1` before the draft; only picks with a
 * real player are returned, so `picks.length + 1` is the pick on the clock.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const leagueId = process.env.DRAFT_LEAGUE_ID;
  const season = process.env.DRAFT_SEASON_YEAR;
  const s2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;
  if (!leagueId || !season || !s2 || !swid) {
    return NextResponse.json(
      { error: "DRAFT_LEAGUE_ID / ESPN cookies missing — run `npm run env`" },
      { status: 500 }
    );
  }

  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}` +
    `/segments/0/leagues/${leagueId}?view=mDraftDetail&view=mSettings&view=mTeam`;
  try {
    const res = await fetch(url, {
      headers: { Cookie: `espn_s2=${s2}; SWID=${swid}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `ESPN ${res.status}` }, { status: 502 });
    }
    const d = await res.json();
    const dd = d.draftDetail ?? {};
    const picks = ((dd.picks ?? []) as Record<string, number>[])
      .filter((p) => p.playerId > 0)
      .map((p) => ({
        pick: p.overallPickNumber,
        round: p.roundId,
        teamId: p.teamId,
        playerId: p.playerId,
      }))
      .sort((a, b) => a.pick - b.pick);

    const me = swid.trim().toUpperCase();
    const teams = ((d.teams ?? []) as { id: number; name?: string; abbrev?: string; owners?: string[] }[]);
    const mine = teams.find((t) => (t.owners ?? []).some((o) => o.toUpperCase() === me));

    return NextResponse.json({
      drafted: Boolean(dd.drafted),
      inProgress: Boolean(dd.inProgress),
      picks,
      pickOrder: d.settings?.draftSettings?.pickOrder ?? [],
      myTeamId: mine?.id ?? null,
      teams: teams.map((t) => ({ id: t.id, name: (t.name ?? "").trim(), abbrev: t.abbrev ?? "" })),
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
