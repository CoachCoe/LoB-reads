-- Raise the trigram similarity threshold from pg_trgm's 0.3 default to 0.5.
--
-- Search runs `search_vector @@ tsq OR title_norm % norm`. At 0.3 the trigram
-- arm is far too permissive: on the real 6.9M-work catalog, the query "dune"
-- had GIN return 134,463 candidate rows for the trigram arm, all of which were
-- rechecked against the heap to yield 202 actual matches. The whole query took
-- 223ms, and the search page runs it twice — once for results, once for the
-- count — so the page took nearly four seconds. M2's acceptance is a p95 under
-- 100ms.
--
-- Measured on the real catalog:
--
--   threshold 0.3 (default)   223 ms
--   threshold 0.5              25 ms
--   threshold 0.7              14 ms
--
-- 0.5 rather than 0.7 because the trigram arm exists to catch typos that FTS
-- cannot match at all, and those must keep working. Measured similarity of
-- realistic misspellings against the titles they should find:
--
--   to kill a mockingbrd -> to kill a mockingbird   0.792
--   the hobbitt          -> the hobbit              0.769
--   farenheit 451        -> fahrenheit 451          0.706
--   slaughterhouse five  -> slaughterhouse-five     1.000
--
-- All comfortably above 0.5. Two cases fall below it and neither is a loss:
-- "gatsby" against "the great gatsby" scores 0.438, but FTS matches it on the
-- word alone; and "dnue" against "dune" scores 0.111, which fails at 0.3 too,
-- because a four-character string has too few trigrams to match anything.
--
-- Set on the database rather than in the query so it applies to every
-- connection without a round trip. It takes effect for new connections, so
-- restart the app after applying it.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET pg_trgm.similarity_threshold = 0.5',
    current_database()
  );
END
$$;
