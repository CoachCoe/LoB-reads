import { config } from "dotenv";
import { Client } from "pg";

/**
 * Ingest scripts run outside Next.js and outside the Prisma CLI, so nothing
 * loads the environment for them. Read `.env` explicitly — deliberately not
 * `.env.local`, which may point at a deployed database; a bulk ingest should
 * never be aimed at one by accident.
 */
config({ path: ".env", quiet: true });

export function connectionString(): string {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "No DIRECT_URL or DATABASE_URL found. Ingest reads .env — see .env.example."
    );
  }
  return url;
}

/** A direct (non-pooled) client. COPY needs a session, not a transaction pooler. */
export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  return client;
}

/**
 * Prisma accepts query parameters libpq does not — `schema`, `connection_limit`,
 * `pgbouncer` and friends. psql rejects them outright ("invalid URI query
 * parameter"), so strip them before shelling out.
 *
 * Dropping `schema` is safe here: every statement in the ingest SQL is
 * schema-qualified rather than relying on the search_path.
 */
const PRISMA_ONLY_PARAMS = [
  "schema",
  "connection_limit",
  "pool_timeout",
  "pgbouncer",
  "socket_timeout",
  "sslidentity",
  "sslcert",
  "sslpassword",
];

export function psqlConnectionString(): string {
  const url = new URL(connectionString());
  for (const param of PRISMA_ONLY_PARAMS) {
    url.searchParams.delete(param);
  }
  return url.toString();
}
