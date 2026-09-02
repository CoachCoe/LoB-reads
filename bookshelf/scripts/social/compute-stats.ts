/**
 * Rebuild the derived social aggregates.
 *
 *   npx tsx scripts/social/compute-stats.ts
 *   ENABLE_SEED_DATA=true npx tsx scripts/social/compute-stats.ts
 *
 * Two tables, both wholly derived and safe to rebuild at any time:
 *
 *   catalog.work_rating_stats  community rating per work
 *   catalog.work_similarity    "readers also enjoyed"
 *
 * SEED DATA IS OPT-IN. Without ENABLE_SEED_DATA=true only real reviews count,
 * which on a new install means almost nothing and empty recommendations —
 * correct, and better than quietly presenting a borrowed corpus as your
 * community's opinion.
 */

import "../enrich/env";
import prisma from "@/lib/prisma";

/** Only ratings this high count as a recommendation signal. */
const LIKED_THRESHOLD = 4;

/**
 * A pair needs this many shared readers before it means anything. Two people
 * is a coincidence, and without a floor the lists fill with noise.
 */
const MIN_CO_RATERS = 3;

/** Neighbours kept per work. Beyond this the tail is not worth storing. */
const NEIGHBOURS_PER_WORK = 20;

/**
 * Whether the CC-BY-SA corpus in `seed` is folded in.
 *
 * Passed rather than read at module scope, so a caller — the recommendation
 * tests especially — decides. A module-level `process.env` read makes a module's
 * behaviour depend on the ambient environment rather than on how it is called,
 * which is exactly the shape that made storage.test.ts pass locally and fail in
 * CI (audit TEST-19).
 */
export interface ComputeOptions {
  includeSeed: boolean;
}

export async function computeRatingStats({
  includeSeed,
}: ComputeOptions): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE catalog.work_rating_stats`);

  // The union is built once here rather than in both queries, so the stats and
  // the similarity matrix cannot disagree about what counts as a rating.
  const seedUnion = includeSeed
    ? `UNION ALL SELECT work_key, rating, true AS is_seed FROM seed.ratings`
    : "";

  await prisma.$executeRawUnsafe(`
    INSERT INTO catalog.work_rating_stats
      (work_key, avg_rating, rating_count, seed_count, computed_at)
    SELECT work_key,
           round(avg(rating)::numeric, 2)::float8,
           count(*)::int,
           count(*) FILTER (WHERE is_seed)::int,
           now()
    FROM (
      SELECT work_key, rating, false AS is_seed FROM app.reviews
      ${seedUnion}
    ) all_ratings
    GROUP BY work_key
  `);

  const [row] = await prisma.$queryRawUnsafe<
    { works: bigint; ratings: bigint; seeded: bigint }[]
  >(`
    SELECT count(*) AS works,
           coalesce(sum(rating_count), 0) AS ratings,
           coalesce(sum(seed_count), 0) AS seeded
    FROM catalog.work_rating_stats
  `);

  console.log(
    `  ${Number(row.works).toLocaleString()} works, ` +
      `${Number(row.ratings).toLocaleString()} ratings ` +
      `(${Number(row.seeded).toLocaleString()} from seed data)`
  );
}

/**
 * Item-item collaborative filtering.
 *
 * Cosine over co-raters rather than raw co-occurrence: raw counts make the
 * most-rated books everyone's neighbour, so every list ends up identical and
 * useless. Dividing by sqrt(popularity_a * popularity_b) is what turns
 * "lots of people read both" into "people who read A disproportionately read B".
 */
export async function computeSimilarity({
  includeSeed,
}: ComputeOptions): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE catalog.work_similarity`);

  // `is_seed` travels with each liked row so the pair counts below can say how
  // much of a given neighbour pair came from the corpus. Attribution is owed per
  // pair, not per run: even with the corpus included, a pair whose co-raters are
  // all real readers owes nothing. See SPEC-3.
  const seedUnion = includeSeed
    ? `UNION ALL SELECT user_id, work_key, true FROM seed.ratings WHERE rating >= ${LIKED_THRESHOLD}`
    : "";

  await prisma.$executeRawUnsafe(`
    WITH liked (user_id, work_key, is_seed) AS (
      SELECT "userId" AS user_id, work_key, false FROM app.reviews WHERE rating >= ${LIKED_THRESHOLD}
      ${seedUnion}
    ),
    popularity AS (
      SELECT work_key, count(DISTINCT user_id)::float8 AS raters
      FROM liked GROUP BY work_key
    ),
    pairs AS (
      SELECT a.work_key AS work_key,
             b.work_key AS similar_work_key,
             count(*)::int AS co_raters,
             -- The rater is the "a" side; "b" is the same person's other book,
             -- so counting a's provenance counts each co-rating exactly once.
             count(*) FILTER (WHERE a.is_seed)::int AS seed_co_raters
      FROM liked a
      JOIN liked b ON b.user_id = a.user_id AND b.work_key <> a.work_key
      GROUP BY a.work_key, b.work_key
      HAVING count(*) >= ${MIN_CO_RATERS}
    ),
    scored AS (
      SELECT p.work_key, p.similar_work_key, p.co_raters, p.seed_co_raters,
             p.co_raters / sqrt(pa.raters * pb.raters) AS score,
             row_number() OVER (
               PARTITION BY p.work_key
               ORDER BY p.co_raters / sqrt(pa.raters * pb.raters) DESC,
                        p.co_raters DESC,
                        p.similar_work_key
             ) AS rank
      FROM pairs p
      JOIN popularity pa ON pa.work_key = p.work_key
      JOIN popularity pb ON pb.work_key = p.similar_work_key
    )
    INSERT INTO catalog.work_similarity
      (work_key, similar_work_key, score, co_raters, seed_co_raters, computed_at)
    SELECT work_key, similar_work_key, score, co_raters, seed_co_raters, now()
    FROM scored
    WHERE rank <= ${NEIGHBOURS_PER_WORK}
  `);

  const [row] = await prisma.$queryRawUnsafe<
    { pairs: bigint; works: bigint }[]
  >(`
    SELECT count(*) AS pairs, count(DISTINCT work_key) AS works
    FROM catalog.work_similarity
  `);

  console.log(
    `  ${Number(row.pairs).toLocaleString()} pairs across ` +
      `${Number(row.works).toLocaleString()} works`
  );
}

