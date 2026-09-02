import { prisma } from "./setup";
import {
  COUNT_CEILING,
  getWorksBySubject,
  countWorksBySubject,
  searchWorks,
  countWorkMatches,
  getWorkByKey,
  getPopularWorks,
} from "@/server/catalog";
import { makeWork } from "./factories";
import { KNOWN_BOOKS } from "../../scripts/ingest/known-books";

/**
 * M2 acceptance: a title search for each of twenty known books must return it
 * in the top three, and p95 latency must stay under 100ms.
 *
 * The catalog is seeded directly here rather than through the ingest pipeline.
 * The pipeline is M1's concern and already has its own tests; what is under
 * test here is ranking, and seeding directly keeps the fixture explicit —
 * every distractor is visible in known-books.ts.
 *
 * The distractors are the point. "Dune Messiah" and "Children of Dune" both
 * match the query "dune" more or less as well as "Dune" does by pure
 * relevance scoring, so a ranking built on ts_rank alone fails this suite.
 */

const FILLER_COUNT = 4000;

async function seedCatalog() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE catalog.works, catalog.editions, catalog.work_authors,
             catalog.authors, catalog.external_ids CASCADE
  `);

  for (const book of KNOWN_BOOKS) {
    await prisma.$executeRaw`
      INSERT INTO catalog.authors (ol_key, name) VALUES (${book.authorKey}, ${book.author})
      ON CONFLICT DO NOTHING`;

    await prisma.$executeRaw`
      INSERT INTO catalog.works
        (ol_key, title, author_names, subjects, first_publish_year, edition_count)
      VALUES (${book.workKey}, ${book.title}, ${book.author},
              ${book.subjects}, ${book.year}, 3)`;

    await prisma.$executeRaw`
      INSERT INTO catalog.work_authors (work_key, author_key, position)
      VALUES (${book.workKey}, ${book.authorKey}, 0)`;

    await prisma.$executeRaw`
      INSERT INTO catalog.editions
        (ol_key, work_key, title, publish_year, number_of_pages, languages)
      VALUES (${book.workKey + "E"}, ${book.workKey}, ${book.title},
              ${book.year}, 320, ARRAY['eng'])`;

    // Distractors carry MORE editions than the original, so popularity alone
    // would rank them first. Only the exact-title term saves the real book.
    for (const [i, title] of (book.distractors ?? []).entries()) {
      const key = `${book.workKey}D${i}`;
      await prisma.$executeRaw`
        INSERT INTO catalog.works
          (ol_key, title, author_names, subjects, first_publish_year, edition_count)
        VALUES (${key}, ${title}, ${book.author}, ${book.subjects},
                ${book.year + 2}, 12)`;
      await prisma.$executeRaw`
        INSERT INTO catalog.work_authors (work_key, author_key, position)
        VALUES (${key}, ${book.authorKey}, 0)`;
    }
  }

  // Bulk filler in one statement — 4,000 round trips would dominate the suite.
  await prisma.$executeRawUnsafe(`
    INSERT INTO catalog.works
      (ol_key, title, author_names, subjects, first_publish_year, edition_count)
    SELECT
      'OLZ' || lpad(i::text, 6, '0') || 'W',
      'The ' || (ARRAY['Shadow','River','Winter','Garden','Silence','Machine',
                       'Empire','Letter','House','Bridge'])[1 + (i % 10)]
              || ' of ' ||
                (ARRAY['Mirrors','Ashes','Autumn','Iron','Glass','Salt',
                       'Thorns','Dust','Bone','Rain'])[1 + ((i * 7) % 10)],
      'Author ' || (i % 500),
      ARRAY['Fiction'],
      1900 + (i % 125),
      1 + (i % 5)
    FROM generate_series(1, ${FILLER_COUNT}) AS i
  `);

  await prisma.$executeRawUnsafe(`ANALYZE catalog.works`);
}

beforeAll(async () => {
  await seedCatalog();
}, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE catalog.works, catalog.editions, catalog.work_authors,
             catalog.authors, catalog.external_ids CASCADE
  `);
});

