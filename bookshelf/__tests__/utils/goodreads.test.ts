import { parseGoodreadsCSV, getShelfDisplayName } from "@/lib/goodreads";

describe("Goodreads utility functions", () => {
  describe("parseGoodreadsCSV", () => {
    it("parses a valid CSV with required columns", () => {
      const csv = `Title,Author,ISBN,ISBN13,My Rating,Date Read,Exclusive Shelf
"The Hobbit","J.R.R. Tolkien","0261103342","9780261103344","5","2023/06/15","read"
"1984","George Orwell","","","4","","to-read"`;

      const books = parseGoodreadsCSV(csv);

      expect(books).toHaveLength(2);
      expect(books[0].title).toBe("The Hobbit");
      expect(books[0].author).toBe("J.R.R. Tolkien");
      expect(books[0].isbn).toBe("0261103342");
      expect(books[0].isbn13).toBe("9780261103344");
      expect(books[0].myRating).toBe(5);
      expect(books[0].exclusiveShelf).toBe("read");
      expect(books[0].dateRead).toEqual(new Date(2023, 5, 15));
    });

    it("handles empty CSV", () => {
      const csv = "";
      const books = parseGoodreadsCSV(csv);
      expect(books).toHaveLength(0);
    });

    it("throws error when required columns are missing", () => {
      const csv = `ISBN,My Rating
"0261103342","5"`;

      expect(() => parseGoodreadsCSV(csv)).toThrow("Missing required column: Title");
    });

    it("cleans ISBN with leading equals sign and quotes", () => {
      const csv = `Title,Author,ISBN,ISBN13
"Test Book","Test Author","=""0261103342""","=""9780261103344"""`;

      const books = parseGoodreadsCSV(csv);
      expect(books[0].isbn).toBe("0261103342");
      expect(books[0].isbn13).toBe("9780261103344");
    });

    it("handles ISBN-10 with X check digit", () => {
      const csv = `Title,Author,ISBN
"Test Book","Test Author","080442957X"`;

      const books = parseGoodreadsCSV(csv);
      expect(books[0].isbn).toBe("080442957X");
    });

    it("returns null for invalid ISBN", () => {
      const csv = `Title,Author,ISBN
"Test Book","Test Author","invalid-isbn"`;

      const books = parseGoodreadsCSV(csv);
      expect(books[0].isbn).toBeNull();
    });

    it("handles quoted fields with commas", () => {
      const csv = `Title,Author,ISBN
"The Lord of the Rings, Part 1","Tolkien, J.R.R.","0261103342"`;

      const books = parseGoodreadsCSV(csv);
      expect(books[0].title).toBe("The Lord of the Rings, Part 1");
      expect(books[0].author).toBe("Tolkien, J.R.R.");
    });

    it("handles escaped quotes in fields", () => {
      const csv = `Title,Author,ISBN
"Book with ""Quotes"" in Title","Author Name",""`;

      const books = parseGoodreadsCSV(csv);
      expect(books[0].title).toBe('Book with "Quotes" in Title');
    });

    it("skips rows without title or author", () => {
      const csv = `Title,Author,ISBN
"","Test Author","0261103342"
"Test Book","","0261103342"
"Valid Book","Valid Author","0261103342"`;

      const books = parseGoodreadsCSV(csv);
      expect(books).toHaveLength(1);
      expect(books[0].title).toBe("Valid Book");
    });

    it("maps exclusive shelf values correctly", () => {
      const csv = `Title,Author,Exclusive Shelf
"Book 1","Author 1","read"
"Book 2","Author 2","currently-reading"
"Book 3","Author 3","to-read"
"Book 4","Author 4","custom-shelf"`;

      const books = parseGoodreadsCSV(csv);
      expect(books[0].exclusiveShelf).toBe("read");
      expect(books[1].exclusiveShelf).toBe("currently-reading");
      expect(books[2].exclusiveShelf).toBe("to-read");
      expect(books[3].exclusiveShelf).toBeNull();
    });

    it("parses bookshelves list", () => {
      const csv = `Title,Author,Bookshelves
"Test Book","Test Author","fiction, fantasy, favorites"`;

      const books = parseGoodreadsCSV(csv);
      expect(books[0].bookshelves).toEqual(["fiction", "fantasy", "favorites"]);
    });
  });

  describe("getShelfDisplayName", () => {
    it("returns correct display names", () => {
      expect(getShelfDisplayName("read")).toBe("Read");
      expect(getShelfDisplayName("currently-reading")).toBe("Currently Reading");
      expect(getShelfDisplayName("to-read")).toBe("Want to Read");
    });
  });
});
