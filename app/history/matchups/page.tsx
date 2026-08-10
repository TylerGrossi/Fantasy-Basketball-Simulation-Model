import HistoryShell from "@/components/HistoryShell";
import { MatchupsTable } from "@/components/CareerHistoryView";
import { MatchupFeed } from "@/components/MatchupFeed";

/**
 * Every matchup ever played, twice: the scores feed on a phone, the sortable
 * nine-column table on a laptop. See the `.only-app` / `.only-web` block in globals.css.
 */
export default function Page() {
  return (
    <HistoryShell title="Matchups">
      {(log) => (
        <>
          <div className="only-app">
            <MatchupFeed log={log} />
          </div>
          <div className="only-web">
            <MatchupsTable log={log} />
          </div>
        </>
      )}
    </HistoryShell>
  );
}
