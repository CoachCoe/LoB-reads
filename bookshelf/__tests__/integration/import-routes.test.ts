import { prisma } from "./setup";
import { makeUserWithShelves } from "./factories";

/**
 * The import endpoints, exercised through the route handlers.
 *
 * The server layer is covered by goodreads-import.test.ts. This covers what
 * that cannot: the HTTP boundary. A green suite and a green build have already
 * missed a 500 in this project once — a `bigint` column that no test read but
 * `JSON.stringify` refused to serialize — so the response is parsed here
 * rather than merely inspected for a status code.
 *
 * Only the session is mocked. There is no browser to hold a cookie; everything
 * else, including the database, is real.
 */

const mockGetCurrentUser = jest.fn();
jest.mock("@/lib/auth/session", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

// Imported after the mock is registered.
import { POST as importPost } from "@/app/api/import/goodreads/route";
import { POST as confirmPost } from "@/app/api/import/rows/[rowId]/confirm/route";
import { POST as skipPost } from "@/app/api/import/rows/[rowId]/skip/route";

const HEADER =
  "Book Id,Title,Author,ISBN,ISBN13,My Rating,Publisher,Number of Pages," +
  "Year Published,Date Read,Date Added,Bookshelves,Exclusive Shelf,My Review,Read Count";

const CSV = [
  HEADER,
  `1,Dune,Frank Herbert,"","=""9780441172719""",5,Ace,412,1965,2024/03/15,2024/01/02,sci-fi,read,"",1`,
  `2,To Kill a Mockingbrd,Harper Lee,"","",4,Harper,281,1960,2024/02/10,2024/02/01,classics,read,"",1`,
].join("\n");

const WORK_KEY = "OLROUTE01W";

function uploadRequest(csv: string, filename = "export.csv") {
  const form = new FormData();
  form.append("file", new File([csv], filename, { type: "text/csv" }));
  return new Request("http://localhost/api/import/goodreads", {
    method: "POST",
    body: form,
  }) as never;
}

const rowParams = (rowId: string) => ({ params: Promise.resolve({ rowId }) });

const jsonRequest = (body: unknown) =>
  new Request("http://localhost/api/import/rows/x/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

let userId: string;

beforeAll(async () => {
  await prisma.$executeRaw`
    INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
    VALUES (${WORK_KEY}, 'To Kill a Mockingbird', 'Harper Lee', ARRAY['Fiction'], 1)
    ON CONFLICT (ol_key) DO NOTHING`;
  await prisma.$executeRaw`
    INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
    VALUES ('OLROUTE02W', 'Dune', 'Frank Herbert', ARRAY['Fiction'], 1)
    ON CONFLICT (ol_key) DO NOTHING`;
  await prisma.$executeRaw`
    INSERT INTO catalog.editions (ol_key, work_key, title, isbn13, number_of_pages)
    VALUES ('OLROUTE02E', 'OLROUTE02W', 'Dune', '9780441172719', 412)
    ON CONFLICT (ol_key) DO NOTHING`;
}, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DELETE FROM catalog.works WHERE ol_key LIKE 'OLROUTE%'`
  );
});

beforeEach(async () => {
  jest.clearAllMocks();
  const user = await makeUserWithShelves();
  userId = user.id;
  mockGetCurrentUser.mockResolvedValue({ id: userId });
});

describe("POST /api/import/goodreads", () => {
  it("returns a serializable session summary", async () => {
    const response = await importPost(uploadRequest(CSV));
    expect(response.status).toBe(200);

    // Parsing is the assertion. A non-serializable field throws here.
    const body = await response.json();

    expect(typeof body.sessionId).toBe("string");
    expect(body.summary.totalRows).toBe(2);
    expect(body.summary.matched).toBe(1);
    expect(body.summary.needsReview).toBe(1);
    expect(body.summary.matchRate).toBe(50);
    expect(body.notProcessed).toBe(0);
  });

  it("refuses an unauthenticated upload", async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const response = await importPost(uploadRequest(CSV));
    expect(response.status).toBe(401);
  });

  it("rejects a file that is not a CSV", async () => {
    const response = await importPost(uploadRequest(CSV, "library.xlsx"));
    expect(response.status).toBe(400);
  });

  it("explains a CSV that is missing required columns", async () => {
    const response = await importPost(uploadRequest("Nonsense,Columns\n1,2"));
    expect(response.status).toBe(400);
    const body = await response.json();
    // The message names the column, which is what makes it actionable.
    expect(body.error).toMatch(/title/i);
  });
});

describe("POST /api/import/rows/[rowId]/confirm", () => {
  async function queuedRowId(): Promise<string> {
    await importPost(uploadRequest(CSV));
    const row = await prisma.importRow.findFirstOrThrow({
      where: { status: "needs_review", session: { userId } },
    });
    return row.id;
  }

  it("applies the match", async () => {
    const rowId = await queuedRowId();

    const response = await confirmPost(jsonRequest({ workKey: WORK_KEY }), rowParams(rowId));
    expect(response.status).toBe(200);

    const shelved = await prisma.shelfItem.findFirst({
      where: { workKey: WORK_KEY, shelf: { userId } },
    });
    expect(shelved).not.toBeNull();
  });

  it("rejects a malformed work key before it reaches the database", async () => {
    const rowId = await queuedRowId();
    const response = await confirmPost(jsonRequest({ workKey: "../../etc" }), rowParams(rowId));
    expect(response.status).toBe(400);
  });

  it("returns 404 for another reader's row rather than confirming it", async () => {
    // Not 403: forbidden would confirm the row exists, which is exactly what a
    // probe wants to learn. Matches how a session lookup behaves.
    const rowId = await queuedRowId();
    const stranger = await makeUserWithShelves();
    mockGetCurrentUser.mockResolvedValue({ id: stranger.id });

    const response = await confirmPost(jsonRequest({ workKey: WORK_KEY }), rowParams(rowId));
    expect(response.status).toBe(404);

    const shelved = await prisma.shelfItem.findFirst({
      where: { workKey: WORK_KEY, shelf: { userId: stranger.id } },
    });
    expect(shelved).toBeNull();
  });

  it("does not leak database detail when the work is unknown", async () => {
    const rowId = await queuedRowId();
    const response = await confirmPost(jsonRequest({ workKey: "OLNOPEW" }), rowParams(rowId));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).not.toMatch(/prisma|constraint|column|relation/i);
  });
});

describe("POST /api/import/rows/[rowId]/skip", () => {
  it("clears the row from the queue", async () => {
    await importPost(uploadRequest(CSV));
    const row = await prisma.importRow.findFirstOrThrow({
      where: { status: "needs_review", session: { userId } },
    });

    const response = await skipPost(new Request("http://localhost") as never, rowParams(row.id));
    expect(response.status).toBe(200);

    const after = await prisma.importRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("skipped");
  });

  it("refuses an unauthenticated skip", async () => {
    await importPost(uploadRequest(CSV));
    const row = await prisma.importRow.findFirstOrThrow({
      where: { status: "needs_review", session: { userId } },
    });

    mockGetCurrentUser.mockResolvedValue(null);
    const response = await skipPost(new Request("http://localhost") as never, rowParams(row.id));
    expect(response.status).toBe(401);
  });
});
