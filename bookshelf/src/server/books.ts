import prisma from "@/lib/prisma";
import { BookWithRelations } from "@/types";

export async function getBookById(bookId: string): Promise<BookWithRelations | null> {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      reviews: {
        include: {
          user: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { reviews: true, shelfItems: true },
      },
    },
  });

  if (!book) return null;

  // Calculate average rating
  const avgRating =
    book.reviews.length > 0
      ? book.reviews.reduce((sum, r) => sum + r.rating, 0) / book.reviews.length
      : 0;

  return {
    ...book,
    averageRating: Math.round(avgRating * 10) / 10,
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

export async function getBooksByGenre(genre: string, limit = 20) {
  return prisma.book.findMany({
    where: {
      genres: { has: genre },
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

export async function getAllGenres() {
  const books = await prisma.book.findMany({
    select: { genres: true },
  });

  const genreSet = new Set<string>();
  books.forEach((book) => {
    book.genres.forEach((genre) => genreSet.add(genre));
  });

  return Array.from(genreSet).sort();
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
