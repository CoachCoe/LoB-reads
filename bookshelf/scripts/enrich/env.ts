import { config } from "dotenv";

/**
 * Workers run outside Next.js and outside the Prisma CLI, so nothing loads the
 * environment for them. `.env` deliberately, not `.env.local`, which may point
 * at a deployed database — a backfill should never be aimed at one by accident.
 */
config({ path: ".env", quiet: true });
