import HistoryShell from "@/components/HistoryShell";
import { MatchupFeed } from "@/components/MatchupFeed";

export default function Page() {
  return (
    <HistoryShell title="Matchups">
      {(log) => <MatchupFeed log={log} />}
    </HistoryShell>
  );
}
