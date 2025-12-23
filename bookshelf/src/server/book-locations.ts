import prisma from "@/lib/prisma";

function safeParseCoordinates(json: string): { lat: number; lng: number } {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
      return parsed;
    }
    return { lat: 0, lng: 0 };
  } catch {
    return { lat: 0, lng: 0 };
  }
}

export interface BookLocationData {
  id: string;
  name: string;
  type: string;
  description: string | null;
  coordinates: { lat: number; lng: number } | null;
  isFictional: boolean;
  fictionalWorldId: string | null;
  fictionalWorldName: string | null;
  addedBy: {
    id: string;
    name: string;
  };
  createdAt: Date;
}

export async function getBookLocations(bookId: string): Promise<BookLocationData[]> {
  const locations = await prisma.bookLocation.findMany({
    where: { bookId },
    include: {
      addedBy: {
        select: { id: true, name: true },
      },
      fictionalWorld: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: loc.type,
    description: loc.description,
    coordinates: loc.coordinates ? safeParseCoordinates(loc.coordinates) : null,
    isFictional: loc.isFictional,
    fictionalWorldId: loc.fictionalWorldId,
    fictionalWorldName: loc.fictionalWorld?.name ?? null,
    addedBy: loc.addedBy,
    createdAt: loc.createdAt,
  }));
}

export async function addBookLocation(
  bookId: string,
  userId: string,
  data: {
    name: string;
    type: string;
    description?: string;
    coordinates?: { lat: number; lng: number };
    isFictional?: boolean;
    fictionalWorldId?: string;
  }
) {
  return prisma.bookLocation.create({
    data: {
      bookId,
      addedById: userId,
      name: data.name,
      type: data.type,
      description: data.description ?? null,
      coordinates: data.coordinates ? JSON.stringify(data.coordinates) : null,
      isFictional: data.isFictional ?? false,
      fictionalWorldId: data.fictionalWorldId ?? null,
    },
    include: {
      addedBy: {
        select: { id: true, name: true },
      },
      fictionalWorld: {
        select: { name: true },
      },
    },
  });
}

export async function deleteBookLocation(locationId: string, userId: string) {
  // Only allow deletion by the user who added it
  const location = await prisma.bookLocation.findUnique({
    where: { id: locationId },
    select: { addedById: true },
  });

  if (!location || location.addedById !== userId) {
    throw new Error("Not authorized to delete this location");
  }

  return prisma.bookLocation.delete({
    where: { id: locationId },
  });
}

export async function getAllBookLocationsForMap() {
  const locations = await prisma.bookLocation.findMany({
    where: {
      isFictional: false,
      coordinates: { not: null },
    },
    include: {
      book: {
        select: {
          id: true,
          title: true,
          author: true,
          coverUrl: true,
        },
      },
      fictionalWorld: {
        select: { name: true },
      },
    },
  });

  return locations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: loc.type,
    coordinates: safeParseCoordinates(loc.coordinates!),
    book: loc.book,
    fictionalWorldName: loc.fictionalWorld?.name ?? null,
  }));
}
