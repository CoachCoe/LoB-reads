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

/**
 * Race a probe against a timeout, and clear the timer either way.
 *
 * Promise.race settles on the first result and abandons the loser, but the
 * loser's setTimeout stays armed for its full duration. When the probe won —
 * the normal case — the timer sat live for PROBE_TIMEOUT_MS with nothing
 * waiting on it. That is why every integration run printed "Jest did not exit
 * one second after the test run has completed": --detectOpenHandles traced
 * exactly two Timeout handles here. It also leaks one live timer per readiness
 * probe in production, which an orchestrator polls continuously.
 *
 * clearTimeout in a finally, rather than --forceExit in the test runner or
 * fake timers in the test, because the leak is real outside the tests too.
 */
const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`probe exceeded ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

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
