import prisma from "@/lib/prisma";
import { AuthorizationError, NotFoundError } from "@/lib/http/errors";

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

  const [works, locations] = await Promise.all([
    prisma.$queryRaw<CatalogAuthorDetail["works"]>`
      SELECT w.ol_key AS "olKey", w.title,
             w.first_publish_year AS "firstPublishYear",
             e.cover_id::int AS "coverId"
      FROM catalog.work_authors wa
      JOIN catalog.works w ON w.ol_key = wa.work_key
      LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
      WHERE wa.author_key = ${authorKey}
      ORDER BY w.first_publish_year NULLS LAST, w.title
    `,
    getAuthorLocations(authorKey),
  ]);

  return { ...author, works, locations };
}

/** Resolve a display name to a catalog author, for name-based URLs. */
export async function findAuthorKeyByName(
  name: string
): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ olKey: string }[]>`
    SELECT a.ol_key AS "olKey"
    FROM catalog.authors a
    WHERE lower(a.name) = lower(${name})
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

export async function deleteAuthorLocation(locationId: string, userId: string) {
  const location = await prisma.authorLocation.findUnique({
    where: { id: locationId },
    select: { addedById: true },
  });

  if (!location) {
    throw new NotFoundError("Location not found");
  }

  if (location.addedById !== userId) {
    throw new AuthorizationError(
      "You can only remove locations you contributed"
    );
  }

  return prisma.authorLocation.delete({ where: { id: locationId } });
}
