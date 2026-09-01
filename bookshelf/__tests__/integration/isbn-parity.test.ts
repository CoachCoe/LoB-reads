import { prisma } from "./setup";
import {
  canonicalIsbn13,
  cleanIsbn,
  isbn10To13,
  isValidIsbn13,
} from "@/lib/sources/isbn";

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
  // Separator-bearing ISBN-13s. These are the cases the two implementations
  // actually disagree on and that this list never contained: the TypeScript
  // `isValidIsbn13` calls cleanIsbn first and so accepts them, while
  // `catalog.is_valid_isbn13` tests the raw argument against '^[0-9]{13}$' and
  // rejects them (asserted from the SQL side in ingest-sql.test.ts). The two
  // separator cases above are ISBN-10s, which both sides reject as an ISBN-13 —
  // so they agreed by accident and the boundary went unchecked.
  "978-0-441-17271-9",
  "978 0441172719",
  "978-0441172719",
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

  it.each(CASES)("clean_isbn(%p) agrees", async (input) => {
    // This pair was never compared, which is what let the boundary below go
    // unnoticed: the composition is only trustworthy if the cleaner matches.
    const [row] = await prisma.$queryRaw<{ sql: string }[]>`
      SELECT catalog.clean_isbn(${input}) AS sql
    `;
    expect(cleanIsbn(input)).toBe(row.sql);
  });

  it.each(CASES)("is_valid_isbn13(%p) agrees", async (input) => {
    // Composed the way the ingest composes it, and the way the TypeScript
    // composes it internally.
    //
    // The two functions do NOT have the same contract, and comparing them
    // directly was comparing unlike things: `catalog.is_valid_isbn13` tests its
    // raw argument against '^[0-9]{13}$' — deliberately, asserted in
    // ingest-sql.test.ts — while the pipeline always calls it as
    // `is_valid_isbn13(clean_isbn(x))` (03-normalize.sql), and the TypeScript
    // calls cleanIsbn on the way in. The old CASES list contained no
    // separator-bearing ISBN-13, so the mismatch never showed: its two
    // separator cases are ISBN-10s, which both sides reject as an ISBN-13, so
    // they agreed by accident.
    const [row] = await prisma.$queryRaw<{ sql: boolean }[]>`
      SELECT catalog.is_valid_isbn13(catalog.clean_isbn(${input})) AS sql
    `;
    expect(isValidIsbn13(input)).toBe(row.sql);
  });

  it("pins the contract difference rather than leaving it to chance", async () => {
    // The raw SQL function is strict by design. Locking it here means a future
    // change to either side has to be deliberate: make the SQL lenient and this
    // fails; make the TypeScript strict and the parity loop above fails.
    const separated = "978-0441172719";

    const [raw] = await prisma.$queryRaw<{ sql: boolean }[]>`
      SELECT catalog.is_valid_isbn13(${separated}) AS sql
    `;
    expect(raw.sql).toBe(false);

    const [cleaned] = await prisma.$queryRaw<{ sql: boolean }[]>`
      SELECT catalog.is_valid_isbn13(catalog.clean_isbn(${separated})) AS sql
    `;
    expect(cleaned.sql).toBe(true);

    // The TypeScript cleans on the way in, so it matches the composed form.
    expect(isValidIsbn13(separated)).toBe(true);
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