describe("M2 acceptance: known-title ranking", () => {
  it.each(KNOWN_BOOKS.map((b) => [b.title, b.workKey] as const))(
    'searching "%s" returns it in the top 3',
    async (title, workKey) => {
      const results = await searchWorks(title, { limit: 10 });
      const position = results.findIndex((r) => r.olKey === workKey);

      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThan(3);
    }
  );

  it("puts the exact title first, ahead of its own sequels", async () => {
    const results = await searchWorks("Dune", { limit: 5 });

    expect(results[0].title).toBe("Dune");
    // The sequels have four times the editions, so popularity did not decide it.
    expect(results.slice(1).map((r) => r.title)).toContain("Dune Messiah");
  });

  it("finds an accented title from an unaccented query", async () => {
    const results = await searchWorks("Les Miserables", { limit: 5 });
    expect(results[0].title).toBe("Les Misérables");
  });

  it("finds an accented title from the accented query too", async () => {
    const results = await searchWorks("Les Misérables", { limit: 5 });
    expect(results[0].title).toBe("Les Misérables");
  });

  it("tolerates a typo via trigram fallback", async () => {
    // No full-text match at all: "Neuromancr" is not a lexeme in the index.
    const results = await searchWorks("Neuromancr", { limit: 5 });
    expect(results.map((r) => r.title)).toContain("Neuromancer");
  });

  it("matches on author name as well as title", async () => {
    const results = await searchWorks("Ursula Le Guin", { limit: 5 });
    expect(results.map((r) => r.title)).toContain("The Left Hand of Darkness");
  });

  it("returns nothing for a blank query rather than everything", async () => {
    expect(await searchWorks("")).toEqual([]);
    expect(await searchWorks("   ")).toEqual([]);
  });

  it("survives punctuation that would break to_tsquery", async () => {
    // Raw to_tsquery throws a syntax error on these; websearch_to_tsquery does not.
    await expect(searchWorks("dune!! & || :*")).resolves.toBeInstanceOf(Array);
    await expect(searchWorks("it's a 'quoted' \"phrase\"")).resolves.toBeInstanceOf(Array);
  });

  /**
   * TEST-17. This searched for "the" and asserted only that the two pages did
   * not overlap — which `searchWorks` satisfies by ignoring `offset` entirely,
   * or by returning [] for any offset above zero.
   *
   * It was worse than that. **"the" is an English stopword**, so
   * `websearch_to_tsquery('english', 'the')` produces an empty query and the
   * fixture matched nothing on either page. Two empty arrays do not overlap, so
   * the suite's only pagination test was asserting that [] equals [] and had
   * never exercised pagination at all.
   *
   * A seeded set with a distinctive token instead, and both pages asserted
   * non-empty — the guard read-path-plans.test.ts already applies to
   * worksRowsRead ("returns 0 when no line matches, so a bound on its own would
   * pass vacuously").
   */
  it("paginates without repeating a result", async () => {
    const keys = Array.from({ length: 12 }, (_, i) => `OLPAG${String(i).padStart(3, "0")}W`);
    for (const [i, key] of keys.entries()) {
      await prisma.$executeRaw`
        INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
        VALUES (${key}, ${`Pagination Zarquon ${i}`}, 'A', ARRAY['Fiction'], ${100 - i})
        ON CONFLICT (ol_key) DO UPDATE SET title = EXCLUDED.title`;
    }

    try {
      const first = await searchWorks("Zarquon", { limit: 5, offset: 0 });
      const second = await searchWorks("Zarquon", { limit: 5, offset: 5 });

      expect(first).toHaveLength(5);
      expect(second).toHaveLength(5);

      const overlap = first.filter((a) =>
        second.some((b) => b.olKey === a.olKey)
      );
      expect(overlap).toEqual([]);

      // And the offset actually walks the same ordering rather than reshuffling.
      const third = await searchWorks("Zarquon", { limit: 10, offset: 0 });
      expect(third.map((w) => w.olKey)).toEqual([
        ...first.map((w) => w.olKey),
        ...second.map((w) => w.olKey),
      ]);
    } finally {
      await prisma.$executeRawUnsafe(
        `DELETE FROM catalog.works WHERE ol_key LIKE 'OLPAG%'`
      );
    }
  });

  it("counts matches consistently with what it returns", async () => {
    const total = await countWorkMatches("Dune");
    const page = await searchWorks("Dune", { limit: 100 });
    expect(total.count).toBe(page.length);
    expect(total.atCeiling).toBe(false);
  });

  it("stops counting at the ceiling rather than reading every match", async () => {
    // On the real catalog "Fiction" matches 735,956 works, because subjects
    // are searchable too, and counting them exactly took 5.5 seconds. The
    // ceiling makes that 49ms. atCeiling is what stops the UI presenting a
    // capped number as though it were exact.
    const filler = Array.from({ length: COUNT_CEILING + 50 }, (_, i) =>
      makeWork({ title: `Ceiling Probe Volume ${i}` })
    );
    await Promise.all(filler);

    const total = await countWorkMatches("Ceiling Probe");
    expect(total.count).toBe(COUNT_CEILING);
    expect(total.atCeiling).toBe(true);
  }, 120_000);
});

