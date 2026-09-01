/**
 * Enrichment worker.
 *
 *   npx tsx scripts/enrich/worker.ts              # drain the queue, then exit
 *   npx tsx scripts/enrich/worker.ts --watch      # keep polling
 *   npx tsx scripts/enrich/worker.ts --limit 100  # stop after N jobs
 *
 * Runs outside the request path, always. Nothing here is ever called from a
 * page render; the render only enqueues.
 *
 * Google Books needs GOOGLE_BOOKS_API_KEY. Keyless requests are answered with
 * 429 from a shared address — verified against the live endpoint — so without
 * a key this will back off almost immediately and make no progress.
 */

import "./env";
import prisma from "@/lib/prisma";
import {
  claimJobs,
  getTarget,
  recordResult,
  recordFailure,
  releaseRunning,
  queueStats,
  reclaimStale,
} from "@/server/enrichment";
import {
  GoogleBooksSource,
  RateLimitedError,
  type EnrichmentSource,
} from "@/lib/sources/enrichment";

const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 5_000;

const SOURCES: Record<string, EnrichmentSource> = {
  google_books: new GoogleBooksSource(),
};

/**
 * Spaces requests to a source's tolerated rate. A plain sleep between calls is
 * enough here — the worker is single-threaded by design, because parallelism
 * against a rate-limited third party buys nothing.
 */
class Throttle {
  private last = 0;
  constructor(private readonly perSecond: number) {}

  async wait() {
    const minGap = 1000 / this.perSecond;
    const elapsed = Date.now() - this.last;
    if (elapsed < minGap) {
      await sleep(minGap - elapsed);
    }
    this.last = Date.now();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const throttles = new Map<string, Throttle>();
function throttleFor(source: EnrichmentSource): Throttle {
  let throttle = throttles.get(source.name);
  if (!throttle) {
    throttle = new Throttle(source.ratePerSecond);
    throttles.set(source.name, throttle);
  }
  return throttle;
}

interface Counters {
  filled: number;
  empty: number;
  failed: number;
  rateLimited: number;
}

async function runBatch(counters: Counters): Promise<number> {
  const jobs = await claimJobs(BATCH_SIZE);
  if (jobs.length === 0) return 0;

  // Tracked so anything left unprocessed — because the batch stopped early,
  // or the process was interrupted — goes back to pending rather than sitting
  // in "running" forever.
  const outstanding = new Set(jobs.map((j) => j.id));
  const claimed = jobs.map((j) => j.id);

  // Put anything still claimed back if the process is interrupted, rather than
  // leaving it stuck in "running" until a human notices.
  const onExit = () => {
    void releaseRunning(claimed).finally(() => process.exit(130));
  };
  process.once("SIGINT", onExit);
  process.once("SIGTERM", onExit);

  try {
    for (const job of jobs) {
      const source = SOURCES[job.source];

      if (!source) {
        await recordFailure(job.id, job.attempts, `Unknown source ${job.source}`);
        outstanding.delete(job.id);
        counters.failed++;
        continue;
      }

      if (job.field !== "description") {
        // Covers are handled by scripts/enrich/covers.ts, which streams bytes
        // to object storage rather than writing a value.
        await recordFailure(job.id, job.attempts, `Unsupported field ${job.field}`);
        outstanding.delete(job.id);
        counters.failed++;
        continue;
      }

      try {
        const target = await getTarget(job.entityType, job.entityKey);
        if (!target) {
          await recordFailure(job.id, job.attempts, "Entity no longer in catalog");
          outstanding.delete(job.id);
          counters.failed++;
          continue;
        }

        await throttleFor(source).wait();
        const result = await source.fetchDescription(target);

        await recordResult(job, result.value, result.ttlDays);
        outstanding.delete(job.id);
        if (result.value) counters.filled++;
        else counters.empty++;
      } catch (error) {
        if (error instanceof RateLimitedError) {
          counters.rateLimited++;
          await recordFailure(
            job.id,
            job.attempts,
            error.message,
            error.retryAfterSeconds
          );
          outstanding.delete(job.id);
          // Stop the batch: the next job would be rate-limited too, and
          // hammering a source that just said no is how access gets revoked.
          console.warn(`  rate limited by ${job.source}, pausing batch`);
          break;
        }

        counters.failed++;
        await recordFailure(
          job.id,
          job.attempts,
          error instanceof Error ? error.message : String(error)
        );
        outstanding.delete(job.id);
      }
    }
  } finally {
    process.off("SIGINT", onExit);
    process.off("SIGTERM", onExit);
    // Anything the batch did not reach goes back to pending.
    await releaseRunning([...outstanding]);
  }

  return jobs.length;
}

async function main() {
  const argv = process.argv.slice(2);
  const watch = argv.includes("--watch");
  const limitIndex = argv.indexOf("--limit");
  const limit = limitIndex !== -1 ? Number(argv[limitIndex + 1]) : Infinity;

  if (!process.env.GOOGLE_BOOKS_API_KEY) {
    console.warn(
      "GOOGLE_BOOKS_API_KEY is not set. Keyless requests are rate-limited\n" +
        "immediately, so expect this run to make little or no progress.\n"
    );
  }

  const counters: Counters = { filled: 0, empty: 0, failed: 0, rateLimited: 0 };
  let processed = 0;

  // A previous run may have been killed mid-batch.
  const reclaimed = await reclaimStale();
  if (reclaimed > 0) {
    console.log(`Reclaimed ${reclaimed} job(s) stranded by an earlier run`);
  }

  console.log("Queue:", JSON.stringify(await queueStats()));

  for (;;) {
    const done = await runBatch(counters);
    processed += done;

    if (done > 0) {
      console.log(
        `  ${processed} processed — ${counters.filled} filled, ` +
          `${counters.empty} confirmed empty, ${counters.failed} failed`
      );
    }

    if (processed >= limit) break;

    if (done === 0) {
      if (!watch) break;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log("\nFinished:", JSON.stringify(counters));
  console.log("Queue:", JSON.stringify(await queueStats()));
}

main()
  .catch((error) => {
    console.error("Worker failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
