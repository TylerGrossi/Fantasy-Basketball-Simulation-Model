import HistoryShell from "@/components/HistoryShell";
import { HeadToHeadTable } from "@/components/CareerHistoryView";

export default function Page() {
  return (
    <HistoryShell title="Head to head">
      {(log) => <HeadToHeadTable log={log} />}
    </HistoryShell>
  );
}
