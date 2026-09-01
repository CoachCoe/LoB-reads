import { prisma } from "./setup";
import {
  enqueue,
  enqueueMany,
  claimJobs,
  getTarget,
  recordResult,
  recordFailure,
  releaseRunning,
  reclaimStale,
  queueStats,
  MAX_ATTEMPTS,
} from "@/server/enrichment";
import { getWorkByKey } from "@/server/catalog";
import { makeWork } from "./factories";

/**
 * M4 acceptance.
 *
 *   1. Description coverage on the top works exceeds 90%.
 *   2. Zero external calls happen during a page render.
 *
 * The second is the one worth defending in a test. It is easy to satisfy today
 * and easy to break next month by "just fetching it inline when it's missing" —
 * which works fine locally and then inherits a third party's latency and
 * downtime in production.
 */

async function clearEnrichment() {
  await prisma.$executeRawUnsafe(`DELETE FROM catalog.enrichment_queue`);
  await prisma.$executeRawUnsafe(`DELETE FROM catalog.enrichment`);
}

beforeEach(clearEnrichment);
afterAll(clearEnrichment);

describe("the queue", () => {
  it("deduplicates rather than piling up duplicate work", async () => {
    const work = await makeWork();
    const request = {
      entityType: "work" as const,
      entityKey: work.olKey,
      field: "description" as const,
      source: "google_books",
    };

    await enqueue(request);
    await enqueue(request);
    await enqueue(request);

    expect(await prisma.enrichmentJob.count()).toBe(1);
  });

  it("does not reset a backoff when something is re-requested", async () => {
    const work = await makeWork();
    const request = {
      entityType: "work" as const,
      entityKey: work.olKey,
      field: "description" as const,
      source: "google_books",
    };

    await enqueue(request);
    const [job] = await claimJobs(1);
    await recordFailure(job.id, 0, "boom");

    const afterFailure = await prisma.enrichmentJob.findUnique({
      where: { id: job.id },
    });

    // A page render enqueueing again must not pull the retry forward, or a
    // popular broken work would hammer the source on every view.
    await enqueue(request);

    const afterRequeue = await prisma.enrichmentJob.findUnique({
      where: { id: job.id },
    });
    expect(afterRequeue!.nextAttemptAt).toEqual(afterFailure!.nextAttemptAt);
    expect(afterRequeue!.attempts).toBe(1);
  });

  it("claims each job once, so parallel workers cannot collide", async () => {
    const works = await Promise.all([makeWork(), makeWork(), makeWork()]);
    await enqueueMany(
      works.map((w) => ({
        entityType: "work" as const,
        entityKey: w.olKey,
        field: "description" as const,
        source: "google_books",
      }))
    );

    const [first, second] = await Promise.all([claimJobs(2), claimJobs(2)]);
    const ids = [...first, ...second].map((j) => j.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only claims jobs that are due", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });

    const [job] = await claimJobs(1);
    // An explicit backoff rather than the jittered default. The default is
    // `30 * (0.5 + random())` = 15-30 seconds, computed from the NODE clock,
    // while claimJobs compares against Postgres `now()` — so the margin was 15
    // seconds at worst plus any app/DB clock skew, and it failed twice in about
    // ten runs under load. The behaviour under test is the
    // `next_attempt_at <= now()` filter, which an hour exercises just as well.
    await recordFailure(job.id, 0, "not yet", 3600);

    // Backoff puts it in the future, so a worker running now sees nothing.
    expect(await claimJobs(10)).toHaveLength(0);
  });

  it("applies a jittered backoff within the documented bounds", async () => {
    // Kept as a separate, non-racing assertion so the jitter itself stays
    // covered after the test above stopped depending on it.
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });

    const [job] = await claimJobs(1);
    const before = Date.now();
    await recordFailure(job.id, 0, "jitter");

    const row = await prisma.enrichmentJob.findUnique({
      where: { id: job.id },
      select: { nextAttemptAt: true },
    });

    // `30 * (0.5 + Math.random())`, and `0.5 + random()` spans [0.5, 1.5) — so
    // the first backoff is 15 to 45 seconds, not 15 to 30. An earlier version of
    // this test asserted 30 and failed at 40.7s, which is the range doing its
    // job. STATUS.md only ever stated the lower bound.
    expect(row?.nextAttemptAt).toBeInstanceOf(Date);
    const delayMs = (row?.nextAttemptAt as Date).getTime() - before;
    expect(delayMs).toBeGreaterThanOrEqual(15_000 - 1_000);
    expect(delayMs).toBeLessThan(45_000 + 1_000);
  });

  it("caps a backoff the upstream asked for", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });

    const [job] = await claimJobs(1);
    const before = Date.now();
    // SEC-15: an upstream Retry-After used to bypass the ceiling entirely,
    // which stranded the job permanently rather than delaying it.
    await recordFailure(job.id, 0, "rate limited", 999_999_999);

    const row = await prisma.enrichmentJob.findUnique({
      where: { id: job.id },
      select: { nextAttemptAt: true },
    });

    expect(row?.nextAttemptAt).toBeInstanceOf(Date);
    expect((row?.nextAttemptAt as Date).getTime() - before).toBeLessThanOrEqual(
      3_600_000 + 1_000
    );
  });

  /**
   * reclaimStale exists to return jobs abandoned by a killed worker. It used to
   * compare `created_at`, which is when the job was ENQUEUED — so on a real
   * queue, where a job is usually older than the cutoff by the time anyone
   * claims it, it handed a worker's live batch to a second worker: the same
   * rate-limited third party called twice for one row, and two racing
   * recordResult calls writing the same catalog.enrichment key.
   */
  it("leaves a freshly claimed job alone even when it was enqueued long ago", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });

    // Enqueued 20 minutes ago — entirely normal for a queue with a backlog.
    await prisma.$executeRaw`
      UPDATE catalog.enrichment_queue
         SET created_at = now() - interval '20 minutes'
       WHERE entity_key = ${work.olKey}
    `;

    const [job] = await claimJobs(1);
    expect(job).toBeDefined();

    // Claimed a moment ago, so it is not stale however old the row is.
    expect(await reclaimStale(15)).toBe(0);

    const after = await prisma.enrichmentJob.findUnique({
      where: { id: job.id },
      select: { status: true },
    });
    expect(after?.status).toBe("running");
  });

  it("reclaims a job whose worker died", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });

    const [job] = await claimJobs(1);

    // The worker took it 20 minutes ago and never came back.
    await prisma.$executeRaw`
      UPDATE catalog.enrichment_queue
         SET claimed_at = now() - interval '20 minutes'
       WHERE id = ${job.id}
    `;

    expect(await reclaimStale(15)).toBe(1);

    const after = await prisma.enrichmentJob.findUnique({
      where: { id: job.id },
      select: { status: true, claimedAt: true },
    });
    expect(after?.status).toBe("pending");
    expect(after?.claimedAt).toBeNull();
  });

  it("gives up after MAX_ATTEMPTS instead of cycling forever", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });

    const [job] = await claimJobs(1);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await recordFailure(job.id, attempt, "still broken");
    }

    const final = await prisma.enrichmentJob.findUnique({ where: { id: job.id } });
    expect(final!.status).toBe("failed");
    expect((await queueStats()).failed).toBe(1);
  });

  it("returns interrupted jobs to the queue", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });

    const claimed = await claimJobs(1);
    expect((await queueStats()).running).toBe(1);

    await releaseRunning(claimed.map((j) => j.id));

    expect((await queueStats()).pending).toBe(1);
  });

  it("resolves a target with the ISBN a source needs", async () => {
    const work = await makeWork();
    await prisma.$executeRawUnsafe(
      `UPDATE catalog.editions SET isbn13 = '9780441172719' WHERE work_key = '${work.olKey}'`
    );

    const target = await getTarget("work", work.olKey);
    expect(target).not.toBeNull();
    expect(target!.title).toBe(work.title);
    expect(target!.isbn13).toBe("9780441172719");
  });
});

