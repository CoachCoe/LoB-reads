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

  it("paginates without repeating a result", async () => {
    const first = await searchWorks("the", { limit: 5, offset: 0 });
    const second = await searchWorks("the", { limit: 5, offset: 5 });

    const overlap = first.filter((a) => second.some((b) => b.olKey === a.olKey));
    expect(overlap).toEqual([]);
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

describe("M2 acceptance: latency", () => {
  it("keeps p95 under 100ms across a spread of queries", async () => {
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

    expect(p95).toBeLessThan(100);
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

  it("orders popular works by edition count", async () => {
    const popular = await getPopularWorks(5);
    const counts = popular.map((w) => w.editionCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
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
