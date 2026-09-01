import { prisma } from "./setup";
import { makeUser } from "./factories";

/**
 * The profile and avatar routes, exercised through their handlers.
 *
 * Both were named by the original audit (TEST-7, TEST-8) and neither was
 * addressed; between them they are two of the four blockers in the 2026-09-01
 * audit, and **no test imported either file**.
 *
 * TEST-2. Deleting this from `users/[userId]/route.ts` broke nothing:
 *
 *     if (session.user.id !== userId) {
 *       return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 *     }
 *
 * Any signed-in reader could then PATCH anyone's name, bio and avatar.
 * `conventions.test.ts:103-114` only checks that each mutating handler
 * *mentions* `getServerSession` — it says nothing about whose id reaches the
 * query, which is precisely the gap.
 *
 * TEST-3. In the avatar route, `previousKey?.startsWith(\`avatars/${userId}/\`)`
 * → `previousKey` also broke nothing, restoring the original KNOWN-2 exactly.
 * The route's own comment states the attack: `updateProfileSchema` accepts any
 * path under the CDN origin, so a reader can point their profile at another
 * user's stored blob and have their next upload delete it.
 * `storage.test.ts:109-123` makes the hazard look guarded while the reachable
 * two-request sequence went untested.
 *
 * Mocked: the two session accessors (the routes use different ones) and object
 * storage. The database is real.
 */

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: () => mockGetServerSession(),
}));

const mockGetCurrentUser = jest.fn();
jest.mock("@/lib/auth/session", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

const CDN = "https://cdn.example.invalid";

const mockPutObject = jest.fn();
const mockDeleteObjectByUrl = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/storage/objects", () => ({
  putObject: (key: string, file: unknown) => mockPutObject(key, file),
  deleteObjectByUrl: (url: string) => mockDeleteObjectByUrl(url),
  isStorageConfigured: () => true,
  // Mirrors the real implementation for this origin, which is what the prefix
  // check under test consumes.
  keyFromUrl: (url: string) =>
    url.startsWith(`${CDN}/`) ? decodeURIComponent(url.slice(CDN.length + 1)) : null,
}));

// Imported after the mocks are registered.
import { PATCH } from "@/app/api/users/[userId]/route";
import { POST as uploadAvatar } from "@/app/api/users/[userId]/avatar/route";

const params = (userId: string) => ({ params: Promise.resolve({ userId }) });

const patchRequest = (body: unknown) =>
  new Request("http://localhost/api/users/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** A one-pixel PNG, so `validateImageFile`'s magic-byte check passes. */
function pngFile(name = "avatar.png") {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
      "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex"
  );
  return new File([new Uint8Array(png)], name, { type: "image/png" });
}

function uploadRequest(file: File) {
  const body = new FormData();
  body.append("file", file);
  return new Request("http://localhost/api/users/x/avatar", {
    method: "POST",
    body,
  }) as never;
}

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockGetCurrentUser.mockReset();
  mockPutObject.mockReset();
  mockPutObject.mockImplementation((key: string) =>
    Promise.resolve({ url: `${CDN}/${key}` })
  );
  mockDeleteObjectByUrl.mockClear();
});

describe("PATCH /api/users/[userId]", () => {
  it("rejects an anonymous caller with 401", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await PATCH(patchRequest({ name: "New" }), params("anyone"));
    expect(response.status).toBe(401);
  });

  it("refuses a cross-user edit with 403 and leaves the target untouched", async () => {
    const target = await makeUser({ name: "Original" });
    const attacker = await makeUser();

    mockGetServerSession.mockResolvedValue({ user: { id: attacker.id } });

    const response = await PATCH(
      patchRequest({ name: "Renamed by someone else", bio: "and a bio" }),
      params(target.id)
    );

    expect(response.status).toBe(403);

    // The status code alone would pass if the write happened first.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.name).toBe("Original");
    expect(after.bio).toBeNull();
  });

  it("lets a reader edit their own profile", async () => {
    const user = await makeUser({ name: "Original" });
    mockGetServerSession.mockResolvedValue({ user: { id: user.id } });

    const response = await PATCH(
      patchRequest({ name: "Chosen name", bio: "About me" }),
      params(user.id)
    );

    expect(response.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.name).toBe("Chosen name");
    expect(after.bio).toBe("About me");
  });

  it("does not let a caller grant themselves moderator", async () => {
    // Zod strips unknown keys, so this already holds — pinned because the
    // consequence of it ceasing to hold is site-wide deletion rights.
    const user = await makeUser();
    mockGetServerSession.mockResolvedValue({ user: { id: user.id } });

    const response = await PATCH(
      patchRequest({ name: "Fine", isModerator: true }),
      params(user.id)
    );

    expect(response.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.isModerator).toBe(false);
  });
});

