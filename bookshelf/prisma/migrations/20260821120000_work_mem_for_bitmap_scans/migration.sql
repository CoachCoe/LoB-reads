-- Raise work_mem, because the default makes the search bitmap scan go lossy.
--
-- "Fiction" matches 10,061 works. At the 4MB default the bitmap index scan
-- overflows, stops tracking individual rows, degrades to page granularity, and
-- rechecks every row on every candidate page. Measured on the 6.9M-work
-- catalog, with shared_buffers untouched at 128MB:
--
--   work_mem   rows rechecked   heap blocks                    query
--   4MB        1,028,773        11,357 exact + 55,531 lossy    3549 ms
--   32MB       93,941           67,069 exact, none lossy       1007 ms
--   256MB      93,941           66,682 exact                    926 ms
--
-- 32MB is the knee; more buys almost nothing, and work_mem is allocated per
-- sort or hash node PER PARALLEL WORKER, so it multiplies under concurrency.
--
-- This lives in a migration rather than in a runbook because it was previously
-- set by hand on one machine, which meant a fresh clone silently got the slow
-- query back. Set at database scope so it applies to every connection without
-- touching server-wide configuration.
--
-- It does NOT make the query fast enough. With the whole working set cached and
-- zero disk reads it is still ~1.2s; bounding the candidate set is tracked
-- separately.

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET work_mem = %L', current_database(), '32MB');
EXCEPTION
  -- A managed provider may not grant ALTER DATABASE to the application role.
  -- A performance setting is not worth failing a deployment over, but it is
  -- worth being loud about: silently skipping it is how the slow query comes
  -- back unnoticed. The post-deploy check script asserts the value, so this
  -- being skipped is caught rather than assumed.
  WHEN insufficient_privilege THEN
    RAISE WARNING
      'Could not set work_mem at database scope (insufficient privilege). Set it as a server parameter instead — on Azure: az postgres flexible-server parameter set --name work_mem --value 32768. Leaving it at the default makes common-word search roughly 3.5x slower.';
END $$;
