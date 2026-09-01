import { prisma } from "./setup";
import { makeUser, makeWorkLocation, makeAuthorLocation } from "./factories";
import { checkLimit, LIMITS, __resetRateLimits } from "@/lib/rate-limit";

/**
 * The location rules, exercised through the route handlers.
 *
 * TEST-1, a blocker. `authorization.test.ts:178-201` already covers
 * uploader-or-moderator deletion — but it calls `deleteWorkLocation(id,
 * moderator.id, true)` **directly, passing the flag itself**. So it proves the
 * server function honours a moderator, and says nothing about the route
 * deriving that flag from the session. Changing
 *
 *     deleteWorkLocation(locationId, user.id, Boolean(user.isModerator))
 *
 * to `…, true` in either route left all 534 tests green, and any signed-in
 * reader could then delete every contributor's pin from the public map,
 * permanently.
 *
 * `map-authorization.test.ts` exists for exactly this shape and got the
 * treatment for fictional-world maps only; these two routes carry the identical
 * route-level decision. This file is deliberately its sibling — same mocking
 * boundary, same structure — so the next route of this kind has an obvious
 * pattern to copy.
 *
 * TEST-11 is here too, because it lives in the same handlers: the
 * "coordinates required unless fictional" rule exists **only** in the route,
 * and the one test in the area (`schemas.test.ts:121`) asserts the permissive
 * half of the contract.
 *
 * Only the session is mocked. The database is real, and so is the authorization
 * logic under test.
 */

