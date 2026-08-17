import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { createBook, searchLocalBooks } from "@/server/books";
import { searchBooks, normalizeOpenLibraryBook } from "@/lib/sources/openlibrary";
import { errorResponse, parseBody, unauthorized } from "@/lib/http/api";
import { createBookSchema } from "@/lib/http/schemas";

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
    return errorResponse("Book search error", error);
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return unauthorized();
  }

  try {
    const data = await parseBody(request, createBookSchema);
    const book = await createBook(data);
    return NextResponse.json(book, { status: 201 });
  } catch (error) {
    return errorResponse("Create book error", error);
  }
}
