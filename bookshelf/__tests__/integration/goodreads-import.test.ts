import { prisma } from "./setup";
import { makeUserWithShelves } from "./factories";
import { parseGoodreadsCSV } from "@/lib/sources/goodreads";
import {
  createImportSession,
  getImportSession,
  getRowsForReview,
  confirmMatch,
  skipRow,
  findCandidates,
} from "@/server/imports";

/**
 * M6 acceptance: a real export imports, the match rate is reported, and rows
 * that did not match are queued rather than dropped.
 *
 * The last clause is the one worth testing. The old importer counted its
 * failures and threw them away, so a reader with 800 books got 640 and no way
 * to find the rest. Every assertion here is ultimately about a row that did
 * not match still being reachable afterwards.
 *
 * The CSV below is shaped like an actual Goodreads export — same columns, same
 * order, including the quoted publisher fields and the multi-line review that
 * used to shift every subsequent column.
 */

const HEADER =
  "Book Id,Title,Author,ISBN,ISBN13,My Rating,Publisher,Number of Pages," +
  "Year Published,Date Read,Date Added,Bookshelves,Exclusive Shelf,My Review,Read Count";

/** A work in the catalog with a known ISBN, so the ISBN path has something to hit. */
async function seedWork(opts: {
  key: string;
  title: string;
  author: string;
  isbn13?: string;
}) {
  await prisma.$executeRaw`
    INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
    VALUES (${opts.key}, ${opts.title}, ${opts.author}, ARRAY['Fiction'], 1)
    ON CONFLICT (ol_key) DO UPDATE SET title = EXCLUDED.title`;

  await prisma.$executeRaw`
    INSERT INTO catalog.editions (ol_key, work_key, title, isbn13, number_of_pages)
    VALUES (${opts.key + "E"}, ${opts.key}, ${opts.title}, ${opts.isbn13 ?? null}, 300)
    ON CONFLICT (ol_key) DO UPDATE SET isbn13 = EXCLUDED.isbn13`;

  return opts.key;
}

const WORKS = {
  dune: { key: "OLIMP001W", title: "Dune", author: "Frank Herbert", isbn13: "9780441172719" },
  hobbit: { key: "OLIMP002W", title: "The Hobbit", author: "J.R.R. Tolkien", isbn13: "9780547928227" },
  gatsby: { key: "OLIMP003W", title: "The Great Gatsby", author: "F. Scott Fitzgerald" },
  mockingbird: { key: "OLIMP004W", title: "To Kill a Mockingbird", author: "Harper Lee" },
};

let userId: string;

beforeAll(async () => {
  for (const w of Object.values(WORKS)) await seedWork(w);
}, 60_000);

