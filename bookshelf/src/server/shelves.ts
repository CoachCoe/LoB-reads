import prisma from "@/lib/prisma";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/http/errors";
import { getWorksByKeys, workExists, type WorkSummary } from "./catalog";

/**
 * Shelves hold catalog work keys, not local book rows. Display data is
 * hydrated from the catalog at read time — see getWorksByKeys for why there is
 * no join across the two schemas.
 */

/** The three shelves every account starts with. Order is the display order. */
export const DEFAULT_SHELF_NAMES = [
  "Want to Read",
  "Currently Reading",
  "Read",
] as const;

/**
 * How many items to load per shelf for an overview. The true total still comes
 * from the count, so the UI can say "42 books" while rendering the newest few.
 */
export const SHELF_PREVIEW_SIZE = 24;

export interface ShelfItemWithWork {
  id: string;
  workKey: string;
  addedAt: Date;
  /** Null when the current ingest no longer carries this work. */
  work: WorkSummary | null;
}

export interface ShelfWithItems {
  id: string;
  name: string;
  isDefault: boolean;
  userId: string;
  itemCount: number;
  items: ShelfItemWithWork[];
}

export async function getUserShelves(
  userId: string,
  itemsPerShelf: number = SHELF_PREVIEW_SIZE
): Promise<ShelfWithItems[]> {
  const shelves = await prisma.shelf.findMany({
    where: { userId },
    include: {
      shelfItems: { orderBy: { addedAt: "desc" }, take: itemsPerShelf },
      _count: { select: { shelfItems: true } },
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  // One catalog lookup covering every shelf, rather than one per shelf.
  const works = await getWorksByKeys(
    shelves.flatMap((s) => s.shelfItems.map((i) => i.workKey))
  );

  return shelves.map((shelf) => ({
    id: shelf.id,
    name: shelf.name,
    isDefault: shelf.isDefault,
    userId: shelf.userId,
    itemCount: shelf._count.shelfItems,
    items: shelf.shelfItems.map((item) => ({
      id: item.id,
      workKey: item.workKey,
      addedAt: item.addedAt,
      work: works.get(item.workKey) ?? null,
    })),
  }));
}

/** Names and totals only, for callers that do not need covers. */
export async function getUserShelfSummaries(userId: string) {
  return prisma.shelf.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      isDefault: true,
      _count: { select: { shelfItems: true } },
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

/**
 * How many items a shelf holds, without loading any of them.
 *
 * The shelf page needs the total before it can decide which page to fetch, and
 * paying for a full getShelfById — which hydrates every item against the
 * catalog — just to read `itemCount` would be silly.
 */
export async function getShelfItemCount(shelfId: string): Promise<number> {
  return prisma.shelfItem.count({ where: { shelfId } });
}

/**
 * Shelves are public, so this deliberately has no owner check. It includes the
 * owner's public fields for attribution — never their email.
 */
export async function getShelfById(
  shelfId: string,
  { limit = 100, offset = 0 }: { limit?: number; offset?: number } = {}
) {
  const shelf = await prisma.shelf.findUnique({
    where: { id: shelfId },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      shelfItems: { orderBy: { addedAt: "desc" }, take: limit, skip: offset },
      _count: { select: { shelfItems: true } },
    },
  });

  if (!shelf) return null;

  const works = await getWorksByKeys(shelf.shelfItems.map((i) => i.workKey));

  return {
    id: shelf.id,
    name: shelf.name,
    isDefault: shelf.isDefault,
    userId: shelf.userId,
    user: shelf.user,
    itemCount: shelf._count.shelfItems,
    items: shelf.shelfItems.map((item) => ({
      id: item.id,
      workKey: item.workKey,
      addedAt: item.addedAt,
      work: works.get(item.workKey) ?? null,
    })),
  };
}

export async function createShelf(userId: string, name: string) {
  return prisma.shelf.create({ data: { userId, name, isDefault: false } });
}

/**
 * Shelves are readable by anyone but only writable by their owner. Every
 * mutation goes through this so the check cannot be forgotten in one place.
 */
async function requireOwnedShelf(shelfId: string, userId: string) {
  const shelf = await prisma.shelf.findUnique({ where: { id: shelfId } });

  if (!shelf) {
    throw new NotFoundError("Shelf not found");
  }

  if (shelf.userId !== userId) {
    throw new AuthorizationError("This shelf belongs to someone else");
  }

  return shelf;
}

export async function deleteShelf(shelfId: string, userId: string) {
  const shelf = await requireOwnedShelf(shelfId, userId);

  if (shelf.isDefault) {
    throw new ValidationError("Cannot delete default shelves");
  }

  return prisma.shelf.delete({ where: { id: shelfId } });
}

/**
 * Add a work to a shelf.
 *
 * A work sits on at most one exclusive shelf per user, so adding it to one
 * removes it from the others. Both statements run in a transaction: separately,
 * a failure between them would drop the work off every shelf.
 *
 * This is the cooperative path. The database enforces the same rule
 * independently through a partial unique index on shelf_items, which is what
 * holds when two requests race — see the M3 migration.
 */
export async function addWorkToShelf(
  shelfId: string,
  workKey: string,
  userId: string
) {
  const shelf = await requireOwnedShelf(shelfId, userId);

  // No foreign key protects this, so the check is explicit. Without it a typo
  // in a work key becomes a shelf entry that renders as a blank card forever.
  if (!(await workExists(workKey))) {
    throw new NotFoundError("That book is not in the catalog");
  }

  if (shelf.isDefault) {
    const exclusiveShelves = await prisma.shelf.findMany({
      where: { userId, isDefault: true },
      select: { id: true },
    });

    const [, item] = await prisma.$transaction([
      prisma.shelfItem.deleteMany({
        where: { workKey, shelfId: { in: exclusiveShelves.map((s) => s.id) } },
      }),
      prisma.shelfItem.create({
        data: { shelfId, workKey, userId },
        include: { shelf: true },
      }),
    ]);

    return item;
  }

  return prisma.shelfItem.upsert({
    where: { shelfId_workKey: { shelfId, workKey } },
    create: { shelfId, workKey, userId },
    update: {},
    include: { shelf: true },
  });
}

export async function removeWorkFromShelf(
  shelfId: string,
  workKey: string,
  userId: string
) {
  await requireOwnedShelf(shelfId, userId);

  return prisma.shelfItem.delete({
    where: { shelfId_workKey: { shelfId, workKey } },
  });
}

/** Which of a user's shelves hold this work — drives the shelf picker. */
export async function getWorkShelfStatus(userId: string, workKey: string) {
  const items = await prisma.shelfItem.findMany({
    where: { workKey, shelf: { userId } },
    include: { shelf: true },
  });

  return items.map((item) => ({
    shelfId: item.shelfId,
    shelfName: item.shelf.name,
    isDefault: item.shelf.isDefault,
    addedAt: item.addedAt,
  }));
}
