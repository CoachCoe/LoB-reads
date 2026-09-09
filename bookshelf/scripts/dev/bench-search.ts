/**
 * Time the search statement against whatever catalog DATABASE_URL points at.
 *
 *   npm run bench:search              # report
 *   npm run bench:search -- --gate    # exit non-zero if any query exceeds the budget
 *
 * This exists because R1's first attempt shipped before anyone measured it and
 * made `?q=dune` 500x slower. The regression was invisible to every test in the
 * repo: the bad plan only appears once the table is large enough for an ordered
 * index walk to look cheap, so an EXPLAIN over a 3,000-row fixture cannot see
 * it. The only honest check is a clock against the real catalog.
 *
 * It imports `searchWorksSql` rather than restating the SQL, because
 * read-path-plans.test.ts used to EXPLAIN a copy typed into the test and
 * therefore asserted the shape of its own copy.
 */
import prisma from "@/lib/prisma";
import { searchWorksPaged, searchWorksSql } from "@/server/catalog";

/**
 * Chosen to span the shapes that behave differently, not to look good.
 *
 * - `dune`, `tolkien`: selective prefix matches — 113 rows in 6.9M. These are
 *   the ones a popularity-ordered walk destroys, and the ones the reverted
 *   attempt took from 222ms to 71s.
 * - `Fiction`, `fiction`, `history`, `love`: common words, the actual R1
 *   problem. Both cases of `Fiction` because the prefix bonus is case- and
 *   accent-normalised and that has been wrong before (DEAD-5).
 * - `the lord of the rings`: multi-word, where websearch_to_tsquery ANDs terms.
 * - `the`: an English stopword, so the tsquery is empty and only the trigram
 *   arm can match. TEST-17 was a pagination test built on this by accident.
 * - `zzzzqqq`: matches nothing; the floor.
 */
interface BenchQuery {
  q: string;
  /**
   * Fewest matches this query must find, on EVERY run.
   *
   * This is the half the clock cannot check, and the reason it is here: the two
   * fallback arms are bounded by a `statement_timeout`, and an abandoned arm
   * returns nothing *faster* than a working one. So a regression that stops a
   * query answering makes this benchmark greener, and did — `?q=the hobbitt`
   * returned 0 results on 3 of 12 consecutive warm requests while
   * `bench:search --gate` exited 0 and reported all 22 queries inside budget.
   *
   * Floors, not measured values, and deliberately well under what the queries
   * return today: the catalog is rebuilt monthly and these must not fail on a
   * slice that shifted by a few rows. The failure mode being guarded takes a
   * count to exactly zero, never to a fraction of itself, so a loose floor
   * still catches it.
   *
   * `0` means the query is expected to find nothing and its emptiness is not
   * the property under test.
   */
  minRows: number;
}

const QUERIES: BenchQuery[] = [
  // Full-text arm.
  { q: "dune", minRows: 20 },
  { q: "tolkien", minRows: 20 },
  { q: "Fiction", minRows: 20 },
  { q: "fiction", minRows: 20 },
  { q: "history", minRows: 20 },
  { q: "love", minRows: 20 },
  { q: "science fiction", minRows: 20 },
  { q: "the lord of the rings", minRows: 20 },
  { q: "the hobbit", minRows: 20 },
  // Empty tsquery: every word a stopword. Was 19,189ms.
  //
  // No floor, and that is a finding rather than a decision: both of these
  // currently cost the fuzzy budget and return NOTHING, because the exact-title
  // arm needs 1.7-2.3s on the real catalog and is cancelled at 700ms. Six works
  // are titled exactly "the". Whether that is acceptable is OQ-2 in
  // docs/audit/2026-09-08-findings.md; asserting a floor here would decide it.
  { q: "the", minRows: 0 },
  { q: "of the", minRows: 0 },
  // No match anywhere; the floor.
  { q: "zzzzqqq", minRows: 0 },
  // The fuzzy fallback, which is the expensive arm. These are the queries that
  // set the timeout: a real typo has to survive it. PRD R1 documents them as
  // answering — "mockingbrd finds Mockingbird through this arm and no other" —
  // so a floor here asserts the spec rather than a new decision.
  { q: "mockingbrd", minRows: 10 },
  { q: "harry poter", minRows: 20 },
  { q: "the hobbitt", minRows: 10 },
  { q: "the great gatsy", minRows: 20 },
  { q: "pride and prejudise", minRows: 20 },
  { q: "crime and punishmnt", minRows: 20 },
  { q: "brave new wrld", minRows: 20 },
  { q: "slaughterhous five", minRows: 10 },
  // Non-empty tsquery matching nothing, with common trigrams: the case the
  // timeout exists for. Returns nothing either way.
  { q: "thexx", minRows: 0 },
  { q: "andzz", minRows: 0 },
];

