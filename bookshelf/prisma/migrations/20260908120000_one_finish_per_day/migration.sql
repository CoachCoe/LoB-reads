-- One finished reading session per work per day, enforced by the database.
--
-- RUN-1 was that pressing "Finish" logged a new book every time: finishReading
-- looked for an OPEN session and, finding none, created a new already-finished
-- one. `reading_sessions_one_open_per_work` is partial — WHERE finished_at IS
-- NULL — so finished sessions were unconstrained. Five clicks produced five
-- finished sessions and /wrapped counted five books read.
--
-- The application-level dedupe that fixed it first was a read followed by a
-- create, which is not atomic. A double-click is CONCURRENT, and that is the
-- case the dedupe exists for: two simultaneous finishes both found nothing and
-- both inserted. Measured, two sessions.
--
-- So the rule goes where the exclusive-shelf rule already is. ARCHITECTURE.md
-- on that one: the invariant is "kept honest by a partial unique index and a
-- trigger rather than by application code". Same reasoning here.
--
-- The window is a calendar day in UTC, matching finishedSessionOnDay. UTC
-- rather than local because this is a deduplication window and not a
-- reading-year boundary — wrapped.ts's year boundary is local on purpose and is
-- untouched. A genuine re-read finished on a different day is still two rows,
-- which is why the index is per day and not per work.

-- Existing duplicates have to go first, or the index cannot be created. These
-- rows are the defect's own artifacts: repeated finishes of one work on one
-- day, which the reader performed once. The earliest is kept, because it is the
-- one whose started_at reflects the actual reading.
DELETE FROM app.reading_sessions AS dupe
USING app.reading_sessions AS keeper
WHERE dupe.finished_at IS NOT NULL
  AND keeper.finished_at IS NOT NULL
  AND dupe."userId" = keeper."userId"
  AND dupe.work_key = keeper.work_key
  AND (dupe.finished_at AT TIME ZONE 'UTC')::date
      = (keeper.finished_at AT TIME ZONE 'UTC')::date
  -- Ordered on (finished_at, id) so the comparison is total: two rows written
  -- in the same millisecond still have exactly one winner.
  AND (dupe.finished_at, dupe.id) > (keeper.finished_at, keeper.id);

CREATE UNIQUE INDEX "reading_sessions_one_finish_per_day"
  ON app.reading_sessions
     ("userId", work_key, ((finished_at AT TIME ZONE 'UTC')::date))
  WHERE finished_at IS NOT NULL;
