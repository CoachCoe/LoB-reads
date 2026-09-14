/**
 * @jest-environment node
 */
import { firstPlausiblePageCount } from "@/server/progress";

/**
 * SC-11. The work page derived a progress denominator with
 * `editions.find((e) => e.numberOfPages)?.numberOfPages`, which skips 0 and
 * accepts everything else truthy — so a reader could see a denominator of
 * 2,147,483,647 or a negative one in <ProgressBar max> and <Input max>.
 *
 * The catalogued values below are the real ones: the slice holds one edition at
 * exactly 2147483647, five negative, and 1,139 above MAX_PLAUSIBLE_PAGE_COUNT.
 */
describe("firstPlausiblePageCount", () => {
  it("takes the first edition that states a plausible length", () => {
    expect(
      firstPlausiblePageCount([{ numberOfPages: 317 }, { numberOfPages: 412 }])
    ).toBe(317);
  });

  it("skips an edition that states none and keeps looking", () => {
    expect(
      firstPlausiblePageCount([
        { numberOfPages: null },
        { numberOfPages: undefined },
        { numberOfPages: 289 },
      ])
    ).toBe(289);
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["int32 max", 2_147_483_647],
    ["just past the bound", 20_001],
  ])("skips a %s page count rather than showing it", (_label, pages) => {
    // Each of these reached the reader before. `find` on a truthy value
    // excluded only the first of the four.
    expect(
      firstPlausiblePageCount([{ numberOfPages: pages }, { numberOfPages: 204 }])
    ).toBe(204);
  });

  it("returns null when no edition states a plausible length", () => {
    // Null is the right answer, not a fallback number: the component then
    // tracks a page without a percentage, which is better than a wrong one.
    expect(
      firstPlausiblePageCount([{ numberOfPages: 0 }, { numberOfPages: -1 }])
    ).toBeNull();
    expect(firstPlausiblePageCount([])).toBeNull();
  });

  it("accepts the bound itself", () => {
    expect(firstPlausiblePageCount([{ numberOfPages: 20_000 }])).toBe(20_000);
  });
});
