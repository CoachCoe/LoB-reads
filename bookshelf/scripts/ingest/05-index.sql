-- Stage 5 — index.
--
-- The FTS and trigram indexes are created by the schema migration; this rebuilds
-- statistics after a bulk load so the planner makes sensible choices. Without
-- ANALYZE, Postgres plans against stale estimates and may seq-scan a million
-- rows where an index exists.

ANALYZE catalog.authors;
ANALYZE catalog.works;
ANALYZE catalog.work_authors;
ANALYZE catalog.editions;
ANALYZE catalog.external_ids;

-- Staging tables are scratch; reclaim the space once normalize has run.
TRUNCATE catalog.stage_authors, catalog.stage_works, catalog.stage_editions;
