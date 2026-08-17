import { NextRequest, NextResponse } from "next/server";
import {
  getBookLocations,
  addBookLocation,
  deleteBookLocation,
} from "@/server/book-locations";
import { getCurrentUser } from "@/lib/auth/session";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createBookLocationSchema } from "@/lib/http/schemas";
import { ValidationError } from "@/lib/http/errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const { bookId } = await params;
    const locations = await getBookLocations(bookId);
    return NextResponse.json(locations);
  } catch (error) {
    return errorResponse("Error fetching book locations", error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    const { bookId } = await params;
    const data = await parseBody(request, createBookLocationSchema);

    // A real-world location needs coordinates to be placeable on the map;
    // a fictional one is pinned to its world instead.
    if (!data.isFictional && !data.coordinates) {
      throw new ValidationError(
        "Coordinates are required for real-world locations"
      );
    }

    const location = await addBookLocation(bookId, user.id, {
      name: data.name,
      type: data.type,
      description: data.description ?? undefined,
      coordinates: data.coordinates ?? undefined,
      isFictional: data.isFictional,
      fictionalWorldId: data.fictionalWorldId ?? undefined,
    });

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    return errorResponse("Error adding book location", error);
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

    await deleteBookLocation(locationId, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse("Error deleting book location", error);
  }
}
