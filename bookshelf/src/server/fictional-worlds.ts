import prisma from "@/lib/prisma";

export interface FictionalWorldWithBooks {
  id: string;
  name: string;
  description: string | null;
  mapImageUrl: string | null;
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

export async function getAllFictionalWorlds(): Promise<FictionalWorldWithBooks[]> {
  return prisma.fictionalWorld.findMany({
    include: {
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
    },
    orderBy: {
      name: "asc",
    },
  });
}

export async function getFictionalWorldById(id: string): Promise<FictionalWorldWithBooks | null> {
  return prisma.fictionalWorld.findUnique({
    where: { id },
    include: {
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
    },
  });
}

export async function updateFictionalWorldMapImage(
  id: string,
  mapImageUrl: string
): Promise<FictionalWorldWithBooks | null> {
  return prisma.fictionalWorld.update({
    where: { id },
    data: { mapImageUrl },
    include: {
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
    },
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
    include: {
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
    },
  });
}
