import { prisma } from "./setup";
import { makeUser, makeWork, makeFictionalWorld } from "./factories";
import {
  getAllFictionalWorlds,
  getFictionalWorldById,
} from "@/server/fictional-worlds";
import { addWorkLocation } from "@/server/work-locations";

/**
 * The per-world book count on /map.
 *
 * It was read from `app.work_fictional_worlds` — a table with no write path
 * anywhere in the application, populated only by prisma/seed.ts. Readers who pin
 * a book to a world go through WorkLocationsSection, which writes
 * `app.work_locations` with `isFictional` and a `fictionalWorldId`. So outside a
 * dev database every world reported "0 books" however many were pinned to it.
 *
 * Audit SPEC-7, decision OQ-8: count the table readers actually write.
 */
describe("fictional world book counts", () => {
  const pin = async (
    workKey: string,
    worldId: string,
    userId: string,
    name: string
  ) =>
    addWorkLocation(workKey, userId, {
      name,
      type: "setting",
      isFictional: true,
      fictionalWorldId: worldId,
    });

  it("counts works pinned to the world", async () => {
    const user = await makeUser();
    const world = await makeFictionalWorld();
    const [a, b] = await Promise.all([makeWork(), makeWork()]);

    await pin(a.olKey, world.id, user.id, "Caladan");
    await pin(b.olKey, world.id, user.id, "Giedi Prime");

    expect((await getFictionalWorldById(world.id))?.workCount).toBe(2);
  });

  it("counts a work once however many places it has in that world", async () => {
    const user = await makeUser();
    const world = await makeFictionalWorld();
    const work = await makeWork();

    await pin(work.olKey, world.id, user.id, "Arrakeen");
    await pin(work.olKey, world.id, user.id, "Sietch Tabr");

    // "books", not "places".
    expect((await getFictionalWorldById(world.id))?.workCount).toBe(1);
  });

  it("reports zero for a world nothing is pinned to", async () => {
    const world = await makeFictionalWorld();
    expect((await getFictionalWorldById(world.id))?.workCount).toBe(0);
  });

  it("does not attribute one world's works to another", async () => {
    const user = await makeUser();
    const [mine, theirs] = await Promise.all([
      makeFictionalWorld(),
      makeFictionalWorld(),
    ]);
    const work = await makeWork();

    await pin(work.olKey, mine.id, user.id, "Somewhere");

    const worlds = await getAllFictionalWorlds();
    const byId = new Map(worlds.map((w) => [w.id, w.workCount]));

    expect(byId.get(mine.id)).toBe(1);
    expect(byId.get(theirs.id)).toBe(0);
  });

  it("survives the contributor deleting their account", async () => {
    // addedById is nullable with onDelete: SetNull — contributions outlive the
    // account. The count must not follow the account out.
    const user = await makeUser();
    const world = await makeFictionalWorld();
    const work = await makeWork();

    await pin(work.olKey, world.id, user.id, "Ix");
    await prisma.user.delete({ where: { id: user.id } });

    expect((await getFictionalWorldById(world.id))?.workCount).toBe(1);
  });
});
