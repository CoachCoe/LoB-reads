import { prisma } from "./setup";
import {
  catalogSubjectsSql,
  countWorkMatchesSql,
  popularWorksSql,
  searchWorks,
  searchWorksSql,
  worksBySubjectSql,
  COUNT_CEILING,
} from "@/server/catalog";
import type { Prisma } from "@prisma/client";

/**
 * The hot read paths must not scan or sort the whole catalog.
 *
 * Every performance bug found when the catalog first reached 6.9 million works
 * passed a green suite of 214 integration tests:
 *
 *   getCatalogSubjects   3,944 ms  — unnested every work's subjects, per request
 *   getPopularWorks      1,976 ms  — sorted 6.9M rows, spilling 480MB, for 24
 *   countWorkMatches     5,481 ms  — counted every match exactly
 *   search "Fiction"     6,700 ms  — subjects in search_vector matched 735,956
 *
 * and the M2 latency test kept passing throughout, because four thousand
 * fixture rows are fast to scan badly.
 *
 * So these assert the PLAN, not the latency. "Does this query read the whole
 * table?" has the same answer at four thousand rows as at seven million, which
 * makes it the only version of the question a fixture can answer. Latency does
 * not survive the change of scale; shape does.
 *
 * A test here failing does not necessarily mean the query is wrong — it means
 * the query's cost has stopped being bounded by its result size, which is the
 * property that broke every time.
 */

const WORK_COUNT = 3000;

async function plan(sql: string, params: unknown[] = []): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN (ANALYZE, COSTS OFF) ${sql}`,
    ...params
  );
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

/**
 * EXPLAIN the statement the application actually sends.
 *
 * These assertions used to run against SQL typed into this file, which meant
 * they described the shape of their own copy: getCatalogSubjects could be
 * changed back to the live aggregate, getPopularWorks to an unindexable ORDER
 * BY, and getWorksBySubject to a text LIKE, and every test here stayed green.
 * The builders come from src/server/catalog.ts, so a change there is a change
 * to what is explained.
 */
const planOf = (sql: Prisma.Sql) => plan(sql.text, sql.values as unknown[]);

/**
 * The plan with sequential scans priced out of the way.
 *
 * For "can this predicate use its index", the unforced plan answers the wrong
 * question at fixture size: three thousand rows are genuinely cheaper to scan
 * than to look up, and the planner is right to say so. Forcing the choice
 * separates "chose not to" from "could not", and only the second is a defect —
 * an index that cannot serve a predicate cannot serve it at seven million rows
 * either.
 */
async function planWithoutSeqScan(sql: string, params: unknown[] = []): Promise<string> {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
    return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN (COSTS OFF) ${sql}`,
      ...params
    );
  });
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

/** Rows the plan actually read from catalog.works, whatever the access method. */
function worksRowsRead(explained: string): number {
  let worst = 0;
  for (const line of explained.split("\n")) {
    if (!/on works\b/.test(line)) continue;
    const match = line.match(/actual time=[\d.]+\.\.[\d.]+ rows=(\d+) loops=(\d+)/);
    if (match) worst = Math.max(worst, Number(match[1]) * Number(match[2]));
  }
  return worst;
}

beforeAll(async () => {
  // Enough rows that a full scan is distinguishable from a bounded read. The
  // planner also needs statistics, or it picks plans for an empty table.
  await prisma.$executeRawUnsafe(`
    INSERT INTO catalog.works
      (ol_key, title, author_names, subjects, edition_count, first_publish_year)
    SELECT 'OLPLAN' || lpad(i::text, 6, '0') || 'W',
           'Plan Fixture ' || (ARRAY['Alpha','Beta','Gamma','Delta'])[1 + (i % 4)] || ' ' || i,
           'Fixture Author ' || (i % 100),
           ARRAY['Fixture Subject ' || (i % 20)],
           1 + (i % 40),
           1900 + (i % 120)
    FROM generate_series(1, ${WORK_COUNT}) AS i
    ON CONFLICT (ol_key) DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO catalog.editions
      (ol_key, work_key, title, isbn13, publish_year, cover_id)
    SELECT 'OLPLAN' || lpad(i::text, 6, '0') || 'M',
           'OLPLAN' || lpad(i::text, 6, '0') || 'W',
           'Plan Fixture Edition ' || i,
           NULL, 1990 + (i % 30), i
    FROM generate_series(1, ${WORK_COUNT}) AS i
    ON CONFLICT (ol_key) DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO catalog.subject_counts (subject, work_count, computed_at)
    SELECT subject, count(*)::int, now()
    FROM catalog.works, unnest(subjects) AS subject
    GROUP BY subject
    ON CONFLICT DO NOTHING
  `);

  await prisma.$executeRawUnsafe(`ANALYZE catalog.works`);
  await prisma.$executeRawUnsafe(`ANALYZE catalog.editions`);
  await prisma.$executeRawUnsafe(`ANALYZE catalog.subject_counts`);
}, 120_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM catalog.editions WHERE ol_key LIKE 'OLPLAN%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM catalog.works WHERE ol_key LIKE 'OLPLAN%'`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM catalog.subject_counts WHERE subject LIKE 'Fixture Subject %'`
  );
  await prisma.$executeRawUnsafe(`ANALYZE catalog.works`);
});

