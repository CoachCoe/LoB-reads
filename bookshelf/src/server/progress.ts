import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import {
  getWorksByKeys,
  getDefaultEdition,
  getEditionPageCount,
  workExists,
  type WorkSummary,
} from "./catalog";
import { DEFAULT_SHELF_NAMES } from "./shelves";

/**
 * Reading sessions.
 *
 * A session binds to an edition where one is known, because page counts differ
 * between printings, while the shelf and rating stay on the work. Re-reads are
 * separate sessions; a partial unique index allows at most one open at a time.
 *
 * `pageCount` is snapshotted onto the session rather than read from the
 * catalog each time. The catalog is rebuilt monthly and an edition can vanish
 * from the slice — reading history should not develop holes when that happens.
 */

export interface SessionWithWork {
  id: string;
  workKey: string;
  editionKey: string | null;
  currentPage: number;
  pageCount: number | null;
  startedAt: Date;
  finishedAt: Date | null;
  percent: number | null;
  work: WorkSummary | null;
}

function percentOf(currentPage: number, pageCount: number | null): number | null {
  if (!pageCount || pageCount <= 0) return null;
  return Math.min(100, Math.round((currentPage / pageCount) * 100));
}

async function hydrate(
  sessions: Array<{
    id: string;
    workKey: string;
    editionKey: string | null;
    currentPage: number;
    pageCount: number | null;
    startedAt: Date;
    finishedAt: Date | null;
  }>
): Promise<SessionWithWork[]> {
  const works = await getWorksByKeys(sessions.map((s) => s.workKey));
  return sessions.map((session) => ({
    ...session,
    percent: percentOf(session.currentPage, session.pageCount),
    work: works.get(session.workKey) ?? null,
  }));
}

/** The open session for a work, if there is one. */
export async function getOpenSession(userId: string, workKey: string) {
  return prisma.readingSession.findFirst({
    where: { userId, workKey, finishedAt: null },
  });
}

/**
 * The most recent session for one work, finished or not.
 *
 * `getCurrentlyReading` filters `finishedAt: null`, which is right for the
 * "what am I reading" list and wrong for a single work's panel: after finishing
 * a book the panel found no session and fell back to "Start Reading", which
 * then opened a NEW session and moved the work back to Currently Reading —
 * quietly undoing the finish and double-counting it in getReadingStats and
 * /wrapped.
 *
 * Re-reading a book is legitimate, so the server still allows a new session.
 * The defect was the UI forgetting, which is what this fixes.
 */
export async function getLatestSessionForWork(
  userId: string,
  workKey: string
): Promise<SessionWithWork | null> {
  const session = await prisma.readingSession.findFirst({
    where: { userId, workKey },
    orderBy: [{ startedAt: "desc" }],
  });

  if (!session) return null;
  const [hydrated] = await hydrate([session]);
  return hydrated ?? null;
}

export async function getCurrentlyReading(
  userId: string
): Promise<SessionWithWork[]> {
  return hydrate(
    await prisma.readingSession.findMany({
      where: { userId, finishedAt: null },
      orderBy: { updatedAt: "desc" },
    })
  );
}

