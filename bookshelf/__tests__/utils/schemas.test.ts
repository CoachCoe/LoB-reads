import {
  createReviewSchema,
  updateProgressSchema,
  createAuthorLocationSchema,
  createBookLocationSchema,
  createShelfSchema,
} from "@/lib/schemas";

/**
 * These cover the gaps the audit found in the hand-rolled validation the
 * schemas replaced — each `it` here is a case that previously reached the
 * database.
 */

describe("createReviewSchema", () => {
  it("accepts a whole-number rating in range", () => {
    const result = createReviewSchema.parse({ bookId: "b1", rating: 4 });
    expect(result.rating).toBe(4);
  });

  it("rejects a fractional rating", () => {
    // Previously only range-checked, so 3.7 passed and failed at the column.
    expect(() =>
      createReviewSchema.parse({ bookId: "b1", rating: 3.7 })
    ).toThrow();
  });

  it("rejects a rating outside 1-5", () => {
    expect(() => createReviewSchema.parse({ bookId: "b1", rating: 0 })).toThrow();
    expect(() => createReviewSchema.parse({ bookId: "b1", rating: 6 })).toThrow();
  });

  it("rejects a non-numeric rating", () => {
    // "5" < 1 and "5" > 5 are both false, so the old check let strings past.
    expect(() =>
      createReviewSchema.parse({ bookId: "b1", rating: "5" })
    ).toThrow();
  });

  it("rejects review content beyond the length cap", () => {
    expect(() =>
      createReviewSchema.parse({
        bookId: "b1",
        rating: 3,
        content: "x".repeat(10_001),
      })
    ).toThrow();
  });
});

describe("updateProgressSchema", () => {
  it("accepts a page number", () => {
    expect(updateProgressSchema.parse({ bookId: "b1", currentPage: 42 }))
      .toMatchObject({ currentPage: 42 });
  });

  it("rejects a negative page number", () => {
    // currentPage was entirely unvalidated before.
    expect(() =>
      updateProgressSchema.parse({ bookId: "b1", currentPage: -1 })
    ).toThrow();
  });

  it("rejects a fractional page number", () => {
    expect(() =>
      updateProgressSchema.parse({ bookId: "b1", currentPage: 10.5 })
    ).toThrow();
  });

  it("requires either an action or a page number", () => {
    expect(() => updateProgressSchema.parse({ bookId: "b1" })).toThrow();
  });

  it("accepts a start action with no page number", () => {
    expect(updateProgressSchema.parse({ bookId: "b1", action: "start" }))
      .toMatchObject({ action: "start" });
  });
});

describe("location schemas", () => {
  const validCoords = { lat: 51.5, lng: -0.12 };

  it("accepts coordinates in range", () => {
    expect(
      createAuthorLocationSchema.parse({
        name: "Oxford, UK",
        type: "residence",
        coordinates: validCoords,
      }).coordinates
    ).toEqual(validCoords);
  });

  it("rejects out-of-range latitude and longitude", () => {
    expect(() =>
      createAuthorLocationSchema.parse({
        name: "Nowhere",
        type: "residence",
        coordinates: { lat: 91, lng: 0 },
      })
    ).toThrow();
    expect(() =>
      createAuthorLocationSchema.parse({
        name: "Nowhere",
        type: "residence",
        coordinates: { lat: 0, lng: 181 },
      })
    ).toThrow();
  });

  it("rejects an unknown location type", () => {
    expect(() =>
      createAuthorLocationSchema.parse({
        name: "Somewhere",
        type: "vacation",
        coordinates: validCoords,
      })
    ).toThrow();
  });

  it("allows a book location without coordinates (fictional worlds)", () => {
    expect(
      createBookLocationSchema.parse({
        name: "The Shire",
        type: "setting",
        isFictional: true,
      })
    ).toMatchObject({ name: "The Shire", isFictional: true });
  });
});

describe("createShelfSchema", () => {
  it("trims surrounding whitespace", () => {
    expect(createShelfSchema.parse({ name: "  Favourites  " }).name).toBe(
      "Favourites"
    );
  });

  it("rejects a whitespace-only name", () => {
    expect(() => createShelfSchema.parse({ name: "   " })).toThrow();
  });

  it("rejects an over-long name", () => {
    expect(() =>
      createShelfSchema.parse({ name: "x".repeat(201) })
    ).toThrow();
  });
});
