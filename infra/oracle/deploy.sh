#!/usr/bin/env bash
#
# Build and release Life on Books on the VM, from a checkout of the repository.
#
#   infra/oracle/deploy.sh            # build, migrate, roll, verify
#
# The order is the same one scripts/deploy/azure.sh enforces: migrations run
# BEFORE the new image starts, and the release stops if they fail, so new code
# never runs against a schema it does not have. deploy:verify runs last and its
# exit status is this script's.
#
# BASE_URL defaults to the public origin. Override it only to check the app
# without going through Caddy, as a local rehearsal does.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ -f .env ]] || die ".env is missing. Copy env.example to .env and fill it in."
# shellcheck disable=SC1091
source .env
[[ -n "${DOMAIN:-}" ]] || die "DOMAIN is not set in .env."

compose() { docker compose --profile tools "$@"; }

echo "==> building"
compose build app tools

echo "==> starting postgres"
compose up -d --wait postgres

echo "==> migrating"
compose run --rm --no-deps tools npx prisma migrate deploy

echo "==> rolling the app"
compose up -d --wait app caddy

echo "==> verifying"
compose run --rm --no-deps -e BASE_URL="${BASE_URL:-https://$DOMAIN}" tools npm run deploy:verify
