import { prisma } from "./setup";
import { makeUser, makeUserWithShelves, makeWork, makeShelf } from "./factories";
import { __resetRateLimits, LIMITS } from "@/lib/rate-limit";

/**
 * SEC-6: three write paths that created rows with no rate limit.
 *
 * The contribution routes feeding the public `/map` were given
 * `LIMITS.contribute` in an earlier round. These three were not in that
 * inventory, and each grows an `app` table without bound from one signed-in
 * account: shelves per user has no cap, shelf items can hold a row for each of
 * 6.9M catalog keys, and follows inflate a follower count on a public profile.
 *
 * Written the way `delete-route-authorization.test.ts` says to: through the
 * ROUTE, not the server function, and asserting STATE as well as status — a
 * 429 returned after the write passes a status-only check.
 */

const mockSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: () => mockSession(),
}));

import { POST as createShelf } from "@/app/api/shelves/route";
import { POST as addWorkToShelf } from "@/app/api/shelves/[shelfId]/works/route";
import { POST as follow } from "@/app/api/users/[userId]/follow/route";

beforeEach(() => {
  __resetRateLimits();
  mockSession.mockReset();
});

const json = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** One past the budget, so the last call is the one that must be refused. */
const overBudget = LIMITS.contribute.limit + 1;

describe("POST /api/shelves", () => {
  it("refuses past the contribution budget, and creates nothing when it does", async () => {
    const user = await makeUser();
    mockSession.mockResolvedValue({ user: { id: user.id } });

    const statuses: number[] = [];
    for (let i = 0; i < overBudget; i++) {
      const response = await createShelf(
        json("http://localhost/api/shelves", { name: `Shelf ${i}` })
      );
      statuses.push(response.status);
    }

    expect(statuses.filter((s) => s === 201)).toHaveLength(LIMITS.contribute.limit);
    expect(statuses[statuses.length - 1]).toBe(429);

    // State: the refused call wrote nothing.
    expect(await prisma.shelf.count({ where: { userId: user.id } })).toBe(
      LIMITS.contribute.limit
    );
  });

  it("sets Retry-After to the seconds the limiter reported", async () => {
    const user = await makeUser();
    mockSession.mockResolvedValue({ user: { id: user.id } });

    for (let i = 0; i < LIMITS.contribute.limit; i++) {
      await createShelf(json("http://localhost/api/shelves", { name: `S${i}` }));
    }
    const refused = await createShelf(
      json("http://localhost/api/shelves", { name: "one too many" })
    );

    expect(refused.status).toBe(429);
    // A concrete window, not "truthy" — TEST-18 was an assertion that any
    // constant satisfied. The budget was spent just now, so the whole window
    // is still ahead, give or take the second this test took.
    const retryAfter = Number(refused.headers.get("Retry-After"));
    const windowSeconds = LIMITS.contribute.windowMs / 1000;
    expect(retryAfter).toBeGreaterThan(windowSeconds - 10);
    expect(retryAfter).toBeLessThanOrEqual(windowSeconds);
  });

  it("does not spend the budget on a request that wrote nothing", async () => {
    const user = await makeUser();
    mockSession.mockResolvedValue({ user: { id: user.id } });

    // The schema rejects an empty name, so nothing is created and the hit is
    // refunded. Without the refund a reader who mistypes is locked out.
    for (let i = 0; i < overBudget; i++) {
      const response = await createShelf(
        json("http://localhost/api/shelves", { name: "" })
      );
      expect(response.status).not.toBe(429);
    }

    const accepted = await createShelf(
      json("http://localhost/api/shelves", { name: "a real shelf" })
    );
    expect(accepted.status).toBe(201);
  });
});

describe("POST /api/shelves/[shelfId]/works", () => {
  it("refuses past the contribution budget, and shelves nothing when it does", async () => {
    const user = await makeUserWithShelves();
    const shelf = await makeShelf(user.id, { name: "Target" });
    mockSession.mockResolvedValue({ user: { id: user.id } });

    // Distinct works, so the cap is what stops it rather than a unique
    // constraint on (shelfId, workKey).
    const works = [];
    for (let i = 0; i < overBudget; i++) {
      works.push(await makeWork({ title: `OLT Budget ${i}` }));
    }

    const statuses: number[] = [];
    for (const work of works) {
      const response = await addWorkToShelf(
        json(`http://localhost/api/shelves/${shelf.id}/works`, {
          workKey: work.olKey,
        }),
        { params: Promise.resolve({ shelfId: shelf.id }) }
      );
      statuses.push(response.status);
    }

    expect(statuses[statuses.length - 1]).toBe(429);
    expect(await prisma.shelfItem.count({ where: { shelfId: shelf.id } })).toBe(
      LIMITS.contribute.limit
    );
  });
});

describe("POST /api/users/[userId]/follow", () => {
  it("refuses past the contribution budget, and follows nobody when it does", async () => {
    const follower = await makeUser();
    mockSession.mockResolvedValue({ user: { id: follower.id } });

    const targets = [];
    for (let i = 0; i < overBudget; i++) targets.push(await makeUser());

    const statuses: number[] = [];
    for (const target of targets) {
      const response = await follow(
        new Request(`http://localhost/api/users/${target.id}/follow`, {
          method: "POST",
        }),
        { params: Promise.resolve({ userId: target.id }) }
      );
      statuses.push(response.status);
    }

    expect(statuses[statuses.length - 1]).toBe(429);
    expect(
      await prisma.follow.count({ where: { followerId: follower.id } })
    ).toBe(LIMITS.contribute.limit);
  });
});