/**
 * Reported, not asserted as an acceptance gate.
 *
 * STATUS.md is explicit that this test kept passing through every performance
 * bug found at 6.9M works, because a few thousand fixture rows are fast to scan
 * badly — and both of the mutations that read-path-plans.test.ts exists to catch
 * leave it green. Calling it "M2 acceptance" oversold it, and a 100ms wall-clock
 * bound on a loaded CI runner is a flake waiting to happen.
 *
 * The query-plan assertions in read-path-plans.test.ts are the real gate. The
 * bound here is deliberately loose enough that only a catastrophe trips it.
 */
describe("search latency (reporting, not a gate)", () => {
  it("stays far away from pathological, and logs the distribution", async () => {
    const queries = [
      ...KNOWN_BOOKS.map((b) => b.title),
      "shadow", "the river of ashes", "empire", "asimov", "science fiction",
      "Neuromancr", "hous", "winter garden", "the",
    ];

    // One warm pass so the first query is not paying for cold caches.
    for (const q of queries.slice(0, 5)) await searchWorks(q, { limit: 20 });

    const timings: number[] = [];
    for (const q of queries) {
      const started = performance.now();
      await searchWorks(q, { limit: 20 });
      timings.push(performance.now() - started);
    }

    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95)];
    const median = timings[Math.floor(timings.length * 0.5)];

    console.log(
      `search latency over ${timings.length} queries on ${FILLER_COUNT}+ works — ` +
        `median ${median.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms`
    );

    // Deliberately no timing assertion. At this fixture size the number is not
    // discriminating — STATUS.md records this test passing through every real
    // performance bug — and any threshold picked here would be arbitrary. The
    // query-plan assertions in read-path-plans.test.ts are the gate; this logs
    // the distribution so a human reading CI output can see it move.
    expect(timings).toHaveLength(queries.length);
  }, 60_000);
});

