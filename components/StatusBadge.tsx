import { playerStatus } from "@/lib/playerPool";

/**
 * The injury chip beside a player's name — ONE component for every list in the app.
 *
 * On a phone a long code is spelled with its first letter: "OUT" becomes "O". The badge
 * sits inside the tightest column on every screen that shows it (the name column), and
 * three letters plus its padding was pushing names onto a second line or truncating them
 * — on the cheat sheet, where the row is a rank, a name, two position tags and a team, it
 * was the difference between "Shai Gilgeous-Alexander" and "Shai Gilgeous-Alexan…".
 *
 * Both spellings are in the markup and CSS picks one (`.pv-badge-full` / `.pv-badge-short`
 * in globals.css), so there is no width detection and no flash of the wrong label. The
 * full word stays in `title` and in the accessible name at every width, and the short form
 * is `aria-hidden`, so nothing is lost to a screen reader.
 *
 * ONLY the codes that are actually long get a short form. "IR" and "Q" are already as
 * short as they go, and shortening "DTD" and "DTF" would collide on "D" — a badge that is
 * ambiguous is worse than one that is wide.
 */
const SHORT: Record<string, string> = { OUT: "O", SUSP: "S" };

export default function StatusBadge({ status }: { status: string | undefined }) {
  const [code, sev] = playerStatus(status);
  if (!code) return null;
  const short = SHORT[code];
  return (
    <span className={`pv-badge ${sev}`} title={code}>
      {short ? (
        <>
          <span className="pv-badge-full">{code}</span>
          <span className="pv-badge-short" aria-hidden="true">
            {short}
          </span>
        </>
      ) : (
        code
      )}
    </span>
  );
}
