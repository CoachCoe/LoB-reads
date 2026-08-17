#!/usr/bin/env bash
#
# Run a Prisma CLI command against the TEST database.
#
#   scripts/db/with-test-db.sh migrate deploy
#   scripts/db/with-test-db.sh migrate status
#
# This exists because the Prisma CLI loads `.env` and lets it override an
# inline `DATABASE_URL=…`. So the obvious
#
#   DATABASE_URL="…/bookshelf_test" npx prisma migrate deploy
#
# silently migrates the DEVELOPMENT database instead, reports success, and
# leaves the test database a version behind — which then fails much later as a
# confusing "column does not exist" inside an integration test.
#
# The only thing the CLI reliably honours is the absence of that file, so it is
# moved aside for the duration and restored by the trap on any exit path,
# including Ctrl-C.
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ ! -f .env ]]; then
  echo "No .env found. Copy .env.example and set TEST_DATABASE_URL." >&2
  exit 1
fi

# Read the test URL before hiding the file it lives in.
TEST_URL="$(grep -E '^TEST_DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'')"

if [[ -z "$TEST_URL" ]]; then
  echo "TEST_DATABASE_URL is not set in .env." >&2
  exit 1
fi

# Refuse to touch anything that is not obviously a test database. The whole
# point of this script is pointing migrations at a different database than
# usual; a typo here would run them against real data.
if [[ "$TEST_URL" != *test* ]]; then
  echo "TEST_DATABASE_URL does not contain 'test' — refusing to run." >&2
  exit 1
fi

HIDDEN=".env.hidden-by-with-test-db"
trap 'mv -f "$HIDDEN" .env 2>/dev/null || true' EXIT
mv .env "$HIDDEN"

# The datasource declares both; locally they are the same connection.
DATABASE_URL="$TEST_URL" DIRECT_URL="$TEST_URL" npx prisma "$@"
