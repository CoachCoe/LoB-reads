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
jest.mock("@/lib/storage/objects", () => ({
  deleteObjectByUrl: (url: string) => mockDeleteObjectByUrl(url),
  putObject: jest.fn(),
  isStorageConfigured: () => true,
}));

// Imported after the mocks are registered.
import { DELETE, PATCH } from "@/app/api/fictional-worlds/maps/[mapId]/route";

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
