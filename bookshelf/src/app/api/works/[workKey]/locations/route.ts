import { NextRequest, NextResponse } from "next/server";
import {
  getWorkLocations,
  addWorkLocation,
  deleteWorkLocation,
} from "@/server/work-locations";
import { getCurrentUser } from "@/lib/auth/session";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createWorkLocationSchema } from "@/lib/http/schemas";
import { ValidationError } from "@/lib/http/errors";
import { checkLimit, LIMITS } from "@/lib/rate-limit";

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
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    // These three routes write the tables the public /map reads on every
    // request, and none of them was rate limited. See SEC-2.
    const limit = checkLimit(`contribute:work-location:${user.id}`, LIMITS.contribute);
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
    return errorResponse("Error adding work location", error);
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
