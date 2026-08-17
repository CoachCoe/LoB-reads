import prisma from "@/lib/prisma";
import { AuthorizationError, NotFoundError } from "@/lib/errors";

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

export async function getBookLocations(
  bookId: string
): Promise<BookLocationData[]> {
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
    // Fictional locations have no real-world position; they belong to a world.
    coordinates:
      loc.lat !== null && loc.lng !== null
        ? { lat: loc.lat, lng: loc.lng }
        : null,
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
      lat: data.coordinates?.lat ?? null,
      lng: data.coordinates?.lng ?? null,
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
  const location = await prisma.bookLocation.findUnique({
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

  return prisma.bookLocation.delete({
    where: { id: locationId },
  });
}
