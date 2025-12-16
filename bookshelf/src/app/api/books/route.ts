import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createBook, searchLocalBooks } from "@/server/books";
import { searchBooks, normalizeOpenLibraryBook } from "@/lib/openlibrary";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const source = searchParams.get("source") || "all";

  if (!query) {
    return NextResponse.json({ error: "Query parameter required" }, { status: 400 });
  }

  try {
    const results: {
      local: Awaited<ReturnType<typeof searchLocalBooks>>;
      openLibrary: ReturnType<typeof normalizeOpenLibraryBook>[];
    } = {
      local: [],
      openLibrary: [],
    };

    if (source === "local" || source === "all") {
      results.local = await searchLocalBooks(query);
    }

    if (source === "openlibrary" || source === "all") {
      const olResults = await searchBooks(query);
      results.openLibrary = olResults.docs.map(normalizeOpenLibraryBook);
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error("Book search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, author, isbn, description, coverUrl, pageCount, publishedDate, genres, openLibraryId } = body;

    if (!title || !author) {
      return NextResponse.json(
        { error: "Title and author are required" },
        { status: 400 }
      );
    }

    const book = await createBook({
      title,
      author,
      isbn,
      description,
      coverUrl,
      pageCount,
      publishedDate,
      genres,
      openLibraryId,
    });

    return NextResponse.json(book, { status: 201 });
  } catch (error) {
    console.error("Create book error:", error);
    return NextResponse.json({ error: "Failed to create book" }, { status: 500 });
  }
}