beforeEach(async () => {
  const user = await makeUserWithShelves();
  userId = user.id;
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DELETE FROM catalog.works WHERE ol_key LIKE 'OLIMP%'`
  );
});

/** Import a CSV the way the route does: parse, then create a session. */
async function importCsv(csv: string) {
  const rows = parseGoodreadsCSV(csv);
  const sessionId = await createImportSession(userId, "goodreads_library_export.csv", rows);
  return { sessionId, parsedCount: rows.length };
}

describe("M6 acceptance: Goodreads import", () => {
  const csv = [
    HEADER,
    // Matches on ISBN-13.
    `1,Dune,Frank Herbert,"=""0441172717""","=""9780441172719""",5,Ace,412,1965,2024/03/15,2024/01/02,"sci-fi, favourites",read,"Still the best.",1`,
    // No ISBN in the export — matches on exact title and author.
    `2,The Great Gatsby,F. Scott Fitzgerald,"","",4,Scribner,180,1925,2024/05/01,2024/04/01,classics,read,"",1`,
    // Currently reading, no rating, no read date.
    `3,The Hobbit,J.R.R. Tolkien,"=""054792822X""","=""9780547928227""",0,Houghton,300,1937,,2024/06/01,fantasy,currently-reading,"",0`,
    // A title close to a catalog work but not equal — this is the review case.
    `4,To Kill a Mockingbrd,Harper Lee,"","",5,Harper,281,1960,2024/02/10,2024/02/01,classics,read,"A multi-line review.

Second paragraph, with a comma.",1`,
    // Nothing like it in the catalog at all.
    `5,An Entirely Invented Book,Nobody At All,"","",3,Nowhere,100,2020,,2024/07/01,,to-read,"",0`,
  ].join("\n");

  it("imports a real export and reports a match rate", async () => {
    const { sessionId, parsedCount } = await importCsv(csv);
    expect(parsedCount).toBe(5);

    const summary = await getImportSession(userId, sessionId);
    expect(summary).not.toBeNull();
    expect(summary!.totalRows).toBe(5);

    // Dune by ISBN, Gatsby and The Hobbit by exact title and author.
    expect(summary!.matched).toBe(3);
    expect(summary!.matchRate).toBe(60);
  });

  it("queues what it could not match instead of dropping it", async () => {
    const { sessionId } = await importCsv(csv);

    const summary = await getImportSession(userId, sessionId);
    expect(summary!.needsReview).toBe(2);
    // The session stays open precisely because rows are waiting.
    expect(summary!.status).toBe("review");

    const queued = await getRowsForReview(userId, sessionId);
    expect(queued.map((r) => r.title).sort()).toEqual([
      "An Entirely Invented Book",
      "To Kill a Mockingbrd",
    ]);
  });

  it("keeps the row's own data, so a confirmed match can still be applied", async () => {
    // Dropping a row loses its rating and shelf as well as its title. This is
    // what makes the queue worth having rather than just a list of failures.
    const { sessionId } = await importCsv(csv);
    const queued = await getRowsForReview(userId, sessionId);
    const typo = queued.find((r) => r.title === "To Kill a Mockingbrd")!;

    expect(typo.myRating).toBe(5);
    expect(typo.exclusiveShelf).toBe("read");
  });

  it("offers candidates for a near-miss title", async () => {
    const { sessionId } = await importCsv(csv);
    const queued = await getRowsForReview(userId, sessionId);
    const typo = queued.find((r) => r.title === "To Kill a Mockingbrd")!;

    expect(typo.candidates.length).toBeGreaterThan(0);
    expect(typo.candidates[0].workKey).toBe(WORKS.mockingbird.key);
  });

  it("offers nothing for a book that resembles nothing", async () => {
    // A wrong suggestion costs more attention than an empty list, and the row
    // is still queued either way — the reader can search for it by hand.
    const { sessionId } = await importCsv(csv);
    const queued = await getRowsForReview(userId, sessionId);
    const invented = queued.find((r) => r.title === "An Entirely Invented Book")!;

    expect(invented.candidates).toEqual([]);
  });

  it("never applies a fuzzy match on its own", async () => {
    // "To Kill a Mockingbrd" scores high enough to suggest, and is still not
    // shelved until someone says so. One edit apart can be a different book.
    const { sessionId } = await importCsv(csv);
    await getImportSession(userId, sessionId);

    const shelved = await prisma.shelfItem.findFirst({
      where: { workKey: WORKS.mockingbird.key, shelf: { userId } },
    });
    expect(shelved).toBeNull();
  });
});

