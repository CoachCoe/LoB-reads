import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { GoodreadsBook } from "@/lib/sources/goodreads";
import { getShelfDisplayName } from "@/lib/sources/goodreads";
import {
  findWorkKeysByIsbns,
  findWorkKeyByTitleAuthor,
  workExists,
} from "@/server/catalog";
import { getUserShelfSummaries, addWorkToShelf } from "@/server/shelves";
import { createOrUpdateReview } from "@/server/reviews";
import { finishReading } from "@/server/progress";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import { canonicalIsbn13 } from "@/lib/sources/isbn";

/**
 * Goodreads import as a reviewable session.
 *
 * The previous importer applied what it could and returned a count of what it
 * could not. That count was the only trace: a reader with 800 books saw 640
 * arrive and had no way to find the other 160, let alone fix them. The failure
 * is quiet and permanent, which is the worst combination.
 *
 * So every row is persisted before anything is applied. Rows that match
 * confidently — by ISBN, or by exact title and author — are applied straight
 * away, because asking someone to confirm 640 certain matches is not review,
 * it is data entry. Everything else keeps its candidates and waits.
 *
 * Confidence here means the match is either exact or explicitly chosen by the
 * reader. Trigram similarity is never applied on its own, however high it
 * scores: "The Hobbit" and "The Hobbits" are one edit apart and different
 * books, and silently shelving the wrong one is worse than asking.
 */

/** Fuzzy candidates offered per unmatched row. More is a wall, not a choice. */
const CANDIDATES_PER_ROW = 5;

/**
 * Below this trigram score a suggestion is noise. `pg_trgm` defaults to 0.3;
 * this is deliberately higher, because a bad suggestion costs a reader more
 * attention than a missing one.
 */
const MIN_CANDIDATE_SCORE = 0.35;

/** Title carries most of the weight; the author disambiguates. */
const TITLE_WEIGHT = 0.7;
const AUTHOR_WEIGHT = 0.3;

export interface MatchCandidate {
  workKey: string;
  title: string;
  authorNames: string | null;
  score: number;
}

export interface ImportSessionSummary {
  id: string;
  filename: string;
  status: string;
  totalRows: number;
  createdAt: Date;
  completedAt: Date | null;
  /** Applied without asking: matched by ISBN or exact title and author. */
  matched: number;
  /** Waiting on the reader. */
  needsReview: number;
  /** Applied after the reader chose a candidate. */
  confirmed: number;
  /** Dismissed by the reader. */
  skipped: number;
  failed: number;
  /** Percentage applied without review, which is the number worth reporting. */
  matchRate: number;
}

/**
 * Persist the file, then match it.
 *
 * Persisting first is what makes the rest recoverable: if matching throws
 * halfway, the rows are already stored and the session can be reopened, rather
 * than the reader being told to upload an 800-row export again.
 */
export async function createImportSession(
  userId: string,
  filename: string,
  rows: GoodreadsBook[]
): Promise<string> {
  const session = await prisma.importSession.create({
    data: {
      userId,
      filename,
      status: "processing",
      totalRows: rows.length,
      rows: {
        create: rows.map((row, index) => ({
          rowNumber: index + 1,
          title: row.title,
          author: row.author,
          // Canonicalised, not raw. This column is compared against
          // catalog.editions.isbn13, which the ingest guarantees is a validated
          // 13-digit string — so an ISBN-10 or a hyphenated ISBN-13 stored as
          // it arrived joins against nothing and the row falls through to fuzzy
          // matching or the review queue. canonicalIsbn13's own docstring states
          // the rule ("every cross-source join keys on ISBN-13, so ISBN-10s are
          // converted rather than stored as a second dialect") and it had no
          // caller in src/ at all. DEAD-1.
          isbn13: canonicalIsbn13(row.isbn13 ?? row.isbn),
          myRating: Number.isInteger(row.myRating) ? row.myRating : null,
          exclusiveShelf: row.exclusiveShelf,
          dateRead: row.dateRead,
          status: "needs_review",
        })),
      },
    },
    select: { id: true },
  });

  await matchSession(userId, session.id);
  return session.id;
}

/**
 * Resolve every row in a session, applying the confident ones.
 *
 * Safe to run again: rows the reader has already confirmed or skipped are left
 * alone, so a session interrupted midway can simply be re-matched.
 */
