/**
 * What the SITE itself can show — the pages, and the sections on them.
 *
 * The agent knows the league's NUMBERS through its tools, but it had no idea what the app
 * around it looks like, so "where do I see that?" got a generic answer or an invented one.
 * This is the map.
 *
 * It is a tour, not a tool list. The agent should answer the question first and then point
 * at the page — never redirect instead of answering.
 *
 * KEEP THIS IN STEP WITH lib/nav.ts AND THE PLAYER CARD. It is a hand-written description
 * of a UI that changes, which means it can go stale silently: if a page moves or a section
 * is renamed, fix it here in the same commit. Kept in its own file so the prompt in
 * agentTools.ts stays about BEHAVIOUR and this stays about layout.
 */
export const APP_TOUR = [
  "WHERE THINGS LIVE IN THIS APP. If the user asks where to find something, or would",
  "obviously benefit from a page, name it. Answer the question first, then point.",
  "",
  "- Season Summary (/season): the season at a glance.",
  "- Current Matchup: Scoreboard, Matchup (win probability, score distribution, category",
  "  analysis), Streamers, Bench, Roster. These are in-season pages, and the matchup view",
  "  moves through pre-week -> mid-week -> final on its own as games are played.",
  "- League: Schedule, Season Stats, League Stats (standings, season category totals, and",
  "  the transaction counter), Power Rankings, Rosters, Recent Moves.",
  "- Tools: Player Card, Player Value, Trade Simulator, Compare, Lineup, Cheat Sheets,",
  "  Playoff Odds.",
  "- History: every season this manager has played since 2017-18, across five different",
  "  league ids — Seasons, Players (career stats plus a franchise Hall of Fame rating),",
  "  Head to Head, Managers, Matchups.",
  "",
  "THE PLAYER CARD (/player?name=Full+Name) is the deepest page, and you can link straight",
  "to any player. It shows:",
  "- A bio rail, and a Season / 30 Day / 15 Day table carrying each window's value.",
  "- League Percentile Rankings: every category as a percentile bar, plus Total, Offensive",
  "  and Defensive Value — offence and defence sum exactly to the total — and Team Wins",
  "  under 'Other'. Team Wins is a scored category in this league but is deliberately NOT",
  "  part of the 9-cat value. A window with too few games reads 'Not qualified' rather",
  "  than guessing a rank.",
  "- A 10-game rolling value line across the season.",
  "- Category Shape: the nine categories as a percentile radar, so a player's profile is",
  "  one silhouette instead of nine numbers.",
  "- Similar Players: nearest neighbours by CATEGORY PROFILE rather than by total value.",
  "  This is the right answer to 'who replaces my injured big' — it matches what a player",
  "  DOES, not merely how much he is worth.",
  "- Volume vs Efficiency: shooting possessions against points per possession with the",
  "  whole pool plotted, which is how you tell a real rate from low usage. Desktop only.",
  "- Splits (by month, home/away, and rest including back-to-backs), By Opponent Defense",
  "  (top-10 / middle / bottom-10 defences), Consistency (median night, spread, share of",
  "  startable games, best and worst games), the full Game Log, and Availability (missed",
  "  games grouped into stints).",
  "",
  "Every number on that page is on the same value scale the tools return, so a figure you",
  "quote and a figure the user reads there will agree.",
  "",
].join("\n");
