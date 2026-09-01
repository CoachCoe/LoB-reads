# Deployment — Azure

Next.js app, Postgres via Prisma, uploads in Azure Blob Storage behind a CDN.

Every number in this document was measured on the real system — a 6.9M-work
catalog, not an estimate. Where something has *not* been verified it says so.

Companion documents: `ARCHITECTURE.md` for how it works, `STATUS.md` for where
the project stands, `PRD.md` for what to build next.

## Service mapping

| Piece | Azure service | Notes |
| --- | --- | --- |
| Postgres | **Database for PostgreSQL Flexible Server** | Has PgBouncer built in — see [Connection strings](#connection-strings-two-not-one) |
| Uploads | **Blob Storage**, private container | Never public; the CDN reads it |
| CDN | **Front Door** (or Azure CDN) | `CDN_URL`, required at **build** time |
| App | **Container Apps** | Runs the image built by CI |

## Why Postgres, and not MySQL

The catalog layer is built out of Postgres-specific features, and none of them
have a drop-in MySQL equivalent:

- **Full-text search.** `catalog.works.search_vector` is a `tsvector`,
  maintained by a trigger and ranked with `ts_rank_cd` over
  `websearch_to_tsquery`.
- **`pg_trgm`** backs fuzzy title and author matching, including the Goodreads
  importer's fallback path.
- **`unaccent`** normalises diacritics. It is `STABLE`, not `IMMUTABLE`, which
  is why the normalised values live in trigger-maintained `*_norm` columns
  rather than an expression index.
- **`text[]` arrays.** `catalog.works.subjects` is a native array queried with
  the containment operator `@>` against a GIN index.
- **`COPY ... FROM STDIN`** is how 113.5M staged records get loaded. Row-by-row
  inserts are not a viable substitute at that volume.

Only two extensions are needed:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Both are on Flexible Server's allow-list, but extensions must be added to the
server's `azure.extensions` parameter before `CREATE EXTENSION` will succeed.
Do that first, or the first migration fails.

## Sizing

This is the part that used to look frightening and no longer does.

| | Size |
| --- | --- |
| `catalog` schema | **10 GB** |
| `seed` schema (never served) | 853 MB |
| `app` schema (user data) | 696 kB |
| **Total** | **11 GB** |

Flexible Server's smallest storage allocation is 32 GB, so the catalog fits
with room to spare. Two caveats:

- **It was 134 GB before a `VACUUM FULL`.** A full ingest deletes ~34M works
  and leaves the dead tuples behind; the rename in the rebuild-and-swap does
  not compact them. Do not size storage from a freshly-ingested database. This
  is tracked as R2b — the fix is to never insert those rows.
- **`seed` is CC-BY-SA. The corpus itself is never served; the aggregates
  computed from it are, with attribution — see PRD §5.** It is only
  reachable behind `ENABLE_SEED_DATA`. There is no reason to restore it to
  Azure at all, which also saves the 853 MB.

### Do not run the ingest against Azure

Build the catalog locally, where disk and memory are cheap, then dump and
restore. The ingest is a few passes over ~113M staged rows; **normalize alone**
takes **2 h 41 min** on a well-provisioned machine, and the whole chain
(preflight, stage, normalize, slice, index) roughly three hours and wants `max_wal_size` at 24 GB while it
runs. Pointing it at a burstable instance would be slow at best and would fill
the volume mid-run at worst.

```bash
# locally, from the machine that ran the ingest
pg_dump -d bookshelf -Fd -j 8 --schema=catalog -f catalog-dump

# against Azure — restore only the catalog; migrations own everything else.
# Drop the schema migrations created first, or the restore collides with it.
psql "<direct url>" -c "DROP SCHEMA catalog CASCADE;"
pg_restore -j 8 -h <server>.postgres.database.azure.com -U <user> -d <db> \
  --no-owner --no-privileges catalog-dump
psql "<direct url>" -c "ANALYZE catalog.works; ANALYZE catalog.editions;"
```

Rehearsed end to end against Postgres 16, not estimated:

| step | time | result |
| --- | --- | --- |
| `pg_dump -Fd -j 8` | **103 s** | 1.7 GB on disk, from 10 GB |
| `pg_restore -j 8` | **147 s** | 30 indexes and the search trigger, matching the source |
| `ANALYZE` | 3 s | required — statistics do not travel in a dump |

Exact row counts matched the source on all six tables. Expect both figures to be
slower against Azure, where the bytes cross a network and the tier is smaller;
`-j` is what to tune.

**`ANALYZE` afterwards is not optional.** A dump carries no statistics, so the
planner starts blind and will choose badly on the first queries.

Restore `catalog` **only**. `_prisma_migrations` lives in `public` and `app`
holds real user data — both are created and owned by `prisma migrate deploy`.
The catalog is the disposable part, and it is the only part worth shipping.

### Set `work_mem` to 32 MB — this is the single highest-value parameter

The one measured problem this deployment inherits, and the fix is a server
parameter rather than a bigger tier.

A common-word query (`?q=Fiction`) took **3.5 s**. At the 4 MB `work_mem`
default the bitmap index scan overflows and goes **lossy**: it stops tracking
individual rows, falls back to page granularity, and rechecks 1,028,773 rows.
Raising `work_mem` to 32 MB makes the bitmap exact and the same query runs in
**1007 ms** — with `shared_buffers` untouched.

| `work_mem` | rows rechecked | query |
| --- | --- | --- |
| 4 MB | 1,028,773 | 3549 ms |
| **32 MB** | 93,941 | **1007 ms** |
| 256 MB | 93,941 | 926 ms |

32 MB is the knee; more buys almost nothing. Note `work_mem` is per sort or hash
node *per parallel worker*, so it multiplies under concurrency — 32 MB is
modest, 256 MB on a burstable instance is not.

**A migration already sets this**, at database scope, so a normal
`migrate deploy` applies it and no manual step is needed. If the application
role lacks `ALTER DATABASE`, the migration raises a warning rather than failing
the deployment — set it as a server parameter instead:

```bash
az postgres flexible-server parameter set \
  --resource-group <rg> --server-name <srv> --name work_mem --value 32768
```

`npm run deploy:verify` asserts the effective value, so a skipped migration is
caught rather than assumed.

**More memory will not finish the job.** With `shared_buffers` at 3 GB the query
reports `shared hit=202478, read=0` — everything resident, no disk reads at all
— and still takes 1.2 s. The remainder is CPU, and getting under a second needs
the candidate set bounded so ranking never touches more than N rows. That is a
decision about result quality, not a setting; tracked as R1.

Everything else is fast. Measured in production mode against the full catalog:

| page | production | dev |
| --- | --- | --- |
| `/` | 0.009 s | 0.07 s |
| `/search` (discover) | 0.008 s | 0.08 s |
| `/search?q=dune` | 0.091 s | 0.17 s |
| `/search?subject=Fiction` | 0.031 s | 0.10 s |
| `/work/[olKey]` | 0.009 s | 0.07 s |
| `/search?q=Fiction` | **1.23 s** | 4.2 s |

The last row is after the `work_mem` change; it was 3.5 s before. That it barely
improved between dev and production is what ruled out rendering overhead and
sent the investigation to the query plan.

## Connection strings: two, not one

```
DATABASE_URL   -> pooled connection    (runtime queries)
DIRECT_URL     -> direct connection    (prisma migrate)
```

Flexible Server has **PgBouncer built in** on port 6432. Enable it with the
`pgbouncer.enabled` server parameter. Two things then matter:

- The pooled URL **must** carry `?pgbouncer=true`. In transaction pooling mode a
  server connection is handed to a different client between statements, and
  without this flag Prisma's prepared statements break under reuse.
- Migrations **must** use the direct connection on 5432. They take advisory
  locks and run DDL, neither of which survives a transaction pooler.

```
DATABASE_URL=postgresql://user:pass@srv.postgres.database.azure.com:6432/db?pgbouncer=true&sslmode=require
DIRECT_URL=postgresql://user:pass@srv.postgres.database.azure.com:5432/db?sslmode=require
```

Apply migrations with the wrapper, not the bare CLI:

```bash
DIRECT_URL="<direct>" scripts/db/migrate-deploy.sh
```

It exists because the Prisma CLI loads `.env` and lets it *override* an inline
variable — so a release running in a checkout that happens to contain `.env`
would migrate the wrong database and report success. The script hides the file
for the duration and refuses a `DIRECT_URL` that looks pooled.

> **Unverified:** PgBouncer availability on the *burstable* tier specifically.
> Confirm before relying on it; if it is unavailable, point both variables at
> 5432 and rely on Prisma's own pool, which is adequate for a single container.

## Object storage

Uploads go to a **private** container and are served through the CDN. The
container is never public.

1. **Create a storage account and a container** (`uploads`). Leave public
   access disabled — that is the default and it is correct.

2. **Put Front Door in front of it**, with the blob endpoint as origin and a
   managed identity for origin authentication.

3. **Grant the app write access.** Assign the container app's managed identity
   the **Storage Blob Data Contributor** role, scoped to the container. Then set
   `AZURE_STORAGE_ACCOUNT` and *no* connection string: the adapter falls back to
   `DefaultAzureCredential`, which picks the identity up automatically. A
   connection string is for local development only.

4. **Set `CDN_URL`** to the Front Door endpoint. This is needed at **build** time
   as well as runtime — `next.config.ts` bakes it into both the `next/image`
   host allowlist and the CSP. Build without it and uploaded images are blocked
   in the browser even though the upload succeeded.

`CDN_URL` is not optional in the way it looks. The container is private, so
without a CDN there is nothing that can serve an upload: the request returns
403. `isStorageConfigured()` therefore returns false unless either `CDN_URL` is
set or `AZURE_STORAGE_PUBLIC_CONTAINER=true` declares the container
deliberately readable. Upload endpoints then return 503 rather than accepting
files that could never be displayed.

Verify a real account the same way the emulator is verified:

```bash
AZURE_STORAGE_CONNECTION_STRING="<account connection string>" npm run storage:smoke
```

## Environment variables

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Pooled. Needs `?pgbouncer=true` if PgBouncer is on. |
| `DIRECT_URL` | Direct, port 5432. Migrations only. |
| `NEXTAUTH_URL` | The public URL. Callbacks break if wrong. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `AZURE_STORAGE_ACCOUNT` | Storage account name. Uses the managed identity. |
| `AZURE_STORAGE_CONTAINER` | Defaults to `uploads` |
| `AZURE_STORAGE_CONNECTION_STRING` | **Local only.** Overrides the managed identity. |
| `AZURE_STORAGE_PUBLIC_CONTAINER` | `true` only if the container really is public. Leave unset in Azure. |
| `CDN_URL` | Front Door endpoint. **Required at build time.** |
| `GOOGLE_BOOKS_API_KEY` | Enrichment worker only |
| `TRUSTED_CLIENT_IP_HEADER` | **Preferred over hop counting.** `x-azure-clientip` behind Front Door — one value the client cannot write, instead of arithmetic about chain length. Only set it once direct ingress is blocked (Front Door ID validation or an access restriction), because the container app's own FQDN is public by default and a client that reaches it directly can forge the header and take a fresh rate-limit bucket per request. |
| `MAX_REPLICAS` | Records the replica cap so `deploy:verify` can assert the rate limiter's assumption still holds. Must be `1` until a shared limiter store exists. |
| `TRUSTED_PROXY_HOPS` | How many proxies in front append to `X-Forwarded-For`. **Set it explicitly.** Front Door in front of Container Apps is two, because the Container Apps ingress appends as well — and a wrong count returns a proxy's own address, identical for every client, which puts the whole site on one rate-limit bucket. `0` when nothing trusted is in front. |

Do not set a storage connection string in Azure — use the managed identity.

## Building and running the app

The image is built by CI and run unchanged; the app host never builds.

Until now that was only half true: `ci.yml` built the image, started it, probed
it and threw it away — there was no registry, no tag and no push, so deploying
meant building by hand on somebody's laptop. `.github/workflows/deploy.yml` now
closes that. It runs on `workflow_run` after CI completes on `main` and refuses
to proceed unless CI concluded success, checks out the SHA CI actually tested
rather than the branch tip, pushes to ACR, and then hands off to
`scripts/deploy/azure.sh release`, which applies migrations **before** rolling
the revision and runs `deploy:verify` afterwards.

`CDN_URL` is baked in at build time — `next.config.ts` reads it for the image
allowlist and the CSP — so an image is specific to one environment and cannot be
promoted between them unchanged.

`next build` wants roughly **2 GB of memory**, which is more than a burstable
instance has. It is also fast where memory is available — **5.4 s** — so there
is no reason to do it anywhere but CI.

The `Dockerfile` is a three-stage build producing a **479 MB** image from
`output: "standalone"`, which bundles only the dependencies actually reachable
at runtime. Two things in it are load-bearing and were both learned the hard
way:

- **Debian, not Alpine.** Prisma 5.22 probes the host to decide which query
  engine to load and resolves `openssl-1.1.x` on current Alpine, which ships
  only `libssl.so.3`. The container built, started, and served static pages —
  then threw `PrismaClientInitializationError` on every request that touched
  the database. Declaring the musl `binaryTargets` does not fix it: that changes
  which engines are shipped, not which one the client asks for.
- **`openssl` installed in every stage that runs Prisma.** The same detection
  falls back to a 1.1.x engine when it finds no libssl at all, so a stage
  missing the package fails identically — including the builder, because
  `next build` runs prerender queries.

```bash
docker build -t lob-app .
```

Then set the environment variables above on the container app. Container Apps
terminates TLS and scales the revision; nothing needs nginx.

### Health probes

Two endpoints, and using the right one for each probe matters:

| probe | endpoint | checks |
| --- | --- | --- |
| liveness | `/api/health` | nothing — only that the process responds |
| readiness | `/api/health/ready` | the database answers **and** the catalog has rows |

**Do not point liveness at the readiness endpoint.** Liveness decides whether to
*kill* the container. Wire it to something that depends on Postgres and a brief
database blip restarts every replica at once, which is strictly worse than
serving errors for a few seconds. Verified by stopping the database: liveness
answered 200 in 4 ms, readiness returned 503 in 2.0 s, and the app recovered on
its own when the database came back — no restart.

Readiness returns 503 when the catalog is empty, not just when the database is
down. That is deliberate: a restore still in progress, or one that silently
restored nothing, leaves the process perfectly healthy and every search empty.

```yaml
probes:
  - type: liveness
    httpGet: { path: /api/health, port: 3000 }
    periodSeconds: 10
  - type: readiness
    httpGet: { path: /api/health/ready, port: 3000 }
    periodSeconds: 10
    failureThreshold: 3
```

The readiness query has a 2-second budget. Without it the probe *hung* rather
than failing — with Postgres stopped, Prisma blocked on connect for well over
25 s, and a probe that never answers looks identical to a wedged process.

### Databases that predate the baseline

There are none, by design. The baseline migration is the starting point for
every environment, and `prisma migrate deploy` takes an empty database to
current in one step — verified against a fresh Postgres 16. That run covered 19 migrations; two
have been added since (`import_row_error`, `enrichment_claimed_at`) and the
claim has not been re-established against 21.

An earlier revision carried a hand-written upgrade script for a database
holding the pre-baseline schema. It was removed once no such database existed:
it could not be exercised by any test, and it silently rotted when a later
migration moved every table from `public` into `app` — the documented procedure
would have left a database believing it was current while missing two of the
three migrations.

If a legacy database ever does surface, recover the script from git
(`git show 099ddc0:bookshelf/prisma/manual/001_legacy_to_baseline.sql`) and
treat it as a starting point rather than a working tool: it predates both the
schema move and the catalog tables.

## Rehearse it locally first

`docker-compose.yml` runs the deployed topology on one machine: Postgres 16,
PgBouncer in transaction mode, the app container, and Azurite standing in for
Blob Storage.

```bash
docker compose up -d
DIRECT_URL="postgresql://bookshelf:bookshelf@127.0.0.1:5433/bookshelf" \
  scripts/db/migrate-deploy.sh
npm run storage:smoke
```

It deliberately differs from `npm run dev` in three ways, each of which has
hidden a real failure:

1. **`DATABASE_URL` goes through a pooler and `DIRECT_URL` does not.** Locally
   they are the same string, so nothing had ever exercised the split.
2. **Postgres 16**, matching Flexible Server. Local development runs 14.
3. **`shared_buffers` is not the 128 MB default.**

This is where the Prisma engine failure above was found — not in CI, not in the
test suite, but by a container that built and started cleanly and then 500ed on
every database-backed page.

## Tuning the machine that runs the ingest

Local, not Azure — but keep it here, because the numbers were expensive to get.

The defaults are tuned for many small concurrent queries. The ingest is the
opposite: a few passes over roughly a hundred million rows. Two settings
dominate, and both were measured during a full run rather than guessed.

**`max_wal_size`.** At the 1 GB default, the works insert triggered 562
requested checkpoints and spent its time waiting on `IO/WALWrite`. Every
checkpoint forces full-page writes for the next touch of each page, so a bulk
load at this size is mostly writing pages twice. Raising it to 24 GB dropped the
rate from roughly 3.7 checkpoints per minute to 0.14, and the wait moved off
WAL entirely.

    ALTER SYSTEM SET max_wal_size = '24GB';
    ALTER SYSTEM SET checkpoint_completion_target = '0.9';
    SELECT pg_reload_conf();          -- no restart needed

Both are reloadable and take no locks, so they can be applied to a run already
in progress. Revert afterwards if the same server also serves the application —
24 GB of WAL is a lot of disk for an OLTP workload.

**Memory.** `03-normalize.sql` and `05-index.sql` set `work_mem` and
`maintenance_work_mem` themselves, scoped to their own transaction or session.
Lower those values if the ingest host is small; `work_mem` is per sort node and
each parallel worker gets its own.

**Statistics.** `ANALYZE` after each bulk insert, inside the transaction.
Statistics do not update mid-transaction, and the planner sized a 15,380,614-row
table at 1,269 rows — which alone took `work_authors` from 4 h 17 min to 38 min.

Autovacuum on the staging tables is disabled by migration — they are UNLOGGED,
written once and dropped, so vacuuming them only competes for IO.

## Known limitation: rate limiting

`src/lib/rate-limit.ts` keeps state in process memory. That is correct for a
single long-lived instance and **wrong on Container Apps**, which scales the
revision: each replica gets its own empty window, so the effective limit
becomes `limit × replicas`.

Either pin the app to one replica, or move the limiter to a shared store before
scaling. The signature is storage-agnostic, so that is a change to one file —
which routes are limited, the key format and the limits all stay as they are.

## After deploying, verify

Most of this is automated. Run it first — it exits non-zero, so it can gate a
release rather than being a checklist someone skims:

```bash
DIRECT_URL="<direct>" DATABASE_URL="<pooled>" \
NEXTAUTH_URL="https://…" NEXTAUTH_SECRET="…" CDN_URL="https://…" \
BASE_URL="https://…" npm run deploy:verify
```

It runs every check over configuration and schema that applies to the
environment it is given (the exact number varies with it — more when the pooled and
direct URLs differ), and eight more against the
running app when `BASE_URL` is set. Each corresponds to something that has gone
wrong or would go wrong silently: the two connection strings the right way round and the
pooled one carrying `pgbouncer=true`; `NEXTAUTH_SECRET` not a placeholder;
storage having something that can actually serve it; both extensions; every
migration applied and none failed; `work_mem` at least 32 MB;
`pg_trgm.similarity_threshold`; the catalog non-empty; all four search indexes;
the `search_vector` trigger; statistics gathered; both probes; the CSP carrying
your CDN origin and not `localhost`; and search answering in under a second.

Warnings (a shared `DATABASE_URL`/`DIRECT_URL`, a missing HSTS header) do not
fail the run — they are legitimate in some topologies.

### Still worth doing by hand

The script cannot check these, because they need two accounts and a browser.

- `/user/<id>` renders signed out and leaks no `email` or `passwordHash`
  (the read handlers on `/api/users/<id>` and `/api/shelves/<id>` were removed;
  both routes now export only their mutating method)
- Registering as `Test@Example.com` then signing in as `test@example.com` works
- A second account gets 403 deleting the first account's uploaded map
- Upload an avatar, confirm it renders, then replace it and confirm the old
  blob is gone from the container
- **Open a work page and put the book on a shelf.** The whole reading loop was
  unreachable once, invisibly to 222 passing tests, because the page mounted
  none of its components.
