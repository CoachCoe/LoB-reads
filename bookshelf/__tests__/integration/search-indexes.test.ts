import { prisma } from "./setup";

/**
 * Search must use its indexes.
 *
 * This exists because they were silently dropped. `prisma migrate diff`
 * generates a DROP for any index present in the database but absent from
 * schema.prisma, and the FTS and trigram indexes had been hand-written into a
 * migration — so the next diff removed all three.
 *
 * Nothing failed. Search still returned correct results, from a sequential
 * scan, and the latency test did not notice because a few thousand fixture
 * rows seq-scan in about ten milliseconds. It would have been found in
 * production, at catalog scale, by everything being slow.
 *
 * So this asserts the query PLAN, not merely that an index exists. An index
 * that is present but unused — wrong operator class, wrong expression — fails
 * here too, which is the failure mode that a `pg_indexes` check would miss.
 */

async function plan(sql: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN (COSTS OFF) ${sql}`
  );
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

/**
 * The plan with sequential scans priced out of the way.
 *
 * For the trigram predicates this is the honest question to ask. At fixture
 * size the planner prefers a sequential scan even when a perfectly good index
 * exists, and it is right to — a few thousand rows are cheaper to read than to
 * look up. Asserting on the unforced plan would therefore fail for a reason
 * that has nothing to do with the bug.
 *
 * What actually broke was different in kind: the predicate wrapped the column
 * in `unaccent(lower(...))`, which no index on that column can ever answer, at
 * any size, however the planner is priced. Disabling seqscan separates "chose
 * not to" from "could not" — and only the second is a defect.
 *
 * SET LOCAL inside a transaction, so the setting cannot leak into another
 * test through a pooled connection.
 */
async function planWithoutSeqScan(sql: string): Promise<string> {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
    return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN (COSTS OFF) ${sql}`
    );
  });
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

beforeAll(async () => {
  // The planner needs enough rows to prefer an index; on an empty table a
  // sequential scan is genuinely the right choice and the test would be
  // asserting nothing.
  await prisma.$executeRawUnsafe(`
    INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
    SELECT 'OLIDX' || lpad(i::text, 6, '0') || 'W',
           'The ' || (ARRAY['Shadow','River','Winter','Garden','Silence'])[1 + (i % 5)]
                  || ' of ' || (ARRAY['Mirrors','Ashes','Iron','Glass','Salt'])[1 + (i % 5)],
           'Author ' || (i % 200), ARRAY['Fiction'], 1
    FROM generate_series(1, 3000) AS i
    ON CONFLICT (ol_key) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`ANALYZE catalog.works`);
}, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM catalog.works WHERE ol_key LIKE 'OLIDX%'`);
  await prisma.$executeRawUnsafe(`ANALYZE catalog.works`);
});

describe("search indexes", () => {
  it("all three exist", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'catalog' AND tablename = 'works'
        AND indexdef LIKE '%USING gin%'
      ORDER BY indexname
    `;

    expect(rows.map((r) => r.indexname).sort()).toEqual([
      "works_author_names_norm_idx",
      "works_search_vector_idx",
      "works_title_norm_idx",
    ]);
  });

  it("full-text search uses the GIN index rather than scanning", async () => {
    const explained = await plan(`
      SELECT ol_key FROM catalog.works
      WHERE search_vector @@ plainto_tsquery('english', unaccent('shadow'))
    `);

    expect(explained).toContain("works_search_vector_idx");
    expect(explained).not.toMatch(/^Seq Scan on works/m);
  });

  // These two assert the exact predicate shape the search uses. Rewriting a
  // comparison as `unaccent(lower(title)) % ...` still returns correct rows, so
  // only the plan catches it.
  it("trigram title matching can use its index", async () => {
    const explained = await planWithoutSeqScan(`
      SELECT ol_key FROM catalog.works
      WHERE title_norm % unaccent(lower('Shadw of Mirors'))
    `);

    expect(explained).toContain("works_title_norm_idx");
  });

  it("trigram author matching can use its index", async () => {
    const explained = await planWithoutSeqScan(`
      SELECT ol_key FROM catalog.works
      WHERE author_names_norm % unaccent(lower('Athor 42'))
    `);

    expect(explained).toContain("works_author_names_norm_idx");
  });

  it("cannot use an index if the predicate wraps the column", async () => {
    // The negative control, and the reason the two tests above are worth
    // having. This is the exact predicate the search used to run. It returns
    // identical rows, so no functional test can tell the difference — it is
    // simply unindexable, forever, and the only visible symptom is that
    // production gets slower as the catalog grows.
    //
    // If this ever starts using an index, the constraint that motivated the
    // title_norm columns has gone away and they can be reconsidered.
    const explained = await planWithoutSeqScan(`
      SELECT ol_key FROM catalog.works
      WHERE unaccent(lower(title)) % 'shadw of mirors'
    `);

    expect(explained).toMatch(/Seq Scan on works/);
    expect(explained).not.toContain("works_title_norm_idx");
  });

  it("normalizes on write, so the query never has to wrap the column", async () => {
    // The property the indexes depend on. If the trigger stops maintaining
    // these, every comparison silently starts missing accented titles.
    const [row] = await prisma.$queryRaw<
      { titleNorm: string; authorNorm: string }[]
    >`
      INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
      VALUES ('OLIDXACCENTW', 'Les Misérables', 'Victor Hugo', ARRAY['Fiction'], 1)
      ON CONFLICT (ol_key) DO UPDATE SET title = EXCLUDED.title
      RETURNING title_norm AS "titleNorm", author_names_norm AS "authorNorm"
    `;

    expect(row.titleNorm).toBe("les miserables");
    expect(row.authorNorm).toBe("victor hugo");
  });
});
