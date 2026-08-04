import Link from "next/link";

/**
 * A player's name, linked to their Player Card.
 *
 * ONE component for every player name in the app, so the URL shape lives in a single
 * place and every surface — cheat sheet, box score, roster, streamers, trade — behaves
 * the same. Renders a plain <span> when there is no name, so a caller never has to
 * branch to avoid an empty link.
 *
 * Deliberately NOT styled as a link by default: these appear inside dense tables where
 * a page of blue underlined names would be unreadable. `.plink` inherits its colour and
 * only reveals itself on hover; a caller that wants the name to look clickable at rest
 * (the cheat sheet, where it is the primary action) passes its own class.
 *
 * A server component — it holds no state — so it can be used from both server and
 * client components.
 */
export default function PlayerLink({
  name,
  className = "",
  children,
}: {
  name: string | null | undefined;
  className?: string;
  /** Defaults to the name itself; pass children to decorate it. */
  children?: React.ReactNode;
}) {
  if (!name) return <span className={className}>{children ?? "—"}</span>;
  return (
    <Link
      href={`/player?name=${encodeURIComponent(name)}`}
      className={`plink ${className}`.trim()}
      title={`${name} — player card`}
    >
      {children ?? name}
    </Link>
  );
}
