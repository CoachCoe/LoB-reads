/**
 * Queue a description backfill for the works most likely to be looked at.
 *
 *   npx tsx scripts/enrich/backfill.ts            # top 10,000 works
 *   npx tsx scripts/enrich/backfill.ts --top 500
 *
 * Ranked by rating count, then edition count. A work nobody has rated and that
 * exists in one printing is not worth a third-party call; the queue is a
 * budget, and this spends it where it shows.
 */

import "./env";
import prisma from "@/lib/prisma";
import { enqueueMany, queueStats } from "@/server/enrichment";

async function main() {
  const topIndex = process.argv.indexOf("--top");
  const top = topIndex !== -1 ? Number(process.argv[topIndex + 1]) : 10_000;

  const works = await prisma.$queryRaw<{ olKey: string }[]>`
    SELECT w.ol_key AS "olKey"
    FROM catalog.works w
    LEFT JOIN (
      SELECT work_key, count(*) AS n FROM app.reviews GROUP BY work_key
    ) r ON r.work_key = w.ol_key
    WHERE w.description IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM catalog.enrichment e
         WHERE e.entity_type = 'work' AND e.entity_key = w.ol_key
           AND e.field = 'description'
           AND (e.expires_at IS NULL OR e.expires_at > now())
      )
    ORDER BY coalesce(r.n, 0) DESC, w.edition_count DESC, w.ol_key
    LIMIT ${top}
  `;

  console.log(`${works.length} work(s) without a description`);

  const queued = await enqueueMany(
    works.map((w) => ({
      entityType: "work" as const,
      entityKey: w.olKey,
      field: "description" as const,
      source: "google_books",
    }))
  );

  console.log(`${queued} newly queued (the rest were already pending)`);
  console.log("Queue:", JSON.stringify(await queueStats()));
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
