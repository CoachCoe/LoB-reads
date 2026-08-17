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
 * Catalog rows created by test factories.
 *
 * Not truncated between every test: the search suite seeds thousands of works
 * once in beforeAll, and clearing them per test would make it unusably slow.
 * Factory-created works use an OLT prefix so they can be removed selectively.
 */
export async function clearTestCatalogRows() {
  // One statement per call: $executeRawUnsafe does not accept a batch.
  for (const sql of [
    `DELETE FROM catalog.work_authors WHERE work_key LIKE 'OLT%' OR author_key LIKE 'OLT%'`,
    `DELETE FROM catalog.editions WHERE ol_key LIKE 'OLT%'`,
    `DELETE FROM catalog.works WHERE ol_key LIKE 'OLT%'`,
    `DELETE FROM catalog.authors WHERE ol_key LIKE 'OLT%'`,
  ]) {
    await prisma.$executeRawUnsafe(sql);
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
