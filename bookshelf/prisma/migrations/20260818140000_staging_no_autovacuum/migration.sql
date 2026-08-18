-- Keep autovacuum off the staging tables.
--
-- They are UNLOGGED, written once by COPY, read once by normalize, and then
-- dropped. Vacuuming them buys nothing and costs a great deal at the worst
-- possible moment: during the first full ingest, an autovacuum sat on
-- stage_editions for over three hours, throttled by vacuum_cost_delay,
-- competing for IO with the normalize transaction it could not help.
--
-- Autovacuum triggers on the bulk insert itself, so this fires on every run
-- unless disabled.
ALTER TABLE "catalog"."stage_authors"  SET (autovacuum_enabled = false);
ALTER TABLE "catalog"."stage_works"    SET (autovacuum_enabled = false);
ALTER TABLE "catalog"."stage_editions" SET (autovacuum_enabled = false);
