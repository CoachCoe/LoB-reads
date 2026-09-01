-- Store instants as timestamptz.
--
-- Every DateTime column was `timestamp without time zone`, which is Prisma's
-- default mapping. Prisma writes UTC instants into them, while SQL `now()`
-- evaluated in a timestamp context returns LOCAL time — so any comparison
-- between an application-written timestamp and now() was wrong by the server's
-- UTC offset. Four hours, here.
--
-- That silently broke two things in the enrichment layer: `next_attempt_at <=
-- now()` never matched a freshly queued job, and `expires_at > now()` judged
-- freshness against the wrong clock. It would have been invisible on a server
-- running in UTC and wrong everywhere else.
--
-- The USING clause is load-bearing. Without it Postgres assumes the existing
-- naive values are local time and shifts every one of them; they were written
-- as UTC, so they must be reinterpreted as UTC.

ALTER TABLE "app"."author_locations" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "app"."author_locations" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "app"."fictional_world_maps" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."fictional_world_maps" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."fictional_worlds" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."fictional_worlds" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."follows" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."reading_sessions" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "app"."reading_sessions" ALTER COLUMN "finished_at" TYPE TIMESTAMPTZ(6) USING "finished_at" AT TIME ZONE 'UTC';
ALTER TABLE "app"."reading_sessions" ALTER COLUMN "started_at" TYPE TIMESTAMPTZ(6) USING "started_at" AT TIME ZONE 'UTC';
ALTER TABLE "app"."reading_sessions" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "app"."reviews" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."reviews" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."shelf_items" ALTER COLUMN "addedAt" TYPE TIMESTAMPTZ(6) USING "addedAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."shelves" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."shelves" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."users" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."users" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "app"."work_fictional_worlds" ALTER COLUMN "added_at" TYPE TIMESTAMPTZ(6) USING "added_at" AT TIME ZONE 'UTC';
ALTER TABLE "app"."work_locations" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "app"."work_locations" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."authors" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."editions" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."enrichment" ALTER COLUMN "expires_at" TYPE TIMESTAMPTZ(6) USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."enrichment" ALTER COLUMN "fetched_at" TYPE TIMESTAMPTZ(6) USING "fetched_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."enrichment_queue" ALTER COLUMN "completed_at" TYPE TIMESTAMPTZ(6) USING "completed_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."enrichment_queue" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."enrichment_queue" ALTER COLUMN "next_attempt_at" TYPE TIMESTAMPTZ(6) USING "next_attempt_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."ingest_runs" ALTER COLUMN "completed_at" TYPE TIMESTAMPTZ(6) USING "completed_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."ingest_runs" ALTER COLUMN "dump_published" TYPE TIMESTAMPTZ(6) USING "dump_published" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."ingest_runs" ALTER COLUMN "started_at" TYPE TIMESTAMPTZ(6) USING "started_at" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."stage_authors" ALTER COLUMN "last_modified" TYPE TIMESTAMPTZ(6) USING "last_modified" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."stage_editions" ALTER COLUMN "last_modified" TYPE TIMESTAMPTZ(6) USING "last_modified" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."stage_works" ALTER COLUMN "last_modified" TYPE TIMESTAMPTZ(6) USING "last_modified" AT TIME ZONE 'UTC';
ALTER TABLE "catalog"."works" ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';
