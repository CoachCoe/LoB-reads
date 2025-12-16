import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getShelfById, deleteShelf } from "@/server/shelves";

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
    console.error("Get shelf error:", error);
    return NextResponse.json({ error: "Failed to fetch shelf" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ shelfId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { shelfId } = await params;
    await deleteShelf(shelfId, session.user.id);
    return NextResponse.json({ message: "Shelf deleted" });
  } catch (error) {
    console.error("Delete shelf error:", error);
    const message = error instanceof Error ? error.message : "Failed to delete shelf";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
