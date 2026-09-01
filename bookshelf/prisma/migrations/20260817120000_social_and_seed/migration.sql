-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "seed";

-- CreateTable
CREATE TABLE "seed"."users" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "is_synthetic" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seed"."ratings" (
    "user_id" TEXT NOT NULL,
    "work_key" TEXT NOT NULL,
    "rating" SMALLINT NOT NULL,
    "source" TEXT NOT NULL,
    "is_synthetic" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("user_id","work_key")
);

-- CreateTable
CREATE TABLE "catalog"."work_rating_stats" (
    "work_key" TEXT NOT NULL,
    "avg_rating" DOUBLE PRECISION NOT NULL,
    "rating_count" INTEGER NOT NULL,
    "seed_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_rating_stats_pkey" PRIMARY KEY ("work_key")
);

-- CreateTable
CREATE TABLE "catalog"."work_similarity" (
    "work_key" TEXT NOT NULL,
    "similar_work_key" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "co_raters" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_similarity_pkey" PRIMARY KEY ("work_key","similar_work_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "seed"."users"("handle");

-- CreateIndex
CREATE INDEX "ratings_work_key_idx" ON "seed"."ratings"("work_key");

-- CreateIndex
CREATE INDEX "work_rating_stats_rating_count_idx" ON "catalog"."work_rating_stats"("rating_count");

-- CreateIndex
CREATE INDEX "work_similarity_work_key_score_idx" ON "catalog"."work_similarity"("work_key", "score");

-- AddForeignKey
ALTER TABLE "seed"."ratings" ADD CONSTRAINT "ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "seed"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

