# Deployment

Life on Books runs on Next.js with Postgres via Prisma, and is built to deploy
on Vercel with a hosted Postgres.

## Why Postgres, and not MySQL

The schema depends on Postgres features that have no direct MySQL equivalent:

- `Book.genres` is a `String[]` — a native Postgres array. MySQL has no array
  type; this would become a `book_genres` join table.
- Book search uses Prisma's `mode: "insensitive"` filter in three places,
  which is Postgres-only. MySQL would need collation changes instead.
- `getAllGenres` uses `unnest()` to get distinct genres in SQL rather than
  reading every book row into memory.

Moving to MySQL means rewriting search and genre storage for no gain. Stay on
Postgres.

## Choosing a host

Any Postgres works. The two that need least setup here:

| Host | Notes |
| --- | --- |
| **Neon** | Serverless Postgres, generous free tier, database branching. Gives you pooled and direct connection strings out of the box, which is exactly what Prisma wants. |
| **Vercel Postgres** | Neon underneath, provisioned from the Vercel dashboard, env vars injected automatically. Simplest if you are already deploying on Vercel. |

Supabase and Railway both work too; Supabase bundles auth and storage this app
does not use (it has NextAuth and Vercel Blob already).

## Connection strings: two, not one

This is the part that quietly breaks things.

```
DATABASE_URL   -> pooled connection    (runtime queries)
DIRECT_URL     -> direct connection    (prisma migrate / db push)
```

Serverless functions open a connection per invocation, so runtime traffic must
go through a pooler or you exhaust the connection limit under modest load.
Migrations need the opposite: a direct connection, because they use
session-level features a transaction pooler does not support.

On Neon the two strings differ only by `-pooler` in the hostname:

```
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

Getting these backwards fails in two different ways: a direct `DATABASE_URL`
exhausts connections in production, and a pooled `DIRECT_URL` makes migrations
fail. Locally there is no pooler, so both point at the same database.

## First deploy

1. **Create the database** and copy both connection strings.

2. **Set environment variables** in the Vercel project (all environments):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | pooled connection string |
   | `DIRECT_URL` | direct connection string |
   | `NEXTAUTH_URL` | the deployment's public URL |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
   | `BLOB_READ_WRITE_TOKEN` | injected automatically once a Blob store is attached |

   `NEXTAUTH_URL` must be the real public URL or sign-in callbacks break.

3. **Apply the schema:**

   ```bash
   DATABASE_URL="<direct>" DIRECT_URL="<direct>" npx prisma migrate deploy
   ```

   Use `migrate deploy`, never `migrate dev`, against a deployed database —
   `dev` can prompt to reset. For an empty database this applies the baseline
   and you are done.

4. **Optionally seed** demo data: `npm run db:seed`. Skip for a real
   deployment — it creates accounts with a published password.

5. **Deploy.** `npm run build` already runs `prisma generate` first.

### Deploying to a database that predates the baseline

The baseline migration creates every table from scratch and will fail on a
database that already holds the old schema. Use the tested upgrade script
instead:

```bash
pg_dump "$DIRECT_URL" > backup.sql          # do this first
psql "$DIRECT_URL" -f prisma/manual/001_legacy_to_baseline.sql
DIRECT_URL="…" npx prisma migrate resolve --applied 20260816230833_init
```

Read that file before running it — two steps are marked `REVIEW` because they
are judgement calls (discarding author locations whose coordinates never
parsed, and attributing pre-existing maps to a user account).

## Known limitation: rate limiting

`src/lib/rate-limit.ts` keeps its state in process memory. That is correct for
local development and a single long-lived server, but on serverless each
instance gets its own empty window — the effective limit becomes roughly
`limit x instances`.

Before opening registration to the public, swap the body of `checkLimit` for a
shared store. The signature is storage-agnostic so this is a change to that one
file:

```bash
npm install @upstash/ratelimit @upstash/redis
```

Everything else — which routes are limited, the key format, the limits
themselves — stays as is.

## After deploying, verify

- `GET /api/users/<id>` returns no `email` and no `passwordHash`
- `GET /api/shelves/<id>` works signed out and shows owner attribution
- Registering as `Test@Example.com` then signing in as `test@example.com` works
- A second account gets 403 deleting the first account's uploaded map
- Response headers include the CSP and `X-Frame-Options: DENY` from
  `next.config.ts`