describe("resolving a queued row", () => {
  const csv = [
    HEADER,
    `1,To Kill a Mockingbrd,Harper Lee,"","",5,Harper,281,1960,2024/02/10,2024/02/01,classics,read,"",1`,
  ].join("\n");

  it("applies the shelf and rating the row was carrying", async () => {
    const { sessionId } = await importCsv(csv);
    const [row] = await getRowsForReview(userId, sessionId);

    await confirmMatch(userId, row.id, WORKS.mockingbird.key);

    const shelved = await prisma.shelfItem.findFirst({
      where: { workKey: WORKS.mockingbird.key, shelf: { userId } },
      include: { shelf: true },
    });
    expect(shelved?.shelf.name).toBe("Read");

    const review = await prisma.review.findFirst({
      where: { userId, workKey: WORKS.mockingbird.key },
    });
    expect(review?.rating).toBe(5);
  });

  it("closes the session once nothing is waiting", async () => {
    const { sessionId } = await importCsv(csv);
    const [row] = await getRowsForReview(userId, sessionId);

    await confirmMatch(userId, row.id, WORKS.mockingbird.key);

    const summary = await getImportSession(userId, sessionId);
    expect(summary!.status).toBe("complete");
    expect(summary!.completedAt).not.toBeNull();
    expect(summary!.confirmed).toBe(1);
  });

  it("does not count a confirmation toward the match rate", async () => {
    // The rate measures how much of the file the catalog matched on its own,
    // which is a fact about catalog coverage and can be acted on. Folding in
    // confirmations would instead measure how patient the reader was, and
    // would climb to 100% for every import that someone bothered to finish.
    const { sessionId } = await importCsv(csv);
    const [row] = await getRowsForReview(userId, sessionId);
    expect((await getImportSession(userId, sessionId))!.matchRate).toBe(0);

    await confirmMatch(userId, row.id, WORKS.mockingbird.key);

    const summary = await getImportSession(userId, sessionId);
    expect(summary!.confirmed).toBe(1);
    expect(summary!.matchRate).toBe(0);
  });

  it("skipping leaves the row on record rather than deleting it", async () => {
    const { sessionId } = await importCsv(csv);
    const [row] = await getRowsForReview(userId, sessionId);

    await skipRow(userId, row.id);

    expect(await getRowsForReview(userId, sessionId)).toHaveLength(0);
    const summary = await getImportSession(userId, sessionId);
    expect(summary!.skipped).toBe(1);
    expect(summary!.status).toBe("complete");
  });

  it("rejects a work key that is not in the catalog", async () => {
    // There is no foreign key from app into catalog, so nothing else would
    // catch this — the row would store a key that renders as a blank card.
    const { sessionId } = await importCsv(csv);
    const [row] = await getRowsForReview(userId, sessionId);

    await expect(confirmMatch(userId, row.id, "OLNOTREALW")).rejects.toThrow(
      /not in the catalog/i
    );
  });

  it("will not let one reader resolve another reader's import", async () => {
    const { sessionId } = await importCsv(csv);
    const [row] = await getRowsForReview(userId, sessionId);
    const stranger = await makeUserWithShelves();

    await expect(
      confirmMatch(stranger.id, row.id, WORKS.mockingbird.key)
    ).rejects.toThrow(/not found/i);
    await expect(getRowsForReview(stranger.id, sessionId)).rejects.toThrow();
    expect(await getImportSession(stranger.id, sessionId)).toBeNull();
  });
});

/**
 * TEST-5: `findWorkKeyByTitleAuthor` escapes LIKE's own metacharacters, and
 * nothing tested it.
 *
 * The author is bound as a parameter, which stops SQL injection and does
 * nothing whatever about `%` and `_` — they are wildcards to LIKE regardless
 * of how the string arrived. All thirteen existing import tests use ordinary
 * names, so deleting the escape changed nothing in the suite.
 *
 * What makes it worth a test is which path it sits on. `imports.ts:153` feeds
 * this straight into applyRow and marks the row `matched`/`title_author` with
 * **no review step**, so a crafted row attaches itself to whichever work shares
 * its title and has the most editions — silently, and to the reader's own
 * shelves.
 *
 * `_` is the more interesting metacharacter of the two and the one a
 * `%`-only test would miss: it matches exactly one character, so an author of
 * "Frank Herber_" is a wildcard match for "Frank Herbert" while looking like
 * an ordinary typo.
 *
 * The last case is a control. Without it, every assertion here would still
 * pass if title-and-author matching stopped working altogether.
 */
