import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError, ZodType } from "zod";
import {
  AuthorizationError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from "@/lib/http/errors";

/**
 * Single place where a thrown error becomes a response.
 *
 * Only errors we raised deliberately have their message shown. Anything else
 * — most importantly Prisma errors, which name constraints and columns — is
 * logged server-side and answered with a fixed string.
 */
export function errorResponse(context: string, error: unknown): NextResponse {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof PayloadTooLargeError) {
    return NextResponse.json({ error: error.message }, { status: 413 });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: firstZodMessage(error) },
      { status: 400 }
    );
  }

  // Prisma's own failures for "the row is not there" and "it already is".
  //
  // Both were reaching the client as 500s. A bare `.delete()` on a row that has
  // already gone raises P2025 — reachable by removing a book from a shelf twice,
  // or unfollowing from a stale button — and an ordinary double-click was
  // answered with a server error. The message is NOT forwarded: Prisma names
  // constraints and columns, which is what `errors.ts` exists to keep out of
  // responses.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error.code === "P2002") {
      return NextResponse.json({ error: "That already exists" }, { status: 409 });
    }
  }

  console.error(`${context}:`, error);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

/**
 * Parse a request body against a schema. Throws ZodError, which
 * `errorResponse` turns into a 400 carrying the first readable message.
 */
/**
 * Largest JSON body any route accepts.
 *
 * The biggest legitimate one in the app is a review: `longText` caps content at
 * 10,000 characters, and a location description the same, so 64 KB leaves
 * several times the headroom needed even after JSON escaping and multibyte
 * characters. Upload routes do not come through here — they read `formData()`
 * and carry their own, larger limit.
 */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/**
 * Read a body, refusing to buffer more than `maxBytes` of it.
 *
 * `request.json()` accumulates the whole body before anything can object, and
 * Content-Length is advisory and absent on a chunked request — so the declared
 * check below is a cheap first gate and this is the one that actually holds.
 * Bytes are counted as they arrive and the stream is abandoned the moment the
 * limit is passed, so an attacker sending 200 MB has 64 KB of it read.
 */
async function readBounded(request: Request, maxBytes: number): Promise<string> {
  const body = request.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    // Releases the connection whether we finished or bailed out.
    reader.releaseLock();
  }

  return new TextDecoder().decode(
    chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
  );
}

/**
 * Parse a request body against a schema. Throws ZodError, which
 * `errorResponse` turns into a 400 carrying the first readable message.
 *
 * The size gate is here rather than at each route because this is the single
 * place every JSON body passes through. `declaredBodyTooLarge` already existed
 * for the same purpose but had only ever been wired to the three multipart
 * routes, so the eleven routes that post JSON — reviews, shelves, progress, both
 * location types, worlds, profiles, import confirmations — would each buffer
 * whatever they were sent. Twenty concurrent 200 MB posts is 4 GB of heap and an
 * OOM-killed container, from one signed-in account.
 */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
  { maxBytes = MAX_JSON_BODY_BYTES }: { maxBytes?: number } = {}
): Promise<T> {
  if (declaredBodyTooLarge(request, maxBytes)) {
    throw new PayloadTooLargeError();
  }

  const text = await readBounded(request, maxBytes);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  return schema.parse(raw);
}

/** Zod issue paths are arrays; surface something a person can act on. */
function firstZodMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Reject an over-large body before it is buffered into memory.
 *
 * Every upload route checked `file.size` — which is only knowable AFTER
 * `await request.formData()` has accumulated the whole body. A size limit
 * enforced after the bytes are in memory is not a size limit, and Next exposes
 * no body cap for route handlers (`serverActions.bodySizeLimit` applies to
 * Server Actions only), there is no middleware, and next.config.ts sets none.
 *
 * Content-Length is advisory and absent on a chunked request, so this is a cheap
 * first gate rather than a guarantee — it turns the easy case (an honest client,
 * or an attacker not bothering to hide) into a 413 that costs nothing. The
 * per-account rate limits are what bound the rest.
 */
export function declaredBodyTooLarge(
  request: Request,
  maxBytes: number
): boolean {
  const declared = Number(request.headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}

export function payloadTooLarge(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 413 });
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
