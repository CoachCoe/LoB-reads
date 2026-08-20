import { canonicalIsbn13 } from "@/lib/sources/isbn";

/**
 * Reading an ISBN out of a rating corpus whose CSV went through a spreadsheet.
 *
 * Extracted from load-ratings.ts to be testable. It was inline, and the bug it
 * guards against cost 6,481 of 9,300 books before anyone looked at the column
 * — exactly the kind of quiet data loss that needs a test rather than a
 * comment.
 *
 * goodbooks-10k has two ISBN columns and both were coerced to numbers by
 * whatever wrote the file:
 *
 * `isbn13` became scientific notation — "9.78043902348e+12". That is not
 * merely a missing check digit: the twelfth digit is rounded too. Rebuilding
 * the value and cross-checking it against `isbn10` disagreed on 1,199 of 2,680
 * rows, so it is unrecoverable and deliberately ignored rather than matched at
 * a 45% error rate.
 *
 * `isbn10` lost its leading zeros. Of 9,300 values, 5,573 are nine characters,
 * 916 are eight and 112 are seven. An ISBN-10 is exactly ten, so padding
 * restores it — "439023483" is The Hunger Games's 0439023483.
 *
 * The padding is NOT validated, and it is worth being precise about that
 * because the obvious assumption is wrong. `isbn10To13` discards the ISBN-10
 * check digit: it takes the first nine digits, prepends 978 and computes a
 * fresh ISBN-13 digit. So 0439023483 and 0439023484 produce the same ISBN-13,
 * and a mis-padded value yields a well-formed ISBN-13 rather than a rejection.
 *
 * What actually protects the match is the catalog: the resulting ISBN-13 has to
 * exist in catalog.editions for a rating to attach to anything. A wrong guess
 * almost always matches nothing, which is a lost rating rather than a rating
 * on the wrong book. That is the real guarantee, and it is weaker than a check
 * digit — worth knowing before trusting this against a corpus whose columns
 * are mangled differently.
 */
export function corpusIsbnToCanonical(isbn10Column: string): string | null {
  const digits = isbn10Column.replace(/[^0-9Xx]/g, "");
  if (digits.length === 0) return null;

  // Longer than ten is not a truncated ISBN-10; leave it for the check digit
  // to reject rather than mangling it with a pad.
  const padded = digits.length <= 10 ? digits.padStart(10, "0") : digits;

  return canonicalIsbn13(padded);
}

/**
 * True when a value looks like a number that used to be an ISBN-13.
 *
 * Only used to explain a skip in logs. Nothing should try to recover these.
 */
export function isCoercedIsbn13(value: string): boolean {
  return /e\+?\d+$/i.test(value.trim());
}
