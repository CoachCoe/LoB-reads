import { NextRequest, NextResponse } from "next/server";
import { getBookLocations, addBookLocation, deleteBookLocation } from "@/server/book-locations";
import { getCurrentUser } from "@/lib/session";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const { bookId } = await params;
    const locations = await getBookLocations(bookId);
    return NextResponse.json(locations);
  } catch (error) {
    console.error("Error fetching book locations:", error);
    return NextResponse.json(
      { error: "Failed to fetch locations" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookId } = await params;
    const body = await request.json();
    const { name, type, description, coordinates, isFictional, fictionalWorldId } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Location name is required" },
        { status: 400 }
      );
    }

    if (!type || typeof type !== "string") {
      return NextResponse.json(
        { error: "Location type is required" },
        { status: 400 }
      );
    }

    // Validate coordinates if provided
    if (coordinates) {
      if (
        typeof coordinates.lat !== "number" ||
        typeof coordinates.lng !== "number" ||
        coordinates.lat < -90 ||
        coordinates.lat > 90 ||
        coordinates.lng < -180 ||
        coordinates.lng > 180
      ) {
        return NextResponse.json(
          { error: "Invalid coordinates (lat: -90 to 90, lng: -180 to 180)" },
          { status: 400 }
        );
      }
    }

    const location = await addBookLocation(bookId, user.id, {
      name,
      type,
      description,
      coordinates,
      isFictional,
      fictionalWorldId,
    });

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    console.error("Error adding book location:", error);
    return NextResponse.json(
      { error: "Failed to add location" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");

    if (!locationId) {
      return NextResponse.json(
        { error: "Location ID is required" },
        { status: 400 }
      );
    }

    await deleteBookLocation(locationId, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting book location:", error);
    const message = error instanceof Error ? error.message : "Failed to delete location";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
