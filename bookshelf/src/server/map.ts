import prisma from "@/lib/prisma";
import { getWorksByKeys } from "./catalog";

/**
 * Everything the world map renders.
 *
 * Locations are keyed by catalog work and author keys, so the display data
 * (title, author name) is hydrated separately rather than joined — `app` holds
 * no foreign key into `catalog`.
 */

export interface MappedWorkLocation {
  id: string;
  name: string;
  type: string;
  coordinates: { lat: number; lng: number };
  workKey: string;
  workTitle: string;
  workAuthor: string | null;
  coverId: number | null;
  fictionalWorldName: string | null;
  addedBy: string | null;
}

export interface MappedAuthorLocation {
  id: string;
  name: string;
  type: string;
  coordinates: { lat: number; lng: number };
  authorKey: string;
  authorName: string;
  yearStart: number | null;
  yearEnd: number | null;
  addedBy: string | null;
}

/**
 * Most pins the map will render in one response.
 *
 * /map is public, anonymous, and PRD R6 has just made it discoverable, so this
 * table is meant to grow — and every load ran two unbounded findMany calls plus
 * a getWorksByKeys hydration over every distinct workKey, serialised whole into
 * the RSC payload and handed to Leaflet. One account inserting in a loop through
 * the (previously unrated) contribution routes made the page unservable for
 * everyone.
 *
 * A cap rather than pagination because a map is not a list: the right fix is a
 * viewport query, which is a design change. Newest first, so a cap that bites
 * shows recent contributions rather than an arbitrary slice. Recorded as
 * remaining work.
 */
export const MAP_PIN_LIMIT = 2000;

/** Real-world book locations. Fictional ones belong to a world, not a point. */
export async function getMappedWorkLocations(): Promise<MappedWorkLocation[]> {
  const locations = await prisma.workLocation.findMany({
    where: { isFictional: false, lat: { not: null }, lng: { not: null } },
    include: {
      fictionalWorld: { select: { name: true } },
      addedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: MAP_PIN_LIMIT,
  });

  const works = await getWorksByKeys(locations.map((l) => l.workKey));

  return locations.map((loc) => {
    const work = works.get(loc.workKey);
    return {
      id: loc.id,
      name: loc.name,
      type: loc.type,
      // The where clause guarantees both are present.
      coordinates: { lat: loc.lat!, lng: loc.lng! },
      workKey: loc.workKey,
      // A location can outlive its work leaving the catalog slice; showing the
      // pin with a placeholder beats dropping a contribution off the map.
      workTitle: work?.title ?? "Unknown work",
      workAuthor: work?.authorNames ?? null,
      coverId: work?.coverId ?? null,
      fictionalWorldName: loc.fictionalWorld?.name ?? null,
      addedBy: loc.addedBy?.name ?? null,
    };
  });
}

export async function getMappedAuthorLocations(): Promise<
  MappedAuthorLocation[]
> {
  const locations = await prisma.authorLocation.findMany({
    include: { addedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: MAP_PIN_LIMIT,
  });

  if (locations.length === 0) return [];

  const names = await prisma.$queryRaw<{ olKey: string; name: string }[]>`
    SELECT ol_key AS "olKey", name FROM catalog.authors
    WHERE ol_key = ANY(${[...new Set(locations.map((l) => l.authorKey))]})
  `;
  const nameByKey = new Map(names.map((n) => [n.olKey, n.name]));

  return locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: loc.type,
    coordinates: { lat: loc.lat, lng: loc.lng },
    authorKey: loc.authorKey,
    authorName: nameByKey.get(loc.authorKey) ?? "Unknown author",
    yearStart: loc.yearStart,
    yearEnd: loc.yearEnd,
    addedBy: loc.addedBy?.name ?? null,
  }));
}
