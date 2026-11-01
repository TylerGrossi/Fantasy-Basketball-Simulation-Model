import Link from "next/link";

/**
 * A fantasy team's name, linked to its Team Card (`/team?id=`).
 *
 * The team counterpart of PlayerLink: one place for the URL shape, and the same `.plink`
 * styling - inherits its colour inside dense tables and only reveals itself on hover.
 * A server component, so it works from both server and client components.
 */
export default function TeamLink({
  id,
  name,
  className = "",
}: {
  id: number;
  name: string;
  className?: string;
}) {
  return (
    <Link
      href={`/team?id=${id}`}
      className={`plink ${className}`.trim()}
      title={`${name} — team card`}
    >
      {name}
    </Link>
  );
}
