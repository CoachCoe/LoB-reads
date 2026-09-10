import { prisma } from "./setup";

/**
 * The invariants ARCHITECTURE.md names, asserted against the live schema.
 *
 * SPEC-1. ARCHITECTURE.md:40-42 states: "**Nothing in `app` may hold a foreign
 * key into `catalog`.** A bad ingest would cascade into user data." It is the
 * single most load-bearing decision in the schema.
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

/**
 * RUN-1's guard is the index, not the application code.
 *
 * `finishReading` looks for an existing finish before inserting, but a read
 * followed by a create is not atomic and a double-click is concurrent. The
 * behavioural test for that race is in core-loop.test.ts and it is only a
 * PROBABILISTIC detector: measured, it passed five times in a row with this
 * index dropped, because three calls can serialise by luck. Once it caught the
 * defect with three rows where one was expected.
 *
 * So the deterministic assertion is here, on the schema. This is the same
 * argument the exclusive-shelf rule already rests on — ARCHITECTURE.md:
 * "kept honest by a partial unique index and a trigger rather than by
 * application code".
 */
describe("one finished reading session per work per day", () => {
  it("is enforced by a partial unique index, not by application code", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'app'
        AND tablename = 'reading_sessions'
        AND indexname = 'reading_sessions_one_finish_per_day'
    `;

    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef;

    // Unique, or it constrains nothing.
    expect(def).toMatch(/CREATE UNIQUE INDEX/);
    // Partial, or an in-progress session could not exist at all.
    expect(def).toMatch(/WHERE \(finished_at IS NOT NULL\)/);
    // Per day in UTC, which is the window finishedSessionOnDay uses. A
    // mismatch between the two would make the code and the constraint disagree
    // about what a duplicate is.
    expect(def).toMatch(/finished_at AT TIME ZONE/);
    expect(def).toMatch(/date/);
    // Scoped to the reader and the work.
    expect(def).toMatch(/"userId"/);
    expect(def).toMatch(/work_key/);
  });

  it("still allows one open session alongside a finished one", async () => {
    // The control: the index must not forbid a re-read being started after a
    // finish, which is what `reading_sessions_one_open_per_work` governs and
    // what getLatestSessionForWork's docstring says is legitimate.
    const open = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'app'
        AND indexname = 'reading_sessions_one_open_per_work'
    `;
    expect(open).toHaveLength(1);
    expect(open[0].indexdef).toMatch(/WHERE \(finished_at IS NULL\)/);
  });
});
