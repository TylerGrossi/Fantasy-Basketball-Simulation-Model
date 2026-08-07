import HistoryShell from "@/components/HistoryShell";
import { MatchupsTable } from "@/components/CareerHistoryView";

export default function Page() {
  return (
    <HistoryShell title="Matchups" intro="Every matchup you've ever played, newest first.">
      {(log) => <MatchupsTable log={log} />}
    </HistoryShell>
  );
}
