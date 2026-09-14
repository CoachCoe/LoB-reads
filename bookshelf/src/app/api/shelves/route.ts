import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { getUserShelves, createShelf } from "@/server/shelves";
import {
  errorResponse,
  parseBody,
  tooManyRequests,
  unauthorized,
} from "@/lib/http/api";
import { createShelfSchema } from "@/lib/http/schemas";
import { checkLimit, LIMITS, refundHit } from "@/lib/rate-limit";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const shelves = await getUserShelves(session.user.id);
    return NextResponse.json(shelves);
  } catch (error) {
    return errorResponse("Get shelves error", error);
  }
}

/**
 * SEC-6. There is no cap on shelves per account and there was no limiter, so a
 * loop on this endpoint grew app.shelves without bound — and /my-books then
 * loads every shelf with a 24-item preview, so the account also made its own
 * pages unusable. The contribution routes feeding the public /map were given
 * LIMITS.contribute in an earlier round; the shelf and follow writes were not
 * in that inventory.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const limitKey = `contribute:shelf:${session.user.id}`;
  const limit = checkLimit(limitKey, LIMITS.contribute);
  if (!limit.allowed) {
    return tooManyRequests(
      limit,
      "You are creating shelves very quickly. Try again shortly."
    );
  }

  try {
    const { name } = await parseBody(request, createShelfSchema);
    const shelf = await createShelf(session.user.id, name);
    return NextResponse.json(shelf, { status: 201 });
  } catch (error) {
    // Spend the budget on the work you caused: a name the schema rejected
    // wrote nothing, so it should not count against the reader.
    refundHit(limitKey);
    return errorResponse("Create shelf error", error);
  }
}
