import { getCoverUrl, getISBNCoverUrl, normalizeOpenLibraryBook } from "@/lib/openlibrary";

describe("OpenLibrary utility functions", () => {
  describe("getCoverUrl", () => {
    it("returns null when coverId is undefined", () => {
      expect(getCoverUrl(undefined)).toBeNull();
    });

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

  describe("getISBNCoverUrl", () => {
    it("returns correct URL with default size (M)", () => {
      expect(getISBNCoverUrl("978-0-123456-47-2")).toBe(
        "https://covers.openlibrary.org/b/isbn/978-0-123456-47-2-M.jpg"
      );
    });

    it("returns correct URL with specified size", () => {
      expect(getISBNCoverUrl("978-0-123456-47-2", "L")).toBe(
        "https://covers.openlibrary.org/b/isbn/978-0-123456-47-2-L.jpg"
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
