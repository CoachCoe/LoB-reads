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
