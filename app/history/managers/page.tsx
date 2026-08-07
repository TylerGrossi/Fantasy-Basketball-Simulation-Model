import HistoryShell from "@/components/HistoryShell";
import { ManagersTable } from "@/components/CareerHistoryView";
import { ManagerRangeChart } from "@/components/HistoryCharts";

export default function Page() {
  return (
    <HistoryShell
      title="Managers"
      intro="Everyone you've shared a league with, across all of them, ranked by titles then win %."
    >
      {(log) => (
        <>
          <ManagersTable log={log} />
          <ManagerRangeChart log={log} />
        </>
      )}
    </HistoryShell>
  );
}
