import { prisma } from "./setup";
import { POST as register } from "@/app/api/auth/register/route";
import { __resetRateLimits } from "@/lib/rate-limit";

/**
 * Registration and sign-in identity rules, all fixed in response to the first
 * audit and none of them previously guarded.
 *
 *   - email is stored lowercased and trimmed, so signing up as Reader@x.com
 *     does not lock you out of reader@x.com
 *   - the user and their three default shelves are created in one transaction,
 *     so a partial failure cannot leave an account that can never shelve a book
 *   - registration is rate limited
 */

const post = (body: unknown, ip = "203.0.113.1") =>
  register(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    })
  );

const valid = {
  email: "Reader@Example.COM",
  password: "password123",
  name: "Reader",
};

beforeEach(() => {
  // The limiter is process-global; without this, later tests inherit earlier
  // tests' attempts and start failing for the wrong reason.
  __resetRateLimits();
});

describe("email normalization", () => {
  it("stores a mixed-case address lowercased and trimmed", async () => {
    const response = await post({ ...valid, email: "  Reader@Example.COM  " });
    expect(response.status).toBe(201);

    const user = await prisma.user.findUnique({
      where: { email: "reader@example.com" },
    });
    expect(user).not.toBeNull();
    expect(user!.email).toBe("reader@example.com");
  });

  it("treats a different casing as the same account already existing", async () => {
    expect((await post(valid)).status).toBe(201);

    const duplicate = await post({ ...valid, email: "READER@example.com" });

    expect(duplicate.status).toBe(400);
    await expect(duplicate.json()).resolves.toEqual({
      error: "User with this email already exists",
    });
    expect(await prisma.user.count()).toBe(1);
  });
});

describe("atomic registration", () => {
  it("creates the three default shelves with the account", async () => {
    await post(valid);

    const user = await prisma.user.findUnique({
      where: { email: "reader@example.com" },
      include: { shelves: true },
    });

    expect(user!.shelves.map((s) => s.name).sort()).toEqual([
      "Currently Reading",
      "Read",
      "Want to Read",
    ]);
    expect(user!.shelves.every((s) => s.isDefault)).toBe(true);
  });

  it("creates no user at all when the request is rejected", async () => {
    const response = await post({ ...valid, password: "short" });

    expect(response.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.shelf.count()).toBe(0);
  });
});

describe("input rules", () => {
  it.each([
    ["a password with no digit", { password: "passwordonly" }],
    ["a password that is too short", { password: "pass1" }],
    ["a name that is too short", { name: "A" }],
    ["a malformed address", { email: "not-an-email" }],
  ])("rejects %s", async (_label, override) => {
    const response = await post({ ...valid, ...override });
    expect(response.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it("never returns the password hash", async () => {
    const response = await post(valid);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("password123");
  });
});

describe("rate limiting", () => {
  it("blocks repeated sign-ups from one address with 429", async () => {
    const ip = "198.51.100.42";
    const statuses: number[] = [];

    for (let i = 0; i < 7; i++) {
      const response = await post(
        { ...valid, email: `person${i}@example.com` },
        ip
      );
      statuses.push(response.status);
    }

    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });

  it("limits per address, so one abuser does not block everyone", async () => {
    for (let i = 0; i < 5; i++) {
      await post({ ...valid, email: `noisy${i}@example.com` }, "198.51.100.1");
    }
    expect((await post({ ...valid, email: "x@example.com" }, "198.51.100.1")).status).toBe(429);

    const other = await post({ ...valid, email: "quiet@example.com" }, "198.51.100.2");
    expect(other.status).toBe(201);
  });
});
