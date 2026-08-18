import { prisma } from "./setup";

/**
 * The ingest's SQL helper functions, tested where they run.
 *
 * These are plpgsql, so testing them means calling them in Postgres rather
 * than reimplementing the logic in TypeScript and asserting against a copy —
 * the mistake the original audit found in this repo's first test suite.
 *
 * The ISBN converter matters most: it silently determines the cross-source
 * match rate. A wrong check digit produces ISBNs that look valid and join to
 * nothing, and the failure mode is a quietly emptier catalog, not an error.
 */

const scalar = async <T>(sql: string): Promise<T> => {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, T>>>(sql);
  return Object.values(rows[0])[0];
};

describe("catalog.isbn10_to_13", () => {
  // Real books. Each pair is the ISBN-10 printed on the copy and the ISBN-13
  // it corresponds to, so a regression here is checkable against a shelf.
  it.each([
    ["0395071224", "9780395071229", "The Hobbit, Houghton Mifflin"],
    ["034533968X", "9780345339683", "The Hobbit, Del Rey — X check digit"],
    ["0441172717", "9780441172719", "Dune, Ace"],
    ["0060883286", "9780060883287", "One Hundred Years of Solitude"],
    ["0747532699", "9780747532699", "Harry Potter, Bloomsbury"],
  ])("converts %s to %s (%s)", async (isbn10, expected) => {
    expect(await scalar(`SELECT catalog.isbn10_to_13('${isbn10}')`)).toBe(expected);
  });

  it("accepts hyphenated and spaced input", async () => {
    expect(await scalar(`SELECT catalog.isbn10_to_13('0-395-07122-4')`)).toBe(
      "9780395071229"
    );
    expect(await scalar(`SELECT catalog.isbn10_to_13('0 395 07122 4')`)).toBe(
      "9780395071229"
    );
  });

  it("accepts a lowercase x check digit", async () => {
    expect(await scalar(`SELECT catalog.isbn10_to_13('034533968x')`)).toBe(
      "9780345339683"
    );
  });

  it.each([
    ["too short", "12345"],
    ["too long", "12345678901234"],
    ["an ISBN-13 passed in by mistake", "9780441172719"],
    ["letters other than X", "04411727A7"],
    ["empty", ""],
  ])("returns null for %s", async (_label, input) => {
    expect(await scalar(`SELECT catalog.isbn10_to_13('${input}')`)).toBeNull();
  });

  it("returns null rather than throwing on null input", async () => {
    expect(await scalar(`SELECT catalog.isbn10_to_13(NULL)`)).toBeNull();
  });

  it("always produces a self-consistent check digit", async () => {
    // Whatever it emits must validate, which is the property that matters.
    const allValid = await scalar<boolean>(`
      SELECT bool_and(catalog.is_valid_isbn13(catalog.isbn10_to_13(i)))
      FROM (VALUES ('0395071224'),('034533968X'),('0441172717'),
                   ('0060883286'),('0747532699')) AS t(i)
    `);
    expect(allValid).toBe(true);
  });
});

describe("catalog.is_valid_isbn13", () => {
  it("accepts a correct check digit", async () => {
    expect(await scalar(`SELECT catalog.is_valid_isbn13('9780441172719')`)).toBe(true);
  });

  it("rejects a corrupted check digit", async () => {
    expect(await scalar(`SELECT catalog.is_valid_isbn13('9780441172718')`)).toBe(false);
  });

  it("rejects anything that is not 13 digits", async () => {
    expect(await scalar(`SELECT catalog.is_valid_isbn13('978044117271')`)).toBe(false);
    expect(await scalar(`SELECT catalog.is_valid_isbn13('978-0441172719')`)).toBe(false);
    expect(await scalar(`SELECT catalog.is_valid_isbn13(NULL)`)).toBe(false);
  });
});

describe("catalog.publish_year", () => {
  it.each([
    ["1965", 1965],
    ["October 1, 1965", 1965],
    ["1965-10-01", 1965],
    ["c1965", 1965],
    ["2003", 2003],
  ])("extracts a year from %s", async (raw, expected) => {
    expect(await scalar(`SELECT catalog.publish_year('${raw}')`)).toBe(expected);
  });

  it.each([
    ["n.d.", "no date at all"],
    ["", "empty"],
    ["unknown", "prose"],
  ])("returns null for %s (%s)", async (raw) => {
    expect(await scalar(`SELECT catalog.publish_year('${raw}')`)).toBeNull();
  });

  it("rejects an implausible future year", async () => {
    expect(await scalar(`SELECT catalog.publish_year('2999')`)).toBeNull();
  });
});

