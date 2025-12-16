import prisma from "@/lib/prisma";

export async function getReadingProgress(userId: string, bookId: string) {
  return prisma.readingProgress.findUnique({
    where: {
      userId_bookId: { userId, bookId },
    },
    include: { book: true },
  });
}

export async function getUserCurrentlyReading(userId: string) {
  return prisma.readingProgress.findMany({
    where: {
      userId,
      finishedAt: null,
    },
    include: { book: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function updateReadingProgress(
  userId: string,
  bookId: string,
  currentPage: number
) {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
  });

  if (!book) {
    throw new Error("Book not found");
  }

  // If current page equals or exceeds page count, mark as finished
  const isFinished = book.pageCount && currentPage >= book.pageCount;

  return prisma.readingProgress.upsert({
    where: {
      userId_bookId: { userId, bookId },
    },
    create: {
      userId,
      bookId,
      currentPage,
      finishedAt: isFinished ? new Date() : null,
    },
    update: {
      currentPage,
      finishedAt: isFinished ? new Date() : null,
    },
    include: { book: true },
  });
}

export async function startReading(userId: string, bookId: string) {
  return prisma.readingProgress.upsert({
    where: {
      userId_bookId: { userId, bookId },
    },
    create: {
      userId,
      bookId,
      currentPage: 0,
    },
    update: {
      currentPage: 0,
      startedAt: new Date(),
      finishedAt: null,
    },
    include: { book: true },
  });
}

export async function finishReading(userId: string, bookId: string) {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
  });

  if (!book) {
    throw new Error("Book not found");
  }

  const progress = await prisma.readingProgress.upsert({
    where: {
      userId_bookId: { userId, bookId },
    },
    create: {
      userId,
      bookId,
      currentPage: book.pageCount || 0,
      finishedAt: new Date(),
    },
    update: {
      currentPage: book.pageCount || 0,
      finishedAt: new Date(),
    },
    include: { book: true },
  });

  // Move book to "Read" shelf
  const readShelf = await prisma.shelf.findFirst({
    where: {
      userId,
      name: "Read",
      isDefault: true,
    },
  });

  if (readShelf) {
    // Remove from other default shelves
    const defaultShelves = await prisma.shelf.findMany({
      where: { userId, isDefault: true },
    });

    await prisma.shelfItem.deleteMany({
      where: {
        bookId,
        shelfId: { in: defaultShelves.map((s) => s.id) },
      },
    });

    // Add to Read shelf
    await prisma.shelfItem.create({
      data: {
        shelfId: readShelf.id,
        bookId,
      },
    });
  }

  return progress;
}

export async function getUserReadingStats(userId: string) {
  const [booksRead, currentlyReading, totalPagesRead] = await Promise.all([
    prisma.readingProgress.count({
      where: { userId, finishedAt: { not: null } },
    }),
    prisma.readingProgress.count({
      where: { userId, finishedAt: null },
    }),
    prisma.readingProgress.findMany({
      where: { userId, finishedAt: { not: null } },
      include: { book: true },
    }),
  ]);

  const pagesRead = totalPagesRead.reduce(
    (sum, p) => sum + (p.book.pageCount || 0),
    0
  );

  return {
    booksRead,
    currentlyReading,
    pagesRead,
  };
}
