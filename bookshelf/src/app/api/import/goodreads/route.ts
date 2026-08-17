import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  parseGoodreadsCSV,
  GoodreadsBook,
  ImportResult,
  getShelfDisplayName,
} from "@/lib/sources/goodreads";
import { findWorkKeysByIsbns, findWorkKeyByTitleAuthor } from "@/server/catalog";
import { getUserShelfSummaries, addWorkToShelf } from "@/server/shelves";
import { createOrUpdateReview } from "@/server/reviews";
import { finishReading } from "@/server/progress";
import { errorResponse, unauthorized } from "@/lib/http/api";
import { ValidationError } from "@/lib/http/errors";

/**
 * Goodreads CSV import, matched against the local catalog.
 *
 * There is no network call here any more. The importer used to fetch Open
 * Library over HTTP once per unmatched book — a 500-book export meant 500
 * sequential round trips — and create a local book row from the result. With
 * the catalog held locally that becomes a single ISBN lookup for the file.
 *
 * Rows that do not match are reported back rather than dropped. A review queue
 * where the reader confirms fuzzy matches is M6.
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Rows per request, so one upload cannot run for an unbounded time. */
const MAX_ROWS = 2_000;

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

    const rows = parsed.slice(0, MAX_ROWS);
    const notProcessed = parsed.length - rows.length;

    const shelves = await getUserShelfSummaries(userId);
    const shelfIdByName = new Map(shelves.map((s) => [s.name, s.id]));

    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      errors: [],
      books: [],
    };

    // One lookup for the whole file.
    const byIsbn = await findWorkKeysByIsbns(
      rows.map((r) => r.isbn13 || r.isbn).filter((v): v is string => !!v)
    );

    for (const row of rows) {
      try {
        const workKey = await resolveWorkKey(row, byIsbn);

        if (!workKey) {
          // Reported, not silently dropped. Otherwise a reader finds a smaller
          // library than they exported and no explanation for the difference.
          result.skipped++;
          result.books.push({
            title: row.title,
            author: row.author,
            status: "skipped",
            reason: "No match in the catalog",
          });
          continue;
        }

        if (row.exclusiveShelf) {
          const shelfId = shelfIdByName.get(
            getShelfDisplayName(row.exclusiveShelf)
          );
          if (shelfId) {
            try {
              await addWorkToShelf(shelfId, workKey, userId);
            } catch {
              // Already on the shelf; nothing to do.
            }
          }
        }

        if (
          Number.isInteger(row.myRating) &&
          row.myRating >= 1 &&
          row.myRating <= 5
        ) {
          try {
            await createOrUpdateReview(userId, workKey, row.myRating);
          } catch {
            // A rating failure should not lose the book itself.
          }
        }

        if (row.dateRead && row.exclusiveShelf === "read") {
          try {
            await finishReading(userId, workKey);
          } catch {
            // Reading history is a nice-to-have; the book is already shelved.
          }
        }

        result.imported++;
        result.books.push({
          title: row.title,
          author: row.author,
          status: "imported",
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        result.skipped++;
        result.errors.push(`${row.title}: ${reason}`);
        result.books.push({
          title: row.title,
          author: row.author,
          status: "error",
          reason,
        });
      }
    }

    if (notProcessed > 0) {
      result.errors.push(
        `Only the first ${MAX_ROWS} rows were imported. ${notProcessed} more were not processed — re-upload the remainder to continue.`
      );
    }

    const matchRate =
      rows.length > 0 ? Math.round((result.imported / rows.length) * 100) : 0;
    result.errors.unshift(
      `Matched ${result.imported} of ${rows.length} rows (${matchRate}%).`
    );

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse("Goodreads import error", error);
  }
}

/** ISBN first; fall back to an exact title and author match. */
async function resolveWorkKey(
  row: GoodreadsBook,
  byIsbn: Map<string, string>
): Promise<string | null> {
  const isbn = row.isbn13 || row.isbn;
  if (isbn) {
    const matched = byIsbn.get(isbn);
    if (matched) return matched;
  }
  return findWorkKeyByTitleAuthor(row.title, row.author);
}
