import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { addBookToShelf, removeBookFromShelf } from "@/server/shelves";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shelfId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { shelfId } = await params;
    const { bookId } = await request.json();

    if (!bookId) {
      return NextResponse.json({ error: "Book ID is required" }, { status: 400 });
    }

    const shelfItem = await addBookToShelf(shelfId, bookId, session.user.id);
    return NextResponse.json(shelfItem, { status: 201 });
  } catch (error) {
    console.error("Add book to shelf error:", error);
    const message = error instanceof Error ? error.message : "Failed to add book";
    return NextResponse.json({ error: message }, { status: 400 });
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
    const { bookId } = await request.json();

    if (!bookId) {
      return NextResponse.json({ error: "Book ID is required" }, { status: 400 });
    }

    await removeBookFromShelf(shelfId, bookId, session.user.id);
    return NextResponse.json({ message: "Book removed from shelf" });
  } catch (error) {
    console.error("Remove book from shelf error:", error);
    const message = error instanceof Error ? error.message : "Failed to remove book";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
