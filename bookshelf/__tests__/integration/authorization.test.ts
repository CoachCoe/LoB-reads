import {
  deleteShelf,
  addWorkToShelf,
  removeWorkFromShelf,
  getShelfById,
} from "@/server/shelves";
import { deleteReview, createOrUpdateReview } from "@/server/reviews";
import { deleteWorkLocation } from "@/server/work-locations";
import { deleteAuthorLocation } from "@/server/authors";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { prisma } from "./setup";
import {
  makeUser,
  makeUserWithShelves,
  makeWork,
  makeShelf,
  makeWorkLocation,
  makeAuthorLocation,
} from "./factories";

/**
 * Every place the application decides that one user may not touch another
 * user's data. These were all fixed in response to the first audit and, until
 * now, were verified only by hand — delete the ownership check and nothing
 * failed.
 *
 * Each test asserts two things: that the wrong user is refused with the right
 * error type, and that the data is actually still there afterwards. A check
 * that throws but deletes anyway would pass the first assertion alone.
 */

describe("shelf ownership", () => {
  it("refuses to delete another user's shelf, and leaves it intact", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const shelf = await makeShelf(owner.id);

    await expect(deleteShelf(shelf.id, stranger.id)).rejects.toThrow(
      AuthorizationError
    );

    expect(await prisma.shelf.findUnique({ where: { id: shelf.id } })).not.toBeNull();
  });

  it("reports a missing shelf as not-found, not as forbidden", async () => {
    const user = await makeUser();
    await expect(deleteShelf("does-not-exist", user.id)).rejects.toThrow(
      NotFoundError
    );
  });

  it("refuses to delete a default shelf even for its owner", async () => {
    const owner = await makeUserWithShelves();
    const readShelf = owner.shelves.find((s) => s.name === "Read")!;

    await expect(deleteShelf(readShelf.id, owner.id)).rejects.toThrow(
      ValidationError
    );
    expect(
      await prisma.shelf.findUnique({ where: { id: readShelf.id } })
    ).not.toBeNull();
  });

  it("lets the owner delete their own custom shelf", async () => {
    const owner = await makeUser();
    const shelf = await makeShelf(owner.id);

    await deleteShelf(shelf.id, owner.id);

    expect(await prisma.shelf.findUnique({ where: { id: shelf.id } })).toBeNull();
  });

  it("refuses to add a book to another user's shelf", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const shelf = await makeShelf(owner.id);
    const work = await makeWork();

    await expect(addWorkToShelf(shelf.id, work.olKey, stranger.id)).rejects.toThrow(
      AuthorizationError
    );

    expect(await prisma.shelfItem.count({ where: { shelfId: shelf.id } })).toBe(0);
  });

  it("refuses to remove a book from another user's shelf", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const shelf = await makeShelf(owner.id);
    const work = await makeWork();
    await addWorkToShelf(shelf.id, work.olKey, owner.id);

    await expect(
      removeWorkFromShelf(shelf.id, work.olKey, stranger.id)
    ).rejects.toThrow(AuthorizationError);

    expect(await prisma.shelfItem.count({ where: { shelfId: shelf.id } })).toBe(1);
  });
});

describe("shelves are public to read", () => {
  it("returns another user's shelf with owner attribution and no email", async () => {
    const owner = await makeUser({ name: "Alice" });
    const shelf = await makeShelf(owner.id, { name: "Favourites" });

    // Deliberately no viewer argument: reads are unauthenticated by design.
    const result = await getShelfById(shelf.id);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("Favourites");
    expect(result!.user.name).toBe("Alice");
    expect(JSON.stringify(result)).not.toContain("@example.com");
    expect(JSON.stringify(result)).not.toContain("passwordHash");
  });
});

describe("review ownership", () => {
  it("refuses to delete another user's review, and leaves it intact", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const work = await makeWork();
    const review = await createOrUpdateReview(owner.id, work.olKey, 4, "Good");

    await expect(deleteReview(review.id, stranger.id)).rejects.toThrow(
      AuthorizationError
    );

    expect(await prisma.review.findUnique({ where: { id: review.id } })).not.toBeNull();
  });

  it("lets the owner delete their own review", async () => {
    const owner = await makeUser();
    const work = await makeWork();
    const review = await createOrUpdateReview(owner.id, work.olKey, 4);

    await deleteReview(review.id, owner.id);

    expect(await prisma.review.findUnique({ where: { id: review.id } })).toBeNull();
  });
});

describe("crowdsourced location ownership", () => {
  it("refuses to delete a book location contributed by someone else", async () => {
    const contributor = await makeUser();
    const stranger = await makeUser();
    const work = await makeWork();
    const location = await makeWorkLocation(work.olKey, contributor.id);

    await expect(deleteWorkLocation(location.id, stranger.id)).rejects.toThrow(
      AuthorizationError
    );

    expect(
      await prisma.workLocation.findUnique({ where: { id: location.id } })
    ).not.toBeNull();
  });

  it("refuses to delete an author location contributed by someone else", async () => {
    const contributor = await makeUser();
    const stranger = await makeUser();
    const { location } = await makeAuthorLocation(contributor.id);

    await expect(deleteAuthorLocation(location.id, stranger.id)).rejects.toThrow(
      AuthorizationError
    );

    expect(
      await prisma.authorLocation.findUnique({ where: { id: location.id } })
    ).not.toBeNull();
  });

  it("lets the contributor remove their own location", async () => {
    const contributor = await makeUser();
    const work = await makeWork();
    const location = await makeWorkLocation(work.olKey, contributor.id);

    await deleteWorkLocation(location.id, contributor.id);

    expect(
      await prisma.workLocation.findUnique({ where: { id: location.id } })
    ).toBeNull();
  });

  it("distinguishes a missing location from someone else's", async () => {
    const user = await makeUser();
    await expect(deleteWorkLocation("no-such-id", user.id)).rejects.toThrow(
      NotFoundError
    );
  });
});
