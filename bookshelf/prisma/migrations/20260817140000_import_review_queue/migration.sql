-- The Goodreads import review queue.
--
-- An import is a session with a row per CSV line, rather than a fire-and-forget
-- loop. Rows that match confidently are applied; rows that do not are kept with
-- their candidates for the reader to resolve, because silently dropping a book
-- someone actually read is the worse failure.
--
-- No foreign key from import_rows.work_key into catalog.works: the catalog is
-- rebuilt monthly, and a narrowed ingest must never delete someone's import
-- history. The write path checks the key exists instead.

-- CreateTable
CREATE TABLE "app"."import_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "import_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."import_rows" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "isbn13" TEXT,
    "my_rating" SMALLINT,
    "exclusive_shelf" TEXT,
    "date_read" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'needs_review',
    "matched_by" TEXT,
    "work_key" TEXT,
    "candidates" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_sessions_user_id_created_at_idx" ON "app"."import_sessions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "import_rows_session_id_status_idx" ON "app"."import_rows"("session_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_session_id_row_number_key" ON "app"."import_rows"("session_id", "row_number");

-- AddForeignKey
ALTER TABLE "app"."import_sessions" ADD CONSTRAINT "import_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."import_rows" ADD CONSTRAINT "import_rows_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "app"."import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

