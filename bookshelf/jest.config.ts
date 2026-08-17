import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: "./",
});

const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "jsdom",
  // Without this, --coverage only measures files the tests happen to import,
  // which reports a flattering number for an almost-uncovered codebase.
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/types/**",
    "!src/**/*.d.ts",
  ],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/"],
};

export default createJestConfig(config);