describe("the discover page must not read the whole catalog", () => {
  it("reads popular works through an index, not a full sort", async () => {
    // The bug: ORDER BY edition_count with no index sorted all 6.9M rows,
    // spilling ~480MB of temp files, to return 24. The giveaway is not the
    // time, it is that the number of rows read has nothing to do with 24.
    const explained = await planOf(popularWorksSql(24));

    expect(explained).toContain("works_edition_count_ol_key_idx");

    // No Sort node at all. This is the assertion that discriminates, and it is
    // scale-independent: if the index supplies the ordering there is nothing to
    // sort, and if it cannot, Postgres adds a Sort above the scan — which at
    // 3,000 rows is a quicksort in 25kB and at 6.9M was the 480MB external
    // merge. Asserting only "external merge" or a row bound tested the symptom
    // at a size where the symptom does not appear: changing the ORDER BY to
    // `w.edition_count DESC, w.title` left both green.
    expect(explained).not.toMatch(/\bSort\b/);
    expect(explained).not.toMatch(/external merge/i);
    // worksRowsRead returns 0 when no line matches, so a bound on its own would
    // pass vacuously if the plan's node labels ever changed.
    expect(worksRowsRead(explained)).toBeGreaterThan(0);
    expect(worksRowsRead(explained)).toBeLessThan(200);
  });

  it("reads subject chips from the precomputed counts, not from works", async () => {
    // The bug: this aggregated every work's subjects on every request, and the
    // search page paid for it too and threw the result away.
    const explained = await planOf(catalogSubjectsSql(12));

    expect(explained).not.toMatch(/on works\b/);
    expect(explained).not.toMatch(/HashAggregate/i);
  });
});

describe("search must stay bounded by what it returns", () => {
  it("counts matches up to a ceiling rather than reading them all", async () => {
    // The bug: an exact count read every matching row. "Fiction" matched
    // 735,956 works and took 5.5 seconds, twice per page load.
    const explained = await planOf(countWorkMatchesSql("Fixture"));

    // Every fixture row matches "Fixture", so an unbounded count would read all
    // 3,000. The ceiling must stop it. COUNT_CEILING comes from the module too:
    // this test used to hardcode 1000 beside its own copy of the LIMIT.
    expect(worksRowsRead(explained)).toBeGreaterThan(0);
    expect(worksRowsRead(explained)).toBeLessThanOrEqual(COUNT_CEILING);
  });

  it("does not match works through their subjects", async () => {
    // The bug: subjects were the D-weighted term in search_vector, so every
    // generic word matched most of the catalog. This asserts the shape of the
    // stored vector rather than a row count, so it holds at any size.
    const [row] = await prisma.$queryRaw<{ matched: bigint }[]>`
      SELECT count(*) AS matched FROM catalog.works
      WHERE ol_key LIKE 'OLPLAN%'
        AND search_vector @@ websearch_to_tsquery('english', 'Fixture Subject')
    `;
    expect(Number(row.matched)).toBe(0);
  });

  it("can browse a subject through the array index", async () => {
    // The containment predicate on its own. Asserting it against the full
    // browse query would be asking the wrong thing: that query also has an
    // ORDER BY on edition_count, and the planner may legitimately walk
    // works_edition_count_ol_key_idx to get the ordering for free and filter
    // subjects as it goes. Either plan is bounded; what matters is that the
    // predicate is indexable at all.
    const explained = await planWithoutSeqScan(
      `SELECT ol_key FROM catalog.works WHERE subjects @> ARRAY[$1]::text[]`,
      ["Fixture Subject 3"]
    );

    expect(explained).toContain("works_subjects_idx");

    // The isolated predicate is deliberate (see above), but on its own it is
    // another copy — it would keep passing if getWorksBySubject stopped using
    // containment. Tie the two together. This is a text assertion and says so:
    // EXPLAINing the full browse cannot discriminate, because its ORDER BY on
    // edition_count lets the planner walk that index and filter as it goes,
    // whichever predicate is used.
    expect(worksBySubjectSql("Fixture Subject 3").text).toContain(
      "subjects @> ARRAY"
    );
  });

  it("cannot use that index if subjects are matched as text", async () => {
    // The negative control. Casting the array to text returns the same rows
    // for these fixtures and is unindexable at any size — the same mistake as
    // wrapping a column in unaccent(lower(...)).
    const explained = await planWithoutSeqScan(
      `SELECT ol_key FROM catalog.works WHERE array_to_string(subjects, ',') LIKE $1`,
      ["%Fixture Subject 3%"]
    );

    expect(explained).not.toContain("works_subjects_idx");
  });
});

