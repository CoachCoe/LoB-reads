-- When a job was claimed, so reclaimStale can tell an abandoned job from a busy
-- one.
--
-- reclaimStale selected `status = 'running' AND created_at < cutoff`, but
-- created_at is when the job was ENQUEUED, not when a worker took it. On a real
-- queue almost every job is older than fifteen minutes by the time it is
-- claimed, so a worker's freshly claimed batch was returned to 'pending' while
-- it was still being processed: a second worker claims the same rows, the
-- rate-limited third party is called twice for one row, and both racing
-- recordResult calls write the same catalog.enrichment key.
--
-- That also made the intended failure — a killed worker leaving rows claimed —
-- indistinguishable from the normal case.
ALTER TABLE "catalog"."enrichment_queue"
  ADD COLUMN IF NOT EXISTS "claimed_at" timestamptz(6);
