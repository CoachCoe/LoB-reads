import prisma from "@/lib/prisma";

export interface FictionalWorldMap {
  id: string;
  imageUrl: string;
  title: string;
  description: string | null;
  createdAt: Date;
}

export interface FictionalWorldWithBooks {
  id: string;
  name: string;
  description: string | null;
  mapImageUrl: string | null; // DEPRECATED: Use maps instead
  maps: FictionalWorldMap[];
  _count: {
    books: number;
  };
  books: {
    id: string;
    title: string;
    author: string;
    coverUrl: string | null;
  }[];
}

const fictionalWorldInclude = {
  _count: {
    select: { books: true },
  },
  books: {
    select: {
      id: true,
      title: true,
      author: true,
      coverUrl: true,
    },
  },
  maps: {
    select: {
      id: true,
      imageUrl: true,
      title: true,
      description: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc" as const,
    },
  },
};

export async function getAllFictionalWorlds(): Promise<FictionalWorldWithBooks[]> {
  return prisma.fictionalWorld.findMany({
    include: fictionalWorldInclude,
    orderBy: {
      name: "asc",
    },
  });
}

export async function getFictionalWorldById(id: string): Promise<FictionalWorldWithBooks | null> {
  return prisma.fictionalWorld.findUnique({
    where: { id },
    include: fictionalWorldInclude,
  });
}

export async function createFictionalWorld(
  name: string,
  description?: string
): Promise<FictionalWorldWithBooks> {
  return prisma.fictionalWorld.create({
    data: {
      name,
      description,
    },
    include: fictionalWorldInclude,
  });
}

// Map management functions

export async function addMapToWorld(
  worldId: string,
  imageUrl: string,
  title: string,
  description?: string
): Promise<FictionalWorldMap> {
  return prisma.fictionalWorldMap.create({
    data: {
      fictionalWorldId: worldId,
      imageUrl,
      title,
      description,
    },
    select: {
      id: true,
      imageUrl: true,
      title: true,
      description: true,
      createdAt: true,
    },
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
  title: string,
  description?: string
): Promise<FictionalWorldMap> {
  return prisma.fictionalWorldMap.update({
    where: { id: mapId },
    data: {
      title,
      description,
    },
    select: {
      id: true,
      imageUrl: true,
      title: true,
      description: true,
      createdAt: true,
    },
  });
}

// DEPRECATED: Keep for backward compatibility during migration
export async function updateFictionalWorldMapImage(
  id: string,
  mapImageUrl: string
): Promise<FictionalWorldWithBooks | null> {
  return prisma.fictionalWorld.update({
    where: { id },
    data: { mapImageUrl },
    include: fictionalWorldInclude,
  });
}

export async function deleteFictionalWorldMapImage(
  id: string
): Promise<FictionalWorldWithBooks | null> {
  return prisma.fictionalWorld.update({
    where: { id },
    data: { mapImageUrl: null },
    include: fictionalWorldInclude,
  });
}
