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
const QUERIES = [
  // Full-text arm.
  "dune",
  "tolkien",
  "Fiction",
  "fiction",
  "history",
  "love",
  "science fiction",
  "the lord of the rings",
  "the hobbit",
  // Empty tsquery: every word a stopword. Was 19,189ms.
  "the",
  "of the",
  // No match anywhere; the floor.
  "zzzzqqq",
  // The fuzzy fallback, which is the expensive arm. These are the queries that
  // set the timeout: a real typo has to survive it.
  "mockingbrd",
  "harry poter",
  "the hobbitt",
  "the great gatsy",
  "pride and prejudise",
  "crime and punishmnt",
  "brave new wrld",
  "slaughterhous five",
  // Non-empty tsquery matching nothing, with common trigrams: the case the
  // timeout exists for. Returns nothing either way.
  "thexx",
  "andzz",
];

/** R1: "no query in a representative set exceeds 1 s warm". */
const BUDGET_MS = 1000;
const REPEATS = 3;

async function timeOnce(fn: () => Promise<unknown>): Promise<number> {
  const started = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - started) / 1e6;
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
  console.log("\nquery                        page p50     page max   rows");
  console.log("-".repeat(66));

  const failures: string[] = [];

  for (const q of QUERIES) {
    // Warm the cache first: the budget is a warm one, and a cold read measures
    // the disk rather than the query.
    // searchWorksPaged, not the SQL builders: the arm choice, the fallback and
    // its timeout are all part of what a reader waits for, so they are part of
    // what is measured. This is the call the page makes.
    await searchWorksPaged(q, { pageSize: 24, requestedPage: undefined });

    const search: number[] = [];
    for (let i = 0; i < REPEATS; i++) {
      search.push(
        await timeOnce(() => searchWorksPaged(q, { pageSize: 24, requestedPage: undefined }))
      );
    }

    const result = await searchWorksPaged(q, { pageSize: 24, requestedPage: undefined });
    const rows = result.works;

    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const searchMax = Math.max(...search);
    const flag = searchMax > BUDGET_MS ? "  <-- over budget" : "";

    console.log(
      `${q.padEnd(26)} ${med(search).toFixed(0).padStart(8)}ms ${searchMax
        .toFixed(0)
        .padStart(10)}ms ${String(rows.length).padStart(6)}${flag}`
    );

    if (searchMax > BUDGET_MS) {
      failures.push(`${q}: ${searchMax.toFixed(0)}ms`);
    }
  }

  console.log("-".repeat(66));
  if (failures.length === 0) {
    console.log(`All ${QUERIES.length} queries within the ${BUDGET_MS}ms warm budget.`);
  } else {
    console.log(`${failures.length} over the ${BUDGET_MS}ms warm budget:`);
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
