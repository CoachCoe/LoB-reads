import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getMapById, deleteMap, updateMap } from "@/server/fictional-worlds";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { deleteObjectByUrl } from "@/lib/storage/objects";
import { updateMapSchema } from "@/lib/http/schemas";

interface RouteParams {
  params: Promise<{ mapId: string }>;
}

/**
 * Maps are community-editable, so any signed-in user may correct a title or
 * description. Deletion is destructive and also removes the blob, so it is
 * limited to the person who uploaded it or a moderator.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    const { mapId } = await params;

    const map = await getMapById(mapId);
    if (!map) {
      return NextResponse.json({ error: "Map not found" }, { status: 404 });
    }

    if (map.addedById !== user.id && !user.isModerator) {
      return NextResponse.json(
        { error: "You can only remove maps you uploaded" },
        { status: 403 }
      );
    }

    // Remove the stored image. Best-effort: the DB row matters more, and an
    // orphaned object is cheaper than a map that cannot be deleted.
    try {
      await deleteObjectByUrl(map.imageUrl);
    } catch (storageError) {
      console.error("Error deleting map image from storage:", storageError);
    }

    await deleteMap(mapId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse("Error deleting map", error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    const { mapId } = await params;

    const existingMap = await getMapById(mapId);
    if (!existingMap) {
      return NextResponse.json({ error: "Map not found" }, { status: 404 });
    }

    const { title, description } = await parseBody(request, updateMapSchema);

    const updatedMap = await updateMap(mapId, user.id, {
      title,
      description: description || null,
    });

    return NextResponse.json({ map: updatedMap });
  } catch (error) {
    return errorResponse("Error updating map", error);
  }
}
