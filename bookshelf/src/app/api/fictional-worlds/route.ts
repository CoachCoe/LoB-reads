import { NextRequest, NextResponse } from "next/server";
import { getAllFictionalWorlds, createFictionalWorld } from "@/server/fictional-worlds";
import { getCurrentUser } from "@/lib/auth/session";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createFictionalWorldSchema } from "@/lib/http/schemas";
import { checkLimit, LIMITS, refundHit } from "@/lib/rate-limit";

export async function GET() {
  try {
    const worlds = await getAllFictionalWorlds();
    return NextResponse.json(worlds);
  } catch (error) {
    return errorResponse("Error fetching fictional worlds", error);
  }
}

export async function POST(request: NextRequest) {
  // Declared out here so the catch can refund it; empty until the
  // caller is known, and refundHit ignores a key it has never seen.
  let limitKey = "";

  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    // These three routes write the tables the public /map reads on every
    // request, and none of them was rate limited. See SEC-2.
    //
    // Recorded on arrival so the check is atomic, and refunded on every failure
    // path below: the budget exists to bound rows created, not requests
    // attempted, so a contributor who mistypes a latitude sixty times is not
    // locked out for an hour. Same policy as the login limiter, which refunds a
    // correct password — spend the budget on the work you caused.
    limitKey = `contribute:world:${user.id}`;
    const limit = checkLimit(limitKey, LIMITS.contribute);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "You are adding these very quickly. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const { name, description } = await parseBody(
      request,
      createFictionalWorldSchema
    );

    const world = await createFictionalWorld(name, description ?? undefined);
    return NextResponse.json(world, { status: 201 });
  } catch (error) {
    // Nothing was written, so the attempt costs nothing.
    refundHit(limitKey);
    return errorResponse("Error creating fictional world", error);
  }
}
