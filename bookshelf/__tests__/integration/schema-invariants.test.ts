import { prisma } from "./setup";

/**
 * The invariants ARCHITECTURE.md names, asserted against the live schema.
 *
 * SPEC-1. ARCHITECTURE.md:40-42 states: "**Nothing in `app` may hold a foreign
 * key into `catalog`.** A bad ingest would cascade into user data." STATUS.md
 * calls it "the single most load-bearing decision in the schema".
 *
 * It holds today. Nothing checked it. Every *other* named invariant in that
 * document has a named mechanical guard — exclusive shelves have
 * `exclusive-shelves.test.ts`, `timestamptz` has `timestamps.test.ts`, the search
 * indexes have `search-indexes.test.ts`, the route and client/server conventions
 * have `conventions.test.ts` — and this one was verified by a human reading
 * migrations, twice, which is the evidence that it was a manual check.
 *
 * Adding `work CatalogWork @relation(fields: [workKey], references: [olKey])` to
 * `ShelfItem` is a plausible thing for someone to do: it is what Prisma's own
 * documentation suggests, the editor will offer it, and it makes `include`
 * queries nicer. It would generate a migration and leave every existing suite
 * green. The next monthly ingest would then either fail on a constraint or take
 * user rows with it, depending on the cascade.
 *
 * Asserted against `pg_constraint` rather than the schema file, because the
 * schema file is not what the database enforces — a hand-written migration, or a
 * restore from a dump made elsewhere, can add a constraint Prisma never saw.
 */
describe("schema invariants", () => {
  it("has no foreign key from app into catalog", async () => {
    const offenders = await prisma.$queryRaw<
      { constraint: string; from: string; to: string }[]
    >`
      SELECT
        c.conname                                        AS constraint,
        rn.nspname || '.' || r.relname                    AS "from",
        fn.nspname || '.' || f.relname                    AS "to"
      FROM pg_constraint c
      JOIN pg_class     r  ON r.oid  = c.conrelid
      JOIN pg_namespace rn ON rn.oid = r.relnamespace
      JOIN pg_class     f  ON f.oid  = c.confrelid
      JOIN pg_namespace fn ON fn.oid = f.relnamespace
      WHERE c.contype = 'f'
        AND rn.nspname = 'app'
        AND fn.nspname = 'catalog'
      ORDER BY c.conname
    `;

    // Named in the failure, so whoever hits this sees which relation to remove
    // rather than only that a rule was broken.
    expect(offenders).toEqual([]);
  });

  it("has no foreign key from app into seed either", async () => {
    // Same reasoning, and the corpus is dropped from the deployed database
    // entirely — DEPLOYMENT records that it saves 853 MB — so a reference into
    // it would break on restore rather than on ingest.
    const offenders = await prisma.$queryRaw<{ constraint: string }[]>`
      SELECT c.conname AS constraint
      FROM pg_constraint c
      JOIN pg_class     r  ON r.oid  = c.conrelid
      JOIN pg_namespace rn ON rn.oid = r.relnamespace
      JOIN pg_class     f  ON f.oid  = c.confrelid
      JOIN pg_namespace fn ON fn.oid = f.relnamespace
      WHERE c.contype = 'f' AND rn.nspname = 'app' AND fn.nspname = 'seed'
    `;

    expect(offenders).toEqual([]);
  });

  it("finds the constraints it is looking for, so the check is not vacuous", async () => {
    // A typo in the query above would return zero rows and pass forever. This
    // asserts the same query shape does find the foreign keys that legitimately
    // exist *within* app.
    const withinApp = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM pg_constraint c
      JOIN pg_class     r  ON r.oid  = c.conrelid
      JOIN pg_namespace rn ON rn.oid = r.relnamespace
      JOIN pg_class     f  ON f.oid  = c.confrelid
      JOIN pg_namespace fn ON fn.oid = f.relnamespace
      WHERE c.contype = 'f' AND rn.nspname = 'app' AND fn.nspname = 'app'
    `;

    expect(Number(withinApp[0].count)).toBeGreaterThan(5);
  });

  it("keeps the work references that must stay unconstrained", async () => {
    // The other side of the invariant: these columns hold catalog keys on
    // purpose, and read paths tolerate the key having gone. If one of them ever
    // acquires a constraint the test above fails; this one asserts the columns
    // still exist to be checked, so a rename cannot quietly empty the rule out.
    const columns = await prisma.$queryRaw<
      { table_name: string; column_name: string }[]
    >`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'app' AND column_name IN ('work_key', 'author_key')
      ORDER BY table_name, column_name
    `;

    const named = columns.map((c) => `${c.table_name}.${c.column_name}`);
    expect(named).toContain("shelf_items.work_key");
    expect(named).toContain("reviews.work_key");
    expect(named).toContain("reading_sessions.work_key");
  });
});
