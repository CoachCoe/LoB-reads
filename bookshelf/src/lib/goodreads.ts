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

// Clean ISBN from Goodreads format (often ="0123456789" or "0123456789")
function cleanISBN(isbn: string | undefined): string | null {
  if (!isbn) return null;
  // Remove leading =" or =", trailing ", and any spaces
  const cleaned = isbn.replace(/^[="]+|["]+$/g, "").trim();
  // Validate: ISBN should be 10 or 13 digits
  if (/^\d{10}$/.test(cleaned) || /^\d{13}$/.test(cleaned)) {
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

// Parse a single CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

export function parseGoodreadsCSV(csvContent: string): GoodreadsBook[] {
  const lines = csvContent.split("\n");
  if (lines.length < 2) return [];

  // Parse header row to find column indices
  const headers = parseCSVLine(lines[0]);
  const columnIndex: Record<string, number> = {};
  headers.forEach((header, index) => {
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

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    const title = values[columnIndex["Title"]]?.trim();
    const author = values[columnIndex["Author"]]?.trim();

    // Skip rows without title or author
    if (!title || !author) continue;

    books.push({
      title,
      author,
      isbn: cleanISBN(values[columnIndex["ISBN"]]),
      isbn13: cleanISBN(values[columnIndex["ISBN13"]]),
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