describe("TEST-5: LIKE metacharacters in an imported author name", () => {
  const row = (id: number, title: string, author: string) =>
    [
      HEADER,
      `${id},${title},"${author}","","",5,Pub,300,1965,2024/03/15,2024/01/02,"",read,"",1`,
    ].join("\n");

  it("does not match every author when the name is a bare percent", async () => {
    const { sessionId } = await importCsv(row(1, "Dune", "%"));

    const summary = await getImportSession(userId, sessionId);
    // Unescaped, the predicate became `LIKE '%%%'` — true for every row — so
    // the author half of "exact title and author" was simply switched off.
    expect(summary!.matched).toBe(0);
    expect(summary!.needsReview).toBe(1);

    // And nothing reached the reader's shelves, which is the harm.
    expect(await prisma.shelfItem.count({ where: { userId } })).toBe(0);
    expect(await prisma.readingSession.count({ where: { userId } })).toBe(0);
  });

  it("does not treat an underscore as a single-character wildcard", async () => {
    const { sessionId } = await importCsv(row(2, "Dune", "Frank Herber_"));

    const summary = await getImportSession(userId, sessionId);
    expect(summary!.matched).toBe(0);
    expect(summary!.needsReview).toBe(1);
  });

  it("matches an author whose name really contains a backslash", async () => {
    // The backslash branch of the escape needs a case of its own, and the
    // obvious one does not work: a crafted `\_` cannot produce a false match,
    // because whatever the leftover backslash does to the character after it,
    // the pattern still demands a literal backslash that no ordinary name has.
    // Its actual effect is the opposite — a false NEGATIVE.
    //
    // Backslash is Postgres's default LIKE escape, so `\D` in a pattern means
    // a literal `D`: unescaped, `%AC\DC%` collapses to `%ACDC%` and stops
    // matching the very name it was built from. Escaped, `%AC\\DC%` matches.
    // Verified directly in Postgres before relying on it.
    await seedWork({
      key: "OLIMP005W",
      title: "Back In Black",
      author: "AC\\DC",
    });

    const { sessionId } = await importCsv(row(3, "Back In Black", "AC\\DC"));

    const summary = await getImportSession(userId, sessionId);
    expect(summary!.matched).toBe(1);
  });

  it("still matches the author it is actually given", async () => {
    const { sessionId } = await importCsv(row(4, "Dune", "Frank Herbert"));

    const summary = await getImportSession(userId, sessionId);
    expect(summary!.matched).toBe(1);
    expect(await prisma.readingSession.count({ where: { userId } })).toBe(1);
  });
});

describe("candidate scoring", () => {
  it("ranks the intended book first despite a typo", async () => {
    const candidates = await findCandidates("To Kill a Mockingbrd", "Harper Lee");
    expect(candidates[0]?.workKey).toBe(WORKS.mockingbird.key);
  });

  it("uses the author to break a tie between identical titles", async () => {
    // The decoy is deliberately stacked to win on every other term: the same
    // title, so title similarity ties exactly, and a key that sorts first so
    // it takes the final tiebreak too. The author is the only thing left that
    // can separate them, which is what makes this test discriminating —
    // dropping the author weight puts the decoy on top.
    await seedWork({
      key: "OLIMP000W",
      title: "The Hobbit",
      author: "Someone Else Entirely",
    });

    const candidates = await findCandidates("The Hobbit", "J.R.R. Tolkien");
    expect(candidates[0]?.workKey).toBe(WORKS.hobbit.key);
  });

  it("returns nothing rather than a bad guess", async () => {
    expect(await findCandidates("Zzzqqx Vvwwyy", "Nobody")).toEqual([]);
  });
});

/**
 * A row is only "matched" if something was actually applied.
 *
 * applyRow used to swallow all three of its steps and the caller wrote
 * `status: "matched"` regardless, so a row that shelved nothing counted toward
 * matchRate — the signal PRD section 6 names for "is import working?".
 *
 * The reachable case is not exotic: mapExclusiveShelf returns null for any
 * value outside Goodreads' three shelves, and a Goodreads export can carry
 * others.
 */
