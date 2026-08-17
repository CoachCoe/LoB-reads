import { parseGoodreadsCSV } from "@/lib/goodreads";

/**
 * Regression tests for the record-splitting bug: the parser used to split on
 * "\n" before parsing quotes, so a review containing a line break tore its
 * record in half. The book still imported but arrived with no shelf and no
 * read date, silently.
 */

const HEADER =
  'Title,Author,ISBN,ISBN13,My Rating,My Review,Exclusive Shelf,Date Read,Date Added,Bookshelves';

describe("parseGoodreadsCSV — real-world export shapes", () => {
  it("keeps columns aligned when a review spans multiple lines", () => {
    const csv = [
      HEADER,
      '"Dune","Frank Herbert","","",5,"First paragraph of the review.',
      "",
      'Second paragraph, with a comma.",read,2024/01/05,2024/01/01,"sci-fi"',
      '"Neuromancer","William Gibson","","",4,"Short one.",read,2024/02/05,2024/02/01,""',
    ].join("\n");

    const books = parseGoodreadsCSV(csv);

    expect(books).toHaveLength(2);

    // The row whose review contains newlines must survive intact.
    expect(books[0].title).toBe("Dune");
    expect(books[0].myRating).toBe(5);
    expect(books[0].exclusiveShelf).toBe("read");
    expect(books[0].dateRead).toEqual(new Date(2024, 0, 5));
    expect(books[0].bookshelves).toEqual(["sci-fi"]);

    // And the row after it must not be knocked out of alignment either.
    expect(books[1].title).toBe("Neuromancer");
    expect(books[1].exclusiveShelf).toBe("read");
  });

  it("handles escaped quotes inside a quoted field", () => {
    const csv = [
      HEADER,
      '"The ""Good"" Book","A. Writer","","",3,"He said ""hello"" twice.",read,2024/03/01,2024/02/01,""',
    ].join("\n");

    const books = parseGoodreadsCSV(csv);

    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('The "Good" Book');
    expect(books[0].exclusiveShelf).toBe("read");
  });

  it("handles CRLF line endings", () => {
    const csv = [
      HEADER,
      '"Dune","Frank Herbert","","",5,"ok",read,2024/01/05,2024/01/01,""',
    ].join("\r\n");

    const books = parseGoodreadsCSV(csv);

    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("Dune");
    expect(books[0].exclusiveShelf).toBe("read");
  });

  it("strips a UTF-8 BOM so the first column header still matches", () => {
    const csv =
      "﻿" +
      [
        HEADER,
        '"Dune","Frank Herbert","","",5,"ok",read,2024/01/05,2024/01/01,""',
      ].join("\n");

    const books = parseGoodreadsCSV(csv);

    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("Dune");
  });

  it("ignores blank lines and a trailing newline", () => {
    const csv =
      [
        HEADER,
        '"Dune","Frank Herbert","","",5,"ok",read,2024/01/05,2024/01/01,""',
        "",
        '"Neuromancer","William Gibson","","",4,"ok",read,2024/02/05,2024/02/01,""',
      ].join("\n") + "\n";

    expect(parseGoodreadsCSV(csv)).toHaveLength(2);
  });

  it("still rejects a file missing required columns", () => {
    expect(() => parseGoodreadsCSV("Author,ISBN\n\"A. Writer\",\"\"")).toThrow(
      /Missing required column: Title/
    );
  });
});
