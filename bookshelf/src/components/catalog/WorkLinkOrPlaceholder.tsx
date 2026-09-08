import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Wrap something in a link to a work — but only if that work is still in the
 * catalog.
 *
 * AGENTS.md, project invariants: "Read paths tolerate a missing work. An
 * ingest can narrow the slice and drop a work someone has shelved; those render
 * as 'not in the current catalog' **and are not linked**, because the work page
 * 404s on a key the current slice lacks."
 *
 * ReviewCard and WorkGrid honoured that. ShelfSection, CurrentlyReadingCard and
 * ActivityFeed rendered the placeholder and then linked it anyway — ShelfSection
 * wrapped a card whose own title read "Not in the current catalog" in a Link.
 * AGENTS.md also claims "Each of these has a test that fails if it is broken",
 * and this clause had none.
 *
 * A component rather than a corrected `href` at each site, because the shape
 * that keeps going wrong is structural: the link wraps the card, so honouring
 * the rule means not rendering an element rather than changing an attribute.
 * Four copies of that is how one stays wrong.
 */
export default function WorkLinkOrPlaceholder({
  workKey,
  inCatalog,
  className,
  children,
}: {
  workKey: string;
  /** False when the work has left the current catalog slice. */
  inCatalog: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!inCatalog) {
    return <div className={className}>{children}</div>;
  }

  return (
    <Link href={`/work/${workKey}`} className={className}>
      {children}
    </Link>
  );
}
