-- M3: repoint user data from app.books to catalog work keys.
--
-- DATA LOSS, DELIBERATE. Shelf items, reviews and reading progress pointed at
-- app.books rows, which have no reliable mapping to catalog works: the local
-- rows were created ad hoc and most carry no ISBN to match on. Everything in
-- the database at this point is seed data, so it is dropped and re-created by
-- prisma/seed.ts against catalog work keys instead.
--
-- If this ever needs running against real user data, stop: it needs an ISBN
-- matching pass and a review queue for the remainder, not this migration.

-- Cleared explicitly rather than as a side effect. These rows reference
-- app.books ids that are about to stop existing, and adding a NOT NULL
-- work_key to them is impossible — there is no value to backfill with.
DELETE FROM "app"."reviews";
DELETE FROM "app"."shelf_items";

-- DropForeignKey
ALTER TABLE "app"."author_locations" DROP CONSTRAINT "author_locations_addedById_fkey";

-- DropForeignKey
ALTER TABLE "app"."author_locations" DROP CONSTRAINT "author_locations_authorId_fkey";

-- DropForeignKey
ALTER TABLE "app"."book_locations" DROP CONSTRAINT "book_locations_addedById_fkey";

-- DropForeignKey
ALTER TABLE "app"."book_locations" DROP CONSTRAINT "book_locations_bookId_fkey";

-- DropForeignKey
ALTER TABLE "app"."book_locations" DROP CONSTRAINT "book_locations_fictionalWorldId_fkey";

-- DropForeignKey
ALTER TABLE "app"."books" DROP CONSTRAINT "books_fictionalWorldId_fkey";

-- DropForeignKey
ALTER TABLE "app"."reading_progress" DROP CONSTRAINT "reading_progress_bookId_fkey";

-- DropForeignKey
ALTER TABLE "app"."reading_progress" DROP CONSTRAINT "reading_progress_userId_fkey";

-- DropForeignKey
ALTER TABLE "app"."reviews" DROP CONSTRAINT "reviews_bookId_fkey";

-- DropForeignKey
ALTER TABLE "app"."shelf_items" DROP CONSTRAINT "shelf_items_bookId_fkey";

-- DropIndex
DROP INDEX "app"."author_locations_addedById_idx";

-- DropIndex
DROP INDEX "app"."author_locations_authorId_idx";

-- DropIndex
DROP INDEX "app"."reviews_userId_bookId_key";

-- DropIndex
DROP INDEX "app"."shelf_items_shelfId_bookId_key";

-- DropIndex
DROP INDEX "catalog"."works_authors_trgm_idx";

-- DropIndex
DROP INDEX "catalog"."works_search_vector_idx";

-- DropIndex
DROP INDEX "catalog"."works_title_trgm_idx";

-- AlterTable
ALTER TABLE "app"."author_locations" DROP COLUMN "addedById",
DROP COLUMN "authorId",
DROP COLUMN "createdAt",
DROP COLUMN "updatedAt",
DROP COLUMN "yearEnd",
DROP COLUMN "yearStart",
ADD COLUMN     "added_by_id" TEXT,
ADD COLUMN     "author_key" TEXT NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "year_end" INTEGER,
ADD COLUMN     "year_start" INTEGER;

-- AlterTable
ALTER TABLE "app"."reviews" DROP COLUMN "bookId",
ADD COLUMN     "work_key" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "app"."shelf_items" DROP COLUMN "bookId",
ADD COLUMN     "is_exclusive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "user_id" TEXT NOT NULL,
ADD COLUMN     "work_key" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "catalog"."stage_authors" ALTER COLUMN "last_modified" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "catalog"."stage_editions" ALTER COLUMN "last_modified" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "catalog"."stage_works" ALTER COLUMN "last_modified" SET DATA TYPE TIMESTAMP(3);

-- DropTable
DROP TABLE "app"."authors";

-- DropTable
DROP TABLE "app"."book_locations";

-- DropTable
DROP TABLE "app"."books";

-- DropTable
DROP TABLE "app"."reading_progress";

-- CreateTable
CREATE TABLE "app"."work_fictional_worlds" (
    "work_key" TEXT NOT NULL,
    "world_id" TEXT NOT NULL,
    "added_by_id" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_fictional_worlds_pkey" PRIMARY KEY ("work_key","world_id")
);

