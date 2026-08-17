-- Upgrade a pre-baseline database to the schema in prisma/migrations/20260816230833_init
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The baseline migration (20260816230833_init) creates every table from
-- scratch. It is correct for a fresh database and will FAIL on one that
-- already holds the old schema, because the tables already exist.
--
-- This script transforms an existing pre-baseline database in place, keeping
-- its data, so it ends up matching the baseline. Run it INSTEAD of the
-- baseline migration on such a database, then tell Prisma the baseline is
-- already satisfied:
--
--     psql "$DATABASE_URL" -f prisma/manual/001_legacy_to_baseline.sql
--     DATABASE_URL="…" npx prisma migrate resolve --applied 20260816230833_init
--
-- DO NOT RUN THIS WITHOUT READING IT. Two steps need a human decision; both
-- are marked REVIEW below. Take a backup first.
--
--     pg_dump "$DATABASE_URL" > backup-before-baseline.sql
--
-- It is wrapped in a transaction, so a failure rolls the whole thing back.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Pre-flight: refuse to run if emails collide once case is normalised
-- ---------------------------------------------------------------------------
-- Emails are now stored lowercased, and the unique index is case-sensitive.
-- If "Reader@x.com" and "reader@x.com" both exist they would collide, so stop
-- and let a human decide which account survives rather than guessing.
DO $$
DECLARE
  collisions INT;
BEGIN
  SELECT COUNT(*) INTO collisions FROM (
    SELECT lower(email) FROM users GROUP BY lower(email) HAVING COUNT(*) > 1
  ) dupes;

  IF collisions > 0 THEN
    RAISE EXCEPTION
      'Aborting: % email address(es) collide when lowercased. Resolve these manually first: SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;',
      collisions;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. users: moderator flag + normalised email
-- ---------------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "isModerator" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET email = lower(btrim(email)) WHERE email <> lower(btrim(email));

-- ---------------------------------------------------------------------------
-- 2. books: legacy JSON coordinate strings -> Float columns
-- ---------------------------------------------------------------------------
ALTER TABLE "books"
  ADD COLUMN IF NOT EXISTS "settingLat"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "settingLng"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "authorOriginLat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "authorOriginLng" DOUBLE PRECISION;

-- Only rows whose JSON actually parses are copied; malformed values are left
-- NULL rather than being silently turned into 0,0 (which the old application
-- code did, placing bad data off the coast of West Africa).
UPDATE "books"
SET "settingLat" = ("settingCoordinates"::jsonb ->> 'lat')::double precision,
    "settingLng" = ("settingCoordinates"::jsonb ->> 'lng')::double precision
WHERE "settingCoordinates" IS NOT NULL
  AND "settingCoordinates" ~ '^\s*\{.*\}\s*$'
  AND ("settingCoordinates"::jsonb ->> 'lat') IS NOT NULL
  AND ("settingCoordinates"::jsonb ->> 'lng') IS NOT NULL;

UPDATE "books"
SET "authorOriginLat" = ("authorOriginCoordinates"::jsonb ->> 'lat')::double precision,
    "authorOriginLng" = ("authorOriginCoordinates"::jsonb ->> 'lng')::double precision
WHERE "authorOriginCoordinates" IS NOT NULL
  AND "authorOriginCoordinates" ~ '^\s*\{.*\}\s*$'
  AND ("authorOriginCoordinates"::jsonb ->> 'lat') IS NOT NULL
  AND ("authorOriginCoordinates"::jsonb ->> 'lng') IS NOT NULL;

ALTER TABLE "books"
  DROP COLUMN IF EXISTS "settingCoordinates",
  DROP COLUMN IF EXISTS "authorOriginCoordinates";

-- ---------------------------------------------------------------------------
-- 3. book_locations: coordinates JSON -> nullable lat/lng
-- ---------------------------------------------------------------------------
-- Nullable, because fictional locations are pinned to a world, not a point.
ALTER TABLE "book_locations"
  ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;

UPDATE "book_locations"
SET "lat" = (coordinates::jsonb ->> 'lat')::double precision,
    "lng" = (coordinates::jsonb ->> 'lng')::double precision
