/**
 * Resolve the `?year=` parameter on /wrapped to a year worth reporting on.
 *
 * Extracted from the page so it can be tested. It was four lines of inline
 * ternary in a server component, which meant the only way to exercise it was
 * to render the page, and nothing did.
 *
 * Three separate things are being defended against, and each one has been a
 * real failure mode somewhere in this app:
 *
 *   - **Not a number.** `Number("abc")` is `NaN`, which became
 *     `new Date(NaN, 0, 1)` — an Invalid Date — and went straight into a
 *     Prisma `gte`, answering 500 rather than anything a reader could act on.
 *   - **A year the data cannot cover.** Open Library's slice starts at 1900
 *     and nobody has reading sessions before it, so a lower bound keeps the
 *     query bounded rather than scanning for rows that cannot exist.
 *   - **A year that has not happened.** A future year is always an empty
 *     report, which reads as data loss rather than as an empty year.
 *
 * Anything unusable falls back to the current year, because /wrapped with no
 * parameter is the common case and it must never be the error case.
 */
export function resolveWrappedYear(
  raw: string | undefined,
  now: Date = new Date()
): number {
  const thisYear = now.getFullYear();
  const requested = Number(raw);

  // Number.isInteger rejects NaN, Infinity and 2024.5 in one predicate.
  // Number("") is 0, which the lower bound then rejects.
  return Number.isInteger(requested) && requested >= 1900 && requested <= thisYear
    ? requested
    : thisYear;
}
