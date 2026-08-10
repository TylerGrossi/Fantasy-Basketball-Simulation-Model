import HistoryShell from "@/components/HistoryShell";
import { CareerStrip, SeasonShelf } from "@/components/SeasonShelf";
import { CareerArcChart } from "@/components/HistoryCharts";

/** The History landing page: career totals, the season shelf, then the arc. */
export default function Page() {
  return (
    <HistoryShell title="History">
      {(log) => (
        <>
          <CareerStrip log={log} />
          <SeasonShelf log={log} />
          <CareerArcChart log={log} />
        </>
      )}
    </HistoryShell>
  );
}
