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
      // logging a book they read before joining. Doing it twice in one day is
      // not — see finishedSessionOnDay.
      await finishWithoutOpenSession(userId, workKey, when);

  await moveToExclusiveShelf(userId, workKey, "Read");
  return finished;
}

/**
 * An already-finished session for this work on the same day, if there is one.
 *
 * This is the idempotency `finishReading` lacked. With no OPEN session it went
 * straight to `startAndFinish`, and nothing constrains finished sessions:
 * `reading_sessions_one_open_per_work` is partial, `WHERE finished_at IS NULL`.
 * So five POSTs of `{"action":"finish"}` produced five finished sessions, each
 * with `started_at == finished_at`, and `getWrappedStats` counts sessions
 * rather than distinct works (`wrapped.ts`) — which rendered "5 Books Read,
 * 880 Pages Read" for one 176-page book read once. Re-uploading a Goodreads
 * export did the same thing once per row, which is what the settings page
 * invites when it says "upload it again to continue where this left off".
 *
 * The window is a calendar day rather than an exact timestamp because the two
 * callers need different things: the importer passes the same parsed
 * `Date Read` on every re-upload, while a double-clicked Finish passes two
 * `new Date()`s milliseconds apart. A day covers both.
 *
 * UTC rather than local, deliberately. This is a deduplication window, not a
 * reading-year boundary — the year boundary in `wrapped.ts` is local on purpose
 * and stays that way. The cost is that a double-click straddling UTC midnight
 * still records twice, which is a far smaller hole than the one it replaces.
 * Deduplicating against *any* finished session would be tighter still and is
 * the wrong trade: it would silently drop a genuine re-read, and
 * `getLatestSessionForWork`'s docstring is explicit that "Re-reading a book is
 * legitimate, so the server still allows a new session."
 */
/**
 * Finish a work with no open session, at most once per day.
 *
 * The lookup alone is not enough, and that is the whole point: a read followed
 * by a create is not atomic, and a double-click — the case this exists for — is
 * concurrent. Measured before the index existed: two simultaneous finishes
 * produced two sessions, so the first version of this fix closed the sequential
 * case and left the actual one open.
 *
 * `reading_sessions_one_finish_per_day` is what decides it now. The lookup is
 * kept because it is the common path and returns the row without a failed
 * insert; the P2002 branch is what makes the rule hold. Same shape as the
 * exclusive-shelf rule, which ARCHITECTURE.md describes as "kept honest by a
 * partial unique index and a trigger rather than by application code".
 */
async function finishWithoutOpenSession(
  userId: string,
  workKey: string,
  when: Date
) {
  const existing = await finishedSessionOnDay(userId, workKey, when);
  if (existing) return existing;

  try {
    return await startAndFinish(userId, workKey, when);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Another request inserted between the lookup and the insert. Its row is
    // the same finish, so return it rather than reporting a conflict the
    // reader did not cause.
    const raced = await finishedSessionOnDay(userId, workKey, when);
    if (raced) return raced;
    throw error;
  }
}

/** Postgres 23505 via Prisma: a unique constraint rejected the insert. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

async function finishedSessionOnDay(
  userId: string,
  workKey: string,
  when: Date
) {
  const dayStart = new Date(
    Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate())
  );
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  return prisma.readingSession.findFirst({
    where: { userId, workKey, finishedAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { finishedAt: "desc" },
  });
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

  // Delete from the OTHER exclusive shelves and upsert the target, rather than
  // deleting from all of them and creating. Two properties, both of which this
  // copy was missing and its sibling in shelves.ts has:
  //
  // - Excluding the target means a work already on it keeps its `addedAt` and
  //   its row id, instead of being silently re-shelved (RUN-5).
  // - The upsert makes the move idempotent under concurrency. It was a delete
  //   followed by a create, so two simultaneous finishes both deleted and both
  //   inserted, and one got a P2002 from `shelf_items_one_exclusive_per_work`.
  //   Measured: a third of three racing finishReading calls rejected, after the
  //   session half of that race had already been fixed.
  //
  // Order matters inside the transaction: the delete has to precede the upsert,
  // because the partial unique index allows only one exclusive shelf per work.
  const others = exclusive
    .map((shelf) => shelf.id)
    .filter((id) => id !== target.id);

  try {
    await prisma.$transaction([
      prisma.shelfItem.deleteMany({ where: { workKey, shelfId: { in: others } } }),
      prisma.shelfItem.upsert({
        where: { shelfId_workKey: { shelfId: target.id, workKey } },
        create: { shelfId: target.id, workKey, userId },
        update: {},
      }),
    ]);
  } catch (error) {
    // A unique violation here means another writer put the work on an
    // exclusive shelf while this transaction was running. The upsert cannot
    // absorb it, because the index that rejects is the PARTIAL one — one
    // exclusive shelf per work — and not the (shelfId, workKey) key the
    // ON CONFLICT targets.
    //
    // So the end state is checked rather than assumed. If the work is on the
    // shelf this call wanted, the other writer did this call's work and there
    // is nothing to report; the reading session is the record of truth and it
    // is already correct. If it is somewhere else, that is a real failure and
    // it is rethrown.
    //
    // This is the docstring above finally being true: "this path must not fail
    // the reading action if the shelf is missing" (JR-10). It was catching a
    // missing shelf and letting everything else escape, so a racing
    // double-click answered 500 for a book that was already finished.
    if (!isUniqueViolation(error)) throw error;

    const onTarget = await prisma.shelfItem.findUnique({
      where: { shelfId_workKey: { shelfId: target.id, workKey } },
      select: { id: true },
    });
    if (!onTarget) throw error;
  }
}

export async function getReadingStats(userId: string) {
  const [booksRead, currentlyReading, pages] = await Promise.all([
    prisma.readingSession.count({
      where: { userId, finishedAt: { not: null } },
    }),
    prisma.readingSession.count({ where: { userId, finishedAt: null } }),
    // Raw, because Prisma's aggregate cannot COALESCE and summing page_count
    // alone counted 0 for a finished session on an edition that states no
    // length — even though finishReading sets currentPage from whatever the
    // reader logged. /wrapped had the same defect and is fixed alongside.
    //
    // Two things to note if this is ever edited, both of them recorded lessons
    // in this repo. The identifiers here are mixed case:
    // app.reading_sessions has "userId" and "currentPage" camel-cased and
    // page_count and finished_at snake-cased, so the quotes are load-bearing
    // and an unquoted "userId" is a runtime 500 that tsc cannot see. And SUM()
    // returns bigint, which JSON.stringify refuses, so the ::int cast is not
    // decoration.
    prisma.$queryRaw<{ pages: number }[]>`
      SELECT COALESCE(SUM(COALESCE(page_count, "currentPage")), 0)::int AS pages
      FROM app.reading_sessions
      WHERE "userId" = ${userId} AND finished_at IS NOT NULL
    `,
  ]);

  return {
    booksRead,
    currentlyReading,
    pagesRead: pages[0]?.pages ?? 0,
  };
}
