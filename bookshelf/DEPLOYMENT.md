# Deployment — AWS free tier

Next.js app, Postgres via Prisma, uploads in S3 behind CloudFront. Targeted at
the AWS 12-month free tier, which shapes several decisions below.

## Why Postgres, and not MySQL

The schema depends on Postgres features with no direct MySQL equivalent:

- `Book.genres` is a `String[]` — a native Postgres array. MySQL has no array
  type; this would become a join table.
- Book search uses Prisma's `mode: "insensitive"` filter in three places,
  which is Postgres-only.
- `getAllGenres` uses `unnest()` to get distinct genres in SQL rather than
  reading every book row into memory.

The planned catalog layer goes further, requiring `pg_trgm`, `unaccent` and
`jsonb`. Postgres is not optional here.

## What the free tier actually gives you

| Service | Allowance | What it means here |
| --- | --- | --- |
| EC2 | 750 h/month `t3.micro` — 2 vCPU, **1 GiB RAM** | Enough to serve the app. **Not** enough to build it. |
| RDS | 750 h/month `db.t3.micro`, **20 GB** storage | Fine for app data. Tight for a large book catalog. |
| S3 | 5 GB standard, 20k GET / 2k PUT per month | Comfortable for avatars and map images. |
| CloudFront | 1 TB egress, 10M requests | Generous; serve all uploads through it. |

Two consequences worth internalising before you start:

**`next build` will likely OOM on a t3.micro.** Next wants roughly 2 GB. Build
in CI and ship the artifact, or attach swap as a stopgap. The CI workflow in
`.github/workflows/ci.yml` already runs the build — extend it to upload the
output rather than building on the box.

**20 GB of RDS storage is the real ceiling.** App data is negligible. A full
Open Library catalog is not — see [Catalog sizing](#catalog-sizing).

## 1. Database

Either works:

- **RDS `db.t3.micro`** — managed backups, separate from the app instance.
  Uses the 20 GB free allowance. Start here.
- **Postgres on the EC2 box** — no separate allowance consumed, shares the
  instance's EBS volume, and you own backups. Cheaper if you outgrow 20 GB.

Create the database, enable required extensions, then apply migrations:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
```

```bash
DATABASE_URL="<direct>" DIRECT_URL="<direct>" npm run db:deploy
```

Use `migrate deploy`, never `migrate dev` — `dev` can prompt to reset.

### Connection strings: two, not one

```
DATABASE_URL   -> pooled connection    (runtime queries)
DIRECT_URL     -> direct connection    (prisma migrate / db push)
```

RDS has no built-in pooler. On a single EC2 instance Prisma's own pool is
enough, so both may point at the same endpoint. Add **RDS Proxy** or PgBouncer
if you move to Lambda or scale past one instance — a connection per invocation
exhausts `db.t3.micro`'s limit quickly. Migrations always need the direct
endpoint: they use session-level features a transaction pooler does not
support.

### Catalog sizing

The book catalog is the thing that will blow the storage budget.

| Slice | Approx. works | Fits in 20 GB? |
| --- | --- | --- |
| Rating-corpus fixture | ~10K | Comfortably |
| Default slice (1900+, English, has ISBN) | 500K–1M | Tight with GIN indexes |
| Full Open Library | ~20M editions | No — needs ~150 GB |

Build the catalog **locally**, where disk is cheap, then `pg_dump` the sliced
result and restore it to RDS. Running the ingest against RDS directly is slow
and risks filling the volume mid-run. GIN index builds over a million rows on
1 GiB of RAM are painful; do that locally too.

## 2. Object storage

Uploads go to a **private** S3 bucket and are served through CloudFront. The
bucket is never public.

1. **Create the bucket.** Block all public access (the default). No website
   hosting, no public ACLs.

2. **Create a CloudFront distribution** with the bucket as origin, using
   **Origin Access Control**. CloudFront gets a bucket policy allowing reads;
   nothing else can read the bucket directly.

3. **Grant the app write access.** Attach an instance role to EC2 with
   `s3:PutObject` and `s3:DeleteObject` scoped to `arn:aws:s3:::<bucket>/*`.
   Use a role, not access keys — `src/lib/storage.ts` reads credentials from
   the default provider chain, so nothing needs configuring in the app.

4. **Set `CDN_URL`** to the distribution domain. This is needed at **build**
   time as well as runtime: `next.config.ts` bakes it into both the image host
   allowlist and the Content-Security-Policy. Build without it and uploaded
   images will be blocked by CSP in the browser.

If `S3_BUCKET` is unset the app still runs; upload endpoints return 503 rather
than failing obscurely.

## 3. Environment variables

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Runtime connection |
| `DIRECT_URL` | Direct connection for migrations |
| `NEXTAUTH_URL` | The deployment's public URL. Callbacks break if wrong. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `S3_BUCKET` | Upload bucket name |
| `AWS_REGION` | Defaults to `us-east-1` |
| `CDN_URL` | CloudFront domain. **Required at build time.** |

Do not set AWS credentials on EC2 — use the instance role.

## 4. Running the app

`npm run build` runs `prisma generate` first, then `next build`. Build in CI,
copy `.next/`, `public/`, `package.json` and `node_modules` (or `.next/standalone`
if you enable `output: "standalone"`) to the instance, then:

```bash
npm run start          # listens on 3000
```

Put nginx or an ALB in front for TLS. Keep it alive with systemd or pm2 — a
bare `npm start` dies with the SSH session.

### Deploying to a database that predates the baseline migration

The baseline migration creates every table from scratch and fails on a database
that already holds the old schema. Use the tested upgrade script:

```bash
pg_dump "$DIRECT_URL" > backup.sql          # do this first
psql "$DIRECT_URL" -f prisma/manual/001_legacy_to_baseline.sql
DIRECT_URL="…" npx prisma migrate resolve --applied 20260816230833_init
```

Read that file first — two steps are marked `REVIEW` because they are
judgement calls.

## 5. Known limitation: rate limiting

`src/lib/rate-limit.ts` keeps state in process memory. That is correct for a
single long-lived EC2 instance — which is exactly this deployment — so it works
as-is here. It stops being correct the moment you run more than one instance or
move to Lambda, where each gets its own empty window and the effective limit
becomes `limit x instances`.

The signature is storage-agnostic, so switching to a shared store is a change
to that one file. Everything else — which routes are limited, the key format,
the limits — stays as is.

## 6. After deploying, verify

- `GET /api/users/<id>` returns no `email` and no `passwordHash`
- `GET /api/shelves/<id>` works signed out and shows owner attribution
- Registering as `Test@Example.com` then signing in as `test@example.com` works
- A second account gets 403 deleting the first account's uploaded map
- Response headers include the CSP, and its `img-src` lists your CloudFront
  domain — not `localhost`, and not a stale distribution
- Upload an avatar, confirm it renders, then replace it and confirm the old
  object is gone from S3
