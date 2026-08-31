import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { parseGoodreadsCSV, GoodreadsBook } from "@/lib/sources/goodreads";
import { createImportSession, getImportSession } from "@/server/imports";
import {
  declaredBodyTooLarge,
  errorResponse,
  payloadTooLarge,
  unauthorized,
} from "@/lib/http/api";
import { checkLimit, LIMITS } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/http/errors";

/**
 * Goodreads CSV import.
 *
 * There is no network call here. The importer used to fetch Open Library over
 * HTTP once per unmatched book — a 500-book export meant 500 sequential round
 * trips — and build a local book row from the reply. With the catalog held
 * locally that becomes one ISBN lookup for the whole file.
 *
 * The handler stores the file as a session and returns its id. Rows that match
 * confidently are applied; the rest are queued for the reader at
 * /import/[sessionId] rather than counted and discarded.
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Rows per upload, so one file cannot run for an unbounded time. */
const MAX_ROWS = 2_000;

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    // This route had no rate limit at all, while the two blob-upload routes
    // did — and it is by far the most expensive: createImportSession runs
    // matchSession, which per row may do a trigram similarity scan over
    // catalog.works plus up to three write paths, two of them transactions.
    // MAX_ROWS bounds the loop, not the cost, so 2,000 deliberately unmatchable
    // rows times a handful of concurrent requests exhausts the connection pool
    // and every other page starts timing out.
    const limit = checkLimit(`import:${user.id}`, LIMITS.upload);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many imports. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        }
      );
    }

    // Before formData(), which buffers the entire body.
    if (declaredBodyTooLarge(request, MAX_FILE_SIZE)) {
      return payloadTooLarge("File too large. Maximum size is 10MB.");
    }

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
    const sessionId = await createImportSession(user.id, file.name, rows);
    const summary = await getImportSession(user.id, sessionId);

    return NextResponse.json({
      sessionId,
      summary,
      // Named so the client can say which rows were left, rather than implying
      // the file failed. Re-uploading continues from where this stopped.
      notProcessed: parsed.length - rows.length,
      maxRows: MAX_ROWS,
    });
  } catch (error) {
    return errorResponse("Goodreads import error", error);
  }
}
