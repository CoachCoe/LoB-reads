/**
 * Builds a small, gzipped dump fixture in the real Open Library format so the
 * pipeline can be exercised without downloading ~12GB.
 *
 * Every gotcha the spec calls out is represented deliberately:
 *   - keys arrive prefixed (/works/OL…, /authors/OL…)
 *   - `description` is sometimes a string, sometimes {type, value}
 *   - work authors are [{author:{key}}]; edition authors are [{key}]
 *   - publish_date is free text: "1965", "October 1, 1965", "n.d."
 *   - isbn_10 / isbn_13 are arrays
 *   - /type/redirect records appear and are not real records
 *   - a line with malformed JSON
 *   - a line with too few columns
 *   - a value containing a literal tab and newline, which would break COPY
 *     if not escaped
 *
 *   npx tsx scripts/ingest/make-fixture.ts
 */

import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { RAW_DIR, DUMPS } from "./dumps";

const tsv = (type: string, key: string, rev: number, json: unknown) =>
  [type, key, String(rev), "2024-01-01T00:00:00.000000", JSON.stringify(json)].join("\t");

const authors = [
  tsv("/type/author", "/authors/OL34184A", 5, {
    key: "/authors/OL34184A",
    name: "J. R. R. Tolkien",
    personal_name: "John Ronald Reuel Tolkien",
    birth_date: "3 January 1892",
    death_date: "2 September 1973",
    // Object-shaped text, the awkward variant.
    bio: { type: "/type/text", value: "English writer and philologist." },
    photos: [6146942],
    type: { key: "/type/author" },
  }),
  tsv("/type/author", "/authors/OL26320A", 3, {
    key: "/authors/OL26320A",
    name: "Frank Herbert",
    birth_date: "8 October 1920",
    death_date: "11 February 1986",
    // Plain-string bio, the other variant.
    bio: "American science fiction author.",
    type: { key: "/type/author" },
  }),
  tsv("/type/author", "/authors/OL23919A", 1, {
    key: "/authors/OL23919A",
    name: "Gabriel García Márquez",
    birth_date: "6 March 1927",
    type: { key: "/type/author" },
  }),
  // A redirect: present in real dumps, not a record.
  tsv("/type/redirect", "/authors/OL99999A", 2, {
    key: "/authors/OL99999A",
    location: "/authors/OL34184A",
    type: { key: "/type/redirect" },
  }),
  // Malformed JSON — must be quarantined, must not kill the stream.
  ["/type/author", "/authors/OL77777A", "1", "2024-01-01T00:00:00.000000", '{"name": "Broken", '].join("\t"),
  // Too few columns.
  "/type/author\t/authors/OL66666A\t1",
];

const works = [
  tsv("/type/work", "/works/OL45804W", 14, {
    key: "/works/OL45804W",
    title: "The Hobbit",
    subtitle: "or There and Back Again",
    authors: [
      { type: { key: "/type/author_role" }, author: { key: "/authors/OL34184A" } },
    ],
    description: { type: "/type/text", value: "A hobbit is talked into an adventure." },
    subjects: ["Fantasy", "Adventure", "Middle-earth"],
    first_publish_date: "1937",
    covers: [6979861],
    type: { key: "/type/work" },
  }),
  tsv("/type/work", "/works/OL893415W", 9, {
    key: "/works/OL893415W",
    title: "Dune",
    authors: [
      { type: { key: "/type/author_role" }, author: { key: "/authors/OL26320A" } },
    ],
    // Plain-string description.
    description: "Paul Atreides on the desert planet Arrakis.",
    subjects: ["Science Fiction", "Desert"],
    first_publish_date: "1965",
    type: { key: "/type/work" },
  }),
  tsv("/type/work", "/works/OL27448W", 4, {
    key: "/works/OL27448W",
    // Contains a literal tab and newline, which break COPY unless escaped.
    title: "One Hundred\tYears of\nSolitude",
    authors: [
      { type: { key: "/type/author_role" }, author: { key: "/authors/OL23919A" } },
    ],
    subjects: ["Magical Realism"],
    first_publish_date: "1967",
    type: { key: "/type/work" },
  }),
  // A work with no author at all — real, and it breaks the spec's M1
  // acceptance criterion unless the slice filters for it.
  tsv("/type/work", "/works/OL00000W", 1, {
    key: "/works/OL00000W",
    title: "Anonymous Fragment",
    subjects: [],
    type: { key: "/type/work" },
  }),
];

const editions = [
  tsv("/type/edition", "/books/OL7353617M", 3, {
    key: "/books/OL7353617M",
    title: "The Hobbit",
    works: [{ key: "/works/OL45804W" }],
    // Edition authors are a flatter shape than work authors.
    authors: [{ key: "/authors/OL34184A" }],
    publishers: ["Houghton Mifflin"],
    publish_date: "October 1, 1988",
    number_of_pages: 304,
    isbn_10: ["0395071224"],
    isbn_13: ["9780395071229"],
    languages: [{ key: "/languages/eng" }],
    physical_format: "Hardcover",
    covers: [6979861],
    type: { key: "/type/edition" },
  }),
  tsv("/type/edition", "/books/OL1532554M", 2, {
    key: "/books/OL1532554M",
    title: "The Hobbit",
    works: [{ key: "/works/OL45804W" }],
    publishers: ["Del Rey"],
    publish_date: "1986",
    number_of_pages: 287,
    // ISBN-10 only, with an X check digit — must canonicalize to ISBN-13.
    isbn_10: ["034533968X"],
    languages: [{ key: "/languages/eng" }],
    type: { key: "/type/edition" },
  }),
  tsv("/type/edition", "/books/OL7947094M", 1, {
    key: "/books/OL7947094M",
    title: "Dune",
    works: [{ key: "/works/OL893415W" }],
    publishers: ["Chilton Books"],
    publish_date: "1965",
    number_of_pages: 412,
    isbn_13: ["9780441172719"],
    languages: [{ key: "/languages/eng" }],
    covers: [8188903],
    type: { key: "/type/edition" },
  }),
  tsv("/type/edition", "/books/OL5555555M", 1, {
    key: "/books/OL5555555M",
    title: "Cien años de soledad",
    works: [{ key: "/works/OL27448W" }],
    publishers: ["Editorial Sudamericana"],
    // Unparseable date — keep raw, leave publish_year null.
    publish_date: "n.d.",
    isbn_10: ["0060883286"],
    languages: [{ key: "/languages/spa" }],
    type: { key: "/type/edition" },
  }),
  // No ISBN and pre-1900: excluded by the default slice.
  tsv("/type/edition", "/books/OL1111111M", 1, {
    key: "/books/OL1111111M",
    title: "Anonymous Fragment",
    works: [{ key: "/works/OL00000W" }],
    publish_date: "1650",
    languages: [{ key: "/languages/lat" }],
    type: { key: "/type/edition" },
  }),
];

mkdirSync(RAW_DIR, { recursive: true });

for (const [type, lines] of [
  ["authors", authors],
  ["works", works],
  ["editions", editions],
] as const) {
  const file = path.join(RAW_DIR, DUMPS[type].file);
  writeFileSync(file, gzipSync(Buffer.from(lines.join("\n") + "\n")));
  console.log(`wrote ${file}  (${lines.length} lines)`);
}
