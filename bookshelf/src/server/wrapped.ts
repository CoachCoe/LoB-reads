import prisma from "@/lib/prisma";

export interface WrappedStats {
  year: number;
  booksRead: number;
  pagesRead: number;
  reviewsWritten: number;
  averageRating: number;
  topGenres: { genre: string; count: number }[];
  topAuthors: { author: string; count: number }[];
  longestBook: { title: string; author: string; pageCount: number } | null;
  shortestBook: { title: string; author: string; pageCount: number } | null;
  firstBookOfYear: { title: string; author: string; finishedAt: Date } | null;
  mostRecentBook: { title: string; author: string; finishedAt: Date } | null;
  readingByMonth: { month: number; count: number }[];
  topRatedBooks: { title: string; author: string; rating: number; coverUrl: string | null }[];
  totalReadingDays: number;
  averageBooksPerMonth: number;
  favoriteGenre: string | null;
  favoriteAuthor: string | null;
}

export async function getWrappedStats(userId: string, year: number = new Date().getFullYear()): Promise<WrappedStats> {
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59);

  // Get all finished reading progress for the year
  const finishedBooks = await prisma.readingProgress.findMany({
    where: {
      userId,
      finishedAt: {
        gte: startOfYear,
        lte: endOfYear,
      },
    },
    include: {
      book: true,
    },
    orderBy: {
      finishedAt: "asc",
    },
  });

  // Get reviews written this year
  const reviews = await prisma.review.findMany({
    where: {
      userId,
      createdAt: {
        gte: startOfYear,
        lte: endOfYear,
      },
    },
    include: {
      book: true,
    },
  });

  // Calculate basic stats
  const booksRead = finishedBooks.length;
  const pagesRead = finishedBooks.reduce((sum, p) => sum + (p.book.pageCount || 0), 0);
  const reviewsWritten = reviews.length;
  const averageRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  // Genre analysis
  const genreCounts: Record<string, number> = {};
  finishedBooks.forEach((p) => {
    p.book.genres.forEach((genre) => {
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });
  });
  const topGenres = Object.entries(genreCounts)
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Author analysis
  const authorCounts: Record<string, number> = {};
  finishedBooks.forEach((p) => {
    const author = p.book.author;
    authorCounts[author] = (authorCounts[author] || 0) + 1;
  });
  const topAuthors = Object.entries(authorCounts)
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Find longest and shortest books
  const booksWithPages = finishedBooks.filter((p) => p.book.pageCount && p.book.pageCount > 0);
  const sortedByPages = [...booksWithPages].sort(
    (a, b) => (b.book.pageCount || 0) - (a.book.pageCount || 0)
  );

  const longestBook = sortedByPages[0]
    ? {
        title: sortedByPages[0].book.title,
        author: sortedByPages[0].book.author,
        pageCount: sortedByPages[0].book.pageCount || 0,
      }
    : null;

  const shortestBook = sortedByPages[sortedByPages.length - 1]
    ? {
        title: sortedByPages[sortedByPages.length - 1].book.title,
        author: sortedByPages[sortedByPages.length - 1].book.author,
        pageCount: sortedByPages[sortedByPages.length - 1].book.pageCount || 0,
      }
    : null;

  // First and most recent books
  const firstBookOfYear = finishedBooks[0]
    ? {
        title: finishedBooks[0].book.title,
        author: finishedBooks[0].book.author,
        finishedAt: finishedBooks[0].finishedAt!,
      }
    : null;

  const mostRecentBook = finishedBooks[finishedBooks.length - 1]
    ? {
        title: finishedBooks[finishedBooks.length - 1].book.title,
        author: finishedBooks[finishedBooks.length - 1].book.author,
        finishedAt: finishedBooks[finishedBooks.length - 1].finishedAt!,
      }
    : null;

  // Reading by month
  const monthCounts: Record<number, number> = {};
  for (let i = 0; i < 12; i++) {
    monthCounts[i] = 0;
  }
  finishedBooks.forEach((p) => {
    if (p.finishedAt) {
      const month = p.finishedAt.getMonth();
      monthCounts[month]++;
    }
  });
  const readingByMonth = Object.entries(monthCounts).map(([month, count]) => ({
    month: parseInt(month),
    count,
  }));

  // Top rated books (user's own ratings)
  const topRatedBooks = reviews
    .filter((r) => r.rating >= 4)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 5)
    .map((r) => ({
      title: r.book.title,
      author: r.book.author,
      rating: r.rating,
      coverUrl: r.book.coverUrl,
    }));

  // Calculate reading days (unique days with finished books)
  const uniqueDays = new Set(
    finishedBooks
      .filter((p) => p.finishedAt)
      .map((p) => p.finishedAt!.toISOString().split("T")[0])
  );
  const totalReadingDays = uniqueDays.size;

  // Average books per month
  const currentMonth = new Date().getMonth() + 1;
  const monthsElapsed = year === new Date().getFullYear() ? currentMonth : 12;
  const averageBooksPerMonth = booksRead / monthsElapsed;

  return {
    year,
    booksRead,
    pagesRead,
    reviewsWritten,
    averageRating: Math.round(averageRating * 10) / 10,
    topGenres,
    topAuthors,
    longestBook,
    shortestBook,
    firstBookOfYear,
    mostRecentBook,
    readingByMonth,
    topRatedBooks,
    totalReadingDays,
    averageBooksPerMonth: Math.round(averageBooksPerMonth * 10) / 10,
    favoriteGenre: topGenres[0]?.genre || null,
    favoriteAuthor: topAuthors[0]?.author || null,
  };
}
