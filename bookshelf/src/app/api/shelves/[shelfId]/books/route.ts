import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { addBookToShelf, removeBookFromShelf } from "@/server/shelves";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { shelfBookSchema } from "@/lib/http/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shelfId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return unauthorized();
  }

  try {
    const { shelfId } = await params;
    const { bookId } = await parseBody(request, shelfBookSchema);

    const shelfItem = await addBookToShelf(shelfId, bookId, session.user.id);
    return NextResponse.json(shelfItem, { status: 201 });
  } catch (error) {
    return errorResponse("Add book to shelf error", error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ shelfId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return unauthorized();
  }

  try {
    const { shelfId } = await params;
    const { bookId } = await parseBody(request, shelfBookSchema);

    await removeBookFromShelf(shelfId, bookId, session.user.id);
    return NextResponse.json({ message: "Book removed from shelf" });
  } catch (error) {
    return errorResponse("Remove book from shelf error", error);
  }
}