describe("recording results", () => {
  it("writes to catalog.enrichment and NEVER to catalog.works", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });
    const [job] = await claimJobs(1);

    await recordResult(job, "A description from elsewhere.", 30);

    // The canonical row is untouched: the monthly rebuild stays authoritative,
    // and purging a source is one DELETE.
    const [canonical] = await prisma.$queryRawUnsafe<{ description: string | null }[]>(
      `SELECT description FROM catalog.works WHERE ol_key = '${work.olKey}'`
    );
    expect(canonical.description).toBeNull();

    const [enriched] = await prisma.$queryRawUnsafe<{ value: string }[]>(
      `SELECT value #>> '{}' AS value FROM catalog.enrichment
        WHERE entity_key = '${work.olKey}' AND field = 'description'`
    );
    expect(enriched.value).toBe("A description from elsewhere.");
  });

  it("always sets an expiry, because the value is a cache and not ours", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });
    const [job] = await claimJobs(1);

    await recordResult(job, "Cached text.", 30);

    const [row] = await prisma.$queryRawUnsafe<{ expiresAt: Date | null }[]>(
      `SELECT expires_at AS "expiresAt" FROM catalog.enrichment
        WHERE entity_key = '${work.olKey}'`
    );
    expect(row.expiresAt).not.toBeNull();
  });

  it("caches a confirmed absence, so it is not asked again", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });
    const [job] = await claimJobs(1);

    await recordResult(job, null, 30);

    expect((await queueStats()).done).toBe(1);
    expect(
      await prisma.$queryRawUnsafe(
        `SELECT 1 FROM catalog.enrichment WHERE entity_key = '${work.olKey}'`
      )
    ).toHaveLength(1);
  });
});

