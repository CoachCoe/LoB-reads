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
  _count: { select: { works: true } },
  maps: { select: mapSelect, orderBy: { createdAt: "desc" as const } },
};

type WorldRow = {
  id: string;
  name: string;
  description: string | null;
  maps: FictionalWorldMap[];
  _count: { works: number };
};

const toWorld = (row: WorldRow): FictionalWorldWithWorks => ({
  id: row.id,
  name: row.name,
  description: row.description,
  maps: row.maps,
  workCount: row._count.works,
});

export async function getAllFictionalWorlds(): Promise<FictionalWorldWithWorks[]> {
  const rows = await prisma.fictionalWorld.findMany({
    include: fictionalWorldInclude,
    orderBy: { name: "asc" },
  });
  return rows.map(toWorld);
}

export async function getFictionalWorldById(
  id: string
): Promise<FictionalWorldWithWorks | null> {
  const row = await prisma.fictionalWorld.findUnique({
    where: { id },
    include: fictionalWorldInclude,
  });
  return row ? toWorld(row) : null;
}

export async function createFictionalWorld(
  name: string,
  description?: string
): Promise<FictionalWorldWithWorks> {
  return toWorld(
    await prisma.fictionalWorld.create({
      data: { name, description },
      include: fictionalWorldInclude,
    })
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
