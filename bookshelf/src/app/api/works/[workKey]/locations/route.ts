import { NextRequest, NextResponse } from "next/server";
import { getWorkLocations, addWorkLocation, deleteWorkLocation, updateWorkLocation } from "@/server/work-locations";
import { getCurrentUser } from "@/lib/auth/session";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createWorkLocationSchema, updateWorkLocationSchema } from "@/lib/http/schemas";
import { ValidationError } from "@/lib/http/errors";
import { checkLimit, LIMITS, refundHit } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workKey: string }> }
) {
  try {
    const { workKey } = await params;
    const locations = await getWorkLocations(workKey);
    return NextResponse.json(locations);
  } catch (error) {
    return errorResponse("Error fetching work locations", error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workKey: string }> }
) {
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
    limitKey = `contribute:work-location:${user.id}`;
    const limit = checkLimit(limitKey, LIMITS.contribute);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "You are adding these very quickly. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const { workKey } = await params;
    const data = await parseBody(request, createWorkLocationSchema);

    // A real-world location needs coordinates to be placeable on the map;
    // a fictional one is pinned to its world instead.
    if (!data.isFictional && !data.coordinates) {
      throw new ValidationError(
        "Coordinates are required for real-world locations"
      );
    }

    const location = await addWorkLocation(workKey, user.id, {
      name: data.name,
      type: data.type,
      description: data.description ?? undefined,
      coordinates: data.coordinates ?? undefined,
      isFictional: data.isFictional,
      fictionalWorldId: data.fictionalWorldId ?? undefined,
    });

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    // Nothing was written, so the attempt costs nothing.
    refundHit(limitKey);
    return errorResponse("Error adding work location", error);
  }
}

/**
 * Edit a contributed location.
 *
 * Anyone signed in may edit, which is the PRD's wiki rule and the reason there
 * is no ownership check here — DELETE below is contributor-or-moderator, and the
 * asymmetry is deliberate. A reader who spotted a wrong pin could previously do
 * nothing at all: they could neither edit it nor delete it, so a bad pin from
 * someone who never returned was permanent until a moderator intervened.
 *
 * Rate limited, which is SEC-7's lesson: community-editable without a limit is
 * one account rewriting every record on the site in a loop. Refunded on any
 * failure, so a contributor whose correction is rejected is not charged for it —
 * the budget is spent on edits that happened.
 *
 * Takes the id from the query string, as DELETE does, so the two read the same.
 */
export async function PATCH(request: NextRequest) {
  let limitKey = "";

  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    limitKey = `edit:work-location:${user.id}`;
    const limit = checkLimit(limitKey, LIMITS.contribute);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "You are editing these very quickly. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");

    if (!locationId) {
      throw new ValidationError("Location ID is required");
    }

    const data = await parseBody(request, updateWorkLocationSchema);
    const updated = await updateWorkLocation(locationId, user.id, data);

    return NextResponse.json(updated);
  } catch (error) {
    refundHit(limitKey);
    return errorResponse("Error updating work location", error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");

    if (!locationId) {
      throw new ValidationError("Location ID is required");
    }

    await deleteWorkLocation(locationId, user.id, Boolean(user.isModerator));
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse("Error deleting work location", error);
  }
}
