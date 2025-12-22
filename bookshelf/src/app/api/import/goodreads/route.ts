import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import {
  parseGoodreadsCSV,
  GoodreadsBook,
  ImportResult,
  getShelfDisplayName,
} from "@/lib/goodreads";
import { createBook } from "@/server/books";
import { getUserShelves, addBookToShelf } from "@/server/shelves";
import { createOrUpdateReview } from "@/server/reviews";
import { getBookByISBN, normalizeOpenLibraryBook } from "@/lib/openlibrary";
import prisma from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.id;
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a CSV file." },
        { status: 400 }
      );
    }

    // Validate file size (10MB max for CSV)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    // Parse CSV content
    const csvContent = await file.text();
    let books: GoodreadsBook[];

    try {
      books = parseGoodreadsCSV(csvContent);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to parse CSV",
        },
        { status: 400 }
      );
    }

    if (books.length === 0) {
      return NextResponse.json(
        { error: "No valid books found in CSV" },
        { status: 400 }
      );
    }

    // Get user's shelves
    const userShelves = await getUserShelves(userId);
    const shelfMap = new Map(userShelves.map((s) => [s.name, s.id]));

    // Process each book
    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      errors: [],
      books: [],
    };

    for (const grBook of books) {
      try {
        // Step 1: Find or create book
        let book = null;
        const isbn = grBook.isbn13 || grBook.isbn;

        // Check local database first by ISBN
        if (isbn) {
          book = await prisma.book.findUnique({
            where: { isbn },
          });
        }

        // If not found locally, try Open Library
        if (!book && isbn) {
          try {
            const olBook = await getBookByISBN(isbn);
            if (olBook) {
              const normalized = normalizeOpenLibraryBook(olBook);
              book = await createBook({
                ...normalized,
                // Use Goodreads data if OL doesn't have it
                title: normalized.title || grBook.title,
                author: normalized.author || grBook.author,
              });
            }
          } catch {
            // Open Library lookup failed, continue with Goodreads data only
          }
        }

        // If still not found, create with minimal Goodreads data
        if (!book) {
          book = await createBook({
            title: grBook.title,
            author: grBook.author,
            isbn: isbn,
          });
        }

        // Step 2: Add to appropriate shelf
        if (grBook.exclusiveShelf) {
          const shelfName = getShelfDisplayName(grBook.exclusiveShelf);
          const shelfId = shelfMap.get(shelfName);

          if (shelfId) {
            try {
              await addBookToShelf(shelfId, book.id, userId);
            } catch {
              // Ignore if already on shelf
            }
          }
        }

        // Step 3: Create review if rating exists (1-5)
        if (grBook.myRating >= 1 && grBook.myRating <= 5) {
          try {
            await createOrUpdateReview(userId, book.id, grBook.myRating);
          } catch {
            // Ignore review errors
          }
        }

        // Step 4: Set reading progress if date read exists
        if (grBook.dateRead && grBook.exclusiveShelf === "read") {
          try {
            await prisma.readingProgress.upsert({
              where: {
                userId_bookId: { userId, bookId: book.id },
              },
              create: {
                userId,
                bookId: book.id,
                currentPage: book.pageCount || 0,
                finishedAt: grBook.dateRead,
              },
              update: {
                finishedAt: grBook.dateRead,
                currentPage: book.pageCount || 0,
              },
            });
          } catch {
            // Ignore progress errors
          }
        }

        result.imported++;
        result.books.push({
          title: grBook.title,
          author: grBook.author,
          status: "imported",
        });
      } catch (error) {
        result.skipped++;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`${grBook.title}: ${errorMessage}`);
        result.books.push({
          title: grBook.title,
          author: grBook.author,
          status: "error",
          reason: errorMessage,
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Goodreads import error:", error);
    return NextResponse.json(
      { error: "Failed to import Goodreads library" },
      { status: 500 }
    );
  }
}
