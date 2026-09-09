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
import { getReadingStats, finishReading, updateProgress } from "@/server/progress";
import { addWorkToShelf } from "@/server/shelves";

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
 * TEST-7 and TEST-8: the two guards in `updateProgress`, neither of which had
 * a test that could fail.
 *
 * Both matter more since FLOW-28 made the session's `pageCount` the single
 * source of truth for the progress UI, and both are one character wide.
 *
 * TEST-7 — the page ceiling. Every existing progress test posts 120 or -1
 * against a 412-page book, so deleting `currentPage > session.pageCount`
 * entirely changed nothing: page 5,000 of a 412-page book was accepted, the
 * bar rendered past its own end, and /wrapped counted it.
 *
 * TEST-8 — `currentPage >= session.pageCount` is what makes reaching the last
 * page finish the book, which the code comment calls "what a reader means",
 * and it is also what moves the work to the Read shelf. Every test reached
 * "finished" through `action: "finish"` instead, so weakening `>=` to `>` left
 * the documented behaviour and the shelf move it drives completely unguarded.
 *
 * The boundary is asserted from both sides — 411 does not finish, 412 does —
 * because a test that only proves "a big page number finishes it" is equally
 * happy with `>`, with `>= pageCount - 1`, and with no comparison at all.
 */