/** The spec's acceptance: the top 1K works should all have neighbours. */
async function reportCoverage() {
  const [row] = await prisma.$queryRawUnsafe<
    { total: bigint; withNeighbours: bigint }[]
  >(`
    WITH top_works AS (
      SELECT work_key FROM catalog.work_rating_stats
      ORDER BY rating_count DESC, work_key LIMIT 1000
    )
    SELECT count(*) AS total,
           count(*) FILTER (
             WHERE EXISTS (SELECT 1 FROM catalog.work_similarity s
                            WHERE s.work_key = t.work_key)
           ) AS "withNeighbours"
    FROM top_works t
  `);

  const total = Number(row.total);
  const covered = Number(row.withNeighbours);
  const pct = total > 0 ? (covered / total) * 100 : 0;

  console.log(
    `\n"Readers also enjoyed" covers ${covered} of the top ${total} works ` +
      `(${pct.toFixed(1)}%)`
  );

  if (total === 0) {
    console.log("No rated works yet — load a ratings graph first.");
  } else if (pct < 100) {
    console.log(
      `${total - covered} have fewer than ${MIN_CO_RATERS} shared readers with ` +
        "anything, which is what a thin ratings graph looks like."
    );
  }
}

async function main() {
  const includeSeed = process.env.ENABLE_SEED_DATA === "true";

  console.log(
    includeSeed
      ? "Seed data ENABLED — synthetic ratings are included."
      : "Seed data disabled. Set ENABLE_SEED_DATA=true to include it."
  );

  console.log("\nRating stats…");
  await computeRatingStats({ includeSeed });

  console.log("Similarity…");
  await computeSimilarity({ includeSeed });

  await reportCoverage();
}

// Only when run as a script. Importing this module — which the recommendation
// tests now do, so that they exercise the shipped ranking rather than a copy of
// it — must not kick off a rebuild or disconnect the shared client.
if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Compute failed:", error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
