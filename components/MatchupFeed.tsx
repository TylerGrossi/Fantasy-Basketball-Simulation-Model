import { canonicalOwner, gameLog, type CareerLog } from "@/lib/career";

/**
 * Every matchup ever played, as a scores FEED rather than a nine-column table.
 *
 * The shape is the one every sports app uses for a schedule — the two scores on the
 * outside, the state of the game in the middle — because that is what this data is. The
 * table it replaces spent three of its columns (Season, Week, Type) repeating the same
 * answer down 128 rows and split the score across two more, so reading one week meant
 * assembling it from five cells. Here a row is one line: who, what it finished, who.
 *
 * YOU ARE ALWAYS ON THE LEFT. The export has no home/away — a fantasy matchup has no
 * venue — so the side is used for identity instead, and a column that never moves is
 * scannable in a way an alternating one is not. Left because it is read first, and this
 * is a log of YOUR seasons: your score is the one being looked up.
 *
 * The WINNER is the side left at full contrast; the loser drops to `--ink-3`. That is the
 * whole result indicator, exactly as it is in the apps this borrows from. No green and no
 * red: 128 rows of two-colour scoring is a barcode, and the outcome is already legible
 * from which number is brighter.
 */

/** "2024-25" — the year alone is ambiguous once the log spans nine of them. */
const seasonLabel = (s: number) => `${s - 1}-${String(s % 100).padStart(2, "0")}`;

export function MatchupFeed({ log }: { log: CareerLog }) {
  const games = gameLog(log);

  /*
   * The season's own record, off the season row rather than counted from the weeks below.
   *
   * These are two different figures and the heading wants the bigger one: tallying the
   * rows gives the MATCHUP record (15-4-2 weeks), while `season.record` is the CATEGORY
   * record (185-92-8) — the same unit as every score in the feed underneath it, and the
   * same figure the Seasons page prints for that year.
   */
  const record = new Map<number, number[]>();
  for (const s of log.seasons) record.set(s.season, s.record);

  // Newest first, which is the order `gameLog` already returns. Grouped so the season is
  // written once as a heading instead of once per row.
  const seasons: { season: number; rows: typeof games }[] = [];
  for (const g of games) {
    const last = seasons[seasons.length - 1];
    if (last && last.season === g.season) last.rows.push(g);
    else seasons.push({ season: g.season, rows: [g] });
  }

  return (
    <div className="msf">
      {seasons.map(({ season, rows }) => {
        const [w = 0, l = 0, t = 0] = record.get(season) ?? [];
        // Stated once, on the heading, rather than as a Type column on every row: a
        // league scores one way all year, and 1,643.0 next to 9 needs the warning.
        const points = rows.some((g) => g.scoring === "points");

        /*
         * Playoff weeks numbered as ROUNDS, not by their period.
         *
         * ESPN's playoff weeks carry on from the regular season, so the first printing of
         * this feed read "PO 20" and "PO 21" — period ids, which mean nothing next to the
         * "Week 19" above them. Ordering the season's distinct playoff weeks gives R1, R2,
         * R3, which is what the round actually is. (A round can span two internal period
         * ids; ordering by week rather than counting them keeps that harmless.)
         */
        const poRound = new Map<number, number>();
        [...new Set(rows.filter((g) => g.playoff).map((g) => g.week))]
          .sort((a, b) => a - b)
          .forEach((week, idx) => poRound.set(week, idx + 1));

        return (
          <section key={season} className="msf-season">
            <h2 className="msf-head">
              <span>{seasonLabel(season)}</span>
              <span className="msf-head-meta mono">
                {w}-{l}
                {t ? `-${t}` : ""}
                {points ? " · points league" : " · categories"}
              </span>
            </h2>

            <ol className="msf-list">
              {rows.map((g, i) => {
                const bye = g.bye || g.result === "BYE";
                const fmt = (v: number) =>
                  g.scoring === "points" ? v.toFixed(1) : String(v);
                // Canonical, so a season a manager co-owned reads as that manager rather
                // than as both names run together — same rule as the head-to-head table.
                const opp = canonicalOwner(g.oppOwner) || g.oppTeam || "—";
                const won = g.result === "W";
                const lost = g.result === "L";

                return (
                  <li key={`${g.season}-${g.week}-${i}`} className="msf-row">
                    <span className="msf-side msf-left">
                      <b className={`mono${won ? "" : lost ? " msf-dim" : ""}`}>
                        {bye ? "—" : fmt(g.scoreFor)}
                      </b>
                      <em className="msf-you">{g.teamName}</em>
                    </span>

                    <span className="msf-mid">
                      <b>{bye ? "Bye" : "Final"}</b>
                      <em className="mono">
                        {g.playoff
                          ? `PO R${poRound.get(g.week) ?? 1}`
                          : `Week ${g.week ?? "—"}`}
                      </em>
                    </span>

                    <span className="msf-side msf-right">
                      <b className={`mono${lost ? "" : won ? " msf-dim" : ""}`}>
                        {bye ? "—" : fmt(g.scoreAgainst)}
                      </b>
                      <em>{bye ? "Bye week" : opp}</em>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

export default MatchupFeed;
