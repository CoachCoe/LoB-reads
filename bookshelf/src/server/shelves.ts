import prisma from "@/lib/prisma";
import { ShelfWithBooks, ShelfWithOwner } from "@/types";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/http/errors";

/**
 * How many books to load per shelf for the overview. `_count.shelfItems`
 * still reports the true total, so the UI can show "42 books" while rendering
 * only the most recent few. Without a limit, a user with a few thousand books
 * pulled every row plus its full book record on every page load.
 */
export const SHELF_PREVIEW_SIZE = 24;

export async function getUserShelves(
  userId: string,
  itemsPerShelf: number = SHELF_PREVIEW_SIZE
): Promise<ShelfWithBooks[]> {
  return prisma.shelf.findMany({
    where: { userId },
    include: {
      shelfItems: {
        include: { book: true },
        orderBy: { addedAt: "desc" },
        take: itemsPerShelf,
      },
      _count: {
        select: { shelfItems: true },
      },
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

/** Shelf names and totals only — used where the book covers aren't needed. */
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
 * Shelves are public, so this deliberately has no owner check. It includes the
 * owner's public fields for attribution — never their email.
 */
export async function getShelfById(shelfId: string): Promise<ShelfWithOwner | null> {
  return prisma.shelf.findUnique({
    where: { id: shelfId },
    include: {
      user: {
        select: { id: true, name: true, avatarUrl: true },
      },
      shelfItems: {
        include: { book: true },
        orderBy: { addedAt: "desc" },
      },
      _count: {
        select: { shelfItems: true },
      },
    },
  });
}

export async function createShelf(userId: string, name: string) {
  return prisma.shelf.create({
    data: {
      userId,
      name,
      isDefault: false,
    },
  });
}

/**
 * Shelves are readable by anyone but only writable by their owner. Every
 * mutation goes through this so the check can't be forgotten in one place.
 */
async function requireOwnedShelf(shelfId: string, userId: string) {
  const shelf = await prisma.shelf.findUnique({
    where: { id: shelfId },
  });

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

  return prisma.shelf.delete({
    where: { id: shelfId },
  });
}

export async function addBookToShelf(shelfId: string, bookId: string, userId: string) {
  const shelf = await requireOwnedShelf(shelfId, userId);

  // A book sits on at most one of the three default shelves, so adding it to
  // one removes it from the others. Both statements run in a transaction:
  // separately, a failure between them would drop the book off every shelf.
  if (shelf.isDefault) {
    const defaultShelves = await prisma.shelf.findMany({
      where: { userId, isDefault: true },
      select: { id: true },
    });

    const [, shelfItem] = await prisma.$transaction([
      prisma.shelfItem.deleteMany({
        where: {
          bookId,
          shelfId: { in: defaultShelves.map((s) => s.id) },
        },
      }),
      prisma.shelfItem.create({
        data: { shelfId, bookId },
        include: { book: true, shelf: true },
      }),
    ]);

    return shelfItem;
  }

  return prisma.shelfItem.upsert({
    where: {
      shelfId_bookId: { shelfId, bookId },
    },
    create: { shelfId, bookId },
    update: {},
    include: { book: true, shelf: true },
  });
}

export async function removeBookFromShelf(shelfId: string, bookId: string, userId: string) {
  await requireOwnedShelf(shelfId, userId);

  return prisma.shelfItem.delete({
    where: {
      shelfId_bookId: { shelfId, bookId },
    },
  });
}

export async function getBookShelfStatus(userId: string, bookId: string) {
  const shelfItems = await prisma.shelfItem.findMany({
    where: {
      bookId,
      shelf: { userId },
    },
    include: {
      shelf: true,
    },
  });

  return shelfItems.map((item) => ({
    shelfId: item.shelfId,
    shelfName: item.shelf.name,
    isDefault: item.shelf.isDefault,
    addedAt: item.addedAt,
  }));
}