-- CreateTable
CREATE TABLE "app"."reading_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "work_key" TEXT NOT NULL,
    "edition_key" TEXT,
    "currentPage" INTEGER NOT NULL DEFAULT 0,
    "page_count" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reading_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."work_locations" (
    "id" TEXT NOT NULL,
    "work_key" TEXT NOT NULL,
    "added_by_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "is_fictional" BOOLEAN NOT NULL DEFAULT false,
    "fictional_world_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_fictional_worlds_world_id_idx" ON "app"."work_fictional_worlds"("world_id");

-- CreateIndex
CREATE INDEX "reading_sessions_userId_work_key_idx" ON "app"."reading_sessions"("userId", "work_key");

-- CreateIndex
CREATE INDEX "reading_sessions_userId_finished_at_idx" ON "app"."reading_sessions"("userId", "finished_at");

-- CreateIndex
CREATE INDEX "work_locations_work_key_idx" ON "app"."work_locations"("work_key");

-- CreateIndex
CREATE INDEX "work_locations_added_by_id_idx" ON "app"."work_locations"("added_by_id");

-- CreateIndex
CREATE INDEX "author_locations_author_key_idx" ON "app"."author_locations"("author_key");

-- CreateIndex
CREATE INDEX "author_locations_added_by_id_idx" ON "app"."author_locations"("added_by_id");

-- CreateIndex
CREATE INDEX "reviews_work_key_idx" ON "app"."reviews"("work_key");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_work_key_key" ON "app"."reviews"("userId", "work_key");

-- CreateIndex
CREATE INDEX "shelf_items_work_key_idx" ON "app"."shelf_items"("work_key");

-- CreateIndex
CREATE INDEX "shelf_items_user_id_idx" ON "app"."shelf_items"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shelf_items_shelfId_work_key_key" ON "app"."shelf_items"("shelfId", "work_key");

-- AddForeignKey
ALTER TABLE "app"."work_fictional_worlds" ADD CONSTRAINT "work_fictional_worlds_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "app"."fictional_worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."work_fictional_worlds" ADD CONSTRAINT "work_fictional_worlds_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."shelf_items" ADD CONSTRAINT "shelf_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."reading_sessions" ADD CONSTRAINT "reading_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."work_locations" ADD CONSTRAINT "work_locations_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."work_locations" ADD CONSTRAINT "work_locations_fictional_world_id_fkey" FOREIGN KEY ("fictional_world_id") REFERENCES "app"."fictional_worlds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."author_locations" ADD CONSTRAINT "author_locations_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Things Prisma cannot express
-- ---------------------------------------------------------------------------

-- Staging tables are rebuilt from the dumps on every ingest, so there is no
-- point paying for WAL on them.
ALTER TABLE "catalog"."stage_authors"  SET UNLOGGED;
ALTER TABLE "catalog"."stage_works"    SET UNLOGGED;
ALTER TABLE "catalog"."stage_editions" SET UNLOGGED;

-- ---------------------------------------------------------------------------
-- Exclusive shelves
-- ---------------------------------------------------------------------------
-- A work sits on at most ONE exclusive shelf per user: it cannot be both
-- "Currently Reading" and "Read".
--
-- The obvious index — a predicate selecting exclusive shelves via a subquery —
-- is rejected by Postgres ("cannot use subquery in index predicate"). So
-- is_exclusive is denormalized onto shelf_items and indexed directly. The
-- trigger below is what keeps that copy honest; without it the constraint
-- silently stops applying as soon as application code forgets to set the flag.

CREATE UNIQUE INDEX "shelf_items_one_exclusive_per_work"
  ON "app"."shelf_items" ("user_id", "work_key")
  WHERE "is_exclusive";

-- Derive user_id and is_exclusive from the parent shelf on every write, rather
-- than trusting the caller to pass them correctly.
CREATE OR REPLACE FUNCTION app.shelf_items_sync_exclusive()
RETURNS trigger AS $$
BEGIN
  SELECT s."userId", s."isDefault"
    INTO NEW.user_id, NEW.is_exclusive
  FROM app.shelves s
  WHERE s.id = NEW."shelfId";

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'Shelf % does not exist', NEW."shelfId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shelf_items_sync_exclusive
  BEFORE INSERT OR UPDATE OF "shelfId" ON app.shelf_items
  FOR EACH ROW EXECUTE FUNCTION app.shelf_items_sync_exclusive();

-- If a shelf's exclusivity changes, its items must follow or the index stops
-- describing reality.
CREATE OR REPLACE FUNCTION app.shelves_propagate_exclusive()
RETURNS trigger AS $$
BEGIN
  IF NEW."isDefault" IS DISTINCT FROM OLD."isDefault" THEN
    UPDATE app.shelf_items
       SET is_exclusive = NEW."isDefault"
     WHERE "shelfId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shelves_propagate_exclusive
  AFTER UPDATE OF "isDefault" ON app.shelves
  FOR EACH ROW EXECUTE FUNCTION app.shelves_propagate_exclusive();

-- ---------------------------------------------------------------------------
-- Reading sessions
-- ---------------------------------------------------------------------------
-- Re-reads are separate sessions, so there is no unique constraint on
-- (user, work). What must not happen is two sessions of the same work open at
-- once, which the UI cannot represent.
CREATE UNIQUE INDEX "reading_sessions_one_open_per_work"
  ON "app"."reading_sessions" ("userId", "work_key")
  WHERE "finished_at" IS NULL;