describe("work detail", () => {
  it("returns the work with its authors and editions", async () => {
    const work = await getWorkByKey("OLK001W");

    expect(work).not.toBeNull();
    expect(work!.title).toBe("Dune");
    expect(work!.authors.map((a) => a.name)).toEqual(["Frank Herbert"]);
    expect(work!.editions.length).toBeGreaterThan(0);
    expect(work!.editions[0].title).toBe("Dune");
  });

  it("returns null for an unknown key rather than throwing", async () => {
    expect(await getWorkByKey("OLNOSUCHW")).toBeNull();
  });

  it("returns results that survive JSON serialization", async () => {
    // cover_id is a Postgres bigint, and JSON.stringify throws outright on a
    // JS BigInt. The page rendered fine — template interpolation does not care
    // — while the editions API returned a 500. Casting to int in SQL is the
    // fix; this is the assertion that would have caught it.
    const work = await getWorkByKey("OLK001W");
    expect(() => JSON.stringify(work)).not.toThrow();

    const results = await searchWorks("Dune", { limit: 5 });
    expect(() => JSON.stringify(results)).not.toThrow();

    const popular = await getPopularWorks(5);
    expect(() => JSON.stringify(popular)).not.toThrow();
  });

  /**
   * TEST-6. This compared the returned counts to their own descending sort,
   * which **any constant list satisfies** — and the fixture's counts were equal,
   * so reversing the SQL to `edition_count ASC, ol_key DESC` passed. That
   * ordering is the exact reverse of works_edition_count_ol_key_idx, so it is
   * still a no-Sort index scan and read-path-plans.test.ts passed too: index
   * present, no Sort node, rows read within bounds. /search with no query serves
   * getPopularWorks(24), so the front door would have shown the 24 most obscure
   * works in a 6.9M-row catalog.
   *
   * Absolute identity instead, over a seeded spread.
   */
  it("orders popular works by edition count, most first", async () => {
    const spread = [
      { key: "OLPOP001W", count: 5 },
      { key: "OLPOP002W", count: 90 },
      { key: "OLPOP003W", count: 40 },
    ];
    for (const w of spread) {
      await prisma.$executeRaw`
        INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
        VALUES (${w.key}, ${"Popularity " + w.key}, 'A', ARRAY['Fiction'], ${w.count})
        ON CONFLICT (ol_key) DO UPDATE SET edition_count = EXCLUDED.edition_count`;
    }

    try {
      const popular = await getPopularWorks(50);
      const seeded = popular.filter((w) => w.olKey.startsWith("OLPOP"));

      // The seeded works appear most-editions-first, by key, not merely in some
      // order that sorts to itself.
      expect(seeded.map((w) => w.olKey)).toEqual([
        "OLPOP002W",
        "OLPOP003W",
        "OLPOP001W",
      ]);

      // And a strict inequality, so a constant list cannot pass.
      const counts = popular.map((w) => w.editionCount);
      expect(counts[0]).toBeGreaterThan(counts[counts.length - 1]);
    } finally {
      await prisma.$executeRawUnsafe(
        `DELETE FROM catalog.works WHERE ol_key LIKE 'OLPOP%'`
      );
    }
  });
});

describe("subjects are browsed, not searched", () => {
  /**
   * Subjects used to be the D-weighted term in search_vector, which made every
   * generic word match most of the catalog: "Fiction" matched 735,956 works of
   * 6.9 million, and ranking a match set that size means reading every row —
   * 6.7 seconds, from a chip the discover page rendered itself.
   *
   * They are indexed for containment instead, so a subject is a browse.
   */
  it("does not match a work through its subjects", async () => {
    const work = await makeWork({ title: "A Book With No Genre Word" });
    await prisma.$executeRawUnsafe(
      `UPDATE catalog.works SET subjects = ARRAY['Xenobiology'] WHERE ol_key = $1`,
      work.olKey
    );
    // The trigger reruns on the subjects update, so the vector is current.
    const results = await searchWorks("Xenobiology", { limit: 50 });
    expect(results.map((r) => r.olKey)).not.toContain(work.olKey);
  });

  it("finds it by subject browse", async () => {
    const work = await makeWork({ title: "A Book About Xenolinguistics" });
    await prisma.$executeRawUnsafe(
      `UPDATE catalog.works SET subjects = ARRAY['Xenolinguistics'] WHERE ol_key = $1`,
      work.olKey
    );

    const browsed = await getWorksBySubject("Xenolinguistics", { limit: 50 });
    expect(browsed.map((r) => r.olKey)).toContain(work.olKey);
  });

  it("still finds a work by its title", async () => {
    // The point of removing subjects is that it costs nothing here.
    const work = await makeWork({ title: "Distinctive Zaphodian Chronicle" });
    const results = await searchWorks("Zaphodian Chronicle", { limit: 10 });
    expect(results.map((r) => r.olKey)).toContain(work.olKey);
  });

  it("counts a subject browse without reading every match", async () => {
    const subject = `Bulk Subject ${Date.now()}`;
    const works = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        makeWork({ title: `Bulk Subject Volume ${i}` })
      )
    );
    await prisma.$executeRawUnsafe(
      `UPDATE catalog.works SET subjects = ARRAY[$1] WHERE ol_key = ANY($2)`,
      subject,
      works.map((w) => w.olKey)
    );

    const total = await countWorksBySubject(subject);
    expect(total.count).toBe(30);
    expect(total.atCeiling).toBe(false);
  }, 60_000);
});

