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
  "reading_progress",
  "reviews",
  "shelf_items",
  "shelves",
  "book_locations",
  "author_locations",
  "fictional_world_maps",
  "fictional_worlds",
  "authors",
  "books",
  "users",
];

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${APP_TABLES.map((t) => `app."${t}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
}

// A clean database per test. Cheaper to reason about than shared fixtures, and
// a failing test cannot cascade into the next one.
beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
