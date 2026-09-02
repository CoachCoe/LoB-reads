-- Who last edited a contributed location.
--
-- PRD.md: "Editing is wiki-style — anyone signed in may edit,
-- uploader-or-moderator may delete — because the data only exists if
-- contributing is easy."
--
-- The delete half exists for all three contributed types. The edit half existed
-- only for fictional-world maps, so a reader who spotted someone else's wrong
-- pin could do nothing at all: they cannot edit it, and they cannot delete it
-- either, because deletion is contributor-or-moderator. A bad pin from someone
-- who never returns was permanent until a moderator intervened — which defeats
-- the premise the feature rests on, that crowdsourced data becomes accurate
-- because strangers can correct it.
--
-- FictionalWorldMap.updated_by_id already exists for the same purpose. These two
-- columns match it, so "who touched this last" has one shape across all three.
--
-- SET NULL on delete, like added_by_id: losing the account must not take the
-- contribution with it.

ALTER TABLE "app"."work_locations"
  ADD COLUMN IF NOT EXISTS "updated_by_id" text;

ALTER TABLE "app"."author_locations"
  ADD COLUMN IF NOT EXISTS "updated_by_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_locations_updated_by_id_fkey'
  ) THEN
    ALTER TABLE "app"."work_locations"
      ADD CONSTRAINT "work_locations_updated_by_id_fkey"
      FOREIGN KEY ("updated_by_id") REFERENCES "app"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'author_locations_updated_by_id_fkey'
  ) THEN
    ALTER TABLE "app"."author_locations"
      ADD CONSTRAINT "author_locations_updated_by_id_fkey"
      FOREIGN KEY ("updated_by_id") REFERENCES "app"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "work_locations_updated_by_id_idx"
  ON "app"."work_locations" ("updated_by_id");
CREATE INDEX IF NOT EXISTS "author_locations_updated_by_id_idx"
  ON "app"."author_locations" ("updated_by_id");
