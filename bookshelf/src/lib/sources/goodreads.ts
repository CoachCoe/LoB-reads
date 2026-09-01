import { cleanIsbn } from "@/lib/sources/isbn";
export interface GoodreadsBook {
  title: string;
  author: string;
  isbn: string | null;
  isbn13: string | null;
  myRating: number;
  dateRead: Date | null;
  dateAdded: Date | null;
  exclusiveShelf: "read" | "currently-reading" | "to-read" | null;
  bookshelves: string[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  books: {
    title: string;
    author: string;
    status: "imported" | "skipped" | "error";
    reason?: string;
  }[];
}

/**
 * Pull an ISBN out of a Goodreads cell, which arrives as `="0123456789"`.
 *
 * Separators are stripped through the shared `cleanIsbn` rather than by a second
 * local rule. This used to strip only Excel's wrapper and then require ten or
 * thirteen bare digits, so a hyphenated `978-0-441-17271-9` — a perfectly good
 * ISBN-13, and a common export shape — failed the test and was discarded
 * entirely. An X check digit on an ISBN-10 was dropped for the same reason.
 * DEAD-1.
 *
 * Renamed from `cleanISBN`: it sat one letter away from `cleanIsbn` in a sibling
 * directory implementing a different rule, which is how the two drifted.
 */
function isbnFromCell(isbn: string | undefined): string | null {
  if (!isbn) return null;
  const cleaned = cleanIsbn(isbn.replace(/^[="]+|["]+$/g, ""));
  if (/^[0-9]{13}$/.test(cleaned) || /^[0-9]{9}[0-9X]$/.test(cleaned)) {
    return cleaned;
  }
  // Handle ISBN-10 with X check digit
  if (/^\d{9}X$/i.test(cleaned)) {
    return cleaned.toUpperCase();
  }
  return null;
}

// Parse date from Goodreads format (YYYY/MM/DD)
function parseGoodreadsDate(dateStr: string | undefined): Date | null {
  if (!dateStr || dateStr.trim() === "") return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return new Date(year, month - 1, day);
}

// Map Goodreads shelf names to our default shelf names
function mapExclusiveShelf(
  shelf: string
): "read" | "currently-reading" | "to-read" | null {
  const normalized = shelf.toLowerCase().trim();
  switch (normalized) {
    case "read":
      return "read";
    case "currently-reading":
      return "currently-reading";
    case "to-read":
      return "to-read";
    default:
      return null;
  }
}

// Map our shelf identifier to display name
export function getShelfDisplayName(
  shelf: "read" | "currently-reading" | "to-read"
): string {
  switch (shelf) {
    case "read":
      return "Read";
    case "currently-reading":
      return "Currently Reading";
    case "to-read":
      return "Want to Read";
  }
}

/**
 * Split CSV text into records of fields.
 *
 * This walks the whole document as one character stream rather than splitting
 * on newlines first. Goodreads exports include a "My Review" column, and a
 * multi-paragraph review contains literal newlines inside its quoted field —
 * splitting on "\n" first tore those records in half and shifted every column
 * after the review, so the affected book silently lost its shelf and read date.
 */
function parseCSV(content: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM, which would otherwise become part of the first header.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  const pushField = () => {
    record.push(field);
    field = "";
  };

  const pushRecord = () => {
    pushField();
    // Ignore blank lines, including the trailing newline at end of file.
    if (record.some((value) => value.trim() !== "")) {
      records.push(record);
    }
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // Escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRecord();
    } else if (char === "\r") {
      // Handle CRLF; a lone CR is treated as a line break too.
      if (text[i + 1] === "\n") i++;
      pushRecord();
    } else {
      field += char;
    }
  }

  // Final record, when the file does not end with a newline.
  if (field !== "" || record.length > 0) {
    pushRecord();
  }

  return records;
}

export function parseGoodreadsCSV(csvContent: string): GoodreadsBook[] {
  const records = parseCSV(csvContent);
  if (records.length < 2) return [];

  // Parse header row to find column indices
  const columnIndex: Record<string, number> = {};
  records[0].forEach((header, index) => {
    columnIndex[header.trim()] = index;
  });

  // Required columns
  const requiredColumns = ["Title", "Author"];
  for (const col of requiredColumns) {
    if (columnIndex[col] === undefined) {
      throw new Error(`Missing required column: ${col}`);
    }
  }

  const books: GoodreadsBook[] = [];

  for (let i = 1; i < records.length; i++) {
    const values = records[i];

    const title = values[columnIndex["Title"]]?.trim();
    const author = values[columnIndex["Author"]]?.trim();

    // Skip rows without title or author
    if (!title || !author) continue;

    books.push({
      title,
      author,
      isbn: isbnFromCell(values[columnIndex["ISBN"]]),
      isbn13: isbnFromCell(values[columnIndex["ISBN13"]]),
      myRating: parseInt(values[columnIndex["My Rating"]] || "0", 10) || 0,
      dateRead: parseGoodreadsDate(values[columnIndex["Date Read"]]),
      dateAdded: parseGoodreadsDate(values[columnIndex["Date Added"]]),
      exclusiveShelf: mapExclusiveShelf(
        values[columnIndex["Exclusive Shelf"]] || ""
      ),
      bookshelves: (values[columnIndex["Bookshelves"]] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  return books;
}
