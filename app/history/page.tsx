import HistoryShell from "@/components/HistoryShell";
import { CareerStrip, SeasonsTable } from "@/components/CareerHistoryView";
import { CareerArcChart } from "@/components/HistoryCharts";

/** The History landing page: career totals, a row per season, then the arc. */
export default function Page() {
  return (
    <HistoryShell title="History">
      {(log) => (
        <>
          <CareerStrip log={log} />
          <h2>Season by season</h2>
          <SeasonsTable log={log} />
          <CareerArcChart log={log} />
        </>
      )}
    </HistoryShell>
  );
}