describe("TEST-7 and TEST-8: the page ceiling and the last page", () => {
  /** The shelves this user currently has the work on, by name. */
  async function shelvesFor(work: string) {
    const items = await prisma.shelfItem.findMany({
      where: { workKey: work, userId },
      include: { shelf: true },
    });
    return items.map((i) => i.shelf.name).sort();
  }

  it("refuses a page beyond the edition's length, and records nothing", async () => {
    await progressPost(json({ workKey, action: "start" }));

    const response = await progressPost(json({ workKey, currentPage: 5000 }));

    expect(response.status).toBe(400);
    // The message carries the real length, so the reader can tell what
    // happened rather than being told "invalid".
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("412"),
    });
    // Status alone would pass if the write happened and the error came after.
    const open = await prisma.readingSession.findFirstOrThrow({
      where: { userId, workKey },
    });
    expect(open.currentPage).toBe(0);
    expect(open.finishedAt).toBeNull();
  });

  it("accepts the last page itself, which is not beyond the length", async () => {
    await progressPost(json({ workKey, action: "start" }));

    // The ceiling is `>`, not `>=`. Tightening it would make a book
    // impossible to finish by reading it.
    expect((await progressPost(json({ workKey, currentPage: 412 }))).status).toBe(200);
  });

  it("does not finish the book one page short of the end", async () => {
    await progressPost(json({ workKey, action: "start" }));
    await progressPost(json({ workKey, currentPage: 411 }));

    const session = await prisma.readingSession.findFirstOrThrow({
      where: { userId, workKey },
    });
    expect(session.currentPage).toBe(411);
    expect(session.finishedAt).toBeNull();
    expect(await shelvesFor(workKey)).toEqual(["Currently Reading"]);
  });

  it("finishes the book on reaching the last page, and moves it to Read", async () => {
    await progressPost(json({ workKey, action: "start" }));
    expect(await shelvesFor(workKey)).toEqual(["Currently Reading"]);

    const response = await progressPost(json({ workKey, currentPage: 412 }));

    expect(response.status).toBe(200);
    const session = await prisma.readingSession.findFirstOrThrow({
      where: { userId, workKey },
    });
    expect(session.currentPage).toBe(412);
    expect(session.finishedAt).not.toBeNull();
    // The shelf move is the visible half, and it is downstream of the same
    // comparison — so it is asserted rather than assumed.
    expect(await shelvesFor(workKey)).toEqual(["Read"]);
  });

  it("leaves a session with no page count open however far it is read", async () => {
    // `pageCount` is null when the catalog has no page count for the edition,
    // and `session.pageCount != null` is what keeps both guards off that path.
    // Without it, `currentPage >= null` would finish the book at page 0.
    const unpaged = await makeWork();
    await prisma.readingSession.create({
      data: { userId, workKey: unpaged.olKey, pageCount: null, currentPage: 0 },
    });

    expect(
      (await progressPost(json({ workKey: unpaged.olKey, currentPage: 900 }))).status
    ).toBe(200);

    const session = await prisma.readingSession.findFirstOrThrow({
      where: { userId, workKey: unpaged.olKey },
    });
    expect(session.currentPage).toBe(900);
    expect(session.finishedAt).toBeNull();
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

describe("JR-11 and RUN-5: pages read, and re-adding a work", () => {
  it("counts the pages logged when the edition states no length", async () => {
    const user = await makeUserWithShelves();
    const stated = await makeWork({ pages: 100 });

    // Built by hand rather than through makeWork, which defaults
    // number_of_pages to 300 — and the whole point of this case is an edition
    // that states nothing. Open Library has plenty; ReadingProgressSection has
    // a branch for it ("no page count for this edition").
    const unstated = await makeWork({ pages: 1 });
    await prisma.$executeRaw`
      UPDATE catalog.editions SET number_of_pages = NULL
      WHERE work_key = ${unstated.olKey}`;

    await startReading(user.id, stated.olKey);
    await finishReading(user.id, stated.olKey);

    // The session snapshots null, so the reader logs pages by hand and the
    // finish leaves currentPage where they left it.
    await startReading(user.id, unstated.olKey);
    await updateProgress(user.id, unstated.olKey, 250);
    expect(
      (
        await prisma.readingSession.findFirstOrThrow({
          where: { userId: user.id, workKey: unstated.olKey },
        })
      ).pageCount
    ).toBeNull();

    // 100 from the stated edition. The 250 does NOT count yet, because that
    // session is still open — only finished sessions count as read, which is
    // TEST-9's rule and is deliberately unchanged.
    expect((await getReadingStats(user.id)).pagesRead).toBe(100);

    await finishReading(user.id, unstated.olKey);
    const after = await getReadingStats(user.id);

    // Now it counts, and it counts the 250 the reader logged rather than 0.
    // Summing page_count alone gave 100 here.
    expect(after.booksRead).toBe(2);
    expect(after.pagesRead).toBe(350);
  });

  it("leaves addedAt alone when a work is re-added to the shelf it is on", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork({});
    const want = shelfNamed(user, "Want to Read");

    const first = await addWorkToShelf(want, work.olKey, user.id);
    const again = await addWorkToShelf(want, work.olKey, user.id);

    // Same row, not a delete and a recreate: the original shelving date is
    // what a reader's library is ordered by.
    expect(again.id).toBe(first.id);
    expect(again.addedAt.getTime()).toBe(first.addedAt.getTime());
    expect(
      await prisma.shelfItem.count({ where: { userId: user.id, workKey: work.olKey } })
    ).toBe(1);
  });

  it("still moves a work off the other exclusive shelves", async () => {
    // The control: the no-op above must not stop the move it sits in front of.
    const user = await makeUserWithShelves();
    const work = await makeWork({});

    await addWorkToShelf(shelfNamed(user, "Want to Read"), work.olKey, user.id);
    await addWorkToShelf(shelfNamed(user, "Read"), work.olKey, user.id);

    const items = await prisma.shelfItem.findMany({
      where: { userId: user.id, workKey: work.olKey },
      include: { shelf: true },
    });
    expect(items).toHaveLength(1);
    expect(items[0].shelf.name).toBe("Read");
  });
});

describe("RUN-1: finishing is idempotent", () => {
  /**
   * The defect: with no OPEN session, finishReading created a new
   * already-finished one, and the partial unique index only constrains open
   * sessions. Five clicks of Finish were five finished sessions, and
   * getWrappedStats counts sessions rather than distinct works — "5 Books
   * Read, 880 Pages Read" for one 176-page book.
   *
   * These assert the session COUNT, not the response status. A status-only
   * check passed throughout, which is why nothing caught it.
   */
  it("records one session however many times Finish is pressed", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork({ pages: 176 });

    for (let i = 0; i < 5; i++) await finishReading(user.id, work.olKey);

    const sessions = await prisma.readingSession.findMany({
      where: { userId: user.id, workKey: work.olKey },
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0].finishedAt).not.toBeNull();

    // The number the reader actually sees, and the one that was wrong.
    const stats = await getReadingStats(user.id);
    expect(stats.booksRead).toBe(1);
    expect(stats.pagesRead).toBe(176);
  });

  it("records one session when two finishes race", async () => {
    /**
     * The case the dedupe exists for, and the one the first version of the fix
     * did not close: a double-click is CONCURRENT, and a read followed by a
     * create is not atomic. Two simultaneous finishes produced two sessions
     * until `reading_sessions_one_finish_per_day` existed.
     *
     * /bastion asked for this test and it failed when written, which is the
     * only reason to trust it now.
     */
    const user = await makeUserWithShelves();
    const work = await makeWork({ pages: 100 });

    const results = await Promise.allSettled([
      finishReading(user.id, work.olKey),
      finishReading(user.id, work.olKey),
      finishReading(user.id, work.olKey),
    ]);

    // Neither caller sees an error: the loser of the race gets the winner's
    // row back, because it is the same finish.
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);

    expect(
      await prisma.readingSession.count({
        where: { userId: user.id, workKey: work.olKey },
      })
    ).toBe(1);
    expect((await getReadingStats(user.id)).booksRead).toBe(1);
  });

  it("does not add a session when a finished book is re-imported on the same date", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork({ pages: 300 });
    // Midday, per the timezone rule in the testing skill.
    const dateRead = new Date("2014-03-05T12:00:00.000Z");

    await finishReading(user.id, work.olKey, dateRead);
    await finishReading(user.id, work.olKey, dateRead);

    expect(
      await prisma.readingSession.count({
        where: { userId: user.id, workKey: work.olKey },
      })
    ).toBe(1);
    expect((await getReadingStats(user.id)).booksRead).toBe(1);
  });

  it("still closes an open session rather than opening a second one", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork({ pages: 120 });

    await startReading(user.id, work.olKey);
    await finishReading(user.id, work.olKey);
    await finishReading(user.id, work.olKey);

    const sessions = await prisma.readingSession.findMany({
      where: { userId: user.id, workKey: work.olKey },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].currentPage).toBe(120);
  });

  it("still records a genuine re-read finished on a different day", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork({ pages: 200 });

    await finishReading(user.id, work.olKey, new Date("2024-06-01T12:00:00.000Z"));
    await finishReading(user.id, work.olKey, new Date("2025-06-01T12:00:00.000Z"));

    // Two readings, deliberately: the dedupe is a same-day window, not a
    // one-session-per-work rule. getLatestSessionForWork's docstring is
    // explicit that re-reading is legitimate.
    expect(
      await prisma.readingSession.count({
        where: { userId: user.id, workKey: work.olKey },
      })
    ).toBe(2);
    expect((await getReadingStats(user.id)).booksRead).toBe(2);
  });

  it("does not merge two readers' finishes of the same work", async () => {
    const mine = await makeUserWithShelves();
    const theirs = await makeUserWithShelves();
    const work = await makeWork({ pages: 150 });
    const when = new Date("2026-02-10T12:00:00.000Z");

    await finishReading(mine.id, work.olKey, when);
    await finishReading(theirs.id, work.olKey, when);

    expect((await getReadingStats(mine.id)).booksRead).toBe(1);
    expect((await getReadingStats(theirs.id)).booksRead).toBe(1);
  });
});

/** Start and finish in one step, the way the importer does. */
async function startAndFinishFor(userId: string, workKey: string) {
  await startReading(userId, workKey);
  await finishReading(userId, workKey);
}

/** The id of one of a user's three default shelves, by name. */
function shelfNamed(
  user: Awaited<ReturnType<typeof makeUserWithShelves>>,
  name: string
): string {
  const shelf = user.shelves.find((s) => s.name === name);
  if (!shelf) throw new Error(`no shelf named ${name}`);
  return shelf.id;
}
