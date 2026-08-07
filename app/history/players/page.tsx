import HistoryShell from "@/components/HistoryShell";
import { HallOfFameStrip, PlayersTable } from "@/components/CareerHistoryView";

export default function Page() {
  return (
    <HistoryShell title="Players">
      {(log) => (
        <>
          <HallOfFameStrip log={log} />
          <PlayersTable log={log} />
        </>
      )}
    </HistoryShell>
  );
}
