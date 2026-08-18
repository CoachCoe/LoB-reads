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
