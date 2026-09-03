import { prisma } from "./setup";
import { getWrappedStats, getWrappedProjections } from "@/server/wrapped";
import { makeUser, makeWork } from "./factories";

/**
 * `src/server/wrapped.ts` is 387 lines and had no test by any path. It is the
 * whole of `/wrapped` and `/wrapped/projections` — two pages made entirely of
 * arithmetic, which is the category of defect this repo has shipped most
 * often: FLOW-10 recorded every imported book as finished today and 534 green
 * tests said nothing, because nothing multiplied the numbers out.
 *
 * So these tests assert values, not shapes. Every expectation below was
 * verified by mutation — the note on each group says which change to
 * `wrapped.ts` makes it fail — because an assertion that cannot fail is worse
 * than no assertion (TEST-6, TEST-9, TEST-17).
 *
 * Integration rather than unit: the module joins `catalog.works` and
 * `catalog.editions` for titles, authors, subjects and covers, and the
 * interesting cases include a work the catalog does not have. Mocking the
 * client would assert that the mock returns what it was told to.
 */

// Only Date is faked. Faking the timer APIs as well wedges the Postgres
// driver, which schedules real work on them; verified by probe before this
// suite was written.
const FAKE_DATE_ONLY = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "nextTick",
  "queueMicrotask",
  "performance",
  "hrtime",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
] as const;

/**
 * Both functions read the wall clock, so anything that depends on "now" is
 * pinned. Times are midday deliberately: the module builds its year bounds
 * with `new Date(year, 0, 1)` — local — while day arithmetic is done in
 * milliseconds, so a fixture at midnight would land on a different day
 * depending on whether the runner is in UTC or, like this machine,
 * America/New_York, and a DST transition inside the interval would move it
 * again. Midday absorbs both, so every number here holds in either zone.
 */
function freezeAt(date: Date) {
  jest.useFakeTimers({ doNotFake: [...FAKE_DATE_ONLY] });
  jest.setSystemTime(date);
}

afterEach(() => {
  jest.useRealTimers();
});

/** A finished reading session. `pageCount` is the snapshot Wrapped must use. */
async function finish(
  userId: string,
  workKey: string,
  finishedAt: Date,
  pageCount: number | null = 300
) {
  return prisma.readingSession.create({
    data: {
      userId,
      workKey,
      pageCount,
      currentPage: pageCount ?? 0,
      startedAt: finishedAt,
      finishedAt,
    },
  });
}

async function review(
  userId: string,
  workKey: string,
  rating: number,
  createdAt: Date
) {
  return prisma.review.create({
    data: { userId, workKey, rating, createdAt },
  });
}

/** A past year, so nothing in these cases depends on today's date. */
const YEAR = 2024;
/** Midday, mid-year, mid-month — no boundary of any kind. */
const midYear = (month: number, day: number, year = YEAR) =>
  new Date(year, month, day, 12, 0, 0);

