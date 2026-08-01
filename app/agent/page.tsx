import AgentView from "@/components/AgentView";
import { apiKey } from "@/lib/gemini";
import { loadLeague, myTeam } from "@/lib/loadLeague";

export const dynamic = "force-dynamic";

/**
 * The AI assistant. No page title or caption: the chat's own greeting is the heading, and
 * a "Agent" H1 above a chatbot that already says hello is one heading too many.
 *
 * Only the team NAME and whether a key EXISTS cross to the client — the tools run
 * server-side in /api/agent, which is also where the key itself stays. Saying so up front
 * beats letting someone type a question and get "the assistant is unavailable" back.
 */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  return <AgentView teamName={me.name} configured={Boolean(apiKey())} />;
}
