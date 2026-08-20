import { prisma } from "./setup";

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
    const explained = await plan(`
      SELECT w.ol_key
      FROM catalog.works w
      LEFT JOIN catalog.editions e ON e.ol_key = w.cover_edition_key
      ORDER BY w.edition_count DESC, w.ol_key
      LIMIT 24
    `);

    expect(explained).toContain("works_edition_count_ol_key_idx");
    expect(explained).not.toMatch(/external merge/i);
    expect(worksRowsRead(explained)).toBeLessThan(200);
  });

  it("reads subject chips from the precomputed counts, not from works", async () => {
    // The bug: this aggregated every work's subjects on every request, and the
    // search page paid for it too and threw the result away.
    const explained = await plan(`
      SELECT subject FROM catalog.subject_counts
      ORDER BY work_count DESC, subject LIMIT 12
    `);

    expect(explained).not.toMatch(/on works\b/);
    expect(explained).not.toMatch(/HashAggregate/i);
  });
});

describe("search must stay bounded by what it returns", () => {
  it("counts matches up to a ceiling rather than reading them all", async () => {
    // The bug: an exact count read every matching row. "Fiction" matched
    // 735,956 works and took 5.5 seconds, twice per page load.
    const explained = await plan(
      `
      SELECT count(*) FROM (
        SELECT 1 FROM catalog.works w
        CROSS JOIN (SELECT websearch_to_tsquery('english', unaccent($1)) AS tsq,
                           unaccent(lower($1)) AS norm) q
        WHERE w.search_vector @@ q.tsq OR w.title_norm % q.norm
        LIMIT 1000
      ) t
      `,
      ["Fixture"]
    );

    // Every fixture row matches "Fixture", so an unbounded count would read
    // all 3,000. The ceiling must stop it at 1,000.
    expect(worksRowsRead(explained)).toBeLessThanOrEqual(1000);
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
