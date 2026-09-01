#!/usr/bin/env bash
#
# Apply migrations from a release step — CI, or a one-off container.
#
#   DIRECT_URL=postgresql://… scripts/db/migrate-deploy.sh
#
# Two things make this a script rather than a bare `npx prisma migrate deploy`:
#
#   1. The Prisma CLI loads `.env` and lets it OVERRIDE an inline variable, so
#      a deployment that happened to run in a checkout containing `.env` would
#      silently migrate the developer's database and report success. The only
#      thing the CLI reliably honours is the absence of that file, so it is
#      moved aside and restored by the trap on every exit path.
#   2. Migrations must not go through a transaction-mode pooler — it breaks
#      advisory locks and DDL. This insists on DIRECT_URL and points both
#      variables at it, because the datasource block reads both.
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ -z "${DIRECT_URL:-}" ]]; then
  echo "DIRECT_URL is not set. Migrations need the non-pooled connection." >&2
  exit 1
fi

# A pooled URL here would appear to work and then fail partway through a
# migration, which is the worst of the available outcomes.
if [[ "$DIRECT_URL" == *pgbouncer=true* ]]; then
  echo "DIRECT_URL looks like a pooled connection string — refusing to run." >&2
  exit 1
fi

if [[ -f .env ]]; then
  HIDDEN=".env.hidden-by-migrate-deploy"
  trap 'mv -f "$HIDDEN" .env 2>/dev/null || true' EXIT
  mv .env "$HIDDEN"
fi

DATABASE_URL="$DIRECT_URL" DIRECT_URL="$DIRECT_URL" npx prisma migrate deploy
