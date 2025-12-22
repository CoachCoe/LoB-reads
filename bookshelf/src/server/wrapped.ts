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

export interface WrappedProjections {
  year: number;
  // YTD stats
  booksReadYTD: number;
  pagesReadYTD: number;
  reviewsWrittenYTD: number;
  daysElapsed: number;
  daysRemaining: number;
  // Current pace
  booksPerMonth: number;
  pagesPerDay: number;
  // Projections
  projectedBooksEndOfYear: number;
  projectedPagesEndOfYear: number;
  // Goals helper
  booksNeededPerMonthFor50: number;
  booksNeededPerMonthFor100: number;
  onTrackFor50: boolean;
  onTrackFor100: boolean;
  // Previous year comparison (if available)
  previousYearBooks: number | null;
  aheadOfLastYear: boolean | null;
  // Monthly breakdown
  readingByMonth: { month: number; count: number }[];
  // Recent activity
  lastBookFinished: { title: string; author: string; finishedAt: Date } | null;
  currentlyReading: { title: string; author: string; progress: number }[];
}

export async function getWrappedProjections(userId: string): Promise<WrappedProjections> {
  const now = new Date();
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59);

  // Calculate days elapsed and remaining
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysElapsed = Math.floor((now.getTime() - startOfYear.getTime()) / msPerDay) + 1;
  const totalDaysInYear = 365 + (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0);
  const daysRemaining = totalDaysInYear - daysElapsed;

  // Get books finished this year
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
      finishedAt: "desc",
    },
  });

  // Get currently reading books (started but not finished)
  const currentlyReadingProgress = await prisma.readingProgress.findMany({
    where: {
      userId,
      finishedAt: null,
    },
    include: {
      book: true,
    },
  });

  // Get reviews this year
  const reviews = await prisma.review.findMany({
    where: {
      userId,
      createdAt: {
        gte: startOfYear,
        lte: endOfYear,
      },
    },
  });

  // Get previous year stats
  const previousYearStart = new Date(year - 1, 0, 1);
  const previousYearEnd = new Date(year - 1, 11, 31, 23, 59, 59);
  const previousYearBooks = await prisma.readingProgress.count({
    where: {
      userId,
      finishedAt: {
        gte: previousYearStart,
        lte: previousYearEnd,
      },
    },
  });

  // Calculate YTD stats
  const booksReadYTD = finishedBooks.length;
  const pagesReadYTD = finishedBooks.reduce((sum, p) => sum + (p.book.pageCount || 0), 0);
  const reviewsWrittenYTD = reviews.length;

  // Current pace calculations
  const monthsElapsed = daysElapsed / 30.44; // Average days per month
  const booksPerMonth = booksReadYTD / monthsElapsed;
  const pagesPerDay = pagesReadYTD / daysElapsed;

  // Projections
  const monthsRemaining = daysRemaining / 30.44;
  const projectedBooksEndOfYear = Math.round(booksReadYTD + (booksPerMonth * monthsRemaining));
  const projectedPagesEndOfYear = Math.round(pagesReadYTD + (pagesPerDay * daysRemaining));

  // Goal calculations
  const booksNeededFor50 = Math.max(0, 50 - booksReadYTD);
  const booksNeededFor100 = Math.max(0, 100 - booksReadYTD);
  const booksNeededPerMonthFor50 = monthsRemaining > 0 ? booksNeededFor50 / monthsRemaining : 0;
  const booksNeededPerMonthFor100 = monthsRemaining > 0 ? booksNeededFor100 / monthsRemaining : 0;

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

  // Previous year comparison (at same point in year)
  const sameDateLastYear = new Date(year - 1, now.getMonth(), now.getDate());
  const booksAtThisPointLastYear = await prisma.readingProgress.count({
    where: {
      userId,
      finishedAt: {
        gte: previousYearStart,
        lte: sameDateLastYear,
      },
    },
  });

  // Last book finished
  const lastBookFinished = finishedBooks[0]
    ? {
        title: finishedBooks[0].book.title,
        author: finishedBooks[0].book.author,
        finishedAt: finishedBooks[0].finishedAt!,
      }
    : null;

  // Currently reading (calculate progress from currentPage / pageCount)
  const currentlyReading = currentlyReadingProgress.map((p) => ({
    title: p.book.title,
    author: p.book.author,
    progress: p.book.pageCount && p.book.pageCount > 0
      ? Math.round((p.currentPage / p.book.pageCount) * 100)
      : 0,
  }));

  return {
    year,
    booksReadYTD,
    pagesReadYTD,
    reviewsWrittenYTD,
    daysElapsed,
    daysRemaining,
    booksPerMonth: Math.round(booksPerMonth * 10) / 10,
    pagesPerDay: Math.round(pagesPerDay),
    projectedBooksEndOfYear,
    projectedPagesEndOfYear,
    booksNeededPerMonthFor50: Math.round(booksNeededPerMonthFor50 * 10) / 10,
    booksNeededPerMonthFor100: Math.round(booksNeededPerMonthFor100 * 10) / 10,
    onTrackFor50: projectedBooksEndOfYear >= 50,
    onTrackFor100: projectedBooksEndOfYear >= 100,
    previousYearBooks: previousYearBooks > 0 ? previousYearBooks : null,
    aheadOfLastYear: previousYearBooks > 0 ? booksReadYTD > booksAtThisPointLastYear : null,
    readingByMonth,
    lastBookFinished,
    currentlyReading,
  };
}
