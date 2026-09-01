-- Precomputed subject counts for the discover page.
--
-- getCatalogSubjects used to aggregate this live: a sequential scan of every
-- work, unnesting subjects into millions of rows, grouped and sorted, on every
-- request. On the real 6.9M-work catalog that took 3.9 seconds — and the
-- search page ran it on every query too, discarding the result, because the
-- subject chips only render when there is no query. It was the whole of the
-- search page's four-second latency; the search itself was 51ms.
--
-- The original audit caught this same bug in its previous form ("getAllGenres
-- reads the entire books table into memory on every search-page render"). It
-- was rewritten as a GROUP BY, which is not the same as making it cheap.
--
-- Subjects only change when the catalog is rebuilt, so this is derived data
-- refreshed by 05-index.sql at the end of an ingest.
CREATE TABLE IF NOT EXISTS "catalog"."subject_counts" (
  "subject"    text PRIMARY KEY,
  "work_count" integer NOT NULL,
  "computed_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "subject_counts_work_count_idx"
  ON "catalog"."subject_counts" ("work_count" DESC);