describe("read layering", () => {
  it("shows enrichment when there is no canonical description", async () => {
    const work = await makeWork();
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });
    const [job] = await claimJobs(1);
    await recordResult(job, "Filled in from elsewhere.", 30);

    const detail = await getWorkByKey(work.olKey);
    expect(detail!.description).toBe("Filled in from elsewhere.");
    // Attribution is required by the licence, so the source must survive the read.
    expect(detail!.descriptionSource).toBe("google_books");
  });

  it("prefers the canonical description over enrichment", async () => {
    const work = await makeWork();
    await prisma.$executeRawUnsafe(
      `UPDATE catalog.works SET description = 'From Open Library.' WHERE ol_key = '${work.olKey}'`
    );
    await enqueue({
      entityType: "work",
      entityKey: work.olKey,
      field: "description",
      source: "google_books",
    });
    const [job] = await claimJobs(1);
    await recordResult(job, "From a third party.", 30);

    const detail = await getWorkByKey(work.olKey);
    expect(detail!.description).toBe("From Open Library.");
    expect(detail!.descriptionSource).toBeNull();
  });

  it("ignores expired enrichment rather than serving it", async () => {
    const work = await makeWork();
    await prisma.$executeRawUnsafe(`
      INSERT INTO catalog.enrichment
        (entity_type, entity_key, source, field, value, fetched_at, expires_at)
      VALUES ('work', '${work.olKey}', 'google_books', 'description',
              '"Stale text."'::jsonb, now() - interval '60 days',
              now() - interval '30 days')
    `);

    const detail = await getWorkByKey(work.olKey);
    expect(detail!.description).toBeNull();
  });
});

describe("M4 acceptance", () => {
  it("makes zero external calls during a work page render", async () => {
    const work = await makeWork(); // deliberately has no description

    const realFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("A page render must not call a third party");
    }) as typeof fetch;

    try {
      // Exactly what the work page does: read, then queue if empty.
      const detail = await getWorkByKey(work.olKey);
      expect(detail).not.toBeNull();

      if (!detail!.description) {
        await enqueue({
          entityType: "work",
          entityKey: detail!.olKey,
          field: "description",
          source: "google_books",
        });
      }
    } finally {
      global.fetch = realFetch;
    }

    expect(calls).toEqual([]);
    // …and the work is queued for the worker to pick up out of band.
    expect(await prisma.enrichmentJob.count()).toBe(1);
  });

  it("reaches over 90% description coverage once the queue drains", async () => {
    // Twenty works with no description, as a fresh catalog looks.
    const works = await Promise.all(
      Array.from({ length: 20 }, () => makeWork())
    );

    await enqueueMany(
      works.map((w) => ({
        entityType: "work" as const,
        entityKey: w.olKey,
        field: "description" as const,
        source: "google_books",
      }))
    );

    const coverage = async () => {
      const [row] = await prisma.$queryRaw<{ pct: number }[]>`
        SELECT (count(*) FILTER (
                 WHERE w.description IS NOT NULL OR e.value #>> '{}' IS NOT NULL
               )::float / greatest(count(*), 1) * 100)::float AS pct
        FROM catalog.works w
        LEFT JOIN catalog.enrichment e
          ON e.entity_type = 'work' AND e.entity_key = w.ol_key
         AND e.field = 'description'
         AND (e.expires_at IS NULL OR e.expires_at > now())
        WHERE w.ol_key = ANY(${works.map((w) => w.olKey)})
      `;
      return row.pct;
    };

    expect(await coverage()).toBe(0);

    // Drain the queue with a stub source. The real one is Google Books, which
    // cannot run in CI; what is under test is the pipeline, not their API.
    // One work is left without a description on purpose — real sources have
    // gaps, and a test that assumes 100% would not represent anything.
    let processed = 0;
    for (;;) {
      const jobs = await claimJobs(10);
      if (jobs.length === 0) break;
      for (const job of jobs) {
        const found = processed % 20 !== 19;
        await recordResult(job, found ? `Description ${processed}` : null, 30);
        processed++;
      }
    }

    const finalCoverage = await coverage();
    expect(finalCoverage).toBeGreaterThan(90);
    expect((await queueStats()).pending ?? 0).toBe(0);
  }, 60_000);
});
