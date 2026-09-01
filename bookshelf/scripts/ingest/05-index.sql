-- Stage 5 — index.
--
-- The FTS and trigram indexes are created by the schema migration; this rebuilds
-- statistics after a bulk load so the planner makes sensible choices. Without
-- ANALYZE, Postgres plans against stale estimates and may seq-scan a million
-- rows where an index exists.

-- Index builds are bound by maintenance_work_mem; the 64MB default turns a
-- GIN build over millions of rows into repeated merge passes. Session-scoped,
-- so it ends with this psql connection.
SET maintenance_work_mem = '2GB';
SET work_mem = '256MB';

ANALYZE catalog.authors;
ANALYZE catalog.works;
ANALYZE catalog.work_authors;
ANALYZE catalog.editions;
ANALYZE catalog.external_ids;

-- Staging tables are scratch; reclaim the space once normalize has run.
TRUNCATE catalog.stage_authors, catalog.stage_works, catalog.stage_editions;

-- ---------------------------------------------------------------------------
-- Derived: subject counts for the discover page
-- ---------------------------------------------------------------------------
-- Computed once here rather than per request. Aggregating this live meant a
-- sequential scan over every work on every page load — 3.9 seconds on the real
-- catalog, and the search page paid it too while throwing the result away.
TRUNCATE catalog.subject_counts;

INSERT INTO catalog.subject_counts (subject, work_count, computed_at)
SELECT subject, count(*)::int, now()
FROM catalog.works, unnest(subjects) AS subject
GROUP BY subject;

ANALYZE catalog.subject_counts;
