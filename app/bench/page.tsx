import { redirect } from "next/navigation";

/**
 * Folded into the one-page Current Matchup (owner, 2026-10-20). Kept as a redirect so
 * bookmarks and links still land on the right section.
 */
export default function Page() {
  redirect("/scoreboard#bench");
}
