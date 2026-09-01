import {
  createReviewSchema,
  updateProgressSchema,
  createAuthorLocationSchema,
  createWorkLocationSchema,
  createShelfSchema,
  updateProfileSchema,
} from "@/lib/http/schemas";

/**
 * These cover the gaps the audit found in the hand-rolled validation the
 * schemas replaced — each `it` here is a case that previously reached the
 * database.
 */

describe("createReviewSchema", () => {
  it("accepts a whole-number rating in range", () => {
    const result = createReviewSchema.parse({ workKey: "OL1W", rating: 4 });
    expect(result.rating).toBe(4);
  });

  it("rejects a fractional rating", () => {
    // Previously only range-checked, so 3.7 passed and failed at the column.
    expect(() =>
      createReviewSchema.parse({ workKey: "OL1W", rating: 3.7 })
    ).toThrow();
  });

  it("rejects a rating outside 1-5", () => {
    expect(() => createReviewSchema.parse({ workKey: "OL1W", rating: 0 })).toThrow();
    expect(() => createReviewSchema.parse({ workKey: "OL1W", rating: 6 })).toThrow();
  });

  it("rejects a non-numeric rating", () => {
    // "5" < 1 and "5" > 5 are both false, so the old check let strings past.
    expect(() =>
      createReviewSchema.parse({ workKey: "OL1W", rating: "5" })
    ).toThrow();
  });

  it("rejects review content beyond the length cap", () => {
    expect(() =>
      createReviewSchema.parse({
        workKey: "OL1W",
        rating: 3,
        content: "x".repeat(10_001),
      })
    ).toThrow();
  });
});

describe("updateProgressSchema", () => {
  it("accepts a page number", () => {
    expect(updateProgressSchema.parse({ workKey: "OL1W", currentPage: 42 }))
      .toMatchObject({ currentPage: 42 });
  });

  it("rejects a negative page number", () => {
    // currentPage was entirely unvalidated before.
    expect(() =>
      updateProgressSchema.parse({ workKey: "OL1W", currentPage: -1 })
    ).toThrow();
  });

  it("rejects a fractional page number", () => {
    expect(() =>
      updateProgressSchema.parse({ workKey: "OL1W", currentPage: 10.5 })
    ).toThrow();
  });

  it("requires either an action or a page number", () => {
    expect(() => updateProgressSchema.parse({ workKey: "OL1W" })).toThrow();
  });

  it("accepts a start action with no page number", () => {
    expect(updateProgressSchema.parse({ workKey: "OL1W", action: "start" }))
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
      createWorkLocationSchema.parse({
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

/**
 * `updateProfileSchema` had no test at all, which is how `avatarUrl` stayed a
 * bare `z.url()`. Two separate problems rode on that: `z.url()` is not a scheme
 * check, and `Avatar.tsx` renders the value with `unoptimized`, which bypasses
 * next.config.ts's remotePatterns — so the CSP was the only thing left. And
 * because the field accepted any URL, a reader could point their own profile at
 * another user's stored blob and have their next upload delete it.
 */
describe("updateProfileSchema", () => {
  const parse = (avatarUrl: string) => updateProfileSchema.parse({ avatarUrl });

  it("accepts the avatar generator the app itself uses", () => {
    const url = "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice";
    expect(parse(url).avatarUrl).toBe(url);
  });

  it.each([
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a vbscript: URL", "vbscript:msgbox"],
    ["an arbitrary third-party host", "https://evil.example/track.png"],
    ["http on an allowed host", "http://api.dicebear.com/7.x/x.svg"],
  ])("rejects %s", (_label, url) => {
    expect(() => parse(url)).toThrow();
  });

  it("accepts our own storage origin when one is configured", () => {
    const previous = process.env.CDN_URL;
    process.env.CDN_URL = "https://cdn.example.invalid";
    try {
      const url = "https://cdn.example.invalid/avatars/u1/1700000000-pic.jpg";
      expect(parse(url).avatarUrl).toBe(url);
    } finally {
      if (previous === undefined) delete process.env.CDN_URL;
      else process.env.CDN_URL = previous;
    }
  });

  it("still allows clearing the avatar", () => {
    expect(updateProfileSchema.parse({ avatarUrl: null }).avatarUrl).toBeNull();
    expect(updateProfileSchema.parse({}).avatarUrl).toBeUndefined();
  });
});
