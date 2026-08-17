import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  parseGoodreadsCSV,
  GoodreadsBook,
  ImportResult,
  getShelfDisplayName,
} from "@/lib/sources/goodreads";
import { createBook, findBooksByIsbns } from "@/server/books";
import { getUserShelfSummaries, addBookToShelf } from "@/server/shelves";
import { createOrUpdateReview } from "@/server/reviews";
import { recordFinishedRead } from "@/server/progress";
import { getBookByISBN, normalizeOpenLibraryBook } from "@/lib/sources/openlibrary";
import { mapWithConcurrency } from "@/lib/concurrency";
import { errorResponse, unauthorized } from "@/lib/http/api";
import { ValidationError } from "@/lib/http/errors";
import type { Book } from "@prisma/client";

/** CSV file size ceiling. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Rows processed per request. Beyond this the handler risks exceeding a
 * serverless execution limit, so we import the first N and tell the user
 * plainly how many were left out rather than timing out with no explanation.
 */
const MAX_ROWS = 2_000;

/** Parallel Open Library lookups. Kept modest to stay a polite API client. */
const LOOKUP_CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    const userId = user.id;
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a CSV file." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    let parsed: GoodreadsBook[];
    try {
      parsed = parseGoodreadsCSV(await file.text());
    } catch (error) {
      // parseGoodreadsCSV only raises messages we wrote, and they name the
      // missing column — genuinely useful to the person fixing their export.
      throw new ValidationError(
        error instanceof Error ? error.message : "Failed to parse CSV"
      );
    }

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "No valid books found in CSV" },
        { status: 400 }
      );
    }

    const books = parsed.slice(0, MAX_ROWS);
    const notProcessed = parsed.length - books.length;

    const shelves = await getUserShelfSummaries(userId);
    const shelfIdByName = new Map(shelves.map((s) => [s.name, s.id]));

    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      errors: [],
      books: [],
    };

    // Step 1: resolve every row to a Book record.
    //
    // Existing books are found in a single query rather than one per row, and
    // the Open Library lookups for the remainder run with bounded concurrency
    // instead of one blocking request at a time.
    const resolved = await resolveBooks(books, result);

    // Step 2: apply shelf, review and progress. These are local writes, so
    // they stay sequential — no external calls involved.
    for (let i = 0; i < books.length; i++) {
      const grBook = books[i];
      const book = resolved[i];

      if (!book) continue; // Already recorded as an error in resolveBooks.

      try {
        if (grBook.exclusiveShelf) {
          const shelfId = shelfIdByName.get(
            getShelfDisplayName(grBook.exclusiveShelf)
          );
          if (shelfId) {
            try {
              await addBookToShelf(shelfId, book.id, userId);
            } catch {
              // Already on the shelf; nothing to do.
            }
          }
        }

        if (Number.isInteger(grBook.myRating) && grBook.myRating >= 1 && grBook.myRating <= 5) {
          try {
            await createOrUpdateReview(userId, book.id, grBook.myRating);
          } catch {
            // A review failure shouldn't lose the book itself.
          }
        }

        if (grBook.dateRead && grBook.exclusiveShelf === "read") {
          try {
            await recordFinishedRead(
              userId,
              book.id,
              grBook.dateRead,
              book.pageCount
            );
          } catch {
            // Progress is a nice-to-have; the book is already imported.
          }
        }

        result.imported++;
        result.books.push({
          title: grBook.title,
          author: grBook.author,
          status: "imported",
        });
      } catch (error) {
        recordError(result, grBook, error);
      }
    }

    if (notProcessed > 0) {
      result.errors.push(
        `Only the first ${MAX_ROWS} rows were imported. ${notProcessed} more were not processed — re-upload the remainder to continue.`
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse("Goodreads import error", error);
  }
}

/**
 * Map each CSV row to a Book, creating one where needed. Returns an array
 * positionally aligned with `books`; a null entry means that row failed and
 * has already been recorded in `result`.
 */
async function resolveBooks(
  books: GoodreadsBook[],
  result: ImportResult
): Promise<(Book | null)[]> {
  const isbnFor = (b: GoodreadsBook) => b.isbn13 || b.isbn;

  const isbns = [...new Set(books.map(isbnFor).filter((v): v is string => !!v))];

  const existing = await findBooksByIsbns(isbns);
  const bookByIsbn = new Map(existing.map((b) => [b.isbn!, b]));

  return mapWithConcurrency(books, LOOKUP_CONCURRENCY, async (grBook) => {
    try {
      const isbn = isbnFor(grBook);

      if (isbn) {
        const known = bookByIsbn.get(isbn);
        if (known) return known;
      }

      if (isbn) {
        try {
          const olBook = await getBookByISBN(isbn);
          if (olBook) {
            const normalized = normalizeOpenLibraryBook(olBook);
            const created = await createBook({
              ...normalized,
              title: normalized.title || grBook.title,
              author: normalized.author || grBook.author,
            });
            bookByIsbn.set(isbn, created);
            return created;
          }
        } catch {
          // Open Library is best-effort; fall back to the Goodreads columns.
        }
      }

      const created = await createBook({
        title: grBook.title,
        author: grBook.author,
        isbn,
      });
      if (isbn) bookByIsbn.set(isbn, created);
      return created;
    } catch (error) {
      recordError(result, grBook, error);
      return null;
    }
  });
}

function recordError(
  result: ImportResult,
  grBook: GoodreadsBook,
  error: unknown
) {
  const reason = error instanceof Error ? error.message : "Unknown error";
  result.skipped++;
  result.errors.push(`${grBook.title}: ${reason}`);
  result.books.push({
    title: grBook.title,
    author: grBook.author,
    status: "error",
    reason,
  });
}