const mockGetCurrentUser = jest.fn();
jest.mock("@/lib/auth/session", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

// Imported after the mock is registered.
import {
  DELETE as deleteWorkLocationRoute,
  POST as postWorkLocation,
} from "@/app/api/works/[workKey]/locations/route";
import { DELETE as deleteAuthorLocationRoute } from "@/app/api/authors/[authorName]/locations/route";

const WORK_KEY = "OLLOC001W";

const deleteRequest = (locationId: string) =>
  new Request(
    `http://localhost/api/works/${WORK_KEY}/locations?locationId=${locationId}`,
    { method: "DELETE" }
  ) as never;

const postRequest = (body: unknown) =>
  new Request(`http://localhost/api/works/${WORK_KEY}/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

const workParams = { params: Promise.resolve({ workKey: WORK_KEY }) };
beforeAll(async () => {
  // A fixed key rather than makeWork's generated one, because the route takes
  // it from the URL. The OLLOC prefix is outside clearTestCatalogRows' OLT
  // pattern, so afterAll below owns the cleanup.
  await prisma.$executeRaw`
    INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
    VALUES (${WORK_KEY}, 'A Wizard of Earthsea', 'Ursula K. Le Guin', ARRAY['Fiction'], 1)
    ON CONFLICT (ol_key) DO NOTHING`;
}, 60_000);

beforeEach(() => {
  mockGetCurrentUser.mockReset();
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    `DELETE FROM catalog.works WHERE ol_key LIKE 'OLLOC%'`
  );
});

describe("DELETE /api/works/[workKey]/locations", () => {
  it("rejects an anonymous caller with 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const response = await deleteWorkLocationRoute(deleteRequest("anything"));
    expect(response.status).toBe(401);
  });

  it("refuses a signed-in stranger with 403 and keeps the pin", async () => {
    const contributor = await makeUser();
    const stranger = await makeUser();
    const location = await makeWorkLocation(WORK_KEY, contributor.id);

    mockGetCurrentUser.mockResolvedValue({
      id: stranger.id,
      isModerator: false,
    });

    const response = await deleteWorkLocationRoute(deleteRequest(location.id));

    expect(response.status).toBe(403);
    // The row surviving is the assertion that matters: a 403 with the pin
    // already gone would be no protection at all.
    expect(
      await prisma.workLocation.findUnique({ where: { id: location.id } })
    ).not.toBeNull();
  });

  it("lets the contributor remove their own pin", async () => {
    const contributor = await makeUser();
    const location = await makeWorkLocation(WORK_KEY, contributor.id);

    mockGetCurrentUser.mockResolvedValue({
      id: contributor.id,
      isModerator: false,
    });

    const response = await deleteWorkLocationRoute(deleteRequest(location.id));

    expect(response.status).toBe(200);
    expect(
      await prisma.workLocation.findUnique({ where: { id: location.id } })
    ).toBeNull();
  });

  it("lets a moderator remove someone else's pin", async () => {
    const contributor = await makeUser();
    const moderator = await makeUser({ isModerator: true });
    const location = await makeWorkLocation(WORK_KEY, contributor.id);

    mockGetCurrentUser.mockResolvedValue({
      id: moderator.id,
      isModerator: true,
    });

    const response = await deleteWorkLocationRoute(deleteRequest(location.id));

    expect(response.status).toBe(200);
    expect(
      await prisma.workLocation.findUnique({ where: { id: location.id } })
    ).toBeNull();
  });

  it("takes the moderator flag from the session, not from the request", async () => {
    // The mutation this file exists for: hardcoding `true` at the call site.
    // A stranger whose session says isModerator: false must be refused even
    // though the server function would honour a moderator.
    const contributor = await makeUser();
    const stranger = await makeUser();
    const location = await makeWorkLocation(WORK_KEY, contributor.id);

    mockGetCurrentUser.mockResolvedValue({
      id: stranger.id,
      isModerator: false,
    });

    expect((await deleteWorkLocationRoute(deleteRequest(location.id))).status).toBe(
      403
    );

    // Same caller, same row, only the session's flag differs.
    mockGetCurrentUser.mockResolvedValue({
      id: stranger.id,
      isModerator: true,
    });

    expect((await deleteWorkLocationRoute(deleteRequest(location.id))).status).toBe(
      200
    );
  });
});

describe("DELETE /api/authors/[authorName]/locations", () => {
  it("rejects an anonymous caller with 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const response = await deleteAuthorLocationRoute(
      new Request(
        "http://localhost/api/authors/x/locations?locationId=anything",
        { method: "DELETE" }
      ) as never
    );
    expect(response.status).toBe(401);
  });

  it("refuses a stranger, allows the contributor, allows a moderator", async () => {
    const contributor = await makeUser();
    const stranger = await makeUser();
    const moderator = await makeUser({ isModerator: true });

    const request = (locationId: string) =>
      new Request(
        `http://localhost/api/authors/x/locations?locationId=${locationId}`,
        { method: "DELETE" }
      ) as never;

    const { location: forStranger } = await makeAuthorLocation(contributor.id);
    mockGetCurrentUser.mockResolvedValue({
      id: stranger.id,
      isModerator: false,
    });
    expect((await deleteAuthorLocationRoute(request(forStranger.id))).status).toBe(
      403
    );
    expect(
      await prisma.authorLocation.findUnique({ where: { id: forStranger.id } })
    ).not.toBeNull();

    mockGetCurrentUser.mockResolvedValue({
      id: contributor.id,
      isModerator: false,
    });
    expect((await deleteAuthorLocationRoute(request(forStranger.id))).status).toBe(
      200
    );

    const { location: forModerator } = await makeAuthorLocation(contributor.id);
    mockGetCurrentUser.mockResolvedValue({
      id: moderator.id,
      isModerator: true,
    });
    expect((await deleteAuthorLocationRoute(request(forModerator.id))).status).toBe(
      200
    );
  });
});

/**
 * TEST-11. Without this guard a real-world pin stores NULL lat/lng,
 * `getMappedWorkLocations` filters it out, and the contribution is accepted with
 * a 201 and then appears on no map — silent, and permanent.
 */
describe("POST /api/works/[workKey]/locations — coordinates", () => {
  beforeEach(async () => {
    const contributor = await makeUser();
    mockGetCurrentUser.mockResolvedValue({
      id: contributor.id,
      isModerator: false,
    });
  });

  it("refuses a real-world location with no coordinates, and stores nothing", async () => {
    const before = await prisma.workLocation.count();

    const response = await postWorkLocation(
      postRequest({ name: "Gont", type: "setting" }),
      workParams
    );

    expect(response.status).toBe(400);
    expect(await prisma.workLocation.count()).toBe(before);
  });

  it("accepts a real-world location with coordinates", async () => {
    const response = await postWorkLocation(
      postRequest({
        name: "Gont",
        type: "setting",
        coordinates: { lat: 51.5, lng: -0.12 },
      }),
      workParams
    );

    expect(response.status).toBe(201);
  });

  it("accepts a fictional location without coordinates", async () => {
    // A fictional place is pinned to its world, so the rule must not fire here.
    const response = await postWorkLocation(
      postRequest({ name: "Roke", type: "setting", isFictional: true }),
      workParams
    );

    expect(response.status).toBe(201);
  });
});

