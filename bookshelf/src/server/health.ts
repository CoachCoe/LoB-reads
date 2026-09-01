import prisma from "@/lib/prisma";

/**
 * The readiness probe's query, on the right side of the route boundary.
 *
 * Routes stay thin and queries live here; a probe is no exception, and
 * `conventions.test.ts` enforces it.
 */

/**
 * A probe must answer, and quickly. With Postgres stopped the bare query does
 * not fail — it blocks on connect for far longer than any orchestrator waits,
 * so the probe returns nothing at all rather than reporting unavailable.
 * Measured: still hanging after 25 s. An unanswered probe is worse than a
 * failing one, because to an orchestrator it looks the same as a wedged
 * process.
 */
const PROBE_TIMEOUT_MS = 2_000;

export type CatalogHealth = "populated" | "empty" | "unreachable";

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`probe exceeded ${ms}ms`)), ms)
    ),
  ]);

/**
 * Whether this replica can actually serve a request.
 *
 * Distinguishes "the database is unreachable" from "the database is fine but
 * the catalog is empty", because they are different deployment faults: the
 * first is a connection problem, the second is a restore that is still running
 * or that silently restored nothing. Both leave the process perfectly healthy.
 */
export async function checkCatalogHealth(): Promise<CatalogHealth> {
  try {
    // Cheap by design: EXISTS stops at the first row rather than counting.
    const [probe] = await withTimeout(
      prisma.$queryRaw<{ present: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM catalog.works LIMIT 1) AS present
      `,
      PROBE_TIMEOUT_MS
    );

    return probe?.present ? "populated" : "empty";
  } catch (error) {
    // The message can carry connection strings and schema detail, so it is
    // logged here and never returned to the caller.
    console.error("Readiness probe failed:", error);
    return "unreachable";
  }
}