describe("getWrappedStats", () => {
  describe("the year window", () => {
    // Mutation: widening either bound, or dropping the userId, fails these.
    it("counts only the books finished in the requested year", async () => {
      const user = await makeUser();
      const work = await makeWork();

      await finish(user.id, work.olKey, midYear(5, 15, YEAR - 1));
      await finish(user.id, work.olKey, midYear(5, 15, YEAR));
      await finish(user.id, work.olKey, midYear(5, 15, YEAR + 1));

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.year).toBe(YEAR);
      expect(stats.booksRead).toBe(1);
    });

    it("keeps a book finished in the final second of the year", async () => {
      const user = await makeUser();
      const work = await makeWork();

      // The last representable instant of the year. The bound used to be
      // built as `new Date(year, 11, 31, 23, 59, 59)` — millisecond .000 —
      // and compared with `lte`, so this book fell out of December's report
      // and out of January's, since the next year's lower bound is
      // 1 January 00:00:00.000. It belonged to no year at all.
      await finish(user.id, work.olKey, new Date(YEAR, 11, 31, 23, 59, 59, 999));

      expect((await getWrappedStats(user.id, YEAR)).booksRead).toBe(1);
      // And exactly once: it must not also appear in the following year.
      expect((await getWrappedStats(user.id, YEAR + 1)).booksRead).toBe(0);
    });

    it("does not count another reader's books", async () => {
      const [mine, theirs] = await Promise.all([makeUser(), makeUser()]);
      const work = await makeWork();

      await finish(mine.id, work.olKey, midYear(3, 10));
      await finish(theirs.id, work.olKey, midYear(3, 11));
      await finish(theirs.id, work.olKey, midYear(3, 12));

      expect((await getWrappedStats(mine.id, YEAR)).booksRead).toBe(1);
      expect((await getWrappedStats(theirs.id, YEAR)).booksRead).toBe(2);
    });

    it("does not count a book still being read", async () => {
      const user = await makeUser();
      const work = await makeWork();

      await prisma.readingSession.create({
        data: {
          userId: user.id,
          workKey: work.olKey,
          pageCount: 400,
          currentPage: 120,
          startedAt: midYear(2, 1),
          finishedAt: null,
        },
      });

      const stats = await getWrappedStats(user.id, YEAR);

      // TEST-9 was this exact defect one module over: getReadingStats counted
      // in-progress books as read, and had no test.
      expect(stats.booksRead).toBe(0);
      expect(stats.pagesRead).toBe(0);
    });
  });

  describe("counting", () => {
    it("counts a re-read of the same book twice", async () => {
      const user = await makeUser();
      const work = await makeWork({ author: "Ursula K. Le Guin" });

      // The schema declines a unique constraint on (user, work) with a comment
      // saying re-reads are a real thing. A year in review should agree.
      await finish(user.id, work.olKey, midYear(1, 3));
      await finish(user.id, work.olKey, midYear(9, 3));

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.booksRead).toBe(2);
      expect(stats.topAuthors).toEqual([{ author: "Ursula K. Le Guin", count: 2 }]);
    });

    it("takes page counts from the session snapshot, not the catalog", async () => {
      const user = await makeUser();
      // The catalog's cover edition says 300 pages; the reader recorded 512.
      const work = await makeWork({ pages: 300 });

      await finish(user.id, work.olKey, midYear(4, 4), 512);

      // The module's own doc comment: "a year in review should not change
      // because an ingest dropped an edition". Mutation: reading
      // `number_of_pages` through getWorkStats instead returns 300.
      expect((await getWrappedStats(user.id, YEAR)).pagesRead).toBe(512);
    });

    it("treats a missing page count as zero rather than NaN", async () => {
      const user = await makeUser();
      const [a, b] = await Promise.all([makeWork(), makeWork()]);

      await finish(user.id, a.olKey, midYear(4, 4), null);
      await finish(user.id, b.olKey, midYear(4, 5), 100);

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.pagesRead).toBe(100);
      expect(Number.isNaN(stats.pagesRead)).toBe(false);
    });
  });

  describe("genres and authors", () => {
    // Counts are deliberately all different. TEST-6 ranked a list against its
    // own sort with every count equal, which any order satisfies.
    it("ranks genres by how often they were read, keeping five", async () => {
      const user = await makeUser();
      const byGenre = [
        ["Epic Fantasy", 6],
        ["Hard SF", 5],
        ["Gothic", 4],
        ["Noir", 3],
        ["Memoir", 2],
        ["Poetry", 1],
      ] as const;

      let day = 1;
      for (const [genre, count] of byGenre) {
        const work = await makeWork({ subjects: [genre] });
        for (let i = 0; i < count; i++) {
          await finish(user.id, work.olKey, midYear(5, day++));
        }
      }

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.topGenres).toEqual([
        { genre: "Epic Fantasy", count: 6 },
        { genre: "Hard SF", count: 5 },
        { genre: "Gothic", count: 4 },
        { genre: "Noir", count: 3 },
        { genre: "Memoir", count: 2 },
      ]);
      expect(stats.favoriteGenre).toBe("Epic Fantasy");
    });

    it("ranks authors by how often they were read, keeping five", async () => {
      const user = await makeUser();
      const byAuthor = [
        ["Ursula K. Le Guin", 6],
        ["Gene Wolfe", 5],
        ["Shirley Jackson", 4],
        ["Raymond Chandler", 3],
        ["Annie Dillard", 2],
        ["Basho", 1],
      ] as const;

      let day = 1;
      for (const [author, count] of byAuthor) {
        const work = await makeWork({ author });
        for (let i = 0; i < count; i++) {
          await finish(user.id, work.olKey, midYear(5, day++));
        }
      }

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.topAuthors).toEqual([
        { author: "Ursula K. Le Guin", count: 6 },
        { author: "Gene Wolfe", count: 5 },
        { author: "Shirley Jackson", count: 4 },
        { author: "Raymond Chandler", count: 3 },
        { author: "Annie Dillard", count: 2 },
      ]);
      expect(stats.favoriteAuthor).toBe("Ursula K. Le Guin");
    });

    it("does not invent an author called Unknown from books it cannot name", async () => {
      const user = await makeUser();
      // Two books the catalog cannot name: one absent entirely — a narrowed
      // ingest slice can drop a work someone has shelved, which the read paths
      // are required to tolerate — and one present with no author recorded.
      const nameless = await makeWork({ author: null });
      const named = await makeWork({ author: "Ursula K. Le Guin" });

      await finish(user.id, "OLTMISSINGW", midYear(1, 5));
      await finish(user.id, nameless.olKey, midYear(1, 6));
      await finish(user.id, named.olKey, midYear(1, 7));

      const stats = await getWrappedStats(user.id, YEAR);

      // All three still count as books read; only the attribution is missing.
      expect(stats.booksRead).toBe(3);
      // Both unnameable books used to land in one bucket keyed on the literal
      // "Unknown", which outvoted the real author two to one and rendered
      // "Your favourite author: Unknown" on the page.
      expect(stats.topAuthors).toEqual([{ author: "Ursula K. Le Guin", count: 1 }]);
      expect(stats.favoriteAuthor).toBe("Ursula K. Le Guin");
    });
  });

  describe("the longest and shortest book", () => {
    it("picks the extremes by snapshot page count", async () => {
      const user = await makeUser();
      const [short, middle, long] = await Promise.all([
        makeWork({ title: "The Short One" }),
        makeWork({ title: "The Middling One" }),
        makeWork({ title: "The Long One" }),
      ]);

      await finish(user.id, middle.olKey, midYear(1, 1), 200);
      await finish(user.id, long.olKey, midYear(1, 2), 300);
      await finish(user.id, short.olKey, midYear(1, 3), 100);

      const stats = await getWrappedStats(user.id, YEAR);

      // Mutation: swapping the two ends of the sort fails both assertions.
      expect(stats.longestBook).toEqual({
        title: "The Long One",
        author: "Test Author",
        pageCount: 300,
      });
      expect(stats.shortestBook).toEqual({
        title: "The Short One",
        author: "Test Author",
        pageCount: 100,
      });
    });

    it("ignores books with no page count when picking the shortest", async () => {
      const user = await makeUser();
      const [known, unknown, zero] = await Promise.all([
        makeWork({ title: "Counted" }),
        makeWork({ title: "No Page Count" }),
        makeWork({ title: "Zero Pages" }),
      ]);

      await finish(user.id, known.olKey, midYear(1, 1), 250);
      await finish(user.id, unknown.olKey, midYear(1, 2), null);
      await finish(user.id, zero.olKey, midYear(1, 3), 0);

      const stats = await getWrappedStats(user.id, YEAR);

      // Without the filter the shortest book of the year is a zero-page one.
      expect(stats.shortestBook?.title).toBe("Counted");
      expect(stats.longestBook?.title).toBe("Counted");
    });

    it("reports no extremes when nothing has a page count", async () => {
      const user = await makeUser();
      const work = await makeWork();

      await finish(user.id, work.olKey, midYear(1, 1), null);

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.booksRead).toBe(1);
      expect(stats.longestBook).toBeNull();
      expect(stats.shortestBook).toBeNull();
    });
  });

  describe("the first and last book of the year", () => {
    it("brackets the year by when each book was finished", async () => {
      const user = await makeUser();
      const [first, middle, last] = await Promise.all([
        makeWork({ title: "Opened the Year" }),
        makeWork({ title: "Somewhere in June" }),
        makeWork({ title: "Closed the Year" }),
      ]);

      // Inserted out of order, so the ordering under test is the query's.
      await finish(user.id, middle.olKey, midYear(5, 1));
      await finish(user.id, last.olKey, midYear(10, 20));
      await finish(user.id, first.olKey, midYear(0, 5));

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.firstBookOfYear?.title).toBe("Opened the Year");
      expect(stats.firstBookOfYear?.finishedAt).toEqual(midYear(0, 5));
      expect(stats.mostRecentBook?.title).toBe("Closed the Year");
      expect(stats.mostRecentBook?.finishedAt).toEqual(midYear(10, 20));
    });
  });

  describe("reading by month", () => {
    it("returns twelve zero-filled months indexed from zero", async () => {
      const user = await makeUser();
      const work = await makeWork();

      await finish(user.id, work.olKey, midYear(1, 14)); // February
      await finish(user.id, work.olKey, midYear(10, 3)); // November
      await finish(user.id, work.olKey, midYear(10, 4)); // November

      const stats = await getWrappedStats(user.id, YEAR);

      // The view indexes MONTH_NAMES with `m.month` directly, so a one-based
      // month here would label February's books as March's and drop December
      // off the end of the array.
      expect(stats.readingByMonth).toEqual([
        { month: 0, count: 0 },
        { month: 1, count: 1 },
        { month: 2, count: 0 },
        { month: 3, count: 0 },
        { month: 4, count: 0 },
        { month: 5, count: 0 },
        { month: 6, count: 0 },
        { month: 7, count: 0 },
        { month: 8, count: 0 },
        { month: 9, count: 0 },
        { month: 10, count: 2 },
        { month: 11, count: 0 },
      ]);
    });
  });

  describe("ratings and reviews", () => {
    it("averages the year's own reviews to one decimal place", async () => {
      const user = await makeUser();
      const works = await Promise.all([makeWork(), makeWork(), makeWork(), makeWork()]);

      await review(user.id, works[0].olKey, 5, midYear(2, 1));
      await review(user.id, works[1].olKey, 4, midYear(2, 2));
      await review(user.id, works[2].olKey, 4, midYear(2, 3));
      // Written last year: outside the window, so it must not pull the mean.
      await review(user.id, works[3].olKey, 1, midYear(2, 3, YEAR - 1));

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.reviewsWritten).toBe(3);
      // 13 / 3 = 4.333…; rounding to a whole number gives 4, not rounding
      // gives 4.333333333333333, and including last year's 1 gives 3.5.
      expect(stats.averageRating).toBe(4.3);
    });

    it("reports a zero average rather than NaN when nothing was reviewed", async () => {
      const user = await makeUser();
      const work = await makeWork();
      await finish(user.id, work.olKey, midYear(2, 1));

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.reviewsWritten).toBe(0);
      expect(stats.averageRating).toBe(0);
    });

    it("leaves a three star book out of the year's favourites", async () => {
      const user = await makeUser();
      const [loved, liked, fine] = await Promise.all([
        makeWork({ title: "Loved It" }),
        makeWork({ title: "Liked It" }),
        makeWork({ title: "It Was Fine" }),
      ]);

      await review(user.id, loved.olKey, 5, midYear(2, 1));
      await review(user.id, liked.olKey, 4, midYear(2, 2));
      await review(user.id, fine.olKey, 3, midYear(2, 3));

      const stats = await getWrappedStats(user.id, YEAR);

      // Three reviews, so the five-book cap cannot stand in for the filter.
      // The first version of this suite asserted the filter and the cap in one
      // case with eight reviews, and relaxing the filter to >= 3 changed
      // nothing: the extra book sorted last and the cap cut it regardless.
      // Mutation testing caught that, which is the whole reason it is run —
      // TEST-6 in this repo was the same mistake.
      expect(stats.topRatedBooks.map((b) => b.title)).toEqual([
        "Loved It",
        "Liked It",
      ]);
      expect(stats.reviewsWritten).toBe(3);
    });

    it("keeps the five best, and carries each cover through", async () => {
      const user = await makeUser();
      const works = await Promise.all(
        Array.from({ length: 6 }, () => makeWork())
      );
      const withCover = await makeWork({ title: "Has A Cover", coverId: 987654 });

      for (const [i, rating] of [5, 5, 4, 4, 4, 4].entries()) {
        await review(user.id, works[i].olKey, rating, midYear(2, i + 1));
      }
      await review(user.id, withCover.olKey, 5, midYear(2, 9));

      const stats = await getWrappedStats(user.id, YEAR);

      // Seven qualify, five survive. Mutation: a cap of six fails here.
      expect(stats.topRatedBooks).toHaveLength(5);
      expect(stats.topRatedBooks.map((b) => b.rating)).toEqual([5, 5, 5, 4, 4]);
      // The cover id is a bigint in the catalog and is cast on the way out; an
      // uncast bigint is what broke a page in this repo once, via JSON.
      expect(stats.topRatedBooks.map((b) => b.title)).toContain("Has A Cover");
      expect(
        stats.topRatedBooks.find((b) => b.title === "Has A Cover")?.coverId
      ).toBe(987654);
    });
  });

  describe("derived rates", () => {
    it("counts distinct reading days, not books", async () => {
      const user = await makeUser();
      const work = await makeWork();

      await finish(user.id, work.olKey, new Date(YEAR, 5, 1, 12, 0, 0));
      await finish(user.id, work.olKey, new Date(YEAR, 5, 1, 18, 0, 0));
      await finish(user.id, work.olKey, new Date(YEAR, 5, 2, 12, 0, 0));

      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats.booksRead).toBe(3);
      expect(stats.totalReadingDays).toBe(2);
    });

    it("divides a past year by twelve months", async () => {
      const user = await makeUser();
      const work = await makeWork();

      for (let i = 0; i < 6; i++) {
        await finish(user.id, work.olKey, midYear(5, i + 1));
      }

      // A closed year has twelve months, whatever today is.
      expect((await getWrappedStats(user.id, YEAR)).averageBooksPerMonth).toBe(0.5);
    });

    it("divides the current year by the months elapsed so far", async () => {
      const user = await makeUser();
      const work = await makeWork();

      freezeAt(new Date(2026, 6, 2, 12, 0, 0)); // 2 July 2026 — seven months in

      for (let i = 0; i < 14; i++) {
        await finish(user.id, work.olKey, new Date(2026, 2, i + 1, 12, 0, 0));
      }

      // 14 books over seven months. Dividing by twelve would report 1.2.
      expect((await getWrappedStats(user.id, 2026)).averageBooksPerMonth).toBe(2);
    });
  });

  describe("a reader with nothing to report", () => {
    it("returns a well-formed zero report rather than throwing", async () => {
      const user = await makeUser();

      // /wrapped renders this unconditionally, and a page that throws on load
      // was one of the four blockers the 2026-08-31 audit found.
      const stats = await getWrappedStats(user.id, YEAR);

      expect(stats).toMatchObject({
        year: YEAR,
        booksRead: 0,
        pagesRead: 0,
        reviewsWritten: 0,
        averageRating: 0,
        topGenres: [],
        topAuthors: [],
        longestBook: null,
        shortestBook: null,
        firstBookOfYear: null,
        mostRecentBook: null,
        topRatedBooks: [],
        totalReadingDays: 0,
        averageBooksPerMonth: 0,
        favoriteGenre: null,
        favoriteAuthor: null,
      });
      expect(stats.readingByMonth).toHaveLength(12);
      expect(stats.readingByMonth.every((m) => m.count === 0)).toBe(true);
    });
  });
});

