import {
  corpusIsbnToCanonical,
  isCoercedIsbn13,
} from "../../scripts/social/corpus-isbn";

/**
 * Reading ISBNs out of a corpus whose CSV went through a spreadsheet.
 *
 * `scripts/social` had no tests at all, and this is where that showed: taking
 * goodbooks-10k's ISBN columns at face value silently cost 6,481 of 9,300
 * books and three quarters of the ratings behind every recommendation. Nothing
 * failed — the loader reported success, matched a third of the corpus, and the
 * shortfall was only visible by reading the raw file.
 *
 * The real values below are from the 2017 goodbooks-10k release.
 */

describe("corpusIsbnToCanonical", () => {
  it("restores a leading zero the spreadsheet dropped", () => {
    // The Hunger Games: 0439023483, stored as 439023483.
    expect(corpusIsbnToCanonical("439023483")).toBe(
      corpusIsbnToCanonical("0439023483")
    );
    expect(corpusIsbnToCanonical("439023483")).not.toBeNull();
  });

  it("restores two and three dropped zeros", () => {
    // 916 values were eight characters and 112 were seven.
    expect(corpusIsbnToCanonical("61120081")).toBe(
      corpusIsbnToCanonical("0061120081")
    );
    expect(corpusIsbnToCanonical("6112008")).toBe(
      corpusIsbnToCanonical("0006112008")
    );
  });

  it("leaves an intact ten-character ISBN alone", () => {
    expect(corpusIsbnToCanonical("0743273567")).toBe("9780743273565");
  });

  it("does NOT validate the ISBN-10 check digit", () => {
    // Documents a real limitation rather than asserting a guarantee that does
    // not exist. isbn10To13 discards the check digit — it uses the first nine
    // digits and computes a fresh ISBN-13 one — so a corrupted tenth character
    // produces the same ISBN-13 as the correct value.
    //
    // The protection against a mis-padded value is therefore not arithmetic:
    // it is that the resulting ISBN-13 must exist in catalog.editions. A wrong
    // guess loses a rating rather than attaching it to the wrong book.
    expect(corpusIsbnToCanonical("439023484")).toBe(
      corpusIsbnToCanonical("439023483")
    );
  });

  it("ignores hyphens and spaces", () => {
    expect(corpusIsbnToCanonical("0-7432-7356-7")).toBe("9780743273565");
    expect(corpusIsbnToCanonical(" 0743273567 ")).toBe("9780743273565");
  });

  it("keeps an X check digit", () => {
    expect(corpusIsbnToCanonical("034533968X")).toBe("9780345339683");
  });

  it("returns null for an empty column", () => {
    expect(corpusIsbnToCanonical("")).toBeNull();
    expect(corpusIsbnToCanonical("   ")).toBeNull();
  });

  it("does not pad something longer than an ISBN-10", () => {
    // A 13-digit value in the isbn10 column is not a truncated ISBN-10, and
    // padding it would produce a different number entirely.
    expect(corpusIsbnToCanonical("9780743273565")).toBe("9780743273565");
  });

  it("refuses scientific notation rather than guessing", () => {
    // The isbn13 column looks like this. Recovering it is not merely lossy:
    // the twelfth digit is rounded, and rebuilt values disagreed with the
    // isbn10 column on 1,199 of 2,680 rows. A 45% error rate matches books to
    // the wrong record, which is worse than matching nothing.
    expect(corpusIsbnToCanonical("9.78043902348e+12")).toBeNull();
  });
});

describe("isCoercedIsbn13", () => {
  it("recognises the shape so a skip can be explained", () => {
    expect(isCoercedIsbn13("9.78043902348e+12")).toBe(true);
    expect(isCoercedIsbn13("9.78043902348E12")).toBe(true);
  });

  it("does not flag a real ISBN", () => {
    expect(isCoercedIsbn13("9780743273565")).toBe(false);
    expect(isCoercedIsbn13("0743273567")).toBe(false);
  });
});
