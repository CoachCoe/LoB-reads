import { prisma } from "./setup";
import { makeUserWithShelves, makeWork } from "./factories";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The reading loop: shelve a work, rate it, track progress.
 *
 * This exists because all three were unreachable. The components had been
 * written against the pre-M3 `bookId` contract, the repoint to `work_key`
 * moved the routes, and the rebuilt work page mounted none of them — so a
 * reader could search 6.9 million books and not put one on a shelf. Shelves
 * and ratings could only arrive through the Goodreads importer.
 *
 * 214 integration tests passed throughout, because every one of them called
 * the server layer directly. Nothing asserted that a feature was reachable,
 * which is the gap this file is really about: the first block checks the page
 * mounts the components, and the rest check the routes accept exactly what
 * those components send.
 */

const mockSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: () => mockSession(),
}));

// Imported after the mock is registered.
import { POST as shelfPost, DELETE as shelfDelete } from "@/app/api/shelves/[shelfId]/works/route";
import { GET as shelfStatusGet } from "@/app/api/works/[workKey]/shelves/route";
import { POST as reviewPost } from "@/app/api/reviews/route";
import {
  GET as progressGet,
  POST as progressPost,
} from "@/app/api/progress/route";
import { startReading } from "@/server/progress";
import { getReadingStats, finishReading } from "@/server/progress";

const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

/** GET and HEAD cannot carry a body, so they need their own constructor. */
const get = () => new Request("http://localhost/api") as never;

let userId: string;
let shelfId: string;
let workKey: string;

beforeEach(async () => {
  jest.clearAllMocks();
  const user = await makeUserWithShelves();
  userId = user.id;
  mockSession.mockResolvedValue({ user: { id: userId } });

  const shelf = await prisma.shelf.findFirstOrThrow({ where: { userId } });
  shelfId = shelf.id;
  workKey = (await makeWork({ pages: 412 })).olKey;
});

describe("the work page mounts the loop", () => {
  // A source-level check, deliberately. Every other test here calls a route
  // directly, which is exactly how three unreachable components passed for
  // months: the contracts were fine, nothing rendered them.
  const page = readFileSync(
    path.join(process.cwd(), "src/app/(main)/work/[olKey]/page.tsx"),
    "utf8"
  );

  it.each([
    ["AddToShelfButton", "shelve a work"],
    ["ReadingProgressSection", "track progress"],
    ["WorkReviewSection", "rate and review"],
    ["WorkLocationsSection", "contribute a location"],
  ])("renders %s so a reader can %s", (component) => {
    expect(page).toContain(`<${component}`);
  });

  it("passes workKey, not bookId", () => {
    // The whole failure was a stale identifier. If this reverts, the routes
    // 404 and the components fail silently again.
    expect(page).not.toMatch(/bookId=/);
    expect(page).toMatch(/workKey=\{work\.olKey\}/);
  });
});

describe("shelving a work", () => {
  const params = (id: string) => ({ params: Promise.resolve({ shelfId: id }) });

  it("accepts the body AddToShelfButton sends", async () => {
    const response = await shelfPost(json({ workKey }), params(shelfId));
    expect(response.status).toBe(201);

    const item = await prisma.shelfItem.findFirst({ where: { shelfId, workKey } });
    expect(item).not.toBeNull();
  });

  it("reports the shelves a work is on, for the button's label", async () => {
    await shelfPost(json({ workKey }), params(shelfId));

    const response = await shelfStatusGet(get(), {
      params: Promise.resolve({ workKey }),
    });
    const status = await response.json();

    expect(response.status).toBe(200);
    expect(status).toHaveLength(1);
    expect(status[0].shelfId).toBe(shelfId);
  });

  it("removes it again", async () => {
    await shelfPost(json({ workKey }), params(shelfId));
    const response = await shelfDelete(json({ workKey }, "DELETE"), params(shelfId));

    expect(response.status).toBe(200);
    expect(
      await prisma.shelfItem.findFirst({ where: { shelfId, workKey } })
    ).toBeNull();
  });

  it("rejects the old bookId body rather than accepting it silently", async () => {
    // A 400 here is the point: if the contract drifts back, it fails loudly
    // rather than storing nothing and returning success.
    const response = await shelfPost(json({ bookId: workKey }), params(shelfId));
    expect(response.status).toBe(400);
  });

  it("refuses a shelf belonging to someone else", async () => {
    const stranger = await makeUserWithShelves();
    const theirShelf = await prisma.shelf.findFirstOrThrow({
      where: { userId: stranger.id },
    });

    const response = await shelfPost(json({ workKey }), params(theirShelf.id));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.shelfItem.findFirst({ where: { shelfId: theirShelf.id } })
    ).toBeNull();
  });
});

