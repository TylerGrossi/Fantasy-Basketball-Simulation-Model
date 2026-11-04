import type { ReactNode } from "react";

/**
 * One recommendation, one line (owner, 2026-11-03), the format the Bench section's crowded
 * days set: an optional lead (a date), the call in bold after "Recommend:", then the
 * numbers behind it in brackets. Every section that makes a call uses this, so they all
 * read the same way:
 *
 *   Wed 11/4; Recommend: Sit Zach LaVine (+0.144 cats and +0.9% win; 0.035 cats better
 *   than the next-best option)
 */
export default function RecLine({
  lead,
  label = "Recommend",
  children,
  why,
  tone,
}: {
  /** Shown first, then a semicolon — a date, usually. */
  lead?: ReactNode;
  /** "Recommend" by default; "Focus", "Plan" where that reads truer. */
  label?: string;
  /** The call itself, set in bold. */
  children: ReactNode;
  /** The numbers behind it, in brackets. */
  why?: ReactNode;
  /** Colours the call: "go" (cobalt) for doing something, "hold" (clay) for not. */
  tone?: "go" | "hold";
}) {
  return (
    <p className={`rec-line${tone ? ` rec-${tone}` : ""}`}>
      {lead != null && (
        <>
          <span className="mono">{lead}</span>;{" "}
        </>
      )}
      <span className="rec-label">{label}:</span> <b className="rec-call">{children}</b>
      {why != null && <span className="rec-why"> ({why})</span>}
    </p>
  );
}
