/**
 * The column order for stat TABLES (owner, 2026-10-30): the headline line first — PTS,
 * REB, AST, STL, BLK — then shooting, then the rest. The Player Card's Career tab set it.
 *
 * SCOREBOARDS keep ESPN's own order (`league.categories`: FGM … PTS, TW), because that is
 * the sheet the league reads on ESPN every week. So do the category-analysis bars and the
 * home page's "Your Matchup by Category". Everything else that lays categories out as
 * columns goes through `careerOrder`.
 */
export const CAREER_ORDER = [
  "PTS", "REB", "AST", "STL", "BLK",
  "FGM", "FGA", "FG%", "3PM", "3PA", "3P%", "FTM", "FTA", "FT%",
  "TO", "DD", "TW",
];

/** `cats` sorted into CAREER_ORDER; anything it doesn't name keeps its place at the end. */
export function careerOrder<T extends string>(cats: readonly T[]): T[] {
  const rank = (c: string) => {
    const i = CAREER_ORDER.indexOf(c);
    return i < 0 ? CAREER_ORDER.length : i;
  };
  return [...cats].sort((a, b) => rank(a) - rank(b));
}