describe("a row that applies nothing is not reported as matched", () => {
  it("records failed, with a reason, when the export carries no usable shelf", async () => {
    const csv = [
      HEADER,
      `1,Dune,Frank Herbert,="0441172717",="9780441172719",5,Ace,412,1965,,2024/01/01,,,,1`,
    ].join("\n");

    const { sessionId } = await importCsv(csv);

    const row = await prisma.importRow.findFirst({ where: { sessionId } });
    expect(row?.workKey).toBe(WORKS.dune.key); // the match itself was right
    expect(row?.status).toBe("failed");
    expect(row?.error).toMatch(/shelf/i);

    // And nothing was shelved, which is the point.
    expect(
      await prisma.shelfItem.count({ where: { userId, workKey: WORKS.dune.key } })
    ).toBe(0);
  });

  it("keeps such a row out of matchRate", async () => {
    const csv = [
      HEADER,
      // One good row, one that matches but can shelve nothing.
      `1,Dune,Frank Herbert,="0441172717",="9780441172719",5,Ace,412,1965,,2024/01/01,,read,,1`,
      `2,The Hobbit,J.R.R. Tolkien,="0547928221",="9780547928227",4,HMH,300,1937,,2024/01/02,,,,1`,
    ].join("\n");

    const { sessionId } = await importCsv(csv);
    const summary = await getImportSession(userId, sessionId);

    expect(summary!.matched).toBe(1);
    expect(summary!.failed).toBe(1);
    // 1 of 2, not 2 of 2 — the number the old code reported.
    expect(summary!.matchRate).toBe(50);
  });

  it("still applies, and reports matched, when the shelf is usable", async () => {
    const csv = [
      HEADER,
      `1,Dune,Frank Herbert,="0441172717",="9780441172719",5,Ace,412,1965,2024/02/01,2024/01/01,,read,,1`,
    ].join("\n");

    const { sessionId } = await importCsv(csv);

    const row = await prisma.importRow.findFirst({ where: { sessionId } });
    expect(row?.status).toBe("matched");
    expect(row?.error).toBeNull();
    expect(
      await prisma.shelfItem.count({ where: { userId, workKey: WORKS.dune.key } })
    ).toBe(1);
  });
});

/**
 * FLOW-10: the reading dates the importer promises to import.
 *
 * `Date Read` was parsed, stored on the import row, and then used only as a
 * boolean — `if (row.dateRead && exclusiveShelf === "read")` — while
 * `finishReading` stamped `new Date()`. Every imported book was therefore
 * finished at the moment of import.
 *
 * The consequence is not local to the import: `getWrappedStats` selects finished
 * sessions between 1 January and 31 December of a year, so a 300-book export
 * spanning 2010-2024 made this year's /wrapped report 300 books read and every
 * earlier year report none. The settings page promises the opposite in as many
 * words: "Your books, ratings, shelves, and reading dates will be imported."
 */
describe("FLOW-10: imported books keep the date they were actually read", () => {
  const csv = [
    HEADER,
    `1,Dune,Frank Herbert,"=""0441172717""","=""9780441172719""",5,Ace,412,1965,2014/03/15,2024/01/02,sci-fi,read,"",1`,
    `2,The Great Gatsby,F. Scott Fitzgerald,"","",4,Scribner,180,1925,2019/11/02,2024/04/01,classics,read,"",1`,
  ].join("\n");

  it("stamps the CSV date, not the import time", async () => {
    await importCsv(csv);

    const sessions = await prisma.readingSession.findMany({
      where: { userId },
      orderBy: { finishedAt: "asc" },
      select: { workKey: true, startedAt: true, finishedAt: true },
    });

    expect(sessions).toHaveLength(2);

    // Absolute dates, not "before now": stamping the import time also satisfies
    // any inequality against now, which is how this survived.
    expect(sessions[0].finishedAt?.toISOString().slice(0, 10)).toBe("2014-03-15");
    expect(sessions[1].finishedAt?.toISOString().slice(0, 10)).toBe("2019-11-02");
  });

  it("dates the start from the same day, so ordering stays meaningful", async () => {
    await importCsv(csv);

    const sessions = await prisma.readingSession.findMany({
      where: { userId },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true },
    });

    // getLatestSessionForWork orders on startedAt. Left at `now`, a book read in
    // 2014 and imported today would sort ahead of one finished last week.
    expect(sessions[0].startedAt.toISOString().slice(0, 10)).toBe("2014-03-15");
    expect(sessions[1].startedAt.toISOString().slice(0, 10)).toBe("2019-11-02");
  });

  it("lands those books in the year they belong to, not this one", async () => {
    await importCsv(csv);

    const inThisYear = await prisma.readingSession.count({
      where: {
        userId,
        finishedAt: { gte: new Date(`${new Date().getFullYear()}-01-01`) },
      },
    });

    // The assertion that fails on the old code with `Received: 2`. This is the
    // /wrapped defect stated directly.
    expect(inThisYear).toBe(0);
  });

  it("still records a finish for a read row, and still skips one without a date", async () => {
    // The date must not become a silent gate on whether the finish happens.
    await importCsv(
      [
        HEADER,
        `1,Dune,Frank Herbert,"","",5,Ace,412,1965,2014/03/15,2024/01/02,sci-fi,read,"",1`,
        `2,The Hobbit,J.R.R. Tolkien,"","",0,Houghton,300,1937,,2024/06/01,fantasy,currently-reading,"",0`,
      ].join("\n")
    );

    const finished = await prisma.readingSession.count({
      where: { userId, finishedAt: { not: null } },
    });
    expect(finished).toBe(1);
  });
});