export async function matchSession(
  userId: string,
  sessionId: string
): Promise<void> {
  const rows = await prisma.importRow.findMany({
    where: { sessionId, status: "needs_review" },
    orderBy: { rowNumber: "asc" },
  });
  if (rows.length === 0) {
    await finalizeSession(sessionId);
    return;
  }

  // One lookup for the whole file rather than one per row.
  const byIsbn = await findWorkKeysByIsbns(
    rows.map((r) => r.isbn13).filter((v): v is string => !!v)
  );

  const shelfIdByName = new Map(
    (await getUserShelfSummaries(userId)).map((s) => [s.name, s.id])
  );

  for (const row of rows) {
    const isbnMatch = row.isbn13 ? byIsbn.get(row.isbn13) : undefined;
    const workKey =
      isbnMatch ?? (await findWorkKeyByTitleAuthor(row.title, row.author));

    if (workKey) {
      const applied = await applyRow(
        userId,
        { ...row, workKey },
        shelfIdByName
      );
      await prisma.importRow.update({
        where: { id: row.id },
        data: {
          workKey,
          // `failed` already existed on ImportRow and nothing ever set it.
          status: applied.shelved ? "matched" : "failed",
          error: applied.reason ?? null,
          matchedBy: isbnMatch ? "isbn" : "title_author",
          // Clear any suggestions from an earlier pass; they are now noise.
          candidates: Prisma.DbNull,
        },
      });
      continue;
    }

    // No exact match. Offer suggestions and wait — never guess.
    const candidates = await findCandidates(row.title, row.author);
    await prisma.importRow.update({
      where: { id: row.id },
      data: {
        status: "needs_review",
        candidates:
          candidates.length > 0
            ? (candidates as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
      },
    });
  }

  await finalizeSession(sessionId);
}

/**
 * Fuzzy candidates for a row that did not match exactly.
 *
 * Compares against `title_norm` / `author_names_norm` rather than
 * `lower(unaccent(title))`. The two are equivalent in meaning, but only the
 * former can use the trigram index — see the note in `catalog.ts`.
 */
export async function findCandidates(
  title: string,
  author: string
): Promise<MatchCandidate[]> {
  const cleanTitle = title.trim();
  if (cleanTitle.length === 0) return [];

  return prisma.$queryRaw<MatchCandidate[]>`
    WITH q AS (
      SELECT lower(unaccent(${cleanTitle})) AS title_q,
             lower(unaccent(${author.trim()})) AS author_q
    )
    SELECT w.ol_key AS "workKey",
           w.title,
           w.author_names AS "authorNames",
           (
               similarity(w.title_norm, q.title_q) * ${TITLE_WEIGHT}
             + similarity(coalesce(w.author_names_norm, ''), q.author_q) * ${AUTHOR_WEIGHT}
           )::double precision AS score
    FROM catalog.works w
    CROSS JOIN q
    WHERE w.title_norm % q.title_q
    ORDER BY score DESC, w.edition_count DESC, w.ol_key
    LIMIT ${CANDIDATES_PER_ROW}
  `.then((rows) => rows.filter((r) => r.score >= MIN_CANDIDATE_SCORE));
}

/**
 * The reader picked a candidate. Apply it exactly as an automatic match would
 * have been, so a confirmed row is indistinguishable from one that matched on
 * its own.
 */
export async function confirmMatch(
  userId: string,
  rowId: string,
  workKey: string
): Promise<void> {
  const row = await requireOwnedRow(userId, rowId);

  // There is no foreign key from app into catalog — a narrowed ingest must not
  // cascade into someone's shelves — so the write path checks instead. The key
  // arrives from the client, and an unknown one would otherwise be stored and
  // fail much later as a book that renders as a blank card.
  if (!(await workExists(workKey))) {
    throw new ValidationError("That book is not in the catalog");
  }

  const shelfIdByName = new Map(
    (await getUserShelfSummaries(userId)).map((s) => [s.name, s.id])
  );

  const applied = await applyRow(userId, { ...row, workKey }, shelfIdByName);
  await prisma.importRow.update({
    where: { id: rowId },
    data: {
      workKey,
      status: applied.shelved ? "confirmed" : "failed",
      error: applied.reason ?? null,
      matchedBy: "confirmed_by_user",
    },
  });
  await finalizeSession(row.sessionId);
}

/** The reader decided this row is not worth resolving. */
export async function skipRow(userId: string, rowId: string): Promise<void> {
  const row = await requireOwnedRow(userId, rowId);

  await prisma.importRow.update({
    where: { id: rowId },
    data: { status: "skipped" },
  });
  await finalizeSession(row.sessionId);
}

export async function getImportSession(
  userId: string,
  sessionId: string
): Promise<ImportSessionSummary | null> {
  const session = await prisma.importSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return null;

  // An import is a reader's own reading history, unlike their shelves. Not
  // found rather than forbidden, so the id cannot be probed.
  if (session.userId !== userId) return null;

  return { ...session, ...(await countByStatus(sessionId)) };
}

/** Rows awaiting review, with their candidates decoded. */
export async function getRowsForReview(userId: string, sessionId: string) {
  const session = await prisma.importSession.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });
  if (!session || session.userId !== userId) {
    throw new NotFoundError("Import not found");
  }

  const rows = await prisma.importRow.findMany({
    where: { sessionId, status: "needs_review" },
    orderBy: { rowNumber: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    rowNumber: row.rowNumber,
    title: row.title,
    author: row.author,
    myRating: row.myRating,
    exclusiveShelf: row.exclusiveShelf,
    candidates: (row.candidates as unknown as MatchCandidate[] | null) ?? [],
  }));
}

