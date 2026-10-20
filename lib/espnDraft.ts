/**
 * Server-only: the draft league's picks from ESPN's fantasy API. Shared by app/api/draft
 * (the live feed) and app/api/draft/season (the Recap's cached season projection), so the
 * two always read the same picks the same way.
 *
 * ESPN pre-creates every pick slot with `playerId: -1`, and returns NO completed picks while
 * a draft is live (learned on draft night); only picks with a real player are kept.
 */

export interface DraftFeed {
  drafted: boolean;
  inProgress: boolean;
  picks: { pick: number; round: number; teamId: number; playerId: number }[];
  pickOrder: number[];
  myTeamId: number | null;
  teams: { id: number; name: string; abbrev: string }[];
  fetchedAt: string;
}

export class DraftFeedError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function fetchDraftFeed(cache: RequestCache = "no-store"): Promise<DraftFeed> {
  const leagueId = process.env.DRAFT_LEAGUE_ID;
  const season = process.env.DRAFT_SEASON_YEAR;
  const s2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;
  if (!leagueId || !season || !s2 || !swid) {
    throw new DraftFeedError("DRAFT_LEAGUE_ID / ESPN cookies missing — run `npm run env`", 500);
  }
  const url =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}` +
    `/segments/0/leagues/${leagueId}?view=mDraftDetail&view=mSettings&view=mTeam`;
  const res = await fetch(url, { headers: { Cookie: `espn_s2=${s2}; SWID=${swid}` }, cache });
  if (!res.ok) throw new DraftFeedError(`ESPN ${res.status}`, 502);
  const d = await res.json();
  const dd = d.draftDetail ?? {};
  const picks = ((dd.picks ?? []) as Record<string, number>[])
    .filter((p) => p.playerId > 0)
    .map((p) => ({ pick: p.overallPickNumber, round: p.roundId, teamId: p.teamId, playerId: p.playerId }))
    .sort((a, b) => a.pick - b.pick);
  const me = swid.trim().toUpperCase();
  const teams = (d.teams ?? []) as { id: number; name?: string; abbrev?: string; owners?: string[] }[];
  const mine = teams.find((t) => (t.owners ?? []).some((o) => o.toUpperCase() === me));
  return {
    drafted: Boolean(dd.drafted),
    inProgress: Boolean(dd.inProgress),
    picks,
    pickOrder: d.settings?.draftSettings?.pickOrder ?? [],
    myTeamId: mine?.id ?? null,
    teams: teams.map((t) => ({ id: t.id, name: (t.name ?? "").trim(), abbrev: t.abbrev ?? "" })),
    fetchedAt: new Date().toISOString(),
  };
}
