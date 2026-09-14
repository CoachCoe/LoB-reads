import { runSearchArmReporting, runSearchArmWithinBudget } from "@/server/catalog";
import { Prisma } from "@prisma/client";

/**
 * MT-2. An abandoned search arm and an empty one returned the same thing, so
 * /search rendered the same copy for both: "Nothing matched. Try fewer words,
 * or check the spelling." For `the hobbitt` — a real typo with 20 real matches,
 * and the query the fuzzy arm exists to rescue — that told the one reader the
 * feature is for that they cannot spell.
 *
 * Driven with a statement that cannot finish rather than a slow real query:
 * the fallback arms answer in milliseconds on a fixture, so no timeout can be
 * provoked through them. This is the same technique catalog-search.test.ts
 * uses for the arm that must not throw.
 */
describe("an abandoned search arm reports itself", () => {
  /** Guaranteed to exceed any budget, and to touch no real table. */
  const cannotFinish = Prisma.sql`SELECT pg_sleep(5) AS slept`;
  const finishes = Prisma.sql`SELECT 1 AS ok`;

  it("says it was abandoned, and still returns no rows", async () => {
    const result = await runSearchArmReporting(cannotFinish, 50);

    expect(result.abandoned).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it("says it was not abandoned when the arm finishes empty", async () => {
    // The distinction the page needs: this one IS a claim about the catalog.
    const result = await runSearchArmReporting(
      Prisma.sql`SELECT 1 AS ok WHERE false`,
      5_000
    );

    expect(result.abandoned).toBe(false);
    expect(result.rows).toEqual([]);
  });

  it("says it was not abandoned when the arm returns rows", async () => {
    const result = await runSearchArmReporting(finishes, 5_000);

    expect(result.abandoned).toBe(false);
    expect(result.rows).toHaveLength(1);
  });

  it("leaves the plain form's contract unchanged", async () => {
    // Five call sites and two suites use this; it must still swallow the
    // cancellation and return rows rather than a wrapper.
    await expect(runSearchArmWithinBudget(cannotFinish, 50)).resolves.toEqual([]);
    await expect(runSearchArmWithinBudget(finishes, 5_000)).resolves.toHaveLength(1);
  });
});