/**
 * Search stays a single pass.
 *
 * An attempt at R1 bounded the candidate set with four subqueries, each
 * `ORDER BY w.edition_count DESC LIMIT n`. That invites the planner to walk
 * `works_edition_count_ol_key_idx` in popularity order and filter as it goes,
 * betting it will fill the LIMIT early. `title_norm LIKE 'dune%'` matches 113
 * rows in 6.9M, so it walked all 6,943,467 — 10.9 seconds in one subquery.
 * `?q=dune` went from 222ms to 71 seconds, and it shipped.
 *
 * Read this part before adding a plan assertion here and believing it helps:
 * **the bad plan cannot be reproduced at fixture scale.** At 3,000 rows the
 * planner correctly chooses bitmap scans on the text indexes; it only flips to
 * the ordered walk when the table is large enough for that to look cheap. I
 * restored the reverted query and every plan assertion below still passed. The
 * plan itself is scale-dependent, so no fixture-based EXPLAIN can catch this
 * class of regression — which is precisely why it got through.
 *
 * What is checkable without the real catalog is the SHAPE of the statement, so
 * that is what the first test does. It is a text assertion and says so.
 */
describe("search stays a single pass", () => {
  it("has exactly one LIMIT — no per-strategy subquery caps", () => {
    // A text assertion, deliberately. The reverted version had five LIMITs: one
    // per candidate subquery plus the outer one. One LIMIT means one pass over
    // the match set, which is the property that kept this query at 222ms.
    const sql = searchWorksSql("anything", { limit: 24, offset: 0 }).text;
    const limits = sql.match(/\bLIMIT\b/gi) ?? [];

    // One LIMIT is the whole property: no per-strategy subquery caps, so one
    // pass over the match set. A "no ORDER BY ... edition_count ... LIMIT" rule
    // was tried and dropped — the correct query legitimately ends
    // `ORDER BY rank DESC, w.edition_count DESC, w.ol_key` then `LIMIT`, so it
    // matched the good query as readily as the bad one.
    expect(limits).toHaveLength(1);
  });

  it("reaches works through the text indexes at this scale", async () => {
    // Kept as a weak signal, not a guard: it passed against the reverted query
    // too. It would only fail on a change bad enough to be visible at 3,000
    // rows, which the regression was not.
    const explained = await planOf(searchWorksSql("Fixture", { limit: 24 }));
    expect(worksRowsRead(explained)).toBeGreaterThan(0);
  });

  it("still returns the exact title first", async () => {
    // The quality property the reverted change was trying to protect. The
    // single-pass form gets it for free, because nothing is discarded before
    // ranking.
    await prisma.$executeRawUnsafe(`
      INSERT INTO catalog.works
        (ol_key, title, author_names, subjects, edition_count, first_publish_year)
      VALUES ('OLPLANEXACTW', 'Plan Fixture', 'Obscure Author',
              ARRAY['Fixture Subject 1'], 1, 1990)
      ON CONFLICT (ol_key) DO NOTHING
    `);

    try {
      const results = await searchWorks("Plan Fixture", { limit: 5 });
      expect(results[0]?.olKey).toBe("OLPLANEXACTW");
    } finally {
      await prisma.$executeRawUnsafe(
        `DELETE FROM catalog.works WHERE ol_key = 'OLPLANEXACTW'`
      );
    }
  });
});

