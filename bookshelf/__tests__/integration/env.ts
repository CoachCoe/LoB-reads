import { config as loadEnv } from "dotenv";

/**
 * Runs before the test framework and before any module is imported, so the
 * application's Prisma client picks up the test database rather than the
 * development one.
 */
loadEnv({ path: ".env", quiet: true });

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Integration tests need a throwaway database — see .env.example."
  );
}

// These tests delete all data. Refuse anything not obviously disposable.
const database = new URL(url).pathname.slice(1);
if (!/test/i.test(database)) {
  throw new Error(
    `Refusing to run: TEST_DATABASE_URL points at "${database}", whose name does not contain "test". ` +
      "These tests TRUNCATE every table."
  );
}

process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
