/**
 * JI-2: the import's candidate lookup shares the search budget.
 *
 * Its own file because proving the call needs a module mock, and the mock has
 * to be installed before `@/server/imports` is loaded. The mock is a
 * passthrough — the real function runs, against the real database — so this
 * asserts routing without changing behaviour.
 *
 * Three weaker versions were tried against `goodreads-import.test.ts` first,
 * and all three passed against a `findCandidates` with no budget at all:
 * calling `runSearchArmWithinBudget` directly proves only that the helper
 * works; a 1ms budget never fires because the query finishes in microseconds
 * at fixture scale, returning 14 real rows; and `jest.spyOn` cannot attach to
 * a frozen ES module namespace.
 */
import { prisma } from "./setup";
import { makeUserWithShelves } from "./factories";

const budgeted = jest.fn();

jest.mock("@/server/catalog", () => {
  const actual = jest.requireActual("@/server/catalog");
  return {
    ...actual,
    runSearchArmWithinBudget: (...args: unknown[]) => {
      budgeted(...args);
      return actual.runSearchArmWithinBudget(...args);
    },
  };
});

import { findCandidates } from "@/server/imports";

const KEY = "OLBUDGETIMP1W";

beforeAll(async () => {
  await prisma.$executeRaw`
    INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
    VALUES (${KEY}, 'The Hobbit', 'J.R.R. Tolkien', ARRAY['Fiction'], 1)
    ON CONFLICT (ol_key) DO NOTHING`;
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DELETE FROM catalog.works WHERE ol_key LIKE 'OLBUDGETIMP%'`
  );
});

beforeEach(() => budgeted.mockClear());

it("runs the candidate query through the shared budget", async () => {
  const candidates = await findCandidates("The Hobbit", "J.R.R. Tolkien");

  // The real answer still comes back, so the budget is not swallowing it.
  expect(candidates[0]?.workKey).toBe(KEY);
  expect(budgeted).toHaveBeenCalledTimes(1);
});

it("does not reach the budget at all for a title below the length floor", async () => {
  // The pre-filter has to come first. Routing a query that should never run
  // through a budget still runs it.
  expect(await findCandidates("Dune", "Frank Herbert")).toEqual([]);
  expect(budgeted).not.toHaveBeenCalled();
});

/**
 * The per-query budget bounds one lookup; this bounds their sum, which is
 * what the uploader actually waits on. At 900ms each and MAX_ROWS at 2,000,
 * per-query bounds alone still permit a half-hour request.
 */
describe("the budget for a whole import", () => {
  afterEach(() => {
    delete process.env.IMPORT_CANDIDATE_BUDGET_MS;
    jest.resetModules();
  });

  it("stops looking for candidates once the import's budget is spent", async () => {
    // 1ms is spent before the first unmatched row is reached, so no lookup
    // happens at all — which is the behaviour under test. The row must still
    // be queued for review: a reader can search for it by hand, and that is
    // strictly better than the upload timing out.
    process.env.IMPORT_CANDIDATE_BUDGET_MS = "1";
    jest.resetModules();
    const { createImportSession, matchSession, getRowsForReview } =
      await import("@/server/imports");
    const { id: userId } = await makeUserWithShelves();
    const sessionId = await createImportSession(userId, "export.csv", [
      {
        // No exact match, so the row reaches the fuzzy path — which is the
        // path the budget is meant to stop.
        title: "Nothing Like This Exists Anywhere",
        author: "Nobody At All",
        exclusiveShelf: "read",
      },
    ] as never);
    await matchSession(userId, sessionId);

    // Queued for review, as it must be — just with nothing suggested.
    //
    // The stored `candidates` value is not asserted here: `jest.resetModules`
    // gives this test its own module registry, so the `Prisma.DbNull` written
    // by that copy is a different sentinel object from the one the client on
    // `./setup` recognises, and reads back as `{}` rather than null. An
    // artifact of the reset, not of the code — the assertion that carries the
    // behaviour is that no lookup was attempted.
    const rows = await getRowsForReview(userId, sessionId);
    expect(rows).toHaveLength(1);
    expect(budgeted).not.toHaveBeenCalled();
  });
});
