-- Take subjects out of search_vector, and index them for browsing instead.
--
-- Subjects were the D-weighted term in the tsvector, which made every generic
-- word match most of the catalog:
--
--                    matches      without subjects
--   "Fiction"        735,956      10,061
--   "History"        629,451      80,563
--   "dune"               456         416
--   "tolkien"            673         550
--
-- Ranking a match set that large means reading every matching row, so a search
-- for "Fiction" took 6.7 seconds — and the discover page's own subject chips
-- link straight into it. The rank expression is not the cost: substituting a
-- trivial `ln(1 + edition_count)` still took 5.5 seconds.
--
-- Excluding subjects barely moves a title or author search, which is what
-- people actually type. It does remove the ability to find books by subject
-- through full-text search, which is why this migration also adds a GIN index
-- on the array: a subject is now a browse — `subjects @> ARRAY['Fiction']`,
-- indexed — rather than a relevance-ranked query over three quarters of a
-- million rows. That is also a better answer to what a chip means.

CREATE OR REPLACE FUNCTION catalog.works_search_vector_update()
RETURNS trigger AS $$
BEGIN
  -- Title A, author B, subtitle C. Subjects are deliberately absent; see
  -- above. Keep this in step with the backfill in the same migration.
  NEW.search_vector :=
      setweight(to_tsvector('english', unaccent(coalesce(NEW.title, ''))), 'A')
   || setweight(to_tsvector('english', unaccent(coalesce(NEW.author_names, ''))), 'B')
   || setweight(to_tsvector('english', unaccent(coalesce(NEW.subtitle, ''))), 'C');

  NEW.title_norm        := unaccent(lower(coalesce(NEW.title, '')));
  NEW.author_names_norm := unaccent(lower(coalesce(NEW.author_names, '')));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop subjects too long to be subjects.
--
-- Open Library's subject arrays occasionally hold a blurb or a citation
-- string. Of 21.8 million entries, 48 exceed 300 characters and the longest is
-- 5,200 — a book description, not a heading. They are also unindexable: GIN
-- refuses an element over the maximum index row size, and the CREATE INDEX
-- below failed with 54000 program_limit_exceeded until they were removed.
--
-- Dropped rather than truncated: the first 300 characters of a blurb is still
-- not a subject, and would show up as a browse facet.
UPDATE catalog.works
SET subjects = ARRAY(SELECT s FROM unnest(subjects) AS s WHERE length(s) <= 300)
WHERE EXISTS (SELECT 1 FROM unnest(subjects) AS s WHERE length(s) > 300);

-- Subjects become a browse path, so they need an index of their own.
CREATE INDEX IF NOT EXISTS "works_subjects_idx"
  ON "catalog"."works" USING GIN ("subjects");
