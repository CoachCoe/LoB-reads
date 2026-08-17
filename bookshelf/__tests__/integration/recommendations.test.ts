import { prisma } from "./setup";
import { getSimilarWorks, getWorkRating, getWorkRatings } from "@/server/catalog";
import { makeWork } from "./factories";

/**
 * M5 acceptance: "readers also enjoyed" returns non-empty for the top works.
 *
 * The interesting property is not that it returns something — raw
 * co-occurrence returns something for everything. It is that the something is
 * *discriminating*: a book's neighbours should be the books its readers
 * disproportionately liked, not simply the most-rated books in the catalog.
 *
 * So the fixture is built as two disjoint taste groups plus a book everybody
 * reads. A ranking on raw co-occurrence puts the popular book at the top of
 * every list; cosine over co-raters does not.
 */

const READERS_PER_GROUP = 30;

interface Fixture {
  groupA: string[];
  groupB: string[];
  popular: string;
}

async function seedRatingGraph(): Promise<Fixture> {
  await prisma.$executeRawUnsafe(`TRUNCATE seed.ratings, seed.users CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE catalog.work_similarity`);
  await prisma.$executeRawUnsafe(`TRUNCATE catalog.work_rating_stats`);

  const groupA = await Promise.all([makeWork(), makeWork(), makeWork()]);
  const groupB = await Promise.all([makeWork(), makeWork(), makeWork()]);
  const popular = await makeWork();

  const users: { id: string; handle: string; source: string }[] = [];
  const ratings: {
    userId: string;
    workKey: string;
    rating: number;
    source: string;
  }[] = [];

  // The shape matters. For raw co-occurrence to get this WRONG, the popular
  // book must share MORE readers with the anchor than its own group-mates do.
  // So: every reader in a group reads the anchor and the popular book, but
  // only 60% read the rest of their group.
  //
  //   co_raters(anchor, popular) = 30   > co_raters(anchor, group-mate) = 18
  //
  // Raw co-occurrence therefore ranks the popular book first. Cosine divides
  // by sqrt(popularity): the popular book has 60 raters against the group
  // mate's 18, which is enough to flip the order back.
  const add = (prefix: string, group: { olKey: string }[]) => {
    for (let i = 0; i < READERS_PER_GROUP; i++) {
      const id = `${prefix}-${i}`;
      users.push({ id, handle: `${prefix}_${i}`, source: "test" });

      // The anchor and the popular book: everyone.
      ratings.push({ userId: id, workKey: group[0].olKey, rating: 5, source: "test" });
      ratings.push({ userId: id, workKey: popular.olKey, rating: 5, source: "test" });

      // The rest of the group: most, not all.
      if (i < Math.floor(READERS_PER_GROUP * 0.6)) {
        for (const work of group.slice(1)) {
          ratings.push({ userId: id, workKey: work.olKey, rating: 5, source: "test" });
        }
      }
    }
  };

  add("a", groupA);
  add("b", groupB);

  await prisma.seedUser.createMany({ data: users });
  await prisma.seedRating.createMany({ data: ratings });

  return {
    groupA: groupA.map((w) => w.olKey),
    groupB: groupB.map((w) => w.olKey),
    popular: popular.olKey,
  };
}

/** Mirrors scripts/social/compute-stats.ts with seed data enabled. */
async function computeAggregates() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO catalog.work_rating_stats
      (work_key, avg_rating, rating_count, seed_count, computed_at)
    SELECT work_key, round(avg(rating)::numeric, 2)::float8, count(*)::int,
           count(*) FILTER (WHERE is_seed)::int, now()
    FROM (
      SELECT work_key, rating, false AS is_seed FROM app.reviews
      UNION ALL SELECT work_key, rating, true FROM seed.ratings
    ) r
    GROUP BY work_key
    ON CONFLICT (work_key) DO UPDATE
      SET avg_rating = EXCLUDED.avg_rating, rating_count = EXCLUDED.rating_count
  `);

  await prisma.$executeRawUnsafe(`
    WITH liked AS (
      SELECT "userId" AS user_id, work_key FROM app.reviews WHERE rating >= 4
      UNION ALL SELECT user_id, work_key FROM seed.ratings WHERE rating >= 4
    ),
    popularity AS (
      SELECT work_key, count(DISTINCT user_id)::float8 AS raters FROM liked GROUP BY work_key
    ),
    pairs AS (
      SELECT a.work_key, b.work_key AS similar_work_key, count(*)::int AS co_raters
      FROM liked a JOIN liked b ON b.user_id = a.user_id AND b.work_key <> a.work_key
      GROUP BY a.work_key, b.work_key HAVING count(*) >= 3
    ),
    scored AS (
      SELECT p.*, p.co_raters / sqrt(pa.raters * pb.raters) AS score,
             row_number() OVER (PARTITION BY p.work_key
               ORDER BY p.co_raters / sqrt(pa.raters * pb.raters) DESC,
                        p.co_raters DESC, p.similar_work_key) AS rank
      FROM pairs p
      JOIN popularity pa ON pa.work_key = p.work_key
      JOIN popularity pb ON pb.work_key = p.similar_work_key
    )
    INSERT INTO catalog.work_similarity (work_key, similar_work_key, score, co_raters, computed_at)
    SELECT work_key, similar_work_key, score, co_raters, now() FROM scored WHERE rank <= 20
  `);
}

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seedRatingGraph();
  await computeAggregates();
}, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE seed.ratings, seed.users CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE catalog.work_similarity`);
  await prisma.$executeRawUnsafe(`TRUNCATE catalog.work_rating_stats`);
});

