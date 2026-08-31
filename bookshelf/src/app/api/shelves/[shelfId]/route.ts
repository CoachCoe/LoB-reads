import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { getShelfById, deleteShelf } from "@/server/shelves";
import { errorResponse, unauthorized } from "@/lib/http/api";

// Shelves are public — this is intentionally unauthenticated. The query layer
// returns only the owner's public fields alongside the books.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ shelfId: string }> }
) {
  try {
    const { shelfId } = await params;
    const shelf = await getShelfById(shelfId);

    if (!shelf) {
      return NextResponse.json({ error: "Shelf not found" }, { status: 404 });
    }

    return NextResponse.json(shelf);
  } catch (error) {
    return errorResponse("Get shelf error", error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ shelfId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  try {
    const { shelfId } = await params;
    await deleteShelf(shelfId, session.user.id);
    return NextResponse.json({ message: "Shelf deleted" });
  } catch (error) {
    return errorResponse("Delete shelf error", error);
  }
}
