import prisma from "@/lib/prisma";
import { ShelfWithBooks } from "@/types";

export async function getUserShelves(userId: string): Promise<ShelfWithBooks[]> {
  return prisma.shelf.findMany({
    where: { userId },
    include: {
      shelfItems: {
        include: { book: true },
        orderBy: { addedAt: "desc" },
      },
      _count: {
        select: { shelfItems: true },
      },
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function getShelfById(shelfId: string): Promise<ShelfWithBooks | null> {
  return prisma.shelf.findUnique({
    where: { id: shelfId },
    include: {
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

export async function getShelfByName(userId: string, name: string) {
  return prisma.shelf.findUnique({
    where: {
      userId_name: { userId, name },
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

export async function deleteShelf(shelfId: string, userId: string) {
  // Can't delete default shelves
  const shelf = await prisma.shelf.findUnique({
    where: { id: shelfId },
  });

  if (!shelf || shelf.userId !== userId) {
    throw new Error("Shelf not found");
  }

  if (shelf.isDefault) {
    throw new Error("Cannot delete default shelves");
  }

  return prisma.shelf.delete({
    where: { id: shelfId },
  });
}

export async function addBookToShelf(shelfId: string, bookId: string, userId: string) {
  // Verify shelf belongs to user
  const shelf = await prisma.shelf.findUnique({
    where: { id: shelfId },
  });

  if (!shelf || shelf.userId !== userId) {
    throw new Error("Shelf not found");
  }

  // Check if book is already on a default shelf (want to read, reading, read)
  // If so, remove from that shelf first
  if (shelf.isDefault) {
    const defaultShelves = await prisma.shelf.findMany({
      where: { userId, isDefault: true },
    });

    await prisma.shelfItem.deleteMany({
      where: {
        bookId,
        shelfId: { in: defaultShelves.map((s) => s.id) },
      },
    });
  }

  // Add to new shelf
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
  // Verify shelf belongs to user
  const shelf = await prisma.shelf.findUnique({
    where: { id: shelfId },
  });

  if (!shelf || shelf.userId !== userId) {
    throw new Error("Shelf not found");
  }

  return prisma.shelfItem.delete({
    where: {
      shelfId_bookId: { shelfId, bookId },
    },
  });
}

export async function moveBookToShelf(
  bookId: string,
  fromShelfId: string,
  toShelfId: string,
  userId: string
) {
  // Verify both shelves belong to user
  const [fromShelf, toShelf] = await Promise.all([
    prisma.shelf.findUnique({ where: { id: fromShelfId } }),
    prisma.shelf.findUnique({ where: { id: toShelfId } }),
  ]);

  if (!fromShelf || fromShelf.userId !== userId) {
    throw new Error("Source shelf not found");
  }
  if (!toShelf || toShelf.userId !== userId) {
    throw new Error("Target shelf not found");
  }

  // Remove from old shelf and add to new
  await prisma.$transaction([
    prisma.shelfItem.delete({
      where: { shelfId_bookId: { shelfId: fromShelfId, bookId } },
    }),
    prisma.shelfItem.create({
      data: { shelfId: toShelfId, bookId },
    }),
  ]);
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