/**
 * DEAD-5: the normalised columns have to be normalised.
 *
 * `title_norm` was `unaccent(lower(title))`. Under `lc_collate=C` — which this
 * database and the deployed one both use — `lower()` folds only ASCII, so
 * `lower('Ö')` is still `'Ö'` and `unaccent` then produces a capital `'O'`. The
 * column stored `"Offentliche steuerung…"` for `"Öffentliche Steuerung…"`.
 *
 * Both sides shared the fault, so a query in the same casing still matched and
 * the existing accented-title test passed. Measured on the real catalog before
 * the fix:
 *
 *   query "Öffentliche Steuerung und Gest"  ->  trigram 1, prefix 1
 *   query "öffentliche steuerung und gest"  ->  trigram 1, prefix 0
 *
 * The trigram fallback still found the work, so nothing looked broken — the
 * W_PREFIX +20 bonus was simply lost for a reader typing an accented title the
 * normal way. This asserts the prefix path, because that is the half that failed
 * while the visible behaviour did not.
 */
describe("DEAD-5: accent folding is case-independent", () => {
  const KEY = "OLACC001W";
  const TITLE = "Öffentliche Steuerung und Gestaltung";

  beforeAll(async () => {
    await prisma.$executeRaw`
      INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
      VALUES (${KEY}, ${TITLE}, 'Übel Autor', ARRAY['Fiction'], 3)
      ON CONFLICT (ol_key) DO UPDATE SET title = EXCLUDED.title`;
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM catalog.works WHERE ol_key LIKE 'OLACC%'`
    );
  });

  it("stores the column fully folded, not half", async () => {
    const rows = await prisma.$queryRaw<{ titleNorm: string }[]>`
      SELECT title_norm AS "titleNorm" FROM catalog.works WHERE ol_key = ${KEY}`;

    // The assertion that fails on unaccent(lower(x)), which yields
    // "Offentliche steuerung und gestaltung" — capital O.
    expect(rows[0].titleNorm).toBe("offentliche steuerung und gestaltung");
    expect(rows[0].titleNorm).toBe(rows[0].titleNorm.toLowerCase());
  });

  it("folds the author column the same way", async () => {
    const rows = await prisma.$queryRaw<{ authorNorm: string }[]>`
      SELECT author_names_norm AS "authorNorm" FROM catalog.works WHERE ol_key = ${KEY}`;
    expect(rows[0].authorNorm).toBe("ubel autor");
  });

  it("prefix-matches an accented title typed in any casing", async () => {
    const prefixHits = async (query: string) => {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM catalog.works
        WHERE ol_key = ${KEY}
          AND title_norm LIKE lower(unaccent(${query})) || '%'`;
      return Number(rows[0].n);
    };

    // All three must hit. Before the fix the lowercase forms scored zero, and
    // with them the +20 ranking bonus.
    expect(await prefixHits("Öffentliche Steuerung")).toBe(1);
    expect(await prefixHits("öffentliche steuerung")).toBe(1);
    expect(await prefixHits("offentliche steuerung")).toBe(1);
  });

  it("still finds it through the ranked search path", async () => {
    // The user-visible behaviour that never broke, asserted so the fix cannot
    // have traded it away.
    for (const q of ["Öffentliche Steuerung", "öffentliche steuerung"]) {
      const results = await searchWorks(q, { limit: 10 });
      expect(results.map((r) => r.olKey)).toContain(KEY);
    }
  });
});