/**
 * DEAD-1: the ISBN stored has to be in the dialect the join uses.
 *
 * `app.import_rows.isbn13` is compared against `catalog.editions.isbn13`, which
 * the ingest guarantees is a validated 13-digit string. The importer stored
 * `row.isbn13 ?? row.isbn` exactly as it arrived, so an ISBN-10 was stored as a
 * second dialect and matched nothing — while `canonicalIsbn13`, whose docstring
 * states the rule, had no caller anywhere in src/. Separately the parser
 * discarded a hyphenated ISBN-13 outright, because it required bare digits after
 * stripping only Excel's `="…"` wrapper.
 *
 * Both fall through to fuzzy title/author or the review queue, which the
 * importer's own header calls out: "asking someone to confirm certain matches is
 * not review, it is data entry."
 */
describe("DEAD-1: ISBNs are stored in one dialect", () => {
  it("converts an ISBN-10 so it matches the catalog", async () => {
    // Dune's ISBN-10, with the ISBN13 column blank as older exports leave it.
    const csv = [
      HEADER,
      `1,Dune,Frank Herbert,"=""0441172717""","",5,Ace,412,1965,2024/03/15,2024/01/02,sci-fi,read,"",1`,
    ].join("\n");

    const { sessionId } = await importCsv(csv);
    const rows = await prisma.importRow.findMany({
      where: { sessionId },
      select: { isbn13: true },
    });

    // 0441172717 -> 9780441172719, which is the key WORKS.dune carries.
    expect(rows[0].isbn13).toBe("9780441172719");
  });

  it("keeps a hyphenated ISBN-13 instead of discarding it", async () => {
    const csv = [
      HEADER,
      `1,Dune,Frank Herbert,"","978-0-441-17271-9",5,Ace,412,1965,2024/03/15,2024/01/02,sci-fi,read,"",1`,
    ].join("\n");

    const { sessionId } = await importCsv(csv);
    const rows = await prisma.importRow.findMany({
      where: { sessionId },
      select: { isbn13: true, status: true },
    });

    expect(rows[0].isbn13).toBe("9780441172719");
    // And it matched on the ISBN rather than falling through.
    expect(rows[0].status).toBe("matched");
  });

  it("stores nothing rather than a value that can never join", async () => {
    // An ISBN-13 with a broken check digit is not an ISBN. Storing it would put
    // a row in the queue for a person to resolve by hand, for no reason.
    const csv = [
      HEADER,
      `1,Some Book,Some Author,"","9780441172718",0,Pub,100,2000,,2024/01/02,x,to-read,"",0`,
    ].join("\n");

    const { sessionId } = await importCsv(csv);
    const rows = await prisma.importRow.findMany({
      where: { sessionId },
      select: { isbn13: true },
    });

    expect(rows[0].isbn13).toBeNull();
  });
});
