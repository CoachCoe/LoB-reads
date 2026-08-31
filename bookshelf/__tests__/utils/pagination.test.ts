import { resolvePage } from "@/lib/pagination";

/**
 * `?page=` was clamped at the bottom only — `Math.max(1, Number(raw) || 1)` —
 * so a hand-typed `?page=100000000` reached `searchWorks` as
 * `OFFSET 2399999976` on an unauthenticated route. The pager's own links stopped
 * at 50, which is why nothing looked wrong.
 *
 * These are the inputs that discriminate: adding a ceiling changed no existing
 * test, because no existing test asked for one.
 */
describe("resolvePage", () => {
  const opts = { pageSize: 24, ceiling: 1000 };
  // ceil(1000 / 24) = 42
  const LAST = 42;

  it("passes an ordinary page through", () => {
    expect(resolvePage("3", opts)).toBe(3);
  });

  it("defaults to the first page when absent", () => {
    expect(resolvePage(undefined, opts)).toBe(1);
  });

  it.each([
    ["a huge integer", "100000000"],
    ["exponent notation", "1e9"],
    ["one past the last meaningful page", String(LAST + 1)],
  ])("clamps %s to the last meaningful page", (_label, raw) => {
    expect(resolvePage(raw, opts)).toBe(LAST);
  });

  it.each([
    ["zero", "0"],
    ["a negative", "-5"],
    ["non-numeric text", "abc"],
    ["empty", ""],
    ["a fraction", "2.5"],
    ["Infinity", "Infinity"],
    ["NaN", "NaN"],
  ])("falls back to the first page for %s", (_label, raw) => {
    expect(resolvePage(raw, opts)).toBe(1);
  });

  it("never returns an offset beyond the count ceiling", () => {
    for (const raw of ["1", "42", "43", "9999", "1e9"]) {
      const offset = (resolvePage(raw, opts) - 1) * opts.pageSize;
      expect(offset).toBeLessThan(opts.ceiling);
    }
  });

  it("copes with a ceiling smaller than one page", () => {
    expect(resolvePage("7", { pageSize: 24, ceiling: 10 })).toBe(1);
  });
});