export async function getRecentImports(userId: string, limit = 10) {
  const sessions = await prisma.importSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return Promise.all(
    sessions.map(async (s) => ({ ...s, ...(await countByStatus(s.id)) }))
  );
}

/**
 * Shelf, rating and reading history for one resolved row.
 *
 * Each step is independent: a rating that fails must not cost the reader the
 * shelved book, and reading history is the least important of the three. The
 * row itself is already stored either way, so nothing here can lose it.
 */
/**
 * Whether the row actually landed on a shelf.
 *
 * This used to return void and swallow all three steps, and the caller then
 * recorded `matched` unconditionally — so a row that shelved nothing was
 * indistinguishable from one that worked, and `matchRate` (the signal PRD
 * section 6 names for "is import working?") counted it as a success.
 *
 * The shelving step is the one that decides: a rating or a finish date without
 * a shelf entry is not an imported book. The other two stay best-effort, since
 * the book IS in the reader's library either way and both are recoverable by
 * hand.
 */
async function applyRow(
  userId: string,
  row: {
    workKey: string;
    myRating: number | null;
    exclusiveShelf: string | null;
    dateRead: Date | null;
  },
  shelfIdByName: Map<string, string>
): Promise<{ shelved: boolean; reason?: string }> {
  let shelved = false;
  let reason: string | undefined;

  if (!row.exclusiveShelf) {
    // mapExclusiveShelf returns null for any value outside Goodreads' three
    // shelves, and those rows were previously shelved nowhere and still counted
    // as matched.
    reason = "no shelf in the export";
  } else {
    const shelfId = shelfIdByName.get(
      getShelfDisplayName(
        row.exclusiveShelf as "read" | "currently-reading" | "to-read"
      )
    );

    if (!shelfId) {
      reason = "no matching shelf on this account";
    } else {
      try {
        await addWorkToShelf(shelfId, row.workKey, userId);
        shelved = true;
      } catch (error) {
        // The old comment here said "already on the shelf, re-importing is
        // normal" — a case that cannot occur, because addWorkToShelf upserts for
        // custom shelves and deletes-then-creates for the exclusive ones. What
        // it actually hid was NotFoundError("That book is not in the catalog")
        // and any Prisma failure.
        reason = error instanceof Error ? error.message : "could not be shelved";
      }
    }
  }

  if (row.myRating !== null && row.myRating >= 1 && row.myRating <= 5) {
    try {
      await createOrUpdateReview(userId, row.workKey, row.myRating);
    } catch {
      // The book is shelved; a missing rating is recoverable by hand.
    }
  }

  if (row.dateRead && row.exclusiveShelf === "read") {
    try {
      // The parsed date, not now. It was already being read from the CSV and
      // stored on the row; only this call site discarded it. See FLOW-10.
      await finishReading(userId, row.workKey, row.dateRead);
    } catch {
      // Nice to have, and already implied by the "Read" shelf.
    }
  }

  return { shelved, reason };
}

async function requireOwnedRow(userId: string, rowId: string) {
  const row = await prisma.importRow.findUnique({
    where: { id: rowId },
    include: { session: { select: { userId: true } } },
  });
  // Not found rather than forbidden when the row belongs to someone else, to
  // match getImportSession. A 403 would confirm the id exists, which is the
  // one thing a probe is trying to learn.
  if (!row || row.session.userId !== userId) {
    throw new NotFoundError("Import row not found");
  }
  return row;
}

async function countByStatus(sessionId: string) {
  const grouped = await prisma.importRow.groupBy({
    by: ["status"],
    where: { sessionId },
    _count: { _all: true },
  });

  const count = (status: string) =>
    grouped.find((g) => g.status === status)?._count._all ?? 0;

  const matched = count("matched");
  const confirmed = count("confirmed");
  const total = grouped.reduce((sum, g) => sum + g._count._all, 0);

  return {
    matched,
    confirmed,
    needsReview: count("needs_review"),
    skipped: count("skipped"),
    failed: count("failed"),
    // Deliberately the automatic rate, not the eventual one. It measures the
    // catalog's coverage, which is the thing that can be improved; including
    // confirmations would measure how patient the reader was.
    matchRate: total > 0 ? Math.round((matched / total) * 100) : 0,
  };
}

/** A session is complete once no row is still waiting on the reader. */
async function finalizeSession(sessionId: string): Promise<void> {
  const remaining = await prisma.importRow.count({
    where: { sessionId, status: "needs_review" },
  });

  await prisma.importSession.update({
    where: { id: sessionId },
    data: {
      status: remaining > 0 ? "review" : "complete",
      completedAt: remaining > 0 ? null : new Date(),
    },
  });
}