describe("POST /api/users/[userId]/avatar", () => {
  it("rejects an anonymous caller with 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const response = await uploadAvatar(uploadRequest(pngFile()), params("anyone"));
    expect(response.status).toBe(401);
  });

  it("refuses an upload to someone else's profile", async () => {
    const target = await makeUser();
    const attacker = await makeUser();

    mockGetCurrentUser.mockResolvedValue({ id: attacker.id });

    const response = await uploadAvatar(
      uploadRequest(pngFile()),
      params(target.id)
    );

    expect(response.status).toBe(403);
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("stores an avatar under the caller's own prefix", async () => {
    const user = await makeUser();
    mockGetCurrentUser.mockResolvedValue({ id: user.id });

    const response = await uploadAvatar(uploadRequest(pngFile()), params(user.id));

    expect(response.status).toBe(200);
    const [key] = mockPutObject.mock.calls[0];
    expect(key).toMatch(new RegExp(`^avatars/${user.id}/`));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.avatarUrl).toBe(`${CDN}/${key}`);
  });

  it("never deletes a blob outside the caller's prefix", async () => {
    // The KNOWN-2 sequence, end to end: point your own profile at another
    // reader's stored blob, then upload. Nothing may delete their image.
    const victim = await makeUser();
    const attacker = await makeUser();

    const victimsBlob = `${CDN}/avatars/${victim.id}/1700000000-photo.png`;
    await prisma.user.update({
      where: { id: victim.id },
      data: { avatarUrl: victimsBlob },
    });
    await prisma.user.update({
      where: { id: attacker.id },
      data: { avatarUrl: victimsBlob },
    });

    mockGetCurrentUser.mockResolvedValue({ id: attacker.id });

    const response = await uploadAvatar(
      uploadRequest(pngFile()),
      params(attacker.id)
    );

    expect(response.status).toBe(200);
    expect(mockDeleteObjectByUrl).not.toHaveBeenCalled();

    // And the victim's profile still points at their image.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(after.avatarUrl).toBe(victimsBlob);
  });

  it("deletes the caller's own previous avatar", async () => {
    // The other half: the cleanup must still happen, or the prefix check could
    // be satisfied by never deleting anything.
    const user = await makeUser();
    const ownPrevious = `${CDN}/avatars/${user.id}/1600000000-old.png`;
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: ownPrevious },
    });

    mockGetCurrentUser.mockResolvedValue({ id: user.id });

    await uploadAvatar(uploadRequest(pngFile()), params(user.id));

    expect(mockDeleteObjectByUrl).toHaveBeenCalledWith(ownPrevious);
  });

  it("leaves an external avatar alone", async () => {
    const user = await makeUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=x" },
    });

    mockGetCurrentUser.mockResolvedValue({ id: user.id });

    await uploadAvatar(uploadRequest(pngFile()), params(user.id));

    expect(mockDeleteObjectByUrl).not.toHaveBeenCalled();
  });

  it("refuses a file whose bytes are not an image", async () => {
    // TEST-13's shape: file-validation is well covered, but nothing asserted
    // that this route calls it.
    const user = await makeUser();
    mockGetCurrentUser.mockResolvedValue({ id: user.id });

    const notAnImage = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], "x.png", {
      type: "image/png",
    });

    const response = await uploadAvatar(uploadRequest(notAnImage), params(user.id));

    expect(response.status).toBe(400);
    expect(mockPutObject).not.toHaveBeenCalled();
  });
});
