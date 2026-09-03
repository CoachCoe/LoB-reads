import prisma from "@/lib/prisma";

/**
 * Integration test harness.
 *
 * These tests run against a real Postgres, because the behaviour under test —
 * who may delete what — is expressed as queries and constraints. Mocking the
 * client would only assert that our mock returns what we told it to.
 *
 * env.ts has already pointed the application's own client at TEST_DATABASE_URL,
 * so these tests exercise exactly the client the app uses.
 *
 *   createdb bookshelf_test && npm run test:integration
 */

export { prisma };

/**
 * Listed rather than discovered, so adding a table without considering test
 * isolation is a visible omission instead of a silent one.
 */
const APP_TABLES = [
  "import_rows",
  "import_sessions",
  "follows",
  "reading_sessions",
  "reviews",
  "shelf_items",
  "shelves",
  "work_locations",
  "author_locations",
  "work_fictional_worlds",
  "fictional_world_maps",
  "fictional_worlds",
  "users",
];

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${APP_TABLES.map((t) => `app."${t}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
}

/**
 * Every table in the `catalog` schema, in an order that respects the schema's
 * three foreign keys — `work_authors` and `editions` reference `works`, and
 * `work_authors` also references `authors`, so children come first. Listed for
 * the same reason as APP_TABLES: adding a table without considering test
 * isolation should be a visible omission rather than a silent leak.
 */
const CATALOG_TABLES = [
  // children first
  "work_authors",
  "editions",
  // parents
  "works",
  "authors",
  // independent of the above
  "work_similarity",
  "work_rating_stats",
  "subject_counts",
  "enrichment",
  "enrichment_queue",
  "external_ids",
  "stage_works",
  "stage_editions",
  "stage_authors",
  "ingest_runs",
];

/**
 * Empty the catalog. Runs once per test FILE, in afterAll — never between
 * tests, because the search suite seeds thousands of works in beforeAll and
 * clearing them per test would make it unusably slow.
 *
 * This used to delete by an `OLT` prefix, on the assumption that factory rows
 * were the only catalog rows a suite created. They are not: the search suite
 * alone writes `OLPAG%` and `OLPOP%` keys and its own fixture prefix, each
 * removed by its own hand-rolled DELETE, and `subject_counts` was known to
 * neither this helper nor any other. Whatever the prefix scheme missed
 * survived into the next file.
 *
 * That is not hypothetical. `health.test.ts` asserts an empty catalog, and it
 * passed only because every alphabetically-earlier catalog-writing file
 * happened to tidy up after itself; seeding one row with an unrecognised
 * prefix fails two of its tests. An unconditional delete cannot be outrun by
 * a prefix nobody registered.
 *
 * DELETE rather than TRUNCATE, and that is not a style choice: TRUNCATE
 * rewrites each relation's file and fsyncs it, which measured 3-5 seconds per
 * call across these fourteen tables and turned health.test.ts from under a
 * second into 23. DELETE over a few thousand fixture rows is milliseconds.
 */
export async function clearTestCatalogRows() {
  // One statement per call: $executeRawUnsafe does not accept a batch.
  for (const table of CATALOG_TABLES) {
    await prisma.$executeRawUnsafe(`DELETE FROM catalog."${table}"`);
  }
}

// A clean database per test. Cheaper to reason about than shared fixtures, and
// a failing test cannot cascade into the next one.
beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await clearTestCatalogRows();
  await prisma.$disconnect();
});
