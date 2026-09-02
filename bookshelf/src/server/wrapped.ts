import prisma from "@/lib/prisma";

/**
 * Wrapped reads from reading sessions, with titles, authors and subjects
 * hydrated from the catalog. Page counts come from the session snapshot, not
 * the catalog: a year in review should not change because an ingest dropped
 * an edition.
 */

interface WorkStat {
  title: string;
  authorNames: string | null;
  subjects: string[];
  coverId: number | null;
}

async function getWorkStats(keys: string[]): Promise<Map<string, WorkStat>> {
  const unique = [...new Set(keys)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const rows = await prisma.$queryRaw<Array<WorkStat & { olKey: string }>>`
    SELECT w.ol_key AS "olKey", w.title, w.author_names AS "authorNames",
           w.subjects, e.cover_id::int AS "coverId"
    FROM catalog.works w
    LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
    WHERE w.ol_key = ANY(${unique})
  `;
  return new Map(rows.map((r) => [r.olKey, r]));
}

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
  topRatedBooks: { title: string; author: string; rating: number; coverId: number | null }[];
  totalReadingDays: number;
  averageBooksPerMonth: number;
  favoriteGenre: string | null;
  favoriteAuthor: string | null;
}

export async function getWrappedStats(userId: string, year: number = new Date().getFullYear()): Promise<WrappedStats> {
  // Half-open, and it has to be. The bound used to be built as
  // `new Date(year, 11, 31, 23, 59, 59)` — millisecond .000 — and compared
  // with `lte`, so anything finished in the last second of 31 December was
  // outside this year's report AND outside the next one's, whose lower bound
  // is 1 January 00:00:00.000. A book could belong to no year at all.
  const startOfYear = new Date(year, 0, 1);
  const startOfNextYear = new Date(year + 1, 0, 1);

  const [sessions, reviewRows] = await Promise.all([
    prisma.readingSession.findMany({
      where: { userId, finishedAt: { gte: startOfYear, lt: startOfNextYear } },
      orderBy: { finishedAt: "asc" },
    }),
    prisma.review.findMany({
      where: { userId, createdAt: { gte: startOfYear, lt: startOfNextYear } },
    }),
  ]);

  // Titles, authors and subjects live in the catalog, so they are fetched
  // once for every work involved rather than joined per row.
  const works = await getWorkStats([
    ...sessions.map((s) => s.workKey),
    ...reviewRows.map((r) => r.workKey),
  ]);

  const finishedBooks = sessions.map((session) => ({
    ...session,
    book: works.get(session.workKey) ?? null,
  }));
  const reviews = reviewRows.map((review) => ({
    ...review,
    book: works.get(review.workKey) ?? null,
  }));

  // Calculate basic stats
  const booksRead = finishedBooks.length;
  const pagesRead = finishedBooks.reduce((sum, p) => sum + (p.pageCount || 0), 0);
  const reviewsWritten = reviews.length;
  const averageRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  // Genre analysis
  const genreCounts: Record<string, number> = {};
  finishedBooks.forEach((p) => {
    (p.book?.subjects ?? []).forEach((genre: string) => {
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });
  });
  const topGenres = Object.entries(genreCounts)
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Author analysis. A book the catalog cannot name is left out rather than
  // counted under "Unknown": an ingest can narrow the slice and drop a work
  // someone has shelved, and `author_names` is nullable besides, so that
  // bucket collected every unnameable book, outvoted the real authors, and
  // rendered "Your favourite author: Unknown". The book still counts towards
  // booksRead — only the attribution is missing. Genres already behave this
  // way, because an absent subjects array contributes nothing.
  const authorCounts: Record<string, number> = {};
  finishedBooks.forEach((p) => {
    const author = p.book?.authorNames;
    if (!author) return;
    authorCounts[author] = (authorCounts[author] || 0) + 1;
  });
  const topAuthors = Object.entries(authorCounts)
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Find longest and shortest books
  const booksWithPages = finishedBooks.filter((p) => p.pageCount != null && p.pageCount > 0);
  const sortedByPages = [...booksWithPages].sort(
    (a, b) => (b.pageCount || 0) - (a.pageCount || 0)
  );

  const longestBook = sortedByPages[0]
    ? {
        title: sortedByPages[0].book?.title ?? "Unknown",
        author: sortedByPages[0].book?.authorNames ?? "Unknown",
        pageCount: sortedByPages[0].pageCount || 0,
      }
    : null;

  const shortestBook = sortedByPages[sortedByPages.length - 1]
    ? {
        title: sortedByPages[sortedByPages.length - 1].book?.title ?? "Unknown",
        author: sortedByPages[sortedByPages.length - 1].book?.authorNames ?? "Unknown",
        pageCount: sortedByPages[sortedByPages.length - 1].pageCount || 0,
      }
    : null;

  // First and most recent books
  const firstBookOfYear = finishedBooks[0]
    ? {
        title: finishedBooks[0].book?.title ?? "Unknown",
        author: finishedBooks[0].book?.authorNames ?? "Unknown",
        finishedAt: finishedBooks[0].finishedAt!,
      }
    : null;

  const mostRecentBook = finishedBooks[finishedBooks.length - 1]
    ? {
        title: finishedBooks[finishedBooks.length - 1].book?.title ?? "Unknown",
        author: finishedBooks[finishedBooks.length - 1].book?.authorNames ?? "Unknown",
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
      title: r.book?.title ?? "Unknown",
      author: r.book?.authorNames ?? "Unknown",
      rating: r.rating,
      coverId: r.book?.coverId ?? null,
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
  // Half-open, for the reason given in getWrappedStats.
  const startOfNextYear = new Date(year + 1, 0, 1);

  // Calculate days elapsed and remaining
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysElapsed = Math.floor((now.getTime() - startOfYear.getTime()) / msPerDay) + 1;
  const totalDaysInYear = 365 + (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0);
  const daysRemaining = totalDaysInYear - daysElapsed;

  // Get books finished this year
  const finishedSessions = await prisma.readingSession.findMany({
    where: { userId, finishedAt: { gte: startOfYear, lt: startOfNextYear } },
    orderBy: { finishedAt: "desc" },
  });

  const currentlyReadingProgress = await prisma.readingSession.findMany({
    where: { userId, finishedAt: null },
  });

  const projWorks = await getWorkStats([
    ...finishedSessions.map((s) => s.workKey),
    ...currentlyReadingProgress.map((s) => s.workKey),
  ]);

  const finishedBooks = finishedSessions.map((s) => ({
    ...s,
    book: projWorks.get(s.workKey) ?? null,
  }));

  // Get reviews this year
  const reviews = await prisma.review.findMany({
    where: {
      userId,
      createdAt: {
        gte: startOfYear,
        lt: startOfNextYear,
      },
    },
  });

  // Get previous year stats
  const previousYearStart = new Date(year - 1, 0, 1);
  const previousYearBooks = await prisma.readingSession.count({
    where: {
      userId,
      finishedAt: {
        gte: previousYearStart,
        lt: startOfYear,
      },
    },
  });

  // Calculate YTD stats
  const booksReadYTD = finishedBooks.length;
  const pagesReadYTD = finishedBooks.reduce((sum, p) => sum + (p.pageCount || 0), 0);
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
  const booksAtThisPointLastYear = await prisma.readingSession.count({
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
        title: finishedBooks[0].book?.title ?? "Unknown",
        author: finishedBooks[0].book?.authorNames ?? "Unknown",
        finishedAt: finishedBooks[0].finishedAt!,
      }
    : null;

  // Currently reading (calculate progress from currentPage / pageCount)
  const currentlyReading = currentlyReadingProgress.map((p) => ({
    title: projWorks.get(p.workKey)?.title ?? "Unknown",
    author: projWorks.get(p.workKey)?.authorNames ?? "Unknown",
    progress:
      p.pageCount != null && p.pageCount > 0
        ? Math.round((p.currentPage / p.pageCount) * 100)
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