describe("catalog.text_value", () => {
  it("reads a plain string description", async () => {
    expect(await scalar(`SELECT catalog.text_value('"just a string"'::jsonb)`)).toBe(
      "just a string"
    );
  });

  it("reads the object-shaped variant Open Library also emits", async () => {
    expect(
      await scalar(
        `SELECT catalog.text_value('{"type":"/type/text","value":"the value"}'::jsonb)`
      )
    ).toBe("the value");
  });

  it("returns null for shapes it does not recognise", async () => {
    expect(await scalar(`SELECT catalog.text_value('[1,2,3]'::jsonb)`)).toBeNull();
    expect(await scalar(`SELECT catalog.text_value(NULL)`)).toBeNull();
  });
});

describe("catalog.works search vector", () => {
  it("stays in step with the title, which a one-off UPDATE would not", async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO catalog.works (ol_key, title, author_names)
      VALUES ('OLVECTORTESTW', 'Les Misérables', 'Victor Hugo')
    `);

    const matches = (term: string) =>
      scalar<bigint>(`
        SELECT count(*) FROM catalog.works
        WHERE ol_key = 'OLVECTORTESTW'
          AND search_vector @@ plainto_tsquery('english', unaccent('${term}'))
      `);

    // Populated on INSERT by the trigger, and accent-insensitive.
    expect(Number(await matches("miserables"))).toBe(1);
    expect(Number(await matches("Victor Hugo"))).toBe(1);

    await prisma.$executeRawUnsafe(`
      UPDATE catalog.works SET title = 'The Hunchback of Notre Dame'
      WHERE ol_key = 'OLVECTORTESTW'
    `);

    expect(Number(await matches("miserables"))).toBe(0);
    expect(Number(await matches("Hunchback"))).toBe(1);

    await prisma.$executeRawUnsafe(
      `DELETE FROM catalog.works WHERE ol_key = 'OLVECTORTESTW'`
    );
  });
});

describe("catalog.jsonb_bigint", () => {
  /**
   * Open Library emits JSON null inside the covers and photos arrays — 933
   * editions in the 2026-07-31 dump carry "covers": [null]. A JSON null is not
   * a SQL NULL: casting it to text yields the string 'null', so
   * `(data->'covers'->0)::text::bigint` raises
   *
   *   invalid input syntax for type bigint: "null"
   *
   * Normalize is a single transaction over ~100 million rows, so those 933
   * rows would have rolled back the entire run after tens of minutes, naming a
   * type rather than a record. Found by preflight.sql before it ran.
   */
  async function call(json: string): Promise<bigint | null> {
    const [row] = await prisma.$queryRawUnsafe<{ v: bigint | null }[]>(
      `SELECT catalog.jsonb_bigint($1::jsonb) AS v`,
      json
    );
    return row.v;
  }

  it("reads a plain number", async () => {
    expect(await call("12345")).toBe(BigInt(12345));
  });

  it("returns NULL for a JSON null rather than raising", async () => {
    // The actual bug. Not merely wrong — it aborted the transaction.
    expect(await call("null")).toBeNull();
  });

  it("returns NULL for a string, even a numeric-looking one", async () => {
    expect(await call('"12345"')).toBeNull();
  });

  it("returns NULL for a fractional number", async () => {
    // ::bigint rejects it, so the guard has to catch it first.
    expect(await call("3.5")).toBeNull();
  });

  it("returns NULL for a number too wide for bigint", async () => {
    expect(await call("99999999999999999999")).toBeNull();
  });

  it("returns NULL for an object or array", async () => {
    expect(await call('{"a":1}')).toBeNull();
    expect(await call("[1]")).toBeNull();
  });

  it("survives every cover value in a realistic mix", async () => {
    // What normalize does, over the shapes the dump actually contains.
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
      SELECT count(catalog.jsonb_bigint(v)) AS n
      FROM (VALUES ('123'::jsonb), ('null'::jsonb), ('"x"'::jsonb), ('4.5'::jsonb)) t(v)
    `);
    // Only the one valid number is counted; nothing raised.
    expect(Number(row.n)).toBe(1);
  });
});
