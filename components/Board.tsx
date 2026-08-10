/**
 * The matchup header as an actual scoreboard: name, score, status, score, name.
 *
 * Extracted because it now renders TWICE on the Scoreboard page — once inside the
 * `.sb-panel` (desktop, where board + category sheet + acquisition line are one framed
 * unit) and once above the You/Matchup/Opp tabs (mobile, where the score has to be visible
 * whichever tab you're on, the way ESPN's app does it). Exactly one of the two is
 * displayed at any width; see `.sbx-board` in globals.css. Both the live week
 * (Scoreboard.tsx) and a completed one (WeekRecap.tsx) build it from the same markup, so
 * it can't drift between them either.
 */
export default function Board({
  youName,
  oppName,
  youScore,
  oppScore,
  tie,
  status,
  youMeta,
  oppMeta,
}: {
  youName: string;
  oppName: string;
  /** Categories won by each side. */
  youScore: number;
  oppScore: number;
  tie: number;
  status: string;
  /** Optional sub-line under each name — the recap prints season records here. */
  youMeta?: string;
  oppMeta?: string;
}) {
  return (
    <div className="board">
      <div className="board-side">
        <span className="board-team board-you">{youName}</span>
        {youMeta && <span className="rc-meta">{youMeta}</span>}
      </div>
      <div className={`board-score ${youScore >= oppScore ? "sb-win" : "sb-lose"}`}>
        {youScore}
      </div>
      <div className="board-center">
        <span className="board-status">{status}</span>
        {tie > 0 && (
          <span className="board-ties">
            {tie} {tie === 1 ? "tie" : "ties"}
          </span>
        )}
      </div>
      <div className={`board-score ${oppScore >= youScore ? "sb-win" : "sb-lose"}`}>
        {oppScore}
      </div>
      <div className="board-side board-side-right">
        <span className="board-team board-opp">{oppName}</span>
        {oppMeta && <span className="rc-meta">{oppMeta}</span>}
      </div>
    </div>
  );
}
