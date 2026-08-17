import { prisma } from "./setup";
import { canonicalIsbn13, isbn10To13, isValidIsbn13 } from "@/lib/sources/isbn";

/**
 * The ISBN logic exists twice: as SQL for the ingest's set-based work, and as
 * TypeScript for the rating-corpus loader, which reads a CSV in Node and
 * cannot round-trip six million rows through the database one at a time.
 *
 * Duplicated logic drifts. This asserts the two agree — so changing one
 * without the other fails here rather than quietly halving a match rate
 * months later.
 */

const CASES = [
  // Real books, checkable against a physical shelf.
  "0395071224",
  "034533968X", // X check digit
  "0441172717",
  "0060883286",
  "0747532699",
  // Awkward input
  "0-395-07122-4",
  "0 395 07122 4",
  "034533968x", // lowercase check digit
  // Not convertible
  "12345",
  "12345678901234",
  "9780441172719", // already an ISBN-13
  "04411727A7",
  "",
];

describe("ISBN canonicalisation: TypeScript matches SQL", () => {
  it.each(CASES)("isbn10_to_13(%p) agrees", async (input) => {
    const [row] = await prisma.$queryRaw<{ sql: string | null }[]>`
      SELECT catalog.isbn10_to_13(${input}) AS sql
    `;
    expect(isbn10To13(input)).toBe(row.sql);
  });

  it.each(CASES)("is_valid_isbn13(%p) agrees", async (input) => {
    const [row] = await prisma.$queryRaw<{ sql: boolean }[]>`
      SELECT catalog.is_valid_isbn13(${input}) AS sql
    `;
    expect(isValidIsbn13(input)).toBe(row.sql);
  });

  it("agrees on null input", async () => {
    const [row] = await prisma.$queryRaw<{ sql: string | null }[]>`
      SELECT catalog.isbn10_to_13(NULL) AS sql
    `;
    expect(isbn10To13(null)).toBe(row.sql);
  });

  it("produces the canonical form the catalog stores", async () => {
    // What the loader relies on: an ISBN-10 from the corpus must canonicalise
    // to exactly the ISBN-13 the ingest wrote, or nothing joins.
    expect(canonicalIsbn13("034533968X")).toBe("9780345339683");
    expect(canonicalIsbn13("9780345339683")).toBe("9780345339683");
    // A broken check digit is rejected rather than stored to match nothing.
    expect(canonicalIsbn13("9780345339684")).toBeNull();
  });
});
