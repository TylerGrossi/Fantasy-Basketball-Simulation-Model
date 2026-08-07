import HistoryShell from "@/components/HistoryShell";
import { HeadToHeadTable } from "@/components/CareerHistoryView";

export default function Page() {
  return (
    <HistoryShell
      title="Head to head"
      intro="Grouped by manager, not team name. Cats/wk covers category seasons only — 2017-18 was a points league."
    >
      {(log) => <HeadToHeadTable log={log} />}
    </HistoryShell>
  );
}
