-- An indexed, accent-folded author name.
--
-- `findAuthorKeyByName` compared `lower(a.name) = lower($1)`, which breaks the
-- rule catalog.ts states at the top of the file: comparisons go against a
-- normalised column, never a function of the raw one. Wrapping the column is how
-- the fuzzy search path silently became a sequential scan once already.
--
-- Two consequences, both live. `catalog.authors` has only its primary key, so
-- every author page load and every location read or write was a sequential scan
-- over 3.2M rows. And `lower()` alone does not fold accents, so
-- `findWorkKeyByTitleAuthor` matched "Gabriel Garcia Marquez" through
-- `works.author_names_norm` while `findAuthorKeyByName` returned null for the
-- same query — so POST /api/authors/[name]/locations answered
-- "That author is not in the catalog" for an author whose page the reader was
-- standing on.
--
-- A trigger rather than a generated column or an expression index, because
-- `unaccent()` is STABLE and not IMMUTABLE, so Postgres will accept it in
-- neither. This mirrors what works.title_norm already does.

ALTER TABLE "catalog"."authors"
  ADD COLUMN IF NOT EXISTS "name_norm" text;

-- lower(unaccent(x)), not unaccent(lower(x)).
--
-- This database runs lc_collate=C, under which lower() folds only ASCII: it
-- leaves 'É' alone, and unaccent then produces a capital 'E'. So
-- unaccent(lower('Émile Zola')) is 'Emile zola' — not normalised at all, and it
-- will never equal a lowercase query. Unaccenting first gives 'emile zola'.
--
-- works.title_norm and works.author_names_norm use the other order and have the
-- same defect; measured on the real catalog, title_norm for "Öffentliche…" is
-- stored as "Offentliche…" and a lowercase-accented query scores zero prefix
-- matches against it, losing the +20 ranking bonus. That needs a 6.9M-row
-- rewrite of two columns and two GIN rebuilds, so it is recorded rather than
-- bundled here.
CREATE OR REPLACE FUNCTION "catalog"."authors_name_norm_update"()
RETURNS trigger AS $$
BEGIN
  NEW.name_norm := lower(unaccent(coalesce(NEW.name, '')));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "authors_name_norm_trigger" ON "catalog"."authors";
CREATE TRIGGER "authors_name_norm_trigger"
  BEFORE INSERT OR UPDATE OF "name"
  ON "catalog"."authors"
  FOR EACH ROW EXECUTE FUNCTION "catalog"."authors_name_norm_update"();

-- Backfill in one pass with the expression directly, rather than the
-- `SET name = name` trick works.title_norm's migration used: this table has 3.2M
-- rows and there is no reason to pay per-row trigger dispatch for them.
-- A catalog restored from a dump taken after an ingest already has the column
-- populated, so this is a no-op there.
UPDATE "catalog"."authors"
   SET "name_norm" = lower(unaccent(coalesce("name", '')))
 WHERE "name_norm" IS NULL;

-- The index. Created here AND declared in schema.prisma — both, as
-- works.title_norm's migration does. The declaration is what keeps
-- `prisma migrate diff` from generating a DROP for it (how three search indexes
-- were silently lost once before); this statement is what actually creates it.
-- Declaring it without writing it, which is what the first draft of this
-- migration did, leaves the column indexed in the schema file and sequentially
-- scanned in the database.
--
-- btree, not GIN trigram: the comparison is equality on the whole name.
CREATE INDEX IF NOT EXISTS "authors_name_norm_idx"
  ON "catalog"."authors" ("name_norm");
