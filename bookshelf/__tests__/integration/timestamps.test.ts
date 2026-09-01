import { prisma } from "./setup";
import { makeUser } from "./factories";

/**
 * Timestamps are stored as `timestamptz`, not naive `timestamp`.
 *
 * Prisma's default DateTime mapping is `timestamp without time zone`. Prisma
 * writes UTC instants into those columns while SQL `now()` evaluated against
 * them returns LOCAL time, so every comparison between an application-written
 * timestamp and now() is wrong by the server's UTC offset.
 *
 * That is invisible on a machine running in UTC and wrong everywhere else,
 * which is the worst combination: it passes in CI and fails in production, or
 * the reverse. It broke the enrichment queue — freshly queued jobs were never
 * "due" — and expiry checks on cached third-party content.
 */
describe("timestamp columns", () => {
  it("uses timestamptz everywhere, so now() comparisons are meaningful", async () => {
    const naive = await prisma.$queryRaw<{ column: string }[]>`
      SELECT table_schema || '.' || table_name || '.' || column_name AS column
      FROM information_schema.columns
      WHERE data_type = 'timestamp without time zone'
        AND table_schema IN ('app', 'catalog')
      ORDER BY 1
    `;

    expect(naive.map((r) => r.column)).toEqual([]);
  });

  it("agrees with now() on a row it has just written", async () => {
    // The concrete failure: a row created by the application compared against
    // the database's clock. With naive timestamps this was off by hours.
    const user = await makeUser();

    const [row] = await prisma.$queryRaw<
      { inPast: boolean; deltaMs: number }[]
    >`
      SELECT "createdAt" <= now() AS "inPast",
             EXTRACT(EPOCH FROM ("createdAt" - now())) * 1000 AS "deltaMs"
      FROM app.users WHERE id = ${user.id}
    `;

    expect(row.inPast).toBe(true);
    // Generous, but tight enough to catch an offset measured in hours.
    expect(Math.abs(Number(row.deltaMs))).toBeLessThan(5_000);
  });
});
