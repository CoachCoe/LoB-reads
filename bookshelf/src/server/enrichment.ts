import prisma from "@/lib/prisma";
import type { EnrichmentTarget } from "@/lib/sources/enrichment";

/**
 * The enrichment queue.
 *
 * Enqueueing is the only thing a request path ever does — it is a single
 * INSERT with an ON CONFLICT, so serving a work with a missing description
 * costs one cheap write and never an outbound HTTP call. The spec's rule is
 * "zero external calls in a page render", and the way to keep it is to make
 * the request path structurally incapable of making one.
 */

export type EnrichmentField = "description" | "cover_url";

export interface QueueRequest {
  entityType: "work" | "edition";
  entityKey: string;
  field: EnrichmentField;
  source: string;
}

/** Give up after this many failures, so a permanently broken row stops cycling. */
export const MAX_ATTEMPTS = 5;

/**
 * Queue something for enrichment. Safe to call on every page render: the
 * unique constraint makes a repeat a no-op rather than a duplicate.
 */
export async function enqueue(request: QueueRequest): Promise<void> {
  await prisma.enrichmentJob.upsert({
    where: {
      entityType_entityKey_field_source: {
        entityType: request.entityType,
        entityKey: request.entityKey,
        field: request.field,
        source: request.source,
      },
    },
    create: { ...request },
    // Already queued, running, or done — leave it alone. Re-requesting must
    // not reset a backoff or re-run something already answered.
    update: {},
  });
}

/** Queue many at once, for a backfill sweep. */
export async function enqueueMany(requests: QueueRequest[]): Promise<number> {
  if (requests.length === 0) return 0;
  const result = await prisma.enrichmentJob.createMany({
    data: requests,
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Claim a batch of due jobs.
 *
 * The UPDATE ... RETURNING with SKIP LOCKED is what makes it safe to run more
 * than one worker: each claims a disjoint set, and a crashed worker's rows
 * become due again rather than being lost.
 */
export async function claimJobs(limit: number) {
  return prisma.$queryRaw<
    Array<{
      id: string;
      entityType: string;
      entityKey: string;
      field: string;
      source: string;
      attempts: number;
    }>
  >`
    UPDATE catalog.enrichment_queue q
       SET status = 'running'
     WHERE q.id IN (
       SELECT id FROM catalog.enrichment_queue
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING q.id, q.entity_type AS "entityType", q.entity_key AS "entityKey",
              q.field, q.source, q.attempts
  `;
}

/** The details a source needs to look something up. */
export async function getTarget(
  entityType: string,
  entityKey: string
): Promise<EnrichmentTarget | null> {
  if (entityType === "work") {
    const rows = await prisma.$queryRaw<EnrichmentTarget[]>`
      SELECT 'work'::text AS "entityType", w.ol_key AS "entityKey", w.title,
             w.author_names AS "authorNames",
             (SELECT e.isbn13 FROM catalog.editions e
               WHERE e.work_key = w.ol_key AND e.isbn13 IS NOT NULL
               ORDER BY e.publish_year DESC NULLS LAST LIMIT 1) AS isbn13
      FROM catalog.works w WHERE w.ol_key = ${entityKey}
    `;
    return rows[0] ?? null;
  }

  const rows = await prisma.$queryRaw<EnrichmentTarget[]>`
    SELECT 'edition'::text AS "entityType", e.ol_key AS "entityKey", e.title,
           w.author_names AS "authorNames", e.isbn13
    FROM catalog.editions e
    LEFT JOIN catalog.works w ON w.ol_key = e.work_key
    WHERE e.ol_key = ${entityKey}
  `;
  return rows[0] ?? null;
}

/**
 * Record an answer. Writes to catalog.enrichment only — never to
 * catalog.works or catalog.editions, so the monthly rebuild stays authoritative
 * and any single source can be purged in one statement.
 */
export async function recordResult(
  job: { id: string; entityType: string; entityKey: string; field: string; source: string },
  value: string | null,
  ttlDays: number
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);

  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO catalog.enrichment
        (entity_type, entity_key, source, field, value, fetched_at, expires_at)
      VALUES (${job.entityType}, ${job.entityKey}, ${job.source}, ${job.field},
              ${JSON.stringify(value)}::jsonb, now(), ${expiresAt})
      ON CONFLICT (entity_type, entity_key, source, field)
      DO UPDATE SET value = EXCLUDED.value,
                    fetched_at = EXCLUDED.fetched_at,
                    expires_at = EXCLUDED.expires_at
    `,
    prisma.enrichmentJob.update({
      where: { id: job.id },
      data: { status: "done", completedAt: new Date() },
    }),
  ]);
}

/**
 * Record a failure and schedule a retry with exponential backoff plus jitter.
 * Jitter matters: without it a rate-limited batch retries in lockstep and
 * gets rate-limited again together.
 */
export async function recordFailure(
  jobId: string,
  attempts: number,
  error: string,
  retryAfterSeconds?: number
): Promise<void> {
  const exhausted = attempts + 1 >= MAX_ATTEMPTS;

  const backoffSeconds =
    retryAfterSeconds ??
    Math.min(3600, 2 ** attempts * 30) * (0.5 + Math.random());

  await prisma.enrichmentJob.update({
    where: { id: jobId },
    data: {
      status: exhausted ? "failed" : "pending",
      attempts: attempts + 1,
      lastError: error.slice(0, 500),
      nextAttemptAt: new Date(Date.now() + backoffSeconds * 1000),
      completedAt: exhausted ? new Date() : null,
    },
  });
}

/** Push every claimed job back to pending, for a clean shutdown. */
export async function releaseRunning(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  await prisma.enrichmentJob.updateMany({
    where: { id: { in: jobIds }, status: "running" },
    data: { status: "pending" },
  });
}

/**
 * Return jobs abandoned in "running" to the queue.
 *
 * A worker that is killed, or that stops a batch early, leaves rows claimed.
 * Without this they sit there forever and the queue quietly stops draining —
 * a failure that looks like "nothing is happening" rather than an error.
 */
export async function reclaimStale(olderThanMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const result = await prisma.enrichmentJob.updateMany({
    where: { status: "running", createdAt: { lt: cutoff } },
    data: { status: "pending" },
  });
  return result.count;
}

export async function queueStats() {
  const rows = await prisma.enrichmentJob.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  return Object.fromEntries(rows.map((r) => [r.status, r._count.status]));
}