/** R1: "no query in a representative set exceeds 1 s warm". */
const BUDGET_MS = 1000;
const REPEATS = 3;

/**
 * Time one call and keep what it returned.
 *
 * It returns the value as well as the clock because the two have to come from
 * the SAME call: an abandoned search arm is both fast and empty, so timing one
 * call and counting another can report a fast run's latency beside a
 * successful run's row count and hide exactly the regression this gate exists
 * to catch.
 */
async function timeOnce<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = process.hrtime.bigint();
  const value = await fn();
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, value };
}

async function explain(query: string) {
  // EXPLAIN of the statement the module actually sends, not a copy of it.
  const sql = searchWorksSql(query, { limit: 24, offset: 0 });
  const rows = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS, VERBOSE OFF) ${sql.text}`,
    ...sql.values
  );
  console.log(`\n=== EXPLAIN ANALYZE for ${JSON.stringify(query)} ===`);
  for (const r of rows) console.log(r["QUERY PLAN"]);
}

async function main() {
  const explainIdx = process.argv.indexOf("--explain");
  if (explainIdx !== -1) {
    for (const q of process.argv.slice(explainIdx + 1)) {
      await prisma.$queryRaw(searchWorksSql(q, { limit: 24 })); // warm
      await explain(q);
    }
    await prisma.$disconnect();
    return;
  }

  const gate = process.argv.includes("--gate");
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM catalog.works`;
  const works = Number(count);

  const [{ work_mem }] = await prisma.$queryRaw<{ work_mem: string }[]>`SHOW work_mem`;

  console.log(`catalog: ${works.toLocaleString()} works · work_mem ${work_mem}`);
  if (works < 1_000_000) {
    console.log(
      "\nWARNING: this is not the real catalog. R1's budget is defined against\n" +
        "6.9M works; numbers from a fixture prove nothing about the plan, because\n" +
        "the regression this guards is scale-dependent."
    );
  }
  console.log("\nquery                        page p50     page max   rows   min");
  console.log("-".repeat(72));

  const failures: string[] = [];

  for (const { q, minRows } of QUERIES) {
    // Warm the cache first: the budget is a warm one, and a cold read measures
    // the disk rather than the query.
    // searchWorksPaged, not the SQL builders: the arm choice, the fallback and
    // its timeout are all part of what a reader waits for, so they are part of
    // what is measured. This is the call the page makes.
    await searchWorksPaged(q, { pageSize: 24, requestedPage: undefined });

    const search: number[] = [];
    const counts: number[] = [];
    for (let i = 0; i < REPEATS; i++) {
      // The count is kept per run rather than sampled once, because the
      // abandonment this guards is intermittent: a single extra read is very
      // likely to be one of the runs that succeeded.
      const { ms, value } = await timeOnce(() =>
        searchWorksPaged(q, { pageSize: 24, requestedPage: undefined })
      );
      search.push(ms);
      counts.push(value.count);
    }

    const result = await searchWorksPaged(q, { pageSize: 24, requestedPage: undefined });
    const rows = result.works;
    const worstCount = Math.min(...counts);

    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const searchMax = Math.max(...search);
    const overBudget = searchMax > BUDGET_MS;
    const underRecall = worstCount < minRows;
    const flag = overBudget
      ? "  <-- over budget"
      : underRecall
        ? `  <-- found ${worstCount}, needs ${minRows}`
        : "";

    console.log(
      `${q.padEnd(26)} ${med(search).toFixed(0).padStart(8)}ms ${searchMax
        .toFixed(0)
        .padStart(10)}ms ${String(rows.length).padStart(6)} ${String(minRows).padStart(5)}${flag}`
    );

    if (overBudget) {
      failures.push(`${q}: ${searchMax.toFixed(0)}ms over the ${BUDGET_MS}ms budget`);
    }
    // Reported separately from the clock, and both are checked: a query can be
    // fast because it gave up, which is the whole reason this arm exists.
    if (underRecall) {
      failures.push(
        `${q}: found ${worstCount} on its worst of ${REPEATS} runs, needs ${minRows}`
      );
    }
  }

  console.log("-".repeat(66));
  if (failures.length === 0) {
    console.log(
      `All ${QUERIES.length} queries inside the ${BUDGET_MS}ms warm budget, and each found what it should.`
    );
  } else {
    console.log(`${failures.length} problem(s):`);
    for (const f of failures) console.log(`  ${f}`);
  }

  await prisma.$disconnect();
  if (gate && failures.length > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
