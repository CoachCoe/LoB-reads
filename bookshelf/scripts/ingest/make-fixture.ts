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
 *   npx tsx scripts/ingest/make-fixture.ts --scale 5000
 *
 * --scale adds N generated works on top, so search ranking and latency can be
 * measured against a catalog of realistic size. The twenty titles in
 * known-books.ts are always included: they are what the M2 acceptance check
 * searches for, and each ships with distractor titles designed to outrank it
 * if the ranking is naive.
 */

import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { RAW_DIR, DUMPS } from "./dumps";
import { KNOWN_BOOKS } from "./known-books";

const tsv = (type: string, key: string, rev: number, json: unknown) =>
  [type, key, String(rev), "2024-01-01T00:00:00.000000", JSON.stringify(json)].join("\t");

const authors: string[] = [
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

const works: string[] = [
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

const editions: string[] = [
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

// ---------------------------------------------------------------------------
// Scaled fixture: the twenty known titles, their distractors, and filler
// ---------------------------------------------------------------------------

const scaleIndex = process.argv.indexOf("--scale");
const scale = scaleIndex !== -1 ? Number(process.argv[scaleIndex + 1]) : 0;

/**
 * A syntactically valid ISBN-13 with a correct check digit. Random digits
 * produce a valid check digit only about one time in ten, and normalize
 * discards the rest — which silently shrinks the fixture by 90%.
 */
function isbn13(body12: string): string {
  let total = 0;
  for (let i = 0; i < 12; i++) {
    total += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return body12 + String((10 - (total % 10)) % 10);
}

/** Deterministic pseudo-random, so a fixture is reproducible across runs. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const SUBJECT_POOL = [
  "Fiction", "Science Fiction", "Fantasy", "Mystery", "Romance", "History",
  "Biography", "Poetry", "Horror", "Adventure", "Literary Fiction", "Essays",
];
const TITLE_WORDS = [
  "Shadow", "River", "Winter", "Garden", "Silence", "Machine", "Empire",
  "Letter", "House", "Bridge", "Compass", "Harvest", "Lantern", "Mirror",
  "Orchard", "Signal", "Threshold", "Voyage", "Windmill", "Cathedral",
];

if (scale > 0) {
  const random = seeded(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];

  // The twenty acceptance titles, each with a real author record.
  for (const book of KNOWN_BOOKS) {
    authors.push(
      tsv("/type/author", `/authors/${book.authorKey}`, 1, {
        key: `/authors/${book.authorKey}`,
        name: book.author,
        type: { key: "/type/author" },
      })
    );
    works.push(
      tsv("/type/work", `/works/${book.workKey}`, 1, {
        key: `/works/${book.workKey}`,
        title: book.title,
        authors: [
          { type: { key: "/type/author_role" }, author: { key: `/authors/${book.authorKey}` } },
        ],
        subjects: book.subjects,
        first_publish_date: String(book.year),
        type: { key: "/type/work" },
      })
    );
    editions.push(
      tsv("/type/edition", `/books/${book.workKey}E`, 1, {
        key: `/books/${book.workKey}E`,
        title: book.title,
        works: [{ key: `/works/${book.workKey}` }],
        publishers: ["A Publisher"],
        publish_date: String(book.year),
        number_of_pages: 200 + Math.floor(random() * 400),
        isbn_13: [isbn13("978" + String(100000000 + Math.floor(random() * 899999999)))],
        languages: [{ key: "/languages/eng" }],
        covers: [1000 + Math.floor(random() * 9000)],
        type: { key: "/type/edition" },
      })
    );

    // Distractors: sequels and namesakes that must not outrank the original.
    (book.distractors ?? []).forEach((title, i) => {
      const key = `${book.workKey}D${i}`;
      works.push(
        tsv("/type/work", `/works/${key}`, 1, {
          key: `/works/${key}`,
          title,
          authors: [
            { type: { key: "/type/author_role" }, author: { key: `/authors/${book.authorKey}` } },
          ],
          subjects: book.subjects,
          first_publish_date: String(book.year + 2),
          type: { key: "/type/work" },
        })
      );
      editions.push(
        tsv("/type/edition", `/books/${key}E`, 1, {
          key: `/books/${key}E`,
          title,
          works: [{ key: `/works/${key}` }],
          publish_date: String(book.year + 2),
          isbn_13: [isbn13("979" + String(100000000 + Math.floor(random() * 899999999)))],
          languages: [{ key: "/languages/eng" }],
          type: { key: "/type/edition" },
        })
      );
    });
  }

  // Filler, so ranking has to discriminate against volume rather than a
  // handful of rows, and so latency is measured against a realistic index.
  for (let i = 0; i < scale; i++) {
    const authorKey = `OLF${String(i % Math.max(1, Math.floor(scale / 4))).padStart(6, "0")}A`;
    const workKey = `OLF${String(i).padStart(6, "0")}W`;

    if (i < Math.max(1, Math.floor(scale / 4))) {
      authors.push(
        tsv("/type/author", `/authors/${authorKey}`, 1, {
          key: `/authors/${authorKey}`,
          name: `${pick(TITLE_WORDS)} ${pick(["Ashcroft", "Bell", "Cortez", "Duval", "Egan", "Farrow"])}`,
          type: { key: "/type/author" },
        })
      );
    }

    const title = `The ${pick(TITLE_WORDS)} of ${pick(TITLE_WORDS)}${i % 7 === 0 ? ` ${pick(TITLE_WORDS)}` : ""}`;
    works.push(
      tsv("/type/work", `/works/${workKey}`, 1, {
        key: `/works/${workKey}`,
        title,
        authors: [
          { type: { key: "/type/author_role" }, author: { key: `/authors/${authorKey}` } },
        ],
        subjects: [pick(SUBJECT_POOL), pick(SUBJECT_POOL)],
        first_publish_date: String(1900 + Math.floor(random() * 125)),
        type: { key: "/type/work" },
      })
    );
    editions.push(
      tsv("/type/edition", `/books/${workKey}E`, 1, {
        key: `/books/${workKey}E`,
        title,
        works: [{ key: `/works/${workKey}` }],
        publish_date: String(1900 + Math.floor(random() * 125)),
        number_of_pages: 120 + Math.floor(random() * 500),
        isbn_13: [isbn13("978" + String(100000000 + i).slice(0, 9))],
        languages: [{ key: "/languages/eng" }],
        type: { key: "/type/edition" },
      })
    );
  }
}

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
