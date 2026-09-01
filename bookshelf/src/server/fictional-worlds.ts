import prisma from "@/lib/prisma";

export interface FictionalWorldMap {
  id: string;
  imageUrl: string;
  title: string;
  description: string | null;
  addedById: string;
  createdAt: Date;
}

/** Shared shape for map reads — `addedById` is what the delete check reads. */
const mapSelect = {
  id: true,
  imageUrl: true,
  title: true,
  description: true,
  addedById: true,
  createdAt: true,
} as const;

export interface FictionalWorldWithWorks {
  id: string;
  name: string;
  description: string | null;
  maps: FictionalWorldMap[];
  workCount: number;
}

const fictionalWorldInclude = {
  maps: { select: mapSelect, orderBy: { createdAt: "desc" as const } },
};

type WorldRow = {
  id: string;
  name: string;
  description: string | null;
  maps: FictionalWorldMap[];
};

/**
 * How many distinct works are set in each world.
 *
 * Counted from `app.work_locations`, which is the table readers actually write:
 * `WorkLocationsSection` posts a location with `isFictional` and a
 * `fictionalWorldId`. The panel used to count `app.work_fictional_worlds`
 * instead — a table with no write path anywhere in the application, populated
 * only by `prisma/seed.ts` — so outside a dev database every world reported
 * "0 books" however many were pinned to it (audit SPEC-7, decision OQ-8).
 *
 * DISTINCT because one work can carry several locations in the same world; the
 * panel says "books", not "places".
 */
async function workCountsByWorld(
  worldIds: string[]
): Promise<Map<string, number>> {
  if (worldIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<
    { fictionalWorldId: string; works: number }[]
  >`
    SELECT fictional_world_id AS "fictionalWorldId",
           count(DISTINCT work_key)::int AS works
    FROM app.work_locations
    WHERE fictional_world_id = ANY(${worldIds})
    GROUP BY fictional_world_id
  `;

  return new Map(rows.map((r) => [r.fictionalWorldId, r.works]));
}

const toWorld = (
  row: WorldRow,
  workCount: number
): FictionalWorldWithWorks => ({
  id: row.id,
  name: row.name,
  description: row.description,
  maps: row.maps,
  workCount,
});

/**
 * Most worlds returned by the public list.
 *
 * There is no delete path for a world anywhere in the API (SEC-6), so spam is
 * permanent until an operator intervenes; a cap keeps that from taking the map
 * page with it.
 */
export const WORLD_LIST_LIMIT = 500;

export async function getAllFictionalWorlds(): Promise<FictionalWorldWithWorks[]> {
  const rows = await prisma.fictionalWorld.findMany({
    include: fictionalWorldInclude,
    orderBy: { name: "asc" },
    // GET /api/fictional-worlds is public and returned every world with every
    // map. Unrated creation made that a one-account denial of the map page.
    take: WORLD_LIST_LIMIT,
  });

  const counts = await workCountsByWorld(rows.map((row) => row.id));
  return rows.map((row) => toWorld(row, counts.get(row.id) ?? 0));
}

export async function getFictionalWorldById(
  id: string
): Promise<FictionalWorldWithWorks | null> {
  const row = await prisma.fictionalWorld.findUnique({
    where: { id },
    include: fictionalWorldInclude,
  });
  if (!row) return null;

  const counts = await workCountsByWorld([row.id]);
  return toWorld(row, counts.get(row.id) ?? 0);
}

export async function createFictionalWorld(
  name: string,
  description?: string
): Promise<FictionalWorldWithWorks> {
  // A world has no locations the moment it is created.
  return toWorld(
    await prisma.fictionalWorld.create({
      data: { name, description },
      include: fictionalWorldInclude,
    }),
    0
  );
}

// Map management functions

export async function addMapToWorld(
  worldId: string,
  userId: string,
  data: { imageUrl: string; title: string; description?: string | null }
): Promise<FictionalWorldMap> {
  return prisma.fictionalWorldMap.create({
    data: {
      fictionalWorldId: worldId,
      addedById: userId,
      imageUrl: data.imageUrl,
      title: data.title,
      description: data.description ?? null,
    },
    select: mapSelect,
  });
}

export async function getMapById(mapId: string) {
  return prisma.fictionalWorldMap.findUnique({
    where: { id: mapId },
    include: {
      fictionalWorld: {
        select: { id: true, name: true },
      },
    },
  });
}

export async function deleteMap(mapId: string): Promise<void> {
  await prisma.fictionalWorldMap.delete({
    where: { id: mapId },
  });
}

export async function updateMap(
  mapId: string,
  userId: string,
  data: { title: string; description?: string | null }
): Promise<FictionalWorldMap> {
  return prisma.fictionalWorldMap.update({
    where: { id: mapId },
    data: {
      title: data.title,
      description: data.description ?? null,
      updatedById: userId,
    },
    select: mapSelect,
  });
}