export async function getFinishedSessions(
  userId: string,
  limit = 50
): Promise<SessionWithWork[]> {
  return hydrate(
    await prisma.readingSession.findMany({
      where: { userId, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      take: limit,
    })
  );
}

/**
 * Begin reading. Returns the existing open session rather than creating a
 * second one — the partial unique index would reject it anyway, and a 500 is
 * a poor answer to "start reading" pressed twice.
 */
export async function startReading(
  userId: string,
  workKey: string,
  editionKey?: string
) {
  if (!(await workExists(workKey))) {
    throw new NotFoundError("That book is not in the catalog");
  }

  const open = await getOpenSession(userId, workKey);
  if (open) return open;

  // getEditionPageCount throws if the edition is not this work's.
  const edition = editionKey
    ? {
        olKey: editionKey,
        numberOfPages: await getEditionPageCount(workKey, editionKey),
      }
    : await getDefaultEdition(workKey);

  const session = await prisma.readingSession.create({
    data: {
      userId,
      workKey,
      editionKey: edition?.olKey ?? null,
      pageCount: edition?.numberOfPages ?? null,
      currentPage: 0,
    },
  });

  await moveToExclusiveShelf(userId, workKey, "Currently Reading");
  return session;
}

export async function updateProgress(
  userId: string,
  workKey: string,
  currentPage: number
) {
  const session = await getOpenSession(userId, workKey);
  if (!session) {
    throw new NotFoundError("You are not currently reading that book");
  }

  if (!Number.isInteger(currentPage) || currentPage < 0) {
    throw new ValidationError("Page number must be zero or greater");
  }

  if (session.pageCount && currentPage > session.pageCount) {
    throw new ValidationError(
      `That edition has ${session.pageCount} pages`
    );
  }

  // Reaching the last page finishes the book, which is what a reader means.
  const done = session.pageCount != null && currentPage >= session.pageCount;

  const updated = await prisma.readingSession.update({
    where: { id: session.id },
    data: { currentPage, finishedAt: done ? new Date() : null },
  });

  if (done) {
    await moveToExclusiveShelf(userId, workKey, "Read");
  }

  return updated;
}

/**
 * Mark a work finished.
 *
 * `finishedAt` defaults to now, which is right for a reader pressing the button.
 * The Goodreads importer passes the date from the CSV instead: it parses every
 * `Date Read`, and before this parameter existed it used the value only to
 * decide *whether* to record a finish and then threw it away, stamping the
 * import time on all of them. A 300-book export spanning 2010-2024 became 300
 * books finished today, so this year's /wrapped reported all 300 and every
 * earlier year reported none — against the settings page's explicit promise
 * that "your books, ratings, shelves, and reading dates will be imported".
 */
export async function finishReading(
  userId: string,
  workKey: string,
  finishedAt?: Date
) {
  const session = await getOpenSession(userId, workKey);
  const when = finishedAt ?? new Date();

  const finished = session
    ? await prisma.readingSession.update({
        where: { id: session.id },
        data: {
          finishedAt: when,
          currentPage: session.pageCount ?? session.currentPage,
        },
      })
    : // Finishing something never started is a legitimate action: a reader
      // logging a book they read before joining.
      await startAndFinish(userId, workKey, when);

  await moveToExclusiveShelf(userId, workKey, "Read");
  return finished;
}

async function startAndFinish(userId: string, workKey: string, when: Date) {
  if (!(await workExists(workKey))) {
    throw new NotFoundError("That book is not in the catalog");
  }
  const edition = await getDefaultEdition(workKey);

  return prisma.readingSession.create({
    data: {
      userId,
      workKey,
      editionKey: edition?.olKey ?? null,
      pageCount: edition?.numberOfPages ?? null,
      currentPage: edition?.numberOfPages ?? 0,
      // startedAt takes the same date rather than now: getLatestSessionForWork
      // orders on it, so a 2014 book imported today must not sort ahead of one
      // finished last week.
      startedAt: when,
      finishedAt: when,
    },
  });
}

/**
 * Move a work onto one of the three exclusive shelves, off the others.
 *
 * Written here rather than reusing addWorkToShelf because the caller has
 * already established the work exists, and this path must not fail the
 * reading action if the shelf is missing.
 */
async function moveToExclusiveShelf(
  userId: string,
  workKey: string,
  shelfName: (typeof DEFAULT_SHELF_NAMES)[number]
) {
  const target = await prisma.shelf.findFirst({
    where: { userId, name: shelfName, isDefault: true },
    select: { id: true },
  });
  if (!target) return;

  const exclusive = await prisma.shelf.findMany({
    where: { userId, isDefault: true },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.shelfItem.deleteMany({
      where: { workKey, shelfId: { in: exclusive.map((s) => s.id) } },
    }),
    prisma.shelfItem.create({
      data: { shelfId: target.id, workKey, userId },
    }),
  ]);
}

export async function getReadingStats(userId: string) {
  const [booksRead, currentlyReading, pages] = await Promise.all([
    prisma.readingSession.count({
      where: { userId, finishedAt: { not: null } },
    }),
    prisma.readingSession.count({ where: { userId, finishedAt: null } }),
    prisma.readingSession.aggregate({
      where: { userId, finishedAt: { not: null } },
      _sum: { pageCount: true },
    }),
  ]);

  return {
    booksRead,
    currentlyReading,
    pagesRead: pages._sum.pageCount ?? 0,
  };
}
