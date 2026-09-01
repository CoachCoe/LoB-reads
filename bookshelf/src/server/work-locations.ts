import prisma from "@/lib/prisma";
import { workExists } from "./catalog";

/**
 * Locations describe the WORK — where Dune is set does not change between
 * printings. Contributions outlive the account that made them, so addedBy is
 * nullable and a deleted account leaves the pin with its attribution severed.
 */
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/http/errors";

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

/**
 * Most contributed locations shown for one work or author.
 *
 * Sibling read paths are all bounded — getShelfById pages, getAuthorByKey caps
 * at AUTHOR_WORKS_LIMIT, getWorkEditions pages — and these two were not. Well
 * above any real book's set of places, and a bound on a contributed table that
 * anyone signed in can grow.
 */
export const LOCATIONS_PER_ENTITY = 200;

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
    take: LOCATIONS_PER_ENTITY,
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
  // No foreign key protects this — app holds none into catalog — so the check is
  // explicit, as ARCHITECTURE.md requires of every write path and as
  // addWorkToShelf, createOrUpdateReview, startReading and confirmMatch all do.
  // Without it a bad key becomes a pin that renders on the public map forever as
  // "Unknown work" (map.ts), indistinguishable from a legitimate casualty of a
  // narrowed ingest. The sibling author route already validated.
  if (!(await workExists(workKey))) {
    throw new NotFoundError("That book is not in the catalog");
  }

  // `fictionalWorldId` reaches us as any non-empty string, and there IS a
  // foreign key here, so an unchecked value became a Prisma error and a 500.
  if (data.fictionalWorldId) {
    const world = await prisma.fictionalWorld.findUnique({
      where: { id: data.fictionalWorldId },
      select: { id: true },
    });
    if (!world) {
      throw new ValidationError("That fictional world does not exist");
    }
  }

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
export async function deleteWorkLocation(
  locationId: string,
  userId: string,
  isModerator = false
) {
  const location = await prisma.workLocation.findUnique({
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

  return prisma.workLocation.delete({
    where: { id: locationId },
  });
}