describe("M5 acceptance: readers also enjoyed", () => {
  it("returns neighbours for every work in the graph", async () => {
    const all = [...fixture.groupA, ...fixture.groupB, fixture.popular];

    for (const workKey of all) {
      const similar = await getSimilarWorks(workKey);
      expect(similar.length).toBeGreaterThan(0);
    }
  });

  it("covers 100% of the top works by rating count", async () => {
    // The spec's criterion, expressed the way the script reports it.
    const [row] = await prisma.$queryRaw<
      { total: bigint; covered: bigint }[]
    >`
      WITH top_works AS (
        SELECT work_key FROM catalog.work_rating_stats
        ORDER BY rating_count DESC, work_key LIMIT 1000
      )
      SELECT count(*) AS total,
             count(*) FILTER (
               WHERE EXISTS (SELECT 1 FROM catalog.work_similarity s
                              WHERE s.work_key = t.work_key)
             ) AS covered
      FROM top_works t
    `;

    expect(Number(row.total)).toBeGreaterThan(0);
    expect(Number(row.covered)).toBe(Number(row.total));
  });

  it("recommends within a taste group, not just the popular book", async () => {
    // The assertion that raw co-occurrence fails. The popular book shares MORE
    // readers with the anchor (30) than its group-mates do (18), so counting
    // co-raters puts it first. Normalising by popularity puts the group-mates
    // back on top, which is what a reader actually wants.
    const similar = await getSimilarWorks(fixture.groupA[0], 3);
    const keys = similar.map((s) => s.olKey);

    expect(keys[0]).not.toBe(fixture.popular);
    expect(fixture.groupA.slice(1)).toContain(keys[0]);
  });

  it("does not cross between disjoint taste groups", async () => {
    const similar = await getSimilarWorks(fixture.groupA[0], 10);
    const keys = similar.map((s) => s.olKey);

    // No reader rated books from both groups, so there is no signal linking them.
    for (const other of fixture.groupB) {
      expect(keys).not.toContain(other);
    }
  });

  it("never recommends a work to itself", async () => {
    for (const workKey of [...fixture.groupA, fixture.popular]) {
      const similar = await getSimilarWorks(workKey, 20);
      expect(similar.map((s) => s.olKey)).not.toContain(workKey);
    }
  });

  it("returns an empty list for a work with no ratings, rather than throwing", async () => {
    const lonely = await makeWork();
    await expect(getSimilarWorks(lonely.olKey)).resolves.toEqual([]);
  });
});

describe("community ratings", () => {
  it("reports an average and a count", async () => {
    const rating = await getWorkRating(fixture.popular);
    expect(rating).not.toBeNull();
    expect(rating!.average).toBe(5);
    expect(rating!.count).toBe(READERS_PER_GROUP * 2);
  });

  it("returns null for an unrated work rather than a zero", async () => {
    // Zero would render as a one-star book, which is worse than no rating.
    const lonely = await makeWork();
    expect(await getWorkRating(lonely.olKey)).toBeNull();
  });

  it("fetches many at once for a grid", async () => {
    const ratings = await getWorkRatings([...fixture.groupA, fixture.popular]);
    expect(ratings.size).toBe(fixture.groupA.length + 1);
    expect(ratings.get(fixture.popular)!.count).toBe(READERS_PER_GROUP * 2);
  });
});

describe("seed data isolation", () => {
  it("keeps synthetic ratings out of app.reviews entirely", async () => {
    // The separation is a schema boundary, not a boolean column: "is this ours
    // to serve?" is answerable by looking at the table name.
    expect(await prisma.review.count()).toBe(0);
    expect(await prisma.seedRating.count()).toBeGreaterThan(0);
  });

  it("marks every seeded row as synthetic and attributed to a source", async () => {
    const unmarked = await prisma.seedRating.count({
      where: { OR: [{ isSynthetic: false }, { source: "" }] },
    });
    expect(unmarked).toBe(0);
  });
});
