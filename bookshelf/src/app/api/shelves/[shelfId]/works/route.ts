import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { addWorkToShelf, removeWorkFromShelf } from "@/server/shelves";
import {
  errorResponse,
  parseBody,
  tooManyRequests,
  unauthorized,
} from "@/lib/http/api";
import { shelfWorkSchema } from "@/lib/http/schemas";
import { checkLimit, LIMITS, refundHit } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shelfId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  // SEC-6. One account can hold a row per work across 6.9M catalog keys.
  const limitKey = `contribute:shelf-item:${session.user.id}`;
  const limit = checkLimit(limitKey, LIMITS.contribute);
  if (!limit.allowed) {
    return tooManyRequests(
      limit,
      "You are shelving books very quickly. Try again shortly."
    );
  }

  try {
    const { shelfId } = await params;
    const { workKey } = await parseBody(request, shelfWorkSchema);

    const shelfItem = await addWorkToShelf(shelfId, workKey, session.user.id);
    return NextResponse.json(shelfItem, { status: 201 });
  } catch (error) {
    refundHit(limitKey);
    return errorResponse("Add work to shelf error", error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ shelfId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { shelfId } = await params;
    const { workKey } = await parseBody(request, shelfWorkSchema);

    await removeWorkFromShelf(shelfId, workKey, session.user.id);
    return NextResponse.json({ message: "Removed from shelf" });
  } catch (error) {
    return errorResponse("Remove work from shelf error", error);
  }
}
