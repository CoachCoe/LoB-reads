import { NextRequest, NextResponse } from "next/server";
import { getAuthorByName, addAuthorLocation, deleteAuthorLocation } from "@/server/authors";
import { getCurrentUser } from "@/lib/session";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ authorName: string }> }
) {
  try {
    const { authorName } = await params;
    const decodedName = decodeURIComponent(authorName);
    const author = await getAuthorByName(decodedName);

    if (!author) {
      return NextResponse.json({ locations: [] });
    }

    return NextResponse.json({ locations: author.locations });
  } catch (error) {
    console.error("Error fetching author locations:", error);
    return NextResponse.json(
      { error: "Failed to fetch locations" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ authorName: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { authorName } = await params;
    const decodedName = decodeURIComponent(authorName);
    const body = await request.json();
    const { name, type, description, coordinates, yearStart, yearEnd } = body;

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

    if (!coordinates || typeof coordinates.lat !== "number" || typeof coordinates.lng !== "number") {
      return NextResponse.json(
        { error: "Valid coordinates are required" },
        { status: 400 }
      );
    }

    const location = await addAuthorLocation(decodedName, user.id, {
      name,
      type,
      description,
      coordinates,
      yearStart,
      yearEnd,
    });

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    console.error("Error adding author location:", error);
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

    await deleteAuthorLocation(locationId, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting author location:", error);
    const message = error instanceof Error ? error.message : "Failed to delete location";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
