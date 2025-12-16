import { OpenLibrarySearchResponse, OpenLibraryBook } from "@/types";

const BASE_URL = "https://openlibrary.org";

export async function searchBooks(
  query: string,
  limit = 20,
  offset = 0
): Promise<OpenLibrarySearchResponse> {
  const params = new URLSearchParams({
    q: query,
    limit: limit.toString(),
    offset: offset.toString(),
    fields: "key,title,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,subject",
  });

  const response = await fetch(`${BASE_URL}/search.json?${params}`);

  if (!response.ok) {
    throw new Error("Failed to search Open Library");
  }

  return response.json();
}

export async function getBookByISBN(isbn: string): Promise<OpenLibraryBook | null> {
  const response = await fetch(`${BASE_URL}/isbn/${isbn}.json`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error("Failed to fetch book from Open Library");
  }

  const data = await response.json();

  // ISBN endpoint returns a different format, need to normalize
  return {
    key: data.key,
    title: data.title,
    author_name: data.authors?.map((a: { name: string }) => a.name),
    isbn: [isbn],
    cover_i: data.covers?.[0],
    number_of_pages_median: data.number_of_pages,
    subject: data.subjects,
  };
}

export async function getWorkDetails(workKey: string) {
  // workKey format: /works/OL12345W
  const response = await fetch(`${BASE_URL}${workKey}.json`);

  if (!response.ok) {
    throw new Error("Failed to fetch work details");
  }

  const data = await response.json();

  return {
    title: data.title,
    description: typeof data.description === "string"
      ? data.description
      : data.description?.value || null,
    covers: data.covers || [],
    subjects: data.subjects || [],
  };
}

export function getCoverUrl(coverId: number | undefined, size: "S" | "M" | "L" = "M"): string | null {
  if (!coverId) return null;
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}

export function getISBNCoverUrl(isbn: string, size: "S" | "M" | "L" = "M"): string {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-${size}.jpg`;
}

// Convert Open Library book to our format
export function normalizeOpenLibraryBook(book: OpenLibraryBook) {
  return {
    title: book.title,
    author: book.author_name?.join(", ") || "Unknown Author",
    isbn: book.isbn?.[0] || null,
    coverUrl: getCoverUrl(book.cover_i, "L"),
    pageCount: book.number_of_pages_median || null,
    publishedDate: book.first_publish_year?.toString() || null,
    genres: (book.subject || []).slice(0, 5),
    openLibraryId: book.key,
  };
}
