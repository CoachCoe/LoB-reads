import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: "./",
});

/**
 * Two suites, deliberately separate.
 *
 *   unit        — pure functions and components. No I/O, runs anywhere.
 *   integration — exercises the real database. Needs TEST_DATABASE_URL and a
 *                 migrated schema; see __tests__/integration/env.ts.
 *
 * `npm test` stays fast and offline, while the code that decides who may
 * delete what is covered by something that actually talks to Postgres.
 * Authorization cannot be meaningfully tested against a mock, because the
 * thing being tested is a query.
 *
 * Each project is passed through next/jest separately: the transform it
 * installs does not propagate into a `projects` array on its own.
 */
const unit: Config = {
  displayName: "unit",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  testMatch: ["<rootDir>/__tests__/**/*.test.ts?(x)"],
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/__tests__/integration/",
  ],
};

const integration: Config = {
  displayName: "integration",
  testEnvironment: "node",
  // Must run before any import, so the application's Prisma client is
  // constructed against the test database rather than the development one.
  setupFiles: ["<rootDir>/__tests__/integration/env.ts"],
  setupFilesAfterEnv: ["<rootDir>/__tests__/integration/setup.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  testMatch: ["<rootDir>/__tests__/integration/**/*.test.ts"],
  // NOTE: these MUST run serially — they share one database and truncate it
  // between tests. maxWorkers is not a per-project option, so serialization is
  // enforced by --runInBand in the npm script and in CI. Running them in
  // parallel produces deadlocks and foreign-key violations, intermittently.
};

const config = async (): Promise<Config> => ({
  coverageProvider: "v8",
  // Without this, --coverage only measures files the tests happen to import,
  // which reports a flattering number for an almost-uncovered codebase.
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "scripts/**/*.ts",
    "!src/types/**",
    "!src/**/*.d.ts",
    "!scripts/ingest/make-fixture.ts",
  ],
  projects: [
    await createJestConfig(unit)(),
    await createJestConfig(integration)(),
  ],
});

export default config;
