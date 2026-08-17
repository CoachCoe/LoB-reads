/**
 * Fetch cover images once and store them in our own object storage.
 *
 *   npx tsx scripts/enrich/covers.ts             # every cover not yet stored
 *   npx tsx scripts/enrich/covers.ts --limit 200
 *   npx tsx scripts/enrich/covers.ts --size L
 *
 * Covers are currently hotlinked from covers.openlibrary.org on every page
 * render. That is rude at any volume and fragile at all of them: the published
 * rate limits have changed more than once, and a block would empty every cover
 * on the site at once.
 *
 * TWO TRAPS, both verified against the live endpoint:
 *
 *   1. A missing cover does NOT 404. It answers HTTP 200 with a 43-byte 1x1
 *      transparent GIF. Code that checks `response.ok` will happily store that
 *      as a book cover. Appending `?default=false` gives a real 404.
 *
 *   2. Misses must be cached. A large share of editions have no cover, and
 *      re-requesting them forever is exactly how access gets revoked.
 */

import "./env";
import prisma from "@/lib/prisma";
import { putObject, isStorageConfigured } from "@/lib/storage/objects";

const COVER_SOURCE = "openlibrary_covers";
const MISS_TTL_DAYS = 30;
/** A stored cover does not change; only re-check after a long interval. */
const HIT_TTL_DAYS = 365;

/** Politeness. The published limits have moved; this stays well beneath them. */
const REQUESTS_PER_SECOND = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Smallest plausible real image. The placeholder GIF is 43 bytes. */
const MIN_IMAGE_BYTES = 200;

interface Pending {
  editionKey: string;
  coverId: number;
}

async function pendingCovers(limit: number): Promise<Pending[]> {
  return prisma.$queryRaw<Pending[]>`
    SELECT e.ol_key AS "editionKey", e.cover_id::int AS "coverId"
    FROM catalog.editions e
    WHERE e.cover_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM catalog.enrichment en
         WHERE en.entity_type = 'edition'
           AND en.entity_key = e.ol_key
           AND en.field = 'cover_url'
           AND en.source = ${COVER_SOURCE}
           AND (en.expires_at IS NULL OR en.expires_at > now())
      )
    ORDER BY e.ol_key
    LIMIT ${limit}
  `;
}

async function record(editionKey: string, value: string | null, ttlDays: number) {
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await prisma.$executeRaw`
    INSERT INTO catalog.enrichment
      (entity_type, entity_key, source, field, value, fetched_at, expires_at)
    VALUES ('edition', ${editionKey}, ${COVER_SOURCE}, 'cover_url',
            ${JSON.stringify(value)}::jsonb, now(), ${expiresAt})
    ON CONFLICT (entity_type, entity_key, source, field)
    DO UPDATE SET value = EXCLUDED.value,
                  fetched_at = EXCLUDED.fetched_at,
                  expires_at = EXCLUDED.expires_at
  `;
}

/**
 * Returns the stored URL, or null for a confirmed miss.
 * Throws only on transport or storage failure, which is retried later.
 */
async function fetchAndStore(
  cover: Pending,
  size: string
): Promise<string | null> {
  // default=false is what turns a miss into a 404 instead of a placeholder.
  const url = `https://covers.openlibrary.org/b/id/${cover.coverId}-${size}.jpg?default=false`;

  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 404) return null;

  if (response.status === 429) {
    throw new Error("rate limited by covers.openlibrary.org");
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  // Belt and braces: even with default=false, refuse anything too small to be
  // a real cover rather than storing a placeholder under a book's name.
  if (bytes.length < MIN_IMAGE_BYTES) return null;

  const file = new File([new Uint8Array(bytes)], `${cover.coverId}-${size}.jpg`, {
    type: response.headers.get("content-type") ?? "image/jpeg",
  });

  const { url: storedUrl } = await putObject(
    `covers/${size}/${cover.coverId}.jpg`,
    file
  );
  return storedUrl;
}

async function main() {
  const argv = process.argv.slice(2);
  const limitIndex = argv.indexOf("--limit");
  const limit = limitIndex !== -1 ? Number(argv[limitIndex + 1]) : 1000;
  const sizeIndex = argv.indexOf("--size");
  const size = sizeIndex !== -1 ? argv[sizeIndex + 1] : "M";

  if (!isStorageConfigured()) {
    console.error(
      "S3_BUCKET is not set. Covers would be fetched and then discarded."
    );
    process.exit(1);
  }

  const covers = await pendingCovers(limit);
  console.log(`${covers.length} cover(s) to fetch at size ${size}`);

  let stored = 0;
  let missing = 0;
  let failed = 0;

  for (const cover of covers) {
    try {
      const storedUrl = await fetchAndStore(cover, size);

      if (storedUrl) {
        await record(cover.editionKey, storedUrl, HIT_TTL_DAYS);
        stored++;
      } else {
        // Cached, so this edition is never asked about again this month.
        await record(cover.editionKey, null, MISS_TTL_DAYS);
        missing++;
      }
    } catch (error) {
      failed++;
      console.warn(
        `  ${cover.editionKey}: ${error instanceof Error ? error.message : error}`
      );
      if (String(error).includes("rate limited")) {
        console.warn("  backing off — stopping this run");
        break;
      }
    }

    if ((stored + missing + failed) % 50 === 0) {
      console.log(`  ${stored} stored, ${missing} missing, ${failed} failed`);
    }

    await sleep(1000 / REQUESTS_PER_SECOND);
  }

  console.log(`\nDone: ${stored} stored, ${missing} confirmed missing, ${failed} failed`);
}

main()
  .catch((error) => {
    console.error("Cover fetch failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
