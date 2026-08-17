-- Establish the three-schema layout from the Book Data Layer spec.
--
-- Prisma generates CREATE TABLE for a schema change, which would leave the
-- existing rows stranded in "public" behind a set of empty "app" tables. The
-- moves below are hand-written instead: ALTER TABLE ... SET SCHEMA relocates
-- each table together with its data, indexes and constraints.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- Required by the catalog: trigram search and accent-insensitive matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Move the existing application tables out of public, preserving their rows.
ALTER TABLE "public"."users" SET SCHEMA "app";
ALTER TABLE "public"."books" SET SCHEMA "app";
ALTER TABLE "public"."fictional_worlds" SET SCHEMA "app";
ALTER TABLE "public"."fictional_world_maps" SET SCHEMA "app";
ALTER TABLE "public"."shelves" SET SCHEMA "app";
ALTER TABLE "public"."shelf_items" SET SCHEMA "app";
ALTER TABLE "public"."reviews" SET SCHEMA "app";
ALTER TABLE "public"."reading_progress" SET SCHEMA "app";
ALTER TABLE "public"."follows" SET SCHEMA "app";
ALTER TABLE "public"."book_locations" SET SCHEMA "app";
ALTER TABLE "public"."authors" SET SCHEMA "app";
ALTER TABLE "public"."author_locations" SET SCHEMA "app";

-- CreateTable
CREATE TABLE "catalog"."authors" (
    "ol_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personal_name" TEXT,
    "birth_date" TEXT,
    "death_date" TEXT,
    "bio" TEXT,
    "photo_id" BIGINT,
    "wikidata_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authors_pkey" PRIMARY KEY ("ol_key")
);
-- CreateTable
CREATE TABLE "catalog"."works" (
    "ol_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "first_publish_year" INTEGER,
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cover_edition_key" TEXT,
    "edition_count" INTEGER NOT NULL DEFAULT 0,
    "author_names" TEXT,
    "search_vector" tsvector,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "works_pkey" PRIMARY KEY ("ol_key")
);
-- CreateTable
CREATE TABLE "catalog"."work_authors" (
    "work_key" TEXT NOT NULL,
    "author_key" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_authors_pkey" PRIMARY KEY ("work_key","author_key")
);
-- CreateTable
CREATE TABLE "catalog"."editions" (
    "ol_key" TEXT NOT NULL,
    "work_key" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "isbn13" TEXT,
    "isbn10" TEXT,
    "publishers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publish_date_raw" TEXT,
    "publish_year" INTEGER,
    "number_of_pages" INTEGER,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "physical_format" TEXT,
    "cover_id" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "editions_pkey" PRIMARY KEY ("ol_key")
);
-- CreateTable
CREATE TABLE "catalog"."external_ids" (
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,

    CONSTRAINT "external_ids_pkey" PRIMARY KEY ("entity_type","entity_key","source","external_id")
);
-- CreateTable
CREATE TABLE "catalog"."enrichment" (
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "enrichment_pkey" PRIMARY KEY ("entity_type","entity_key","source","field")
);
-- CreateTable
CREATE TABLE "catalog"."ingest_runs" (
    "id" TEXT NOT NULL,
    "dump_type" TEXT NOT NULL,
    "dump_published" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "lines_read" BIGINT NOT NULL DEFAULT 0,
    "rows_staged" BIGINT NOT NULL DEFAULT 0,
    "lines_quarantined" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,

    CONSTRAINT "ingest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "works_first_publish_year_idx" ON "catalog"."works"("first_publish_year");
-- CreateIndex
CREATE INDEX "work_authors_author_key_idx" ON "catalog"."work_authors"("author_key");
-- CreateIndex
CREATE INDEX "editions_work_key_idx" ON "catalog"."editions"("work_key");
-- CreateIndex
CREATE INDEX "editions_isbn13_idx" ON "catalog"."editions"("isbn13");
-- CreateIndex
CREATE INDEX "external_ids_source_external_id_idx" ON "catalog"."external_ids"("source", "external_id");
-- CreateIndex
CREATE INDEX "enrichment_expires_at_idx" ON "catalog"."enrichment"("expires_at");
-- CreateIndex
CREATE INDEX "ingest_runs_dump_type_started_at_idx" ON "catalog"."ingest_runs"("dump_type", "started_at");

-- AddForeignKey
ALTER TABLE "catalog"."work_authors" ADD CONSTRAINT "work_authors_work_key_fkey" FOREIGN KEY ("work_key") REFERENCES "catalog"."works"("ol_key") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "catalog"."work_authors" ADD CONSTRAINT "work_authors_author_key_fkey" FOREIGN KEY ("author_key") REFERENCES "catalog"."authors"("ol_key") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "catalog"."editions" ADD CONSTRAINT "editions_work_key_fkey" FOREIGN KEY ("work_key") REFERENCES "catalog"."works"("ol_key") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Things Prisma cannot express
-- ---------------------------------------------------------------------------

-- ISBNs are stored canonicalized: digits only, except a trailing X check digit
-- on ISBN-10. Stored as text rather than char(n), which is blank-padded and
-- makes equality comparisons surprising.
ALTER TABLE "catalog"."editions"
  ADD CONSTRAINT editions_isbn13_format CHECK (isbn13 IS NULL OR isbn13 ~ '^[0-9]{13}$'),
  ADD CONSTRAINT editions_isbn10_format CHECK (isbn10 IS NULL OR isbn10 ~ '^[0-9]{9}[0-9X]$');

-- Search vector maintenance.
--
-- The spec builds this with a one-off UPDATE, which leaves the vector stale the
-- moment a title changes — the row then matches its old title and not its new
-- one, silently. A generated column is not an option either: unaccent() is
-- STABLE, not IMMUTABLE, so Postgres rejects it in a generated expression.
-- A trigger is what remains.
--
-- Note that unaccent() must also be applied on the QUERY side. Indexing the
-- unaccented form and querying the raw form matches nothing.
CREATE OR REPLACE FUNCTION catalog.works_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('english', unaccent(coalesce(NEW.title, ''))), 'A')
   || setweight(to_tsvector('english', unaccent(coalesce(NEW.author_names, ''))), 'B')
   || setweight(to_tsvector('english', unaccent(coalesce(NEW.subtitle, ''))), 'C')
   || setweight(to_tsvector('english', unaccent(array_to_string(coalesce(NEW.subjects, '{}'), ' '))), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER works_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, subtitle, author_names, subjects
  ON catalog.works
  FOR EACH ROW EXECUTE FUNCTION catalog.works_search_vector_update();

-- Full-text and trigram indexes. Trigram covers typos and partial titles that
-- FTS cannot match.
CREATE INDEX works_search_vector_idx ON catalog.works USING GIN (search_vector);
CREATE INDEX works_title_trgm_idx    ON catalog.works USING GIN (title gin_trgm_ops);
CREATE INDEX works_authors_trgm_idx  ON catalog.works USING GIN (author_names gin_trgm_ops);
