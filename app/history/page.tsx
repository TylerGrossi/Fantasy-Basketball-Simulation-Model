import HistoryShell from "@/components/HistoryShell";
import { CareerStrip, SeasonShelf } from "@/components/SeasonShelf";
import {
  CareerStrip as WideCareerStrip,
  SeasonsTable,
} from "@/components/CareerHistoryView";
import { CareerArcChart } from "@/components/HistoryCharts";

/**
 * The History landing page: career totals, the seasons, then the arc.
 *
 * The seasons render TWICE — the shelf on a phone, the eight-column table on a laptop —
 * and the career strip with them, since the shelf's two slim tiles are sized to sit above
 * the shelf and the five tiles to sit above the table. See the `.only-app` / `.only-web`
 * block in globals.css for why both ship and how the breakpoint picks.
 *
 * The arc chart is NOT duplicated. It is one chart that reads the same at both widths.
 */
export default function Page() {
  return (
    <HistoryShell title="History">
      {(log) => (
        <>
          <div className="only-app">
            <CareerStrip log={log} />
            <SeasonShelf log={log} />
          </div>
          <div className="only-web">
            <WideCareerStrip log={log} />
            <h2>Season by season</h2>
            <SeasonsTable log={log} />
          </div>
          <CareerArcChart log={log} />
        </>
      )}
    </HistoryShell>
  );
}
