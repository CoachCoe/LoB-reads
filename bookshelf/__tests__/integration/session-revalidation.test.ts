import { prisma } from "./setup";
import { makeUser } from "./factories";
import { authOptions } from "@/lib/auth/options";
import type { JWT } from "next-auth/jwt";

/**
 * A JWT is a bearer credential. Authorization copied into it at sign-in and
 * never re-read cannot be withdrawn — and NextAuth re-encodes the token with a
 * fresh expiry on every session read, so for an active user the 30-day default
 * never arrived.
 *
 * The concrete failure this guards: `isModerator` is the flag that lets someone
 * delete another reader's fictional-world map AND its stored blob
 * (api/fictional-worlds/maps/[mapId]/route.ts). Setting `is_moderator = false`
 * in the database — the only revocation the schema offers — did nothing at all.
 *
 * These call the jwt callback directly, which is the only way to exercise it:
 * there is no browser here to hold a cookie.
 */

const jwtCallback = authOptions.callbacks!.jwt!;

/** The shape NextAuth hands the callback on a request that is not a sign-in. */
const callWithToken = (token: JWT) =>
  jwtCallback({ token } as Parameters<typeof jwtCallback>[0]) as Promise<JWT>;

const minutesAgo = (n: number) => Date.now() - n * 60_000;

describe("jwt token revalidation", () => {
  it("stamps the check time at sign-in and trusts the row it was just given", async () => {
    const user = await makeUser({ isModerator: true });

    const token = (await jwtCallback({
      token: {} as JWT,
      user: { id: user.id, isModerator: true },
    } as Parameters<typeof jwtCallback>[0])) as JWT;

    expect(token.id).toBe(user.id);
    expect(token.isModerator).toBe(true);
    expect(typeof token.checkedAt).toBe("number");
  });

  it("does not query again inside the revalidation window", async () => {
    const user = await makeUser({ isModerator: true });

    // Demote in the database, but claim the token was checked a moment ago.
    await prisma.user.update({
      where: { id: user.id },
      data: { isModerator: false },
    });

    const token = await callWithToken({
      id: user.id,
      isModerator: true,
      checkedAt: Date.now(),
    } as JWT);

    // Still stale — deliberately. The window is the cost/latency trade.
    expect(token.isModerator).toBe(true);
  });

  it("picks up a revoked moderator once the window has passed", async () => {
    const user = await makeUser({ isModerator: true });

    await prisma.user.update({
      where: { id: user.id },
      data: { isModerator: false },
    });

    const token = await callWithToken({
      id: user.id,
      isModerator: true,
      checkedAt: minutesAgo(10),
    } as JWT);

    expect(token.isModerator).toBe(false);
    expect(token.id).toBe(user.id);
  });

  it("picks up a granted moderator without requiring a new sign-in", async () => {
    const user = await makeUser({ isModerator: false });

    await prisma.user.update({
      where: { id: user.id },
      data: { isModerator: true },
    });

    const token = await callWithToken({
      id: user.id,
      isModerator: false,
      checkedAt: minutesAgo(10),
    } as JWT);

    expect(token.isModerator).toBe(true);
  });

  it("blanks the id when the account no longer exists", async () => {
    const user = await makeUser();
    await prisma.user.delete({ where: { id: user.id } });

    const token = await callWithToken({
      id: user.id,
      isModerator: true,
      checkedAt: minutesAgo(10),
    } as JWT);

    // Every route guards on `!session?.user?.id` / `!user?.id`, so an empty id
    // is a 401 rather than a 500 or a session authenticating a deleted user.
    expect(token.id).toBe("");
    expect(token.isModerator).toBe(false);
  });

  it("treats a token with no checkedAt as due for a check", async () => {
    // Tokens issued before this change carry no checkedAt at all.
    const user = await makeUser({ isModerator: false });

    const token = await callWithToken({
      id: user.id,
      isModerator: true,
    } as JWT);

    expect(token.isModerator).toBe(false);
    expect(typeof token.checkedAt).toBe("number");
  });

  it("bounds the session lifetime instead of taking the 30-day default", () => {
    expect(authOptions.session?.maxAge).toBe(24 * 60 * 60);
  });
});
