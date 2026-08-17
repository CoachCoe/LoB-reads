import prisma from "@/lib/prisma";

/**
 * Locations describe the WORK — where Dune is set does not change between
 * printings. Contributions outlive the account that made them, so addedBy is
 * nullable and a deleted account leaves the pin with its attribution severed.
 */
import { AuthorizationError, NotFoundError } from "@/lib/http/errors";

export interface WorkLocationData {
  id: string;
  name: string;
  type: string;
  description: string | null;
  coordinates: { lat: number; lng: number } | null;
  isFictional: boolean;
  fictionalWorldId: string | null;
  fictionalWorldName: string | null;
  addedBy: { id: string; name: string } | null;
  createdAt: Date;
}

export async function getWorkLocations(
  workKey: string
): Promise<WorkLocationData[]> {
  const locations = await prisma.workLocation.findMany({
    where: { workKey },
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

export async function addWorkLocation(
  workKey: string,
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
  return prisma.workLocation.create({
    data: {
      workKey,
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

export async function deleteWorkLocation(locationId: string, userId: string) {
  const location = await prisma.workLocation.findUnique({
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

  return prisma.workLocation.delete({
    where: { id: locationId },
  });
}
