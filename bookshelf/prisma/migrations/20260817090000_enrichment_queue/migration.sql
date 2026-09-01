-- CreateTable
CREATE TABLE "catalog"."enrichment_queue" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "enrichment_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enrichment_queue_status_next_attempt_at_idx" ON "catalog"."enrichment_queue"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "enrichment_queue_entity_type_entity_key_field_source_key" ON "catalog"."enrichment_queue"("entity_type", "entity_key", "field", "source");