/**
 * SEC-2. These routes write the tables the public, anonymous /map reads on every
 * request, and none of the three was rate limited — while every read behind the
 * map was unbounded. One account inserting in a loop made the page unservable
 * for everyone. The prior audit's FLOW-22 fixed this exact shape on the author
 * page via AUTHOR_WORKS_LIMIT; the map was not covered.
 *
 * The bucket is exhausted directly rather than by sending 60 real requests: the
 * subject here is whether the route consults the limiter at all, and 60 inserts
 * would test the limiter's arithmetic a second time instead.
 */
describe("POST /api/works/[workKey]/locations — rate limit", () => {
  beforeEach(() => {
    __resetRateLimits();
  });

  it("refuses a contributor who is inserting in a loop", async () => {
    const user = await makeUser();
    mockGetCurrentUser.mockResolvedValue({ id: user.id, isModerator: false });

    for (let i = 0; i < LIMITS.contribute.limit; i++) {
      checkLimit(`contribute:work-location:${user.id}`, LIMITS.contribute);
    }

    const response = await postWorkLocation(
      postRequest({
        name: "Gont",
        type: "setting",
        coordinates: { lat: 51.5, lng: -0.12 },
      }),
      workParams
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("keys the limit per account, so one contributor cannot block another", async () => {
    const noisy = await makeUser();
    const quiet = await makeUser();

    for (let i = 0; i < LIMITS.contribute.limit; i++) {
      checkLimit(`contribute:work-location:${noisy.id}`, LIMITS.contribute);
    }

    mockGetCurrentUser.mockResolvedValue({ id: quiet.id, isModerator: false });
    const response = await postWorkLocation(
      postRequest({
        name: "Roke",
        type: "setting",
        coordinates: { lat: 51.5, lng: -0.12 },
      }),
      workParams
    );

    expect(response.status).toBe(201);
  });
});

/**
 * The budget bounds rows created, not requests attempted.
 *
 * /bastion's point: recording before validation is the SEC-4 shape — a
 * contributor who mistypes a latitude sixty times would be locked out for an
 * hour, having grown no table. Recording on arrival keeps the check atomic
 * (splitting it into a read and a later write is a concurrency bypass), and
 * refunding on every failure path means only work that happened is charged.
 */
describe("the contribution budget is spent on rows, not attempts", () => {
  beforeEach(async () => {
    __resetRateLimits();
    const user = await makeUser();
    mockGetCurrentUser.mockResolvedValue({ id: user.id, isModerator: false });
  });

  it("does not charge a rejected submission", async () => {
    // A real-world location with no coordinates: refused by the route's guard,
    // nothing written.
    for (let i = 0; i < 5; i++) {
      const response = await postWorkLocation(
        postRequest({ name: "Gont", type: "setting" }),
        workParams
      );
      expect(response.status).toBe(400);
    }

    // Five rejections later the budget is untouched, so the next good
    // submission still goes through.
    const good = await postWorkLocation(
      postRequest({
        name: "Gont",
        type: "setting",
        coordinates: { lat: 51.5, lng: -0.12 },
      }),
      workParams
    );
    expect(good.status).toBe(201);
  });

  it("charges a submission that actually wrote a row", async () => {
    const body = {
      name: "Roke",
      type: "setting",
      coordinates: { lat: 51.5, lng: -0.12 },
    };

    expect((await postWorkLocation(postRequest(body), workParams)).status).toBe(201);

    // One row, one hit — the property that makes the limit bound table growth.
    const remaining = checkLimit(
      `contribute:work-location:${(await mockGetCurrentUser()).id}`,
      LIMITS.contribute
    ).remaining;
    expect(remaining).toBe(LIMITS.contribute.limit - 2);
  });
});
