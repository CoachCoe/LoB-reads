import { lastPageFor, resolvePage } from "@/lib/pagination";

/**
 * `?page=` was clamped at the bottom only — `Math.max(1, Number(raw) || 1)` —
 * so a hand-typed `?page=100000000` reached `searchWorks` as
 * `OFFSET 2399999976` on an unauthenticated route. The pager's own links stopped
 * at 50, which is why nothing looked wrong.
 *
 * The bound is the caller's, not a shared constant: a search count stops at
 * COUNT_CEILING so there is no page past it, while a subject browse has an exact
 * count over an indexed lookup and may legitimately run to tens of thousands of
 * pages. An earlier version of this fix used the search ceiling for both, which
 * made most of the browse unreachable — hence the two-mode cases below.
 */
describe("resolvePage", () => {
  // A ranked search: 1,000 matches at 24 a page.
  const SEARCH = { lastPage: lastPageFor(1000, 24) }; // 42
  // A subject browse over an exact count.
  const BROWSE = { lastPage: lastPageFor(735_956, 24) }; // 30,665

  it("passes an ordinary page through", () => {
    expect(resolvePage("3", SEARCH)).toBe(3);
  });

  it("defaults to the first page when absent", () => {
    expect(resolvePage(undefined, SEARCH)).toBe(1);
  });

  it.each([
    ["a huge integer", "100000000"],
    ["exponent notation", "1e9"],
    ["one past the last page", "43"],
  ])("clamps %s to the search's last page", (_label, raw) => {
    expect(resolvePage(raw, SEARCH)).toBe(42);
  });

  it("does NOT clamp a browse to the search ceiling", () => {
    // The regression this guards: 1,000 pages into a 30,665-page browse is a
    // real page over an indexed containment lookup, not something to truncate.
    expect(resolvePage("1000", BROWSE)).toBe(1000);
    expect(resolvePage("30665", BROWSE)).toBe(30665);
    expect(resolvePage("30666", BROWSE)).toBe(30665);
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
    expect(resolvePage(raw, SEARCH)).toBe(1);
  });

  it("never returns an offset past the end of a bounded result set", () => {
    for (const raw of ["1", "42", "43", "9999", "1e9"]) {
      const offset = (resolvePage(raw, SEARCH) - 1) * 24;
      expect(offset).toBeLessThan(1000);
    }
  });

  it("copes with a bound below one page", () => {
    expect(resolvePage("7", { lastPage: lastPageFor(0, 24) })).toBe(1);
    expect(resolvePage("7", { lastPage: lastPageFor(10, 24) })).toBe(1);
  });
});

describe("lastPageFor", () => {
  it.each([
    [0, 1],
    [1, 1],
    [24, 1],
    [25, 2],
    [1000, 42],
  ])("maps a total of %i to %i page(s)", (total, expected) => {
    expect(lastPageFor(total, 24)).toBe(expected);
  });
});
