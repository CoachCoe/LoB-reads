import prisma from "@/lib/prisma";
import { BookWithRelations } from "@/types";
import { getAverageRating } from "./reviews";

/** A popular book can accumulate thousands of reviews; show the newest page. */
export const BOOK_REVIEWS_PAGE_SIZE = 20;

export async function getBookById(bookId: string): Promise<BookWithRelations | null> {
  // The average comes from an aggregate rather than from summing every review
  // in JavaScript, so the page no longer loads the entire review table for a
  // popular book just to display one number.
  const [book, rating] = await Promise.all([
    prisma.book.findUnique({
      where: { id: bookId },
      include: {
        reviews: {
          include: {
            user: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: BOOK_REVIEWS_PAGE_SIZE,
        },
        _count: {
          select: { reviews: true, shelfItems: true },
        },
      },
    }),
    getAverageRating(bookId),
  ]);

  if (!book) return null;

  return {
    ...book,
    averageRating: Math.round(rating.average * 10) / 10,
  };
}

export async function searchLocalBooks(query: string, limit = 20) {
  return prisma.book.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { author: { contains: query, mode: "insensitive" } },
        { isbn: { contains: query, mode: "insensitive" } },
      ],
    },
    include: {
      _count: {
        select: { reviews: true, shelfItems: true },
      },
    },
    take: limit,
  });
}

export async function getPopularBooks(limit = 10) {
  // Get books with most shelf additions in the last week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const popularBookIds = await prisma.shelfItem.groupBy({
    by: ["bookId"],
    where: {
      addedAt: { gte: weekAgo },
    },
    _count: { bookId: true },
    orderBy: { _count: { bookId: "desc" } },
    take: limit,
  });

  const books = await prisma.book.findMany({
    where: {
      id: { in: popularBookIds.map((p) => p.bookId) },
    },
    include: {
      _count: {
        select: { reviews: true, shelfItems: true },
      },
    },
  });

  // Sort by popularity order
  return popularBookIds.map((p) => books.find((b) => b.id === p.bookId)!).filter(Boolean);
}

/**
 * Genres are a String[] column, so there is no way to select distinct values
 * through the Prisma query API — unnesting in SQL keeps the work in the
 * database instead of reading every book row into memory on each search-page
 * render, which is what this used to do.
 */
export async function getAllGenres(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ genre: string }[]>`
    SELECT DISTINCT unnest(genres) AS genre
    FROM books
    ORDER BY genre ASC
  `;

  return rows.map((row) => row.genre);
}

export async function createBook(data: {
  title: string;
  author: string;
  isbn?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  pageCount?: number | null;
  publishedDate?: string | null;
  genres?: string[];
  openLibraryId?: string | null;
}) {
  // Check if book already exists by ISBN or Open Library ID
  if (data.isbn) {
    const existing = await prisma.book.findUnique({
      where: { isbn: data.isbn },
    });
    if (existing) return existing;
  }

  if (data.openLibraryId) {
    const existing = await prisma.book.findUnique({
      where: { openLibraryId: data.openLibraryId },
    });
    if (existing) return existing;
  }

  return prisma.book.create({
    data: {
      title: data.title,
      author: data.author,
      isbn: data.isbn,
      description: data.description,
      coverUrl: data.coverUrl,
      pageCount: data.pageCount,
      publishedDate: data.publishedDate,
      genres: data.genres || [],
      openLibraryId: data.openLibraryId,
    },
  });
}
