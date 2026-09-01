/**
 * @jest-environment node
 */
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { errorResponse, declaredBodyTooLarge } from "@/lib/http/api";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/http/errors";
import { createReviewSchema } from "@/lib/http/schemas";

/**
 * Before this mapping existed, every thrown error became a 500 and its raw
 * message was returned — so an authorization failure looked like a server
 * fault, and Prisma errors leaked constraint and column names to the client.
 */
describe("errorResponse", () => {
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});

  afterAll(() => consoleError.mockRestore());

  it("maps an authorization failure to 403 with its message", async () => {
    const response = errorResponse(
      "ctx",
      new AuthorizationError("You can only remove locations you contributed")
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "You can only remove locations you contributed",
    });
  });

  it("maps a missing resource to 404", async () => {
    const response = errorResponse("ctx", new NotFoundError("Shelf not found"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Shelf not found",
    });
  });

  it("maps a broken rule to 400", async () => {
    const response = errorResponse(
      "ctx",
      new ValidationError("Cannot delete default shelves")
    );

    expect(response.status).toBe(400);
  });

  it("maps a schema failure to 400 with a readable message", async () => {
    let zodError: ZodError | undefined;
    try {
      createReviewSchema.parse({ workKey: "OL45804W", rating: 9 });
    } catch (error) {
      zodError = error as ZodError;
    }

    const response = errorResponse("ctx", zodError);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("rating");
  });

  it("hides the detail of an unexpected error behind a fixed message", async () => {
    const prismaish = new Error(
      "Unique constraint failed on the fields: (`email`)"
    );

    const response = errorResponse("Create user error", prismaish);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Something went wrong. Please try again.");
    // The detail must not reach the client, but must reach the logs.
    expect(body.error).not.toContain("email");
    expect(consoleError).toHaveBeenCalledWith("Create user error:", prismaish);
  });
});

/**
 * The Prisma branch used to be covered by a fixture that could not reach it: a
 * plain `new Error("Unique constraint failed on the fields: (`email`)")` — Prisma
 * -shaped TEXT. `errorResponse` branches on `instanceof`, never on the message,
 * so that fixture only ever exercised the 500 fallback while the suite reported
 * the Prisma contract as covered. These use the real error class.
 */
describe("errorResponse with real Prisma errors", () => {
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});

  afterAll(() => consoleError.mockRestore());

  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError("boom", {
      code,
      clientVersion: "5.22.0",
    });

  it("maps P2025 (record not found) to 404", async () => {
    const response = errorResponse("ctx", prismaError("P2025"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });

  it("maps P2002 (unique constraint) to 409", async () => {
    const response = errorResponse("ctx", prismaError("P2002"));
    expect(response.status).toBe(409);
  });

  /**
   * FLOW-15. followUser validates only self-follow, so pressing Follow on a
   * reader who has since deleted their account raised P2003 — an unresolved
   * foreign key — which fell through to the generic handler and answered 500.
   * POST /api/users/anything/follow did the same. Every other write path in the
   * app checks its foreign reference explicitly, so mapping the code here covers
   * the one that does not, plus the location writes.
   */
  it("maps P2003 (foreign key not found) to 404, not 500", async () => {
    const response = errorResponse("ctx", prismaError("P2003"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });

  it("does not forward the Prisma message, which names columns", async () => {
    const detailed = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      { code: "P2002", clientVersion: "5.22.0" }
    );
    const body = await errorResponse("ctx", detailed).json();
    expect(JSON.stringify(body)).not.toContain("email");
  });

  it("still answers an unrecognised Prisma code with a fixed 500", async () => {
    // Was P2003, which is now deliberately mapped to 404 (see above). Swapped
    // for a code that really is unhandled rather than relaxing the expectation:
    // the point of this assertion is that anything we have *not* thought about
    // stays a fixed 500 with no Prisma detail, and that must keep holding.
    const response = errorResponse("ctx", prismaError("P1001"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Something went wrong. Please try again.",
    });
  });
});

/**
 * Every upload route checked `file.size`, which is only knowable after
 * `formData()` has already buffered the whole body into memory. This is the
 * cheap gate that runs first.
 */
describe("declaredBodyTooLarge", () => {
  const withLength = (value: string | null) =>
    new Request("https://example.com", {
      method: "POST",
      ...(value === null ? {} : { headers: { "content-length": value } }),
    });

  it("rejects a body larger than the cap", () => {
    expect(declaredBodyTooLarge(withLength("20971520"), 5 * 1024 * 1024)).toBe(
      true
    );
  });

  it("allows a body at or under the cap", () => {
    expect(declaredBodyTooLarge(withLength("5242880"), 5 * 1024 * 1024)).toBe(
      false
    );
    expect(declaredBodyTooLarge(withLength("10"), 5 * 1024 * 1024)).toBe(false);
  });

  it.each([
    ["absent (a chunked request)", null],
    ["not a number", "banana"],
    ["empty", ""],
  ])("does not reject when content-length is %s", (_label, value) => {
    // Advisory, not a guarantee — the per-account rate limits bound the rest.
    expect(declaredBodyTooLarge(withLength(value), 5 * 1024 * 1024)).toBe(false);
  });
});
