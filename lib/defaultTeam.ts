/**
 * The team the app analyses when nothing has been chosen.
 *
 * Its own module because it is needed on BOTH sides: `lib/team.ts` resolves the cookie on
 * the server and imports `next/headers`, which a client component may not touch — so the
 * Settings panel could not read the constant from there to label its "Default (…)" option.
 * It was labelling that option with `league.teams[0]` instead, which showed
 * "Default (Born In The Darkness)" while every page was in fact analysing VJ Maxx.
 *
 * Mirrors DEFAULT_TEAM_NAME in engine/config.py.
 */
export const DEFAULT_TEAM_NAME = "VJ Maxx";
