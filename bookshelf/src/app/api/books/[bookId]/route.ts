import { NextResponse } from "next/server";
import { getBookById } from "@/server/books";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const { bookId } = await params;
    const book = await getBookById(bookId);

    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }

    return NextResponse.json(book);
  } catch (error) {
    console.error("Get book error:", error);
    return NextResponse.json({ error: "Failed to fetch book" }, { status: 500 });
  }
}
