/**
 * @jest-environment node
 */
import { ZodError } from "zod";
import { errorResponse } from "@/lib/http/api";
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
      createReviewSchema.parse({ bookId: "b1", rating: 9 });
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
