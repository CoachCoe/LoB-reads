import { prisma } from "./setup";
import { makeUser, makeUserWithShelves, makeWork, makeShelf } from "./factories";
import { createOrUpdateReview } from "@/server/reviews";

/**
 * TEST-21: the two DELETE routes that decide authorization and had no test
 * exercising the route.
 *
 * `authorization.test.ts` covers both, but by calling `deleteReview(id,
 * stranger.id)` and `deleteShelf(id, stranger.id)` — supplying the actor id
 * itself. Neither route module was imported by any test in the repo (16 route
 * modules were; these two were not).
 *
 * That is the exact shape the testing skill names: "Three authorization holes
 * survived 534 tests because the tests called the server function and passed
 * the flag themselves instead of exercising the route."
 * `location-authorization.test.ts` was written to close it for the location
 * routes and says it exists "so the next route of this kind has an obvious
 * pattern to copy". These are the next routes; this is the copy.
 *
 * The mutation that survived: take the actor from the request rather than the
 * session — `deleteReview(reviewId, bodyUserId)` — and the direct-call tests
 * still pass while any signed-in reader can delete any review or any shelf.
 * That is what the "takes the actor from the session, not the request" case
 * below pins.
 *
 * Every case asserts STATE as well as status. A 403 returned after the delete
 * passes a status-only check, which is why the row count is checked each time.
 */

const mockSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: () => mockSession(),
}));

// Imported after the mock is registered.
import { DELETE as deleteReviewRoute } from "@/app/api/reviews/[reviewId]/route";
import { DELETE as deleteShelfRoute } from "@/app/api/shelves/[shelfId]/route";

const asUser = (id: string) => mockSession.mockResolvedValue({ user: { id } });
const anonymous = () => mockSession.mockResolvedValue(null);

const callDeleteReview = (reviewId: string) =>
  deleteReviewRoute(
    new Request(`http://localhost/api/reviews/${reviewId}`, {
      method: "DELETE",
      // A body naming another user, so a handler that trusted the request
      // instead of the session would have something to trust.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "someone-else" }),
    }) as never,
    { params: Promise.resolve({ reviewId }) } as never
  );

const callDeleteShelf = (shelfId: string) =>
  deleteShelfRoute(
    new Request(`http://localhost/api/shelves/${shelfId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "someone-else" }),
    }) as never,
    { params: Promise.resolve({ shelfId }) } as never
  );

beforeEach(() => mockSession.mockReset());

describe("DELETE /api/reviews/[reviewId]", () => {
  async function seedReview() {
    const owner = await makeUserWithShelves();
    const work = await makeWork({});
    const review = await createOrUpdateReview(owner.id, work.olKey, 4, "Mine.");
    return { owner, review };
  }

  it("refuses an anonymous caller and leaves the review", async () => {
    const { review } = await seedReview();
    anonymous();

    expect((await callDeleteReview(review.id)).status).toBe(401);
    expect(await prisma.review.count({ where: { id: review.id } })).toBe(1);
  });

  it("refuses a stranger with 403 and leaves the review", async () => {
    const { review } = await seedReview();
    const stranger = await makeUser();
    asUser(stranger.id);

    expect((await callDeleteReview(review.id)).status).toBe(403);
    // The state assertion is the one that matters: a 403 returned after the
    // delete satisfies the status alone.
    expect(await prisma.review.count({ where: { id: review.id } })).toBe(1);
  });

  it("lets the owner delete it", async () => {
    const { owner, review } = await seedReview();
    asUser(owner.id);

    expect((await callDeleteReview(review.id)).status).toBe(200);
    expect(await prisma.review.count({ where: { id: review.id } })).toBe(0);
  });

  it("takes the actor from the session, not from the request body", async () => {
    // Same call, same row, same body naming a different user; only the session
    // differs. This is the case that fails if the route ever trusts the
    // request, and the direct-call tests cannot express it.
    const { owner, review } = await seedReview();
    const stranger = await makeUser();

    asUser(stranger.id);
    expect((await callDeleteReview(review.id)).status).toBe(403);
    expect(await prisma.review.count({ where: { id: review.id } })).toBe(1);

    asUser(owner.id);
    expect((await callDeleteReview(review.id)).status).toBe(200);
    expect(await prisma.review.count({ where: { id: review.id } })).toBe(0);
  });

  it("404s a review that does not exist", async () => {
    const caller = await makeUser();
    asUser(caller.id);

    expect((await callDeleteReview("no-such-review")).status).toBe(404);
  });
});

describe("DELETE /api/shelves/[shelfId]", () => {
  it("refuses an anonymous caller and leaves the shelf", async () => {
    const owner = await makeUser();
    const shelf = await makeShelf(owner.id);
    anonymous();

    expect((await callDeleteShelf(shelf.id)).status).toBe(401);
    expect(await prisma.shelf.count({ where: { id: shelf.id } })).toBe(1);
  });

  it("refuses a stranger with 403 and leaves the shelf", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const shelf = await makeShelf(owner.id);
    asUser(stranger.id);

    expect((await callDeleteShelf(shelf.id)).status).toBe(403);
    expect(await prisma.shelf.count({ where: { id: shelf.id } })).toBe(1);
  });

  it("lets the owner delete it", async () => {
    const owner = await makeUser();
    const shelf = await makeShelf(owner.id);
    asUser(owner.id);

    expect((await callDeleteShelf(shelf.id)).status).toBe(200);
    expect(await prisma.shelf.count({ where: { id: shelf.id } })).toBe(0);
  });

  it("takes the actor from the session, not from the request body", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const shelf = await makeShelf(owner.id);

    asUser(stranger.id);
    expect((await callDeleteShelf(shelf.id)).status).toBe(403);
    expect(await prisma.shelf.count({ where: { id: shelf.id } })).toBe(1);

    asUser(owner.id);
    expect((await callDeleteShelf(shelf.id)).status).toBe(200);
    expect(await prisma.shelf.count({ where: { id: shelf.id } })).toBe(0);
  });

  it("refuses to delete a default shelf, and leaves it", async () => {
    // deleteShelf rejects an exclusive shelf with a ValidationError; asserted
    // through the route so the mapping to 400 is covered too.
    const owner = await makeUserWithShelves();
    const readShelf = await prisma.shelf.findFirstOrThrow({
      where: { userId: owner.id, isDefault: true },
    });
    asUser(owner.id);

    expect((await callDeleteShelf(readShelf.id)).status).toBe(400);
    expect(await prisma.shelf.count({ where: { id: readShelf.id } })).toBe(1);
  });

  it("404s a shelf that does not exist", async () => {
    const caller = await makeUser();
    asUser(caller.id);

    expect((await callDeleteShelf("no-such-shelf")).status).toBe(404);
  });
});