WHERE coordinates IS NOT NULL
  AND coordinates ~ '^\s*\{.*\}\s*$'
  AND (coordinates::jsonb ->> 'lat') IS NOT NULL
  AND (coordinates::jsonb ->> 'lng') IS NOT NULL;

ALTER TABLE "book_locations" DROP COLUMN IF EXISTS "coordinates";

-- ---------------------------------------------------------------------------
-- 4. author_locations: coordinates JSON -> NOT NULL lat/lng
-- ---------------------------------------------------------------------------
ALTER TABLE "author_locations"
  ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;

UPDATE "author_locations"
SET "lat" = (coordinates::jsonb ->> 'lat')::double precision,
    "lng" = (coordinates::jsonb ->> 'lng')::double precision
WHERE coordinates IS NOT NULL
  AND coordinates ~ '^\s*\{.*\}\s*$'
  AND (coordinates::jsonb ->> 'lat') IS NOT NULL
  AND (coordinates::jsonb ->> 'lng') IS NOT NULL;

-- REVIEW #1 -----------------------------------------------------------------
-- An author location must have a position. Any row whose JSON did not parse
-- cannot satisfy NOT NULL, so it is deleted. Check what you'd be losing first:
--
--   SELECT id, name, type FROM author_locations WHERE lat IS NULL OR lng IS NULL;
--
-- If you would rather keep them, give them coordinates by hand before running
-- this script and delete the statement below.
DELETE FROM "author_locations" WHERE "lat" IS NULL OR "lng" IS NULL;

ALTER TABLE "author_locations"
  ALTER COLUMN "lat" SET NOT NULL,
  ALTER COLUMN "lng" SET NOT NULL;

ALTER TABLE "author_locations" DROP COLUMN IF EXISTS "coordinates";

-- ---------------------------------------------------------------------------
-- 5. fictional_world_maps: attribution columns
-- ---------------------------------------------------------------------------
ALTER TABLE "fictional_world_maps"
  ADD COLUMN IF NOT EXISTS "addedById"   TEXT,
  ADD COLUMN IF NOT EXISTS "updatedById" TEXT;

-- REVIEW #2 -----------------------------------------------------------------
-- Existing maps have no recorded uploader — the old schema didn't track one.
-- `addedById` is NOT NULL and drives who may delete a map, so every existing
-- row must be attributed to somebody. This assigns them to the earliest user
-- account, which is a guess: it makes that account the only non-moderator who
-- can delete these particular maps.
--
-- Prefer a moderator instead? Set one first, then change this to select them:
--   UPDATE users SET "isModerator" = true WHERE email = 'you@example.com';
UPDATE "fictional_world_maps"
SET "addedById" = (SELECT id FROM "users" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "addedById" IS NULL;

-- If there are maps but no users at all, the line above leaves NULLs and the
-- NOT NULL below will fail — which is the correct outcome, not a silent skip.
ALTER TABLE "fictional_world_maps" ALTER COLUMN "addedById" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "fictional_world_maps_addedById_idx"
  ON "fictional_world_maps"("addedById");

ALTER TABLE "fictional_world_maps"
  ADD CONSTRAINT "fictional_world_maps_addedById_fkey"
  FOREIGN KEY ("addedById") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fictional_world_maps"
  ADD CONSTRAINT "fictional_world_maps_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. fictional_worlds: drop the deprecated single-image column
-- ---------------------------------------------------------------------------
-- Superseded by the fictional_world_maps relation. If any world still has only
-- the legacy image and no rows in fictional_world_maps, promote it first —
-- this DROP discards the URL:
--
--   SELECT w.id, w.name, w."mapImageUrl" FROM fictional_worlds w
--   LEFT JOIN fictional_world_maps m ON m."fictionalWorldId" = w.id
--   WHERE w."mapImageUrl" IS NOT NULL AND m.id IS NULL;
ALTER TABLE "fictional_worlds" DROP COLUMN IF EXISTS "mapImageUrl";

COMMIT;
