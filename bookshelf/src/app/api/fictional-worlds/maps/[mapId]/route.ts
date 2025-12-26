import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { getCurrentUser } from "@/lib/session";
import { getMapById, deleteMap, updateMap } from "@/server/fictional-worlds";

interface RouteParams {
  params: Promise<{ mapId: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { mapId } = await params;

    // Check if the map exists
    const map = await getMapById(mapId);
    if (!map) {
      return NextResponse.json(
        { error: "Map not found" },
        { status: 404 }
      );
    }

    // Delete from Vercel Blob
    try {
      await del(map.imageUrl);
    } catch (blobError) {
      console.error("Error deleting from blob storage:", blobError);
      // Continue anyway - the DB delete is more important
    }

    // Delete the map from the database
    await deleteMap(mapId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting map:", error);
    return NextResponse.json(
      { error: "Failed to delete map" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { mapId } = await params;

    // Check if the map exists
    const existingMap = await getMapById(mapId);
    if (!existingMap) {
      return NextResponse.json(
        { error: "Map not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { title, description } = body;

    if (!title || title.trim().length === 0) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    const updatedMap = await updateMap(
      mapId,
      title.trim(),
      description?.trim() || undefined
    );

    return NextResponse.json({ map: updatedMap });
  } catch (error) {
    console.error("Error updating map:", error);
    return NextResponse.json(
      { error: "Failed to update map" },
      { status: 500 }
    );
  }
}
