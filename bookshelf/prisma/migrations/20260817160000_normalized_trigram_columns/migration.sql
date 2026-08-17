-- Make the trigram indexes usable.
--
-- Search matches on `unaccent(lower(title))`, but the trigram indexes were
-- built on the raw `title` column. Postgres cannot use an index on a column to
-- answer a query about a function of that column, so the fuzzy fallback has
-- always been a sequential scan -- correct results, no index, and no error to
-- notice.
--
-- The obvious fix, an expression index on `unaccent(lower(title))`, is not
-- available: `unaccent()` is STABLE rather than IMMUTABLE, because its result
-- depends on a dictionary that could be reloaded. Postgres refuses it in an
-- index expression.
--
-- So normalise on write instead, exactly as `search_vector` already does --
-- the trigger calls the STABLE function once per row and stores the result,
-- and the index is then over a plain column.

ALTER TABLE "catalog"."works"
  ADD COLUMN IF NOT EXISTS "title_norm"        text,
  ADD COLUMN IF NOT EXISTS "author_names_norm" text;

CREATE OR REPLACE FUNCTION catalog.works_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('english', unaccent(coalesce(NEW.title, ''))), 'A')
   || setweight(to_tsvector('english', unaccent(coalesce(NEW.author_names, ''))), 'B')
   || setweight(to_tsvector('english', unaccent(coalesce(NEW.subtitle, ''))), 'C')
   || setweight(to_tsvector('english', unaccent(array_to_string(coalesce(NEW.subjects, '{}'), ' '))), 'D');

  -- Same normalisation the query applies, done once at write time.
  NEW.title_norm        := unaccent(lower(coalesce(NEW.title, '')));
  NEW.author_names_norm := unaccent(lower(coalesce(NEW.author_names, '')));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill. UPDATE fires the trigger, so this needs no expression of its own.
UPDATE "catalog"."works" SET "title" = "title" WHERE "title_norm" IS NULL;

-- The old indexes are on the raw columns, which nothing queries. Replace them
-- rather than accumulating a second unused pair.
DROP INDEX IF EXISTS "catalog"."works_title_idx";
DROP INDEX IF EXISTS "catalog"."works_author_names_idx";

CREATE INDEX IF NOT EXISTS "works_title_norm_idx"
  ON "catalog"."works" USING GIN ("title_norm" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "works_author_names_norm_idx"
  ON "catalog"."works" USING GIN ("author_names_norm" gin_trgm_ops);
