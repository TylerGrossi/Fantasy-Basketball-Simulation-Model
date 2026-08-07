import { phaseNote, type Phase } from "@/lib/matchupPhase";

/**
 * The "this is simulated" notice, shown only when a page is rendering a SYNTHETIC phase.
 *
 * It used to carry a Pre-week / Mid-week / Final switcher as well. That came out: which
 * phase a week is in is a fact about the week, not a user setting, and in season the page
 * moves through the three states on its own as games are played. What survives is the
 * labelling, which is the safety property — a synthetic week that reads as a live one is
 * worse than no preview at all (see the header in lib/matchupPhase.ts). Anything that can
 * enter a phase renders this, so there is exactly one place to check that it says so.
 */
export default function PhaseBanner({ phase }: { phase: Phase | null }) {
  if (!phase) return null;
  const { label, note } = phaseNote(phase);
  return (
    <p className="notice ph-note">
      <strong>{label} — simulated, not live.</strong> The season is over, so every real
      matchup has zero games left, and with no games left there is no variance: every
      probability collapses to 0% or 100%. This rebuilds the week from the real rosters,
      averages and injuries — {note}. Nothing here is a live number.
    </p>
  );
}