describe("a work page must read one work", () => {
  it("fetches a work by key through the primary key", async () => {
    const explained = await plan(
      `SELECT ol_key, title FROM catalog.works WHERE ol_key = $1`,
      ["OLPLAN000042W"]
    );

    expect(explained).toMatch(/Index Scan|Index Only Scan/);
    expect(worksRowsRead(explained)).toBeLessThan(5);
  });

  it("can fetch a work's editions through the work_key index", async () => {
    const explained = await planWithoutSeqScan(
      `SELECT ol_key FROM catalog.editions WHERE work_key = $1
       ORDER BY publish_year DESC NULLS LAST, ol_key LIMIT 25`,
      ["OLPLAN000042W"]
    );

    expect(explained).toContain("editions_work_key_idx");
  });
});

/**
 * DEAD-4: the author lookup compared a function of the column.
 *
 * `findAuthorKeyByName` used `lower(a.name) = lower($1)`, breaking the rule
 * catalog.ts states at the top of the file — comparisons go against a normalised
 * column, never a function of the raw one, because "wrapping the column is how
 * the fuzzy path silently became a sequential scan once already."
 *
 * `catalog.authors` carried no index but its primary key, so every author page
 * load and every location read or write scanned the table. Measured against the
 * real 3.2M-row catalog, on the worst case of a name that is not present so
 * LIMIT 1 cannot terminate early:
 *
 *   before   Parallel Seq Scan   1053 ms
 *   after    Bitmap Index Scan      0.13 ms
 *
 * A plan assertion rather than a timing one, for the reason STATUS.md gives:
 * "the same answer at 3,000 rows as at 7 million".
 */
describe("the author name lookup is indexed", () => {
  /*
   * No plan assertion here, deliberately.
   *
   * `catalog.authors` is all but empty in the fixture, and a sequential scan of
   * twelve rows is the correct plan — so "not Seq Scan" cannot be asserted at
   * this scale without asserting something about the planner rather than about
   * the schema. This is the same limit that let the R1 regression through: the
   * bad plan did not reproduce at 3,000 rows either.
   *
   * What is assertable, and is what actually protects the fix: the index exists
   * in the database, the trigger keeps the column in step, and the shipped query
   * compares against the column rather than a function of the raw one. The last
   * of those is a source check and lives in conventions.test.ts, beside the
   * other rules of that kind.
   *
   * Measured separately against the real 3.2M-row catalog, worst case of a name
   * that is absent so LIMIT 1 cannot stop early:
   *   before  Parallel Seq Scan   1053 ms
   *   after   Bitmap Index Scan      0.13 ms
   */

  it("has the index the query depends on", async () => {
    // The first draft of the migration declared this index in schema.prisma and
    // never wrote the CREATE INDEX, which left the column indexed in the schema
    // file and sequentially scanned in the database. Asserted directly.
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'catalog' AND tablename = 'authors'
    `;
    expect(indexes.map((i) => i.indexname)).toContain("authors_name_norm_idx");
  });

  it("keeps name_norm in step with name, so a later write cannot orphan it", async () => {
    // The trigger, which CREATE TABLE ... LIKE INCLUDING ALL does not copy —
    // so 03-normalize.sql re-creates it after the swap. Without it a renamed
    // author silently stops being findable.
    const key = "OLTRIG001A";
    await prisma.$executeRaw`
      INSERT INTO catalog.authors (ol_key, name) VALUES (${key}, 'Émile Zola')
      ON CONFLICT (ol_key) DO UPDATE SET name = EXCLUDED.name`;

    try {
      const inserted = await prisma.$queryRaw<{ name_norm: string }[]>`
        SELECT name_norm FROM catalog.authors WHERE ol_key = ${key}`;
      expect(inserted[0].name_norm).toBe("emile zola");

      await prisma.$executeRaw`
        UPDATE catalog.authors SET name = 'Édouard Manet' WHERE ol_key = ${key}`;
      const updated = await prisma.$queryRaw<{ name_norm: string }[]>`
        SELECT name_norm FROM catalog.authors WHERE ol_key = ${key}`;
      expect(updated[0].name_norm).toBe("edouard manet");
    } finally {
      await prisma.$executeRaw`DELETE FROM catalog.authors WHERE ol_key = ${key}`;
    }
  });
});
