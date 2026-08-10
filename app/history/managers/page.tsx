import HistoryShell from "@/components/HistoryShell";
import { ManagersTable } from "@/components/CareerHistoryView";
import { ManagerRangeChart } from "@/components/HistoryCharts";

export default function Page() {
  return (
    <HistoryShell title="Managers">
      {(log) => (
        <>
          <ManagersTable log={log} />
          <ManagerRangeChart log={log} />
        </>
      )}
    </HistoryShell>
  );
}