describe("rating and reviewing a work", () => {
  it("accepts the body WorkReviewSection sends", async () => {
    const response = await reviewPost(
      json({ workKey, rating: 4, content: "Held up better than I expected." })
    );
    expect(response.status).toBe(201);

    const review = await prisma.review.findFirst({ where: { userId, workKey } });
    expect(review?.rating).toBe(4);
  });

  it("updates rather than duplicating on a second submit", async () => {
    await reviewPost(json({ workKey, rating: 3 }));
    await reviewPost(json({ workKey, rating: 5, content: "Changed my mind." }));

    const reviews = await prisma.review.findMany({ where: { userId, workKey } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0].rating).toBe(5);
  });

  it("rejects a rating outside 1-5, and a fractional one", async () => {
    expect((await reviewPost(json({ workKey, rating: 0 }))).status).toBe(400);
    expect((await reviewPost(json({ workKey, rating: 6 }))).status).toBe(400);
    expect((await reviewPost(json({ workKey, rating: 3.5 }))).status).toBe(400);
  });

  it("rejects a work that is not in the catalog", async () => {
    // No foreign key from app into catalog by design, so the write path is the
    // only thing standing between a typo and a review on nothing.
    const response = await reviewPost(json({ workKey: "OLNOPEW", rating: 4 }));
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe("tracking progress", () => {
  it("accepts the start, update and finish bodies the component sends", async () => {
    expect((await progressPost(json({ workKey, action: "start" }))).status).toBe(200);
    expect((await progressPost(json({ workKey, currentPage: 120 }))).status).toBe(200);

    const open = await prisma.readingSession.findFirst({
      where: { userId, workKey, finishedAt: null },
    });
    expect(open?.currentPage).toBe(120);

    expect((await progressPost(json({ workKey, action: "finish" }))).status).toBe(200);
    expect(
      await prisma.readingSession.findFirst({
        where: { userId, workKey, finishedAt: null },
      })
    ).toBeNull();
  });

  it("rejects a negative page", async () => {
    await progressPost(json({ workKey, action: "start" }));
    const response = await progressPost(json({ workKey, currentPage: -1 }));
    expect(response.status).toBe(400);
  });

  /**
   * The panel used to fetch the reader's OPEN sessions and match on workKey, so
   * a finished book found nothing and rendered "Start Reading" — which opened a
   * second session, moved the work back to Currently Reading, and
   * double-counted it in getReadingStats and /wrapped.
   */
  it("still reports a finished book instead of forgetting it", async () => {
    await progressPost(json({ workKey, action: "start" }));
    await progressPost(json({ workKey, action: "finish" }));

    const url = `http://test/api/progress?workKey=${encodeURIComponent(workKey)}`;
    const body = await (await progressGet(new Request(url))).json();

    expect(body).not.toBeNull();
    expect(body.workKey).toBe(workKey);
    expect(body.finishedAt).not.toBeNull();
  });

  it("returns null for a work never started, so the caller can tell them apart", async () => {
    const url = `http://test/api/progress?workKey=${encodeURIComponent(workKey)}`;
    expect(await (await progressGet(new Request(url))).json()).toBeNull();
  });

  it("still returns the open-session list when no workKey is given", async () => {
    await progressPost(json({ workKey, action: "start" }));
    const body = await (await progressGet(new Request("http://test/api/progress"))).json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });
});

/**
 * FLOW-5: the session snapshot has to belong to the book.
 *
 * `getEditionPageCount` was `WHERE ol_key = $1` with no `work_key` predicate,
 * and the schema constrained `editionKey` only by length — unlike `workKey`,
 * which has always carried a shape. `getDefaultEdition` filters on `work_key`;
 * only the explicit-`editionKey` path did not.
 *
 * That matters more since FLOW-28: the progress UI now treats the session's
 * `pageCount` as the single source of truth, and `updateProgress` validates page
 * numbers against it. So naming another book's 900-page edition made a 480-page
 * book read "310 / 900 pages", let the reader record page 900 of it, and made
 * /wrapped report it as their longest book of the year — permanently, because the
 * row is frozen by design.
 *
 * No test passed `editionKey` at all before this, which is why length was the
 * only constraint anyone noticed.
 */
describe("FLOW-5: starting a session with an explicit edition", () => {
  it("refuses an edition belonging to a different work", async () => {
    const other = await makeWork({ pages: 900 });
    const user = await makeUserWithShelves();

    await expect(
      startReading(user.id, workKey, `${other.olKey}E`)
    ).rejects.toThrow(/not part of this book/i);

    expect(
      await prisma.readingSession.count({ where: { userId: user.id } })
    ).toBe(0);
  });

  it("accepts an edition of the work, and snapshots its page count", async () => {
    const user = await makeUserWithShelves();

    const session = await startReading(user.id, workKey, `${workKey}E`);

    expect(session.editionKey).toBe(`${workKey}E`);
    expect(session.pageCount).toBe(412);
  });

  it("refuses an edition key that does not exist at all", async () => {
    const user = await makeUserWithShelves();

    await expect(
      startReading(user.id, workKey, "OL999999999M")
    ).rejects.toThrow(/not part of this book/i);
  });

  it("still falls back to the default edition when none is named", async () => {
    const user = await makeUserWithShelves();

    const session = await startReading(user.id, workKey);

    expect(session.pageCount).toBe(412);
  });
});

/**
 * TEST-9: `getReadingStats` is the "books read" number on two pages and had no
 * test at all.
 *
 * Dropping `finishedAt: { not: null }` from the count made every profile count
 * in-progress books as read, and nothing failed. `pagesRead` is equally exposed:
 * `_sum: { pageCount: true }` -> `_sum: { currentPage: true }` changes the number
 * on /my-books and breaks nothing either.
 *
 * This is FLOW-24 — "one definition of books read" — with no regression test
 * behind the fix. Absolute values, so a mutation that shifts a count cannot pass
 * by still being internally consistent.
 */
describe("TEST-9: getReadingStats", () => {
  it("counts finished sessions as read and open ones as in progress", async () => {
    const user = await makeUserWithShelves();
    const a = await makeWork({ pages: 100 });
    const b = await makeWork({ pages: 250 });
    const c = await makeWork({ pages: 400 });

    await startAndFinishFor(user.id, a.olKey);
    await startAndFinishFor(user.id, b.olKey);
    await startReading(user.id, c.olKey);

    const stats = await getReadingStats(user.id);

    expect(stats.booksRead).toBe(2);
    expect(stats.currentlyReading).toBe(1);
    // Finished sessions only, and their snapshot page counts: 100 + 250.
    expect(stats.pagesRead).toBe(350);
  });

  it("reports zeroes for a reader who has started nothing", async () => {
    const user = await makeUserWithShelves();
    const stats = await getReadingStats(user.id);

    expect(stats).toMatchObject({
      booksRead: 0,
      currentlyReading: 0,
      pagesRead: 0,
    });
  });

  it("does not count another reader's books", async () => {
    const mine = await makeUserWithShelves();
    const theirs = await makeUserWithShelves();
    const work = await makeWork({ pages: 100 });

    await startAndFinishFor(theirs.id, work.olKey);

    expect((await getReadingStats(mine.id)).booksRead).toBe(0);
    expect((await getReadingStats(theirs.id)).booksRead).toBe(1);
  });
});

/** Start and finish in one step, the way the importer does. */
async function startAndFinishFor(userId: string, workKey: string) {
  await startReading(userId, workKey);
  await finishReading(userId, workKey);
}
