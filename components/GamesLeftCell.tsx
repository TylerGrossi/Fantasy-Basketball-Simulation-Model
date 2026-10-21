import { scheduledGames, type PlayerRow } from "@/lib/league";
import { formatGames } from "@/lib/liveAdjust";

/**
 * The GL cell: the player's scheduled games, plus — when the daily slot cap means some of
 * them won't count — how many the projection actually gives him, muted beside it.
 *
 * "3 (1)" rather than either number alone. The schedule is what GL means, but the
 * projection (and every Δ built on it) uses the counted figure, and a row whose math
 * quietly disagreed with its own GL would be the more confusing bug.
 */
export default function GamesLeftCell({ player }: { player: PlayerRow }) {
  const scheduled = scheduledGames(player);
  const counted = player.gamesLeft;
  return (
    <td className="num">
      {formatGames(scheduled)}
      {counted < scheduled - 0.05 && (
        <span
          className="gl-counted"
          title={`${formatGames(scheduled)} games on his schedule, ${formatGames(counted)} counted — on the other nights more of your roster plays than you have starting slots, and higher scorers take them.`}
        >
          {" "}({formatGames(counted)})
        </span>
      )}
    </td>
  );
}
