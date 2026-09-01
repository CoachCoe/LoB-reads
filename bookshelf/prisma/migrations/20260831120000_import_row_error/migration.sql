-- Why an import row failed to apply.
--
-- `applyRow` wrapped each of its three steps in try/catch with no rethrow and
-- no record, and the caller then wrote `status = 'matched'` unconditionally. So
-- a row that shelved nothing was indistinguishable from one that worked, and
-- `matchRate` — the signal PRD section 6 names for "is import working?" —
-- counted it as a success.
--
-- `failed` already existed in the status vocabulary and nothing ever set it.
-- Setting it without a reason would still be the quiet failure the review queue
-- exists to prevent (see the header of src/server/imports.ts), so the reason
-- travels with it.
ALTER TABLE "app"."import_rows"
  ADD COLUMN IF NOT EXISTS "error" text;
