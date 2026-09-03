/**
 * @jest-environment node
 */
import { resolveWrappedYear } from "@/lib/wrapped-year";

/**
 * TEST-19: the /wrapped?year= clamp had no test.
 *
 * `now` is injected rather than faked, because the whole question this
 * function answers is "relative to which year?" — passing it in makes every
 * case below independent of when the suite runs, which a frozen clock also
 * achieves but less legibly.
 */
const NOW = new Date(2026, 5, 15, 12, 0, 0); // mid-2026
const THIS_YEAR = 2026;

describe("resolveWrappedYear", () => {
  it("falls back to this year when no year is asked for", () => {
    // The common case: /wrapped with no query string at all.
    expect(resolveWrappedYear(undefined, NOW)).toBe(THIS_YEAR);
  });

  it("returns a year that is actually reportable", () => {
    expect(resolveWrappedYear("2024", NOW)).toBe(2024);
    expect(resolveWrappedYear(String(THIS_YEAR), NOW)).toBe(THIS_YEAR);
  });

  it("refuses a year that has not happened yet", () => {
    // A future year is always an empty report, which reads as data loss.
    expect(resolveWrappedYear("2027", NOW)).toBe(THIS_YEAR);
    expect(resolveWrappedYear("9999", NOW)).toBe(THIS_YEAR);
  });

  it("refuses a year before the catalog begins, and keeps 1900 itself", () => {
    // Asserted from both sides, so the bound cannot drift without failing.
    expect(resolveWrappedYear("1899", NOW)).toBe(THIS_YEAR);
    expect(resolveWrappedYear("1900", NOW)).toBe(1900);
  });

  it("refuses anything that is not a whole number", () => {
    // `Number("abc")` is NaN, which became `new Date(NaN, 0, 1)` and answered
    // 500 from inside a Prisma gte.
    expect(resolveWrappedYear("abc", NOW)).toBe(THIS_YEAR);
    expect(resolveWrappedYear("2024.5", NOW)).toBe(THIS_YEAR);
    expect(resolveWrappedYear("Infinity", NOW)).toBe(THIS_YEAR);
    expect(resolveWrappedYear("-2024", NOW)).toBe(THIS_YEAR);
    // Number("") is 0 — a whole number, which only the lower bound rejects.
    expect(resolveWrappedYear("", NOW)).toBe(THIS_YEAR);
    // And a value that is only partly numeric.
    expect(resolveWrappedYear("2024; DROP TABLE", NOW)).toBe(THIS_YEAR);
  });

  it("reads the current year from the clock it is given", () => {
    // Guards the fallback itself: returning a hardcoded year would satisfy
    // every case above if NOW never changed.
    expect(resolveWrappedYear(undefined, new Date(2031, 0, 1, 12))).toBe(2031);
    expect(resolveWrappedYear("2030", new Date(2031, 0, 1, 12))).toBe(2030);
  });
});
