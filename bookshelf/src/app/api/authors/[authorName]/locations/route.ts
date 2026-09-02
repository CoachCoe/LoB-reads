import { NextRequest, NextResponse } from "next/server";
import { findAuthorKeyByName, getAuthorLocations, addAuthorLocation, deleteAuthorLocation, updateAuthorLocation } from "@/server/authors";
import { getCurrentUser } from "@/lib/auth/session";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createAuthorLocationSchema, updateAuthorLocationSchema } from "@/lib/http/schemas";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import { checkLimit, LIMITS, refundHit } from "@/lib/rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ authorName: string }> }
) {
  try {
    const { authorName } = await params;
    const authorKey = await findAuthorKeyByName(decodeURIComponent(authorName));

    // An author absent from the catalog simply has no locations.
    return NextResponse.json({
      locations: authorKey ? await getAuthorLocations(authorKey) : [],
    });
  } catch (error) {
    return errorResponse("Error fetching author locations", error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ authorName: string }> }
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
    limitKey = `contribute:author-location:${user.id}`;
    const limit = checkLimit(limitKey, LIMITS.contribute);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "You are adding these very quickly. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const { authorName } = await params;
    const data = await parseBody(request, createAuthorLocationSchema);

    if (
      data.yearStart != null &&
      data.yearEnd != null &&
      data.yearEnd < data.yearStart
    ) {
      throw new ValidationError("End year cannot be before start year");
    }

    const authorKey = await findAuthorKeyByName(decodeURIComponent(authorName));
    if (!authorKey) {
      throw new NotFoundError("That author is not in the catalog");
    }

    const location = await addAuthorLocation(authorKey, user.id, {
      name: data.name,
      type: data.type,
      description: data.description ?? undefined,
      coordinates: data.coordinates,
      yearStart: data.yearStart ?? undefined,
      yearEnd: data.yearEnd ?? undefined,
    });

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    // Nothing was written, so the attempt costs nothing.
    refundHit(limitKey);
    return errorResponse("Error adding author location", error);
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

    limitKey = `edit:author-location:${user.id}`;
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

    const data = await parseBody(request, updateAuthorLocationSchema);
    const updated = await updateAuthorLocation(locationId, user.id, data);

    return NextResponse.json(updated);
  } catch (error) {
    refundHit(limitKey);
    return errorResponse("Error updating author location", error);
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

    await deleteAuthorLocation(locationId, user.id, Boolean(user.isModerator));
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse("Error deleting author location", error);
  }
}
