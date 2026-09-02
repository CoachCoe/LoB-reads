import prisma from "@/lib/prisma";
import { AuthorizationError, NotFoundError } from "@/lib/http/errors";
import { LOCATIONS_PER_ENTITY } from "@/server/work-locations";

/**
 * Author pages and their crowdsourced locations.
 *
 * Authors themselves come from the catalog; only the locations are ours. The
 * local Author table is gone — it existed only because there was no author
 * catalog to point at.
 */

export interface AuthorLocationData {
  id: string;
  name: string;
  type: string;
  description: string | null;
  coordinates: { lat: number; lng: number };
  yearStart: number | null;
  yearEnd: number | null;
  /** Null once the contributing account has been deleted. */
  addedBy: { id: string; name: string } | null;
  createdAt: Date;
}

/**
 * Works listed on an author page.
 *
 * The query had an ORDER BY and no LIMIT, so a prolific author — or a
 * compilation-heavy author key, against 3.2M authors and 6.9M works — meant an
 * unbounded query and an unbounded DOM.
 */
export const AUTHOR_WORKS_LIMIT = 100;

export interface CatalogAuthorDetail {
  olKey: string;
  name: string;
  birthDate: string | null;
  deathDate: string | null;
  bio: string | null;
  works: {
    olKey: string;
    title: string;
    firstPublishYear: number | null;
    coverId: number | null;
  }[];
  /**
   * How many works this author has in the catalog, which is not
   * `works.length` — that is capped at AUTHOR_WORKS_LIMIT. Rendering the capped
   * figure as the total is the same defect as showing a shelf's preview size as
   * its book count.
   */
  workCount: number;
  locations: AuthorLocationData[];
}

export async function getAuthorByKey(
  authorKey: string
): Promise<CatalogAuthorDetail | null> {
  const [author] = await prisma.$queryRaw<
    Array<{
      olKey: string;
      name: string;
      birthDate: string | null;
      deathDate: string | null;
      bio: string | null;
    }>
  >`
    SELECT ol_key AS "olKey", name, birth_date AS "birthDate",
           death_date AS "deathDate", bio
    FROM catalog.authors WHERE ol_key = ${authorKey}
  `;

  if (!author) return null;

  const [works, countRows, locations] = await Promise.all([
    prisma.$queryRaw<CatalogAuthorDetail["works"]>`
      SELECT w.ol_key AS "olKey", w.title,
             w.first_publish_year AS "firstPublishYear",
             e.cover_id::int AS "coverId"
      FROM catalog.work_authors wa
      JOIN catalog.works w ON w.ol_key = wa.work_key
      LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
      WHERE wa.author_key = ${authorKey}
      ORDER BY w.first_publish_year NULLS LAST, w.title
      LIMIT ${AUTHOR_WORKS_LIMIT}
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM catalog.work_authors WHERE author_key = ${authorKey}
    `,
    getAuthorLocations(authorKey),
  ]);

  return {
    ...author,
    works,
    workCount: Number(countRows[0]?.count ?? works.length),
    locations,
  };
}

/** Resolve a display name to a catalog author, for name-based URLs. */
/**
 * The catalog key for an author name, most prolific first when names collide.
 *
 * Compares against `name_norm`, not `lower(a.name)`. Two reasons, both from
 * DEAD-4 — and catalog.ts:16-20 states the rule: "Comparisons therefore go
 * against `title_norm` / `author_names_norm`, never `lower(unaccent(title))`…
 * Wrapping the column is how the fuzzy path silently became a sequential scan
 * once already."
 *
 * `catalog.authors` had no index but its primary key, so wrapping the column
 * meant every author page load and every location read or write scanned 3.2M
 * rows. And `lower()` does not fold accents, so this returned null for "Gabriel
 * Garcia Marquez" while `findWorkKeyByTitleAuthor` matched the same query
 * through `works.author_names_norm` — leaving the location routes answering
 * "That author is not in the catalog" for an author whose page the reader was
 * looking at.
 *
 * The ORDER BY stays a correlated count, which is fine now that it runs over the
 * handful of rows an indexed equality returns rather than every match of a
 * sequential scan.
 */
export async function findAuthorKeyByName(
  name: string
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ olKey: string }[]>`
    SELECT a.ol_key AS "olKey"
    FROM catalog.authors a
    WHERE a.name_norm = lower(unaccent(${name}))
    ORDER BY (SELECT count(*) FROM catalog.work_authors wa
              WHERE wa.author_key = a.ol_key) DESC
    LIMIT 1
  `;
  return rows[0]?.olKey ?? null;
}

export async function getAuthorLocations(
  authorKey: string
): Promise<AuthorLocationData[]> {
  const locations = await prisma.authorLocation.findMany({
    where: { authorKey },
    include: { addedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: LOCATIONS_PER_ENTITY,
  });

  return locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: loc.type,
    description: loc.description,
    coordinates: { lat: loc.lat, lng: loc.lng },
    yearStart: loc.yearStart,
    yearEnd: loc.yearEnd,
    addedBy: loc.addedBy,
    createdAt: loc.createdAt,
  }));
}

export async function addAuthorLocation(
  authorKey: string,
  userId: string,
  data: {
    name: string;
    type: string;
    description?: string;
    coordinates: { lat: number; lng: number };
    yearStart?: number;
    yearEnd?: number;
  }
) {
  const exists = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM catalog.authors WHERE ol_key = ${authorKey}) AS exists
  `;
  if (!exists[0]?.exists) {
    throw new NotFoundError("That author is not in the catalog");
  }

  return prisma.authorLocation.create({
    data: {
      authorKey,
      addedById: userId,
      name: data.name,
      type: data.type,
      description: data.description ?? null,
      lat: data.coordinates.lat,
      lng: data.coordinates.lng,
      yearStart: data.yearStart ?? null,
      yearEnd: data.yearEnd ?? null,
    },
    include: { addedBy: { select: { id: true, name: true } } },
  });
}

/**
 * PRD section 2 states the rule for contributed content: "anyone signed in may
 * edit, uploader-or-moderator may delete." The moderator half was implemented
 * for fictional-world maps and for neither location type, so there was no way to
 * remove an abusive pin from the public map at all.
 *
 * It was worse than an inconvenience: `addedById` is nullable with
 * `onDelete: SetNull`, deliberately, so contributions outlive the account that
 * made them. Once a contributor deleted their account the column was NULL,
 * `NULL !== userId` held for every caller, and nobody could ever delete that pin.
 */
export async function deleteAuthorLocation(
  locationId: string,
  userId: string,
  isModerator = false
) {
  const location = await prisma.authorLocation.findUnique({
    where: { id: locationId },
    select: { addedById: true },
  });

  if (!location) {
    throw new NotFoundError("Location not found");
  }

  if (!isModerator && location.addedById !== userId) {
    throw new AuthorizationError(
      "You can only remove locations you contributed"
    );
  }

  return prisma.authorLocation.delete({ where: { id: locationId } });
}