describe("getWrappedProjections", () => {
  describe("the calendar", () => {
    it("counts today as elapsed and the rest of the year as remaining", async () => {
      const user = await makeUser();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0)); // 2 July 2026

      const p = await getWrappedProjections(user.id);

      // 181 days to the end of June, plus 1 and 2 July.
      expect(p.year).toBe(2026);
      expect(p.daysElapsed).toBe(183);
      expect(p.daysRemaining).toBe(182);
      expect(p.daysElapsed + p.daysRemaining).toBe(365);
    });

    // The leap rule is written inline, and all three of its clauses are
    // reachable. Each case below fails if the corresponding clause is dropped.
    it("gives a leap year 366 days", async () => {
      const user = await makeUser();
      freezeAt(new Date(2024, 2, 1, 12, 0, 0)); // 1 March 2024, after 29 Feb

      const p = await getWrappedProjections(user.id);

      expect(p.daysElapsed).toBe(61);
      expect(p.daysElapsed + p.daysRemaining).toBe(366);
    });

    it("does not give a century year 366 days", async () => {
      const user = await makeUser();
      freezeAt(new Date(2100, 2, 1, 12, 0, 0)); // 1 March 2100

      const p = await getWrappedProjections(user.id);

      // Divisible by 4 but not by 400. Dropping `year % 100 !== 0` makes this
      // 366 and February 2100 twenty-nine days long.
      expect(p.daysElapsed).toBe(60);
      expect(p.daysElapsed + p.daysRemaining).toBe(365);
    });

    it("gives a year divisible by 400 its extra day back", async () => {
      const user = await makeUser();
      freezeAt(new Date(2000, 2, 1, 12, 0, 0)); // 1 March 2000

      const p = await getWrappedProjections(user.id);

      // Dropping `|| year % 400 === 0` makes this 365.
      expect(p.daysElapsed).toBe(61);
      expect(p.daysElapsed + p.daysRemaining).toBe(366);
    });
  });

  describe("year to date", () => {
    it("counts only this year's finished books", async () => {
      const user = await makeUser();
      const work = await makeWork();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      await finish(user.id, work.olKey, new Date(2025, 5, 1, 12, 0, 0), 400);
      await finish(user.id, work.olKey, new Date(2026, 1, 1, 12, 0, 0), 100);
      await finish(user.id, work.olKey, new Date(2026, 2, 1, 12, 0, 0), 200);

      const p = await getWrappedProjections(user.id);

      expect(p.booksReadYTD).toBe(2);
      expect(p.pagesReadYTD).toBe(300);
    });

    it("projects the rest of the year from the pace so far", async () => {
      const user = await makeUser();
      const work = await makeWork();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0)); // 183 elapsed, 182 remaining

      // Ten books, 1,830 pages — a round ten pages a day.
      for (let i = 0; i < 10; i++) {
        await finish(user.id, work.olKey, new Date(2026, 1, i + 1, 12, 0, 0), 183);
      }

      const p = await getWrappedProjections(user.id);

      expect(p.booksReadYTD).toBe(10);
      expect(p.pagesReadYTD).toBe(1830);
      expect(p.pagesPerDay).toBe(10);
      // 10 books over 183/30.44 = 6.01 months.
      expect(p.booksPerMonth).toBe(1.7);
      expect(p.projectedBooksEndOfYear).toBe(20);
      expect(p.projectedPagesEndOfYear).toBe(3650);
      // Mutation: projecting from the *rounded* 1.7 books a month gives 3651
      // pages and the same 20 books, which is why pages are asserted too.
    });

    it("reports what each goal would take from here", async () => {
      const user = await makeUser();
      const work = await makeWork();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      for (let i = 0; i < 10; i++) {
        await finish(user.id, work.olKey, new Date(2026, 1, i + 1, 12, 0, 0), 183);
      }

      const p = await getWrappedProjections(user.id);

      // 40 more books and 90 more books, over the 5.98 months left.
      expect(p.booksNeededPerMonthFor50).toBe(6.7);
      expect(p.booksNeededPerMonthFor100).toBe(15.1);
      expect(p.onTrackFor50).toBe(false);
      expect(p.onTrackFor100).toBe(false);
    });

    it("turns a goal off once it is already met", async () => {
      const user = await makeUser();
      const work = await makeWork();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      for (let i = 0; i < 60; i++) {
        await finish(user.id, work.olKey, new Date(2026, 1, 1, 12, 0, 0), 100);
      }

      const p = await getWrappedProjections(user.id);

      expect(p.booksReadYTD).toBe(60);
      // Already past fifty, so nothing more is needed per month; not negative.
      expect(p.booksNeededPerMonthFor50).toBe(0);
      expect(p.booksNeededPerMonthFor100).toBe(6.7);
      expect(p.onTrackFor50).toBe(true);
      expect(p.onTrackFor100).toBe(true);
    });

    it("is on track for fifty without being on track for a hundred", async () => {
      const user = await makeUser();
      const work = await makeWork();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      for (let i = 0; i < 30; i++) {
        await finish(user.id, work.olKey, new Date(2026, 1, 1, 12, 0, 0), 61);
      }

      const p = await getWrappedProjections(user.id);

      expect(p.projectedBooksEndOfYear).toBe(60);
      expect(p.onTrackFor50).toBe(true);
      expect(p.onTrackFor100).toBe(false);
    });
  });

  describe("last year", () => {
    it("reports no previous year rather than a zero", async () => {
      const user = await makeUser();
      const work = await makeWork();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      await finish(user.id, work.olKey, new Date(2026, 1, 1, 12, 0, 0));

      const p = await getWrappedProjections(user.id);

      // Nothing to compare against, so the view has nothing to render.
      expect(p.previousYearBooks).toBeNull();
      expect(p.aheadOfLastYear).toBeNull();
    });

    it("compares against the same point last year, not the whole of it", async () => {
      const user = await makeUser();
      const work = await makeWork();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0)); // 2 July

      // Last year: two by this point, three more after it.
      await finish(user.id, work.olKey, new Date(2025, 2, 1, 12, 0, 0));
      await finish(user.id, work.olKey, new Date(2025, 3, 1, 12, 0, 0));
      await finish(user.id, work.olKey, new Date(2025, 9, 1, 12, 0, 0));
      await finish(user.id, work.olKey, new Date(2025, 10, 1, 12, 0, 0));
      await finish(user.id, work.olKey, new Date(2025, 11, 1, 12, 0, 0));
      // This year: three, which beats last year's two-by-July but not its five.
      await finish(user.id, work.olKey, new Date(2026, 0, 1, 12, 0, 0));
      await finish(user.id, work.olKey, new Date(2026, 1, 1, 12, 0, 0));
      await finish(user.id, work.olKey, new Date(2026, 2, 1, 12, 0, 0));

      const p = await getWrappedProjections(user.id);

      expect(p.previousYearBooks).toBe(5);
      // Mutation: comparing against the full previous year makes this false.
      expect(p.aheadOfLastYear).toBe(true);
    });

    it("is not ahead when it is behind last year's pace", async () => {
      const user = await makeUser();
      const work = await makeWork();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      await finish(user.id, work.olKey, new Date(2025, 2, 1, 12, 0, 0));
      await finish(user.id, work.olKey, new Date(2025, 3, 1, 12, 0, 0));
      await finish(user.id, work.olKey, new Date(2026, 0, 1, 12, 0, 0));

      const p = await getWrappedProjections(user.id);

      expect(p.previousYearBooks).toBe(2);
      expect(p.aheadOfLastYear).toBe(false);
    });
  });

  describe("recent activity", () => {
    it("reports the most recently finished book", async () => {
      const user = await makeUser();
      const [early, late] = await Promise.all([
        makeWork({ title: "Finished In January", author: "A. Author" }),
        makeWork({ title: "Finished In June", author: "B. Author" }),
      ]);
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      await finish(user.id, early.olKey, new Date(2026, 0, 9, 12, 0, 0));
      await finish(user.id, late.olKey, new Date(2026, 5, 9, 12, 0, 0));

      const p = await getWrappedProjections(user.id);

      expect(p.lastBookFinished).toEqual({
        title: "Finished In June",
        author: "B. Author",
        finishedAt: new Date(2026, 5, 9, 12, 0, 0),
      });
    });

    it("caps reported progress at 100%, however the row got there", async () => {
      // TEST-20. `progress` is rendered as a width and a label without going
      // through ProgressBar, so it has to arrive already clamped.
      //
      // `updateProgress` refuses a page past the end, but it is not the only
      // writer — the Goodreads importer creates sessions directly, and
      // `pageCount` is a snapshot taken when the session started. This row is
      // reachable, and unclamped it renders as "128%" over a bar past its own
      // end.
      const user = await makeUser();
      const work = await makeWork({ title: "Past Its Own End" });
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      await prisma.readingSession.create({
        data: {
          userId: user.id,
          workKey: work.olKey,
          pageCount: 250,
          currentPage: 320,
          startedAt: new Date(2026, 5, 1, 12, 0, 0),
          finishedAt: null,
        },
      });

      const p = await getWrappedProjections(user.id);

      expect(p.currentlyReading).toHaveLength(1);
      expect(p.currentlyReading[0].progress).toBe(100);
    });

    it("does not report negative progress", async () => {
      // The other end of the clamp. Nothing writes a negative currentPage
      // today, and the column is not constrained against one either.
      const user = await makeUser();
      const work = await makeWork();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      await prisma.readingSession.create({
        data: {
          userId: user.id,
          workKey: work.olKey,
          pageCount: 250,
          currentPage: -40,
          startedAt: new Date(2026, 5, 1, 12, 0, 0),
          finishedAt: null,
        },
      });

      expect((await getWrappedProjections(user.id)).currentlyReading[0].progress).toBe(0);
    });

    it("reports progress through the books still open", async () => {
      const user = await makeUser();
      const [half, unpaged] = await Promise.all([
        makeWork({ title: "Halfway Through", author: "A. Author" }),
        makeWork({ title: "No Page Count", author: "B. Author" }),
      ]);
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      await prisma.readingSession.createMany({
        data: [
          {
            userId: user.id,
            workKey: half.olKey,
            pageCount: 300,
            currentPage: 150,
            startedAt: new Date(2026, 5, 1, 12, 0, 0),
            finishedAt: null,
          },
          {
            userId: user.id,
            workKey: unpaged.olKey,
            pageCount: null,
            currentPage: 40,
            startedAt: new Date(2026, 5, 1, 12, 0, 0),
            finishedAt: null,
          },
        ],
      });

      const p = await getWrappedProjections(user.id);

      // Unordered by the query, so compared as a set.
      expect(p.currentlyReading).toEqual(
        expect.arrayContaining([
          { title: "Halfway Through", author: "A. Author", progress: 50 },
          // No denominator, so no percentage — and not a NaN rendered as "NaN%".
          { title: "No Page Count", author: "B. Author", progress: 0 },
        ])
      );
      expect(p.currentlyReading).toHaveLength(2);
      expect(p.booksReadYTD).toBe(0);
    });
  });

  describe("a reader with nothing to project", () => {
    it("returns a well-formed zero projection rather than throwing", async () => {
      const user = await makeUser();
      freezeAt(new Date(2026, 6, 2, 12, 0, 0));

      const p = await getWrappedProjections(user.id);

      expect(p).toMatchObject({
        year: 2026,
        booksReadYTD: 0,
        pagesReadYTD: 0,
        reviewsWrittenYTD: 0,
        booksPerMonth: 0,
        pagesPerDay: 0,
        projectedBooksEndOfYear: 0,
        projectedPagesEndOfYear: 0,
        onTrackFor50: false,
        onTrackFor100: false,
        previousYearBooks: null,
        aheadOfLastYear: null,
        lastBookFinished: null,
        currentlyReading: [],
      });
      expect(p.readingByMonth).toHaveLength(12);
    });
  });
});
