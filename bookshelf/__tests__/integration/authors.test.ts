import { prisma } from "./setup";
import { getAuthorByKey, AUTHOR_WORKS_LIMIT } from "@/server/authors";

/**
 * TEST-12: `workCount` is not `works.length`, and nothing held the difference.
 *
 * The interface comment states the rule — "`works.length` … is capped at
 * AUTHOR_WORKS_LIMIT. Rendering the capped figure as the total is the same
 * defect as showing a shelf's preview size as its book count" — and then
 *
 *     workCount: Number(countRows[0]?.count ?? works.length)
 *
 * could be replaced with `works.length` outright and the whole suite stayed
 * green. Every author fixture in the repo has a handful of works, so below the
 * cap the two expressions agree exactly and no test could tell them apart.
 * This is the FLOW-16 regression that /bastion caught during its own fix,
 * still with no test behind it.
 *
 * So the fixture is deliberately built past the cap. That is the only shape
 * where the assertion means anything, and it is also the shape a real author
 * page has — Asimov and Christie both run to several hundred works in the
 * catalog.
 */

const PROLIFIC = "OLTPROLIFICA";
const OVER_CAP = AUTHOR_WORKS_LIMIT + 1;

async function seedProlificAuthor() {
  await prisma.$executeRawUnsafe(
    `INSERT INTO catalog.authors (ol_key, name) VALUES ('${PROLIFIC}', 'A Prolific Author')
     ON CONFLICT (ol_key) DO NOTHING`
  );
  // Bulk, because 101 round trips through the factory is slow for no gain.
  await prisma.$executeRawUnsafe(
    `INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
     SELECT 'OLTPRO' || i || 'W', 'Prolific Work ' || lpad(i::text, 3, '0'),
            'A Prolific Author', ARRAY['Fiction'], 1
     FROM generate_series(1, ${OVER_CAP}) i
     ON CONFLICT (ol_key) DO NOTHING`
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO catalog.work_authors (work_key, author_key, position)
     SELECT 'OLTPRO' || i || 'W', '${PROLIFIC}', 0
     FROM generate_series(1, ${OVER_CAP}) i
     ON CONFLICT DO NOTHING`
  );
}

describe("TEST-12: an author with more works than the page shows", () => {
  beforeEach(seedProlificAuthor);

  it("reports the real total, not the number of works it returned", async () => {
    const author = await getAuthorByKey(PROLIFIC);

    expect(author).not.toBeNull();
    // The page renders this many cards …
    expect(author!.works).toHaveLength(AUTHOR_WORKS_LIMIT);
    // … and states this many works. Collapsing workCount to works.length
    // makes a 101-work author read as having exactly 100, for ever, and the
    // rounder the cap the more plausible the wrong number looks.
    expect(author!.workCount).toBe(OVER_CAP);
    expect(author!.workCount).toBeGreaterThan(author!.works.length);
  });

  it("still agrees with itself for an author below the cap", async () => {
    // The control. Without it, `workCount: 101` hardcoded would pass above.
    await prisma.$executeRawUnsafe(
      `INSERT INTO catalog.authors (ol_key, name) VALUES ('OLTSPARSEA', 'A Sparse Author')
       ON CONFLICT (ol_key) DO NOTHING`
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO catalog.works (ol_key, title, author_names, subjects, edition_count)
       SELECT 'OLTSPA' || i || 'W', 'Sparse Work ' || i, 'A Sparse Author',
              ARRAY['Fiction'], 1
       FROM generate_series(1, 3) i ON CONFLICT (ol_key) DO NOTHING`
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO catalog.work_authors (work_key, author_key, position)
       SELECT 'OLTSPA' || i || 'W', 'OLTSPARSEA', 0
       FROM generate_series(1, 3) i ON CONFLICT DO NOTHING`
    );

    const author = await getAuthorByKey("OLTSPARSEA");

    expect(author!.works).toHaveLength(3);
    expect(author!.workCount).toBe(3);
  });

  it("returns null for an author the catalog does not have", async () => {
    // `getAuthorByKey` had no test by any path, so the absent case is worth
    // pinning too: the author page 404s on this rather than rendering empty.
    expect(await getAuthorByKey("OLTNOSUCHAUTHOR")).toBeNull();
  });
});
