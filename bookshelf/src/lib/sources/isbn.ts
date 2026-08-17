/**
 * ISBN canonicalisation, in TypeScript.
 *
 * The same logic exists as `catalog.isbn10_to_13` and friends, used by the
 * ingest's set-based SQL. This copy exists because the rating-corpus loader
 * reads a CSV in Node and needs to canonicalise before it can join — going
 * through the database for six million rows, one at a time, is not an option.
 *
 * Duplicated logic drifts, so `__tests__/integration/isbn-parity.test.ts`
 * asserts that these two implementations agree across a range of inputs
 * including the awkward ones. Change one, and that test tells you about the
 * other.
 */

/** Strip separators and normalise the check digit's case. */
export function cleanIsbn(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

/** Validate an ISBN-13 check digit. */
export function isValidIsbn13(isbn: string | null | undefined): boolean {
  const value = cleanIsbn(isbn);
  if (!/^[0-9]{13}$/.test(value)) return false;

  let total = 0;
  for (let i = 0; i < 12; i++) {
    total += Number(value[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (total % 10)) % 10 === Number(value[12]);
}

/**
 * Convert an ISBN-10 to its ISBN-13 form: prefix 978, recompute the check
 * digit. Every cross-source join keys on ISBN-13, so ISBN-10s are converted
 * rather than stored as a second dialect.
 */
export function isbn10To13(raw: string | null | undefined): string | null {
  const value = cleanIsbn(raw);
  if (!/^[0-9]{9}[0-9X]$/.test(value)) return null;

  const body = "978" + value.slice(0, 9);

  let total = 0;
  for (let i = 0; i < 12; i++) {
    total += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return body + String((10 - (total % 10)) % 10);
}

/**
 * The canonical ISBN-13 for any input, or null when there isn't one.
 * A valid ISBN-13 passes through; an ISBN-10 is converted; anything else,
 * including an ISBN-13 with a broken check digit, is rejected rather than
 * stored to join against nothing.
 */
export function canonicalIsbn13(raw: string | null | undefined): string | null {
  const value = cleanIsbn(raw);
  if (value.length === 0) return null;
  if (isValidIsbn13(value)) return value;
  return isbn10To13(value);
}
