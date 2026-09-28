#!/usr/bin/env bash
#
# Replace the catalog schema with a dump built elsewhere.
#
#   # on the machine that ran the ingest
#   pg_dump -d bookshelf -Fd -j 8 --schema=catalog -f catalog-dump
#   rsync -a catalog-dump/ vm:<repo>/infra/oracle/catalog-dump/
#
#   # on the VM, after deploy.sh has run migrations at least once
#   infra/oracle/restore-catalog.sh
#
# Catalog only: `app` holds user data and `public` holds _prisma_migrations,
# and migrations own both. The schema migrations created is dropped first or
# the restore collides with it. ANALYZE is not optional — a dump carries no
# statistics, and the planner chooses badly without them. See the restore
# section of bookshelf/DEPLOYMENT.md for the measured timings.
#
# The app keeps serving throughout, but search returns nothing between the drop
# and the end of the restore — minutes, not hours.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ -f catalog-dump/toc.dat ]] \
  || die "catalog-dump/toc.dat not found. Copy a directory-format (-Fd) dump to infra/oracle/catalog-dump first."

psql() { docker compose exec -T postgres psql -U bookshelf -d bookshelf -v ON_ERROR_STOP=1 "$@"; }

echo "==> dropping the current catalog"
psql -c "DROP SCHEMA IF EXISTS catalog CASCADE;"

echo "==> restoring"
docker compose exec -T postgres pg_restore -U bookshelf -d bookshelf \
  -j 4 --no-owner --no-privileges /restore

echo "==> analyzing"
psql -c "ANALYZE catalog.works; ANALYZE catalog.editions;"

psql -c "SELECT count(*) AS works FROM catalog.works;"
