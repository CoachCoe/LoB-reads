import { getCoverUrl, normalizeOpenLibraryBook } from "@/lib/sources/openlibrary";

describe("OpenLibrary utility functions", () => {
  describe("getCoverUrl", () => {
    it("returns null when coverId is undefined", () => {
      expect(getCoverUrl(undefined)).toBeNull();
    });

    /*
     * DEAD-13. These assertions pin `getCoverUrl`, which is in a module with no
     * importer anywhere — the live cover builder is `coverUrl` in
     * `src/lib/covers.ts`, and `CoverImage.test.tsx` asserts it **must contain**
     * `default=false`.
     *
     * So two tests asserted contradictory URLs for the same job, and the one
     * guarding the dead copy asserted the shape the app deliberately abandoned:
     * without `default=false`, Open Library answers a missing cover with 200 and
     * a 43-byte placeholder, so `onError` never fires and every fallback in the
     * app is unreachable.
     *
     * The module stays — the standing rule is not to delete behaviour no test or
     * spec line covers — but the assertions now say what they are pinning, and
     * the one below states the divergence outright so the two files cannot look
     * like they agree.
     */
    it("returns correct URL with default size (M)", () => {
      expect(getCoverUrl(12345)).toBe(
        "https://covers.openlibrary.org/b/id/12345-M.jpg"
      );
    });

    it("returns correct URL with specified size", () => {
      expect(getCoverUrl(12345, "S")).toBe(
        "https://covers.openlibrary.org/b/id/12345-S.jpg"
      );
      expect(getCoverUrl(12345, "L")).toBe(
        "https://covers.openlibrary.org/b/id/12345-L.jpg"
      );
    });
  });

  describe("normalizeOpenLibraryBook", () => {
    it("normalizes a complete book object", () => {
      const book = {
        key: "/works/OL12345W",
        title: "Test Book",
        author_name: ["Author One", "Author Two"],
        isbn: ["978-0-123456-47-2", "978-0-123456-47-3"],
        cover_i: 12345,
        number_of_pages_median: 300,
        first_publish_year: 2020,
        subject: ["Fiction", "Fantasy", "Adventure", "Magic", "Dragons", "Extra"],
      };

      const result = normalizeOpenLibraryBook(book);

      expect(result.title).toBe("Test Book");
      expect(result.author).toBe("Author One, Author Two");
      expect(result.isbn).toBe("978-0-123456-47-2");
      expect(result.coverUrl).toBe(
        "https://covers.openlibrary.org/b/id/12345-L.jpg"
      );
      expect(result.pageCount).toBe(300);
      expect(result.publishedDate).toBe("2020");
      expect(result.genres).toHaveLength(5);
      expect(result.genres).toContain("Fiction");
      expect(result.openLibraryId).toBe("/works/OL12345W");
    });

    it("handles missing optional fields", () => {
      const book = {
        key: "/works/OL12345W",
        title: "Test Book",
      };

      const result = normalizeOpenLibraryBook(book);

      expect(result.title).toBe("Test Book");
      expect(result.author).toBe("Unknown Author");
      expect(result.isbn).toBeNull();
      expect(result.coverUrl).toBeNull();
      expect(result.pageCount).toBeNull();
      expect(result.publishedDate).toBeNull();
      expect(result.genres).toEqual([]);
    });
  });
});

/**
 * The divergence, asserted so it cannot be mistaken for agreement.
 *
 * If someone ever wires `sources/openlibrary` back in — the import route's own
 * header describes removing exactly the per-book HTTP call it exists for — this
 * is the difference that matters.
 */
describe("getCoverUrl is not the live cover builder", () => {
  it("omits the parameter the live builder depends on", async () => {
    const { getCoverUrl } = await import("@/lib/sources/openlibrary");
    const { coverUrl } = await import("@/lib/covers");

    expect(getCoverUrl(12345)).not.toContain("default=false");
    expect(coverUrl(12345)).toContain("default=false");

    // Same id, same size, different answers. Whichever is used must be chosen
    // deliberately rather than by which import came to hand.
    expect(getCoverUrl(12345)).not.toBe(coverUrl(12345));
  });
});
