import { loadCareer } from "@/lib/loadLeague";
import type { CareerLog } from "@/lib/career";

/**
 * The wrapper every /history page shares: title, blurb, and the one empty state.
 *
 * Exists so the "no career.json yet" message is written ONCE. Five pages each rolling
 * their own would be five chances for the instructions to drift out of step with the
 * script that actually produces the file.
 */
export default async function HistoryShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: React.ReactNode;
  children: (log: CareerLog) => React.ReactNode;
}) {
  const log = await loadCareer();

  if (!log?.seasons?.length) {
    return (
      <>
        <h1>{title}</h1>
        <p className="notice">
          No career history yet. Build it with{" "}
          <code>python scripts/build_history.py</code> — it sweeps every past league and
          season you have played in and writes <code>public/data/career.json</code>. It is
          deliberately not part of the hourly export: finished seasons never change.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{title}</h1>
      {intro && <p className="caption">{intro}</p>}
      {children(log)}
    </>
  );
}
