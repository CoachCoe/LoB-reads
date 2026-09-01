import { prisma } from "./setup";
import { addWorkToShelf, getWorkShelfStatus } from "@/server/shelves";
import { makeUserWithShelves, makeShelf, makeWork } from "./factories";

/**
 * M3 acceptance: the exclusive-shelf constraint holds under concurrent writes.
 *
 * A work sits on at most one of the three exclusive shelves per user — it
 * cannot be both "Currently Reading" and "Read". The application enforces this
 * cooperatively by deleting from the others before inserting, which is correct
 * and entirely insufficient: two simultaneous requests each read a state where
 * the other's row does not exist yet, and both insert.
 *
 * So the rule is also enforced by a partial unique index. These tests are
 * about that second line of defence, because the first one cannot hold on its
 * own and it is tempting to believe it does.
 */

const shelfNamed = (
  user: Awaited<ReturnType<typeof makeUserWithShelves>>,
  name: string
) => user.shelves.find((s) => s.name === name)!.id;

describe("exclusive shelves, sequentially", () => {
  it("moves a work between exclusive shelves rather than duplicating it", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork();

    await addWorkToShelf(shelfNamed(user, "Want to Read"), work.olKey, user.id);
    await addWorkToShelf(shelfNamed(user, "Currently Reading"), work.olKey, user.id);
    await addWorkToShelf(shelfNamed(user, "Read"), work.olKey, user.id);

    const status = await getWorkShelfStatus(user.id, work.olKey);
    expect(status).toHaveLength(1);
    expect(status[0].shelfName).toBe("Read");
  });

  it("allows a custom shelf alongside an exclusive one", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork();
    const favourites = await makeShelf(user.id, { name: "Favourites" });

    await addWorkToShelf(shelfNamed(user, "Read"), work.olKey, user.id);
    await addWorkToShelf(favourites.id, work.olKey, user.id);

    const names = (await getWorkShelfStatus(user.id, work.olKey))
      .map((s) => s.shelfName)
      .sort();
    expect(names).toEqual(["Favourites", "Read"]);
  });

  it("keeps users independent", async () => {
    const [a, b] = await Promise.all([
      makeUserWithShelves(),
      makeUserWithShelves(),
    ]);
    const work = await makeWork();

    await addWorkToShelf(shelfNamed(a, "Read"), work.olKey, a.id);
    await addWorkToShelf(shelfNamed(b, "Currently Reading"), work.olKey, b.id);

    expect(await getWorkShelfStatus(a.id, work.olKey)).toHaveLength(1);
    expect(await getWorkShelfStatus(b.id, work.olKey)).toHaveLength(1);
  });
});

describe("exclusive shelves, concurrently", () => {
  it("survives three simultaneous writes to different exclusive shelves", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork();

    // The interleaving that defeats the application-level check: each request
    // reads a world in which the others have not inserted yet.
    const results = await Promise.allSettled([
      addWorkToShelf(shelfNamed(user, "Want to Read"), work.olKey, user.id),
      addWorkToShelf(shelfNamed(user, "Currently Reading"), work.olKey, user.id),
      addWorkToShelf(shelfNamed(user, "Read"), work.olKey, user.id),
    ]);

    // Some will lose the race. What matters is the state they leave behind.
    const status = await getWorkShelfStatus(user.id, work.olKey);
    expect(status).toHaveLength(1);

    // And at least one must have succeeded — a constraint that rejects
    // everything would also satisfy the assertion above.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("holds under repeated racing, not just once", async () => {
    // A race that passes once may simply not have interleaved. Ten rounds with
    // a fresh work each makes a false pass much less likely.
    for (let round = 0; round < 10; round++) {
      const user = await makeUserWithShelves();
      const work = await makeWork();

      await Promise.allSettled([
        addWorkToShelf(shelfNamed(user, "Want to Read"), work.olKey, user.id),
        addWorkToShelf(shelfNamed(user, "Read"), work.olKey, user.id),
      ]);

      const status = await getWorkShelfStatus(user.id, work.olKey);
      expect(status).toHaveLength(1);
    }
  }, 60_000);

  it("rejects a duplicate exclusive row inserted behind the application's back", async () => {
    // Bypassing addWorkToShelf entirely, as a second process would.
    const user = await makeUserWithShelves();
    const work = await makeWork();

    await addWorkToShelf(shelfNamed(user, "Read"), work.olKey, user.id);

    await expect(
      prisma.shelfItem.create({
        data: {
          shelfId: shelfNamed(user, "Currently Reading"),
          workKey: work.olKey,
          userId: user.id,
        },
      })
    ).rejects.toThrow();

    expect(await getWorkShelfStatus(user.id, work.olKey)).toHaveLength(1);
  });

  it("keeps concurrent writes for different users apart", async () => {
    const users = await Promise.all(
      Array.from({ length: 5 }, () => makeUserWithShelves())
    );
    const work = await makeWork();

    await Promise.all(
      users.map((user) =>
        addWorkToShelf(shelfNamed(user, "Read"), work.olKey, user.id)
      )
    );

    for (const user of users) {
      expect(await getWorkShelfStatus(user.id, work.olKey)).toHaveLength(1);
    }
  });
});

describe("the denormalized flag the constraint depends on", () => {
  it("is derived from the shelf, not from what the caller passes", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork();
    const custom = await makeShelf(user.id, { name: "Custom" });

    // Deliberately claim exclusivity on a non-exclusive shelf. The trigger
    // overwrites it — without that, the constraint could be sidestepped by
    // lying about the flag.
    await prisma.shelfItem.create({
      data: {
        shelfId: custom.id,
        workKey: work.olKey,
        userId: user.id,
        isExclusive: true,
      },
    });

    const row = await prisma.shelfItem.findFirst({
      where: { shelfId: custom.id, workKey: work.olKey },
    });
    expect(row!.isExclusive).toBe(false);
  });

  it("follows a shelf that later becomes exclusive", async () => {
    const user = await makeUserWithShelves();
    const work = await makeWork();
    const custom = await makeShelf(user.id, { name: "Later Exclusive" });

    await addWorkToShelf(custom.id, work.olKey, user.id);
    expect(
      (await prisma.shelfItem.findFirst({ where: { shelfId: custom.id } }))!
        .isExclusive
    ).toBe(false);

    await prisma.shelf.update({
      where: { id: custom.id },
      data: { isDefault: true },
    });

    expect(
      (await prisma.shelfItem.findFirst({ where: { shelfId: custom.id } }))!
        .isExclusive
    ).toBe(true);
  });
});
