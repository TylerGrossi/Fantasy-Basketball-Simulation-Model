/**
 * The team-preference cookie name, in its own module with NO server imports.
 *
 * `lib/team.ts` imports `next/headers`, which cannot be pulled into a client component —
 * webpack fails the build outright. The Settings UI is a client component and needs the
 * name to write the cookie, so the constant lives here and both sides import it.
 */
export const TEAM_COOKIE = "fbb_team";
