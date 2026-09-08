import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getMapById, deleteMap, updateMap } from "@/server/fictional-worlds";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { deleteObjectByUrl } from "@/lib/storage/objects";
import { updateMapSchema } from "@/lib/http/schemas";
import { checkLimit, LIMITS, refundHit } from "@/lib/rate-limit";

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

/**
 * Rate limited, which is the lesson both location PATCH handlers already carry
 * in their own headers: "community-editable without a limit is one account
 * rewriting every record on the site in a loop."
 *
 * By deliberate policy there is no ownership check here — PRD §2 makes editing
 * wiki-style — which made this the only mutating handler in the app that was
 * both ownership-free AND unrated. So one signed-in account could walk every
 * mapId and rewrite every title and description rendered on the public /map,
 * with no ceiling. The two location PATCH routes were added in the same round
 * for the same PRD clause and both got LIMITS.contribute; this one was missed.
 *
 * Recorded on arrival and refunded when nothing was written, matching those
 * routes. A revert path is still absent and is recorded as feature work.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  let limitKey = "";
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return unauthorized();
    }

    limitKey = `contribute:map-edit:${user.id}`;
    const limit = checkLimit(limitKey, LIMITS.contribute);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "You are editing these very quickly. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const { mapId } = await params;

    const existingMap = await getMapById(mapId);
    if (!existingMap) {
      // Returns rather than throws, so it does not reach the catch below —
      // refund here or a missing map costs the caller budget it did not spend.
      refundHit(limitKey);
      return NextResponse.json({ error: "Map not found" }, { status: 404 });
    }

    const { title, description } = await parseBody(request, updateMapSchema);

    const updatedMap = await updateMap(mapId, user.id, {
      title,
      description: description || null,
    });

    return NextResponse.json({ map: updatedMap });
  } catch (error) {
    // Nothing was written, so the attempt costs nothing.
    refundHit(limitKey);
    return errorResponse("Error updating map", error);
  }
}
