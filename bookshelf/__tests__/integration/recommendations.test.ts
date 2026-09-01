import { prisma, resetDatabase } from "./setup";
import { getSimilarWorks, getWorkRating, getWorkRatings } from "@/server/catalog";
import { makeWork } from "./factories";
import {
  computeRatingStats,
  computeSimilarity,
} from "../../scripts/social/compute-stats";

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
  // beforeAll runs BEFORE the first beforeEach, so without this the fixture
  // inherits whatever app.reviews rows the previous test FILE happened to leave
  // — and computeRatingStats builds from app.reviews UNION seed.ratings, so a
  // single stale review becomes an eighth work in work_rating_stats with no
  // co-raters and therefore no neighbours. That made
  // "covers 100% of the top works" fail as 7 of 8, depending purely on which
  // file ran before this one.
  await resetDatabase();
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

/**
 * The shipped aggregates, not a copy of them.
 *
 * This used to re-implement compute-stats.ts inline — including the cosine
 * expression, MIN_CO_RATERS and NEIGHBOURS_PER_WORK. The fixture below is
 * genuinely discriminating, but it was discriminating against SQL that lived in
 * this file: changing the shipped score to raw co-occurrence, which is the
 * documented bug this test exists for, left all of these green.
 *
 * What it now catches, verified by mutation: replacing the cosine score
 * expression with `p.co_raters` fails "recommends within a taste group".
 *
 * What it still does not catch, verified the same way: changing the window's
 * ORDER BY alone. That only decides WHICH neighbours survive the
 * NEIGHBOURS_PER_WORK cut, and getSimilarWorks reads back ordered by the stored
 * score — so with a fixture whose works have fewer than 20 neighbours the kept
 * set is identical either way. Catching it needs a work with more neighbours
 * than the cut keeps, which is a fixture this test does not build.
 */
async function computeAggregates() {
  await computeRatingStats({ includeSeed: true });
  await computeSimilarity({ includeSeed: true });
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

describe("provenance is visible", () => {
  /**
   * `seed_count` has always been in the schema — "so the mix is auditable" —
   * and nothing read it, so there was no way to tell how much of a rating came
   * from the CC-BY-SA corpus rather than from readers here. The work page's
   * attribution is driven by this number, so it has to reach the caller.
   */
  it("reports how much of a rating came from the seed corpus", async () => {
    const stats = await getWorkRating(fixture.popular);

    expect(stats).not.toBeNull();
    expect(stats!.count).toBeGreaterThan(0);
    expect(stats!.seedCount).toBe(stats!.count);
  });

  it("reports it for a bulk fetch too", async () => {
    const map = await getWorkRatings([fixture.popular]);
    expect(map.get(fixture.popular)?.seedCount).toBeGreaterThan(0);
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
