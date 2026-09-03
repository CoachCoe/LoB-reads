import { prisma } from "./setup";
import { makeUser, makeFictionalWorld, makeMap } from "./factories";

/**
 * The fictional-world map rules, exercised through the route handlers.
 *
 * This was the most severe finding of the original audit: any signed-in user
 * could delete any map, including its stored image. The rule is now
 * uploader-or-moderator, and it lives in the route rather than the server
 * layer — so it has to be tested there.
 *
 * Only two boundaries are mocked: the session (there is no browser to hold a
 * cookie) and object storage (no S3 in CI). The database is real, and so is
 * the authorization logic under test.
 */

const mockGetCurrentUser = jest.fn();
jest.mock("@/lib/auth/session", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

const mockDeleteObjectByUrl = jest.fn().mockResolvedValue(true);
const mockPutObject = jest
  .fn()
  .mockResolvedValue({ url: "https://cdn.example/fictional-worlds/x/map.png" });
jest.mock("@/lib/storage/objects", () => ({
  deleteObjectByUrl: (url: string) => mockDeleteObjectByUrl(url),
  putObject: (key: string, file: unknown) => mockPutObject(key, file),
  isStorageConfigured: () => true,
}));

// Imported after the mocks are registered.
import { DELETE, PATCH } from "@/app/api/fictional-worlds/maps/[mapId]/route";
import { POST as uploadMap } from "@/app/api/fictional-worlds/[worldId]/upload/route";
import { __resetRateLimits } from "@/lib/rate-limit";

const params = (mapId: string) => ({ params: Promise.resolve({ mapId }) });
const request = (body?: unknown) =>
  new Request("http://localhost/api/fictional-worlds/maps/x", {
    method: body ? "PATCH" : "DELETE",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as never;

beforeEach(() => {
  mockGetCurrentUser.mockReset();
  mockDeleteObjectByUrl.mockClear();
  mockPutObject.mockClear();
  // The upload route is rate limited per account, and the limiter is a
  // module-level Map that outlives a test.
  __resetRateLimits();
});

describe("DELETE /api/fictional-worlds/maps/[mapId]", () => {
  it("rejects an anonymous caller with 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const response = await DELETE(request(), params("anything"));
    expect(response.status).toBe(401);
  });

  it("refuses a signed-in stranger with 403 and keeps the map", async () => {
    const uploader = await makeUser();
    const stranger = await makeUser();
    const world = await makeFictionalWorld();
    const map = await makeMap(world.id, uploader.id);

    mockGetCurrentUser.mockResolvedValue({ id: stranger.id, isModerator: false });

    const response = await DELETE(request(), params(map.id));

    expect(response.status).toBe(403);
    expect(
      await prisma.fictionalWorldMap.findUnique({ where: { id: map.id } })
    ).not.toBeNull();
    // The stored image must survive too — a 403 that still deletes the blob
    // would be worse than the original bug.
    expect(mockDeleteObjectByUrl).not.toHaveBeenCalled();
  });

  it("lets the uploader delete their own map", async () => {
    const uploader = await makeUser();
    const world = await makeFictionalWorld();
    const map = await makeMap(world.id, uploader.id);

    mockGetCurrentUser.mockResolvedValue({ id: uploader.id, isModerator: false });

    const response = await DELETE(request(), params(map.id));

    expect(response.status).toBe(200);
    expect(
      await prisma.fictionalWorldMap.findUnique({ where: { id: map.id } })
    ).toBeNull();
    expect(mockDeleteObjectByUrl).toHaveBeenCalledWith(map.imageUrl);
  });

  it("lets a moderator delete someone else's map", async () => {
    const uploader = await makeUser();
    const moderator = await makeUser({ isModerator: true });
    const world = await makeFictionalWorld();
    const map = await makeMap(world.id, uploader.id);

    mockGetCurrentUser.mockResolvedValue({ id: moderator.id, isModerator: true });

    const response = await DELETE(request(), params(map.id));

    expect(response.status).toBe(200);
    expect(
      await prisma.fictionalWorldMap.findUnique({ where: { id: map.id } })
    ).toBeNull();
  });

  it("returns 404 for a map that does not exist", async () => {
    const user = await makeUser();
    mockGetCurrentUser.mockResolvedValue({ id: user.id, isModerator: false });

    const response = await DELETE(request(), params("no-such-map"));
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/fictional-worlds/maps/[mapId]", () => {
  it("lets any signed-in user edit details — maps are community-editable", async () => {
    const uploader = await makeUser();
    const editor = await makeUser();
    const world = await makeFictionalWorld();
    const map = await makeMap(world.id, uploader.id);

    mockGetCurrentUser.mockResolvedValue({ id: editor.id, isModerator: false });

    const response = await PATCH(
      request({ title: "Corrected title" }),
      params(map.id)
    );

    expect(response.status).toBe(200);

    const updated = await prisma.fictionalWorldMap.findUnique({
      where: { id: map.id },
    });
    expect(updated!.title).toBe("Corrected title");
    // The edit is attributed, so a wiki-style model still has an audit trail.
    expect(updated!.updatedById).toBe(editor.id);
    expect(updated!.addedById).toBe(uploader.id);
  });

  it("still rejects an anonymous editor", async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const response = await PATCH(request({ title: "x" }), params("anything"));
    expect(response.status).toBe(401);
  });

  it("rejects an empty title with 400", async () => {
    const user = await makeUser();
    const world = await makeFictionalWorld();
    const map = await makeMap(world.id, user.id);

    mockGetCurrentUser.mockResolvedValue({ id: user.id, isModerator: false });

    const response = await PATCH(request({ title: "   " }), params(map.id));
    expect(response.status).toBe(400);
  });
});

/**
 * TEST-13: `file-validation.test.ts` covers `validateImageFile` thoroughly —
 * magic bytes, size, extension — and nothing asserted that either upload route
 * calls it. The avatar half was closed in `profile-authorization.test.ts`; this
 * is the other route, which was still open.
 *
 * The check is what stands between the public map surface and an arbitrary
 * file served from our own CDN under a filename we chose. A declared
 * `Content-Type` is worthless here: it is set by the client.
 *
 * `putObject` is asserted not to have been called, rather than only the
 * status. A 400 returned after the write is exactly the shape that passes a
 * status-only test while the file sits in storage.
 */
describe("POST /api/fictional-worlds/[worldId]/upload", () => {
  const worldParams = (worldId: string) => ({ params: Promise.resolve({ worldId }) });

  /** A real 1x1 PNG, so the happy path exercises the validator rather than skipping it. */
  function pngFile(name = "map.png") {
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
        "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
      "hex"
    );
    return new File([new Uint8Array(png)], name, { type: "image/png" });
  }

  function uploadRequest(file: File, title = "The Known World") {
    const body = new FormData();
    body.append("file", file);
    body.append("title", title);
    return new Request("http://localhost/api/fictional-worlds/x/upload", {
      method: "POST",
      body,
    }) as never;
  }

  it("refuses a file whose bytes are not an image, and stores nothing", async () => {
    const user = await makeUser();
    const world = await makeFictionalWorld();
    mockGetCurrentUser.mockResolvedValue({ id: user.id });

    // RIFF, declared as a PNG. Deleting the validateImageFile call from the
    // route leaves this a 201 with the file in storage.
    const notAnImage = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], "map.png", {
      type: "image/png",
    });

    const response = await uploadMap(uploadRequest(notAnImage), worldParams(world.id));

    expect(response.status).toBe(400);
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(await prisma.fictionalWorldMap.count({ where: { fictionalWorldId: world.id } })).toBe(0);
  });

  it("accepts a real image, so the refusal above is not simply a broken route", async () => {
    const user = await makeUser();
    const world = await makeFictionalWorld();
    mockGetCurrentUser.mockResolvedValue({ id: user.id });

    const response = await uploadMap(uploadRequest(pngFile()), worldParams(world.id));

    // 200, not 201 — this route does not set a status on success.
    expect(response.status).toBe(200);
    expect(mockPutObject).toHaveBeenCalledTimes(1);
    expect(
      await prisma.fictionalWorldMap.count({ where: { fictionalWorldId: world.id } })
    ).toBe(1);
  });

  it("refuses an anonymous upload", async () => {
    const world = await makeFictionalWorld();
    mockGetCurrentUser.mockResolvedValue(null);

    const response = await uploadMap(uploadRequest(pngFile()), worldParams(world.id));

    expect(response.status).toBe(401);
    expect(mockPutObject).not.toHaveBeenCalled();
  });
});
