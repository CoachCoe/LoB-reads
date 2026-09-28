#!/usr/bin/env bash
#
# Restore user data and uploads from a backup.sh pair.
#
#   infra/oracle/restore-backup.sh /var/backups/lob/db-<stamp>.dump
#
# The uploads archive with the same stamp is restored alongside it. The catalog
# is untouched.
#
# The entry for the public schema itself is left out of the restore. With
# --clean it would try to drop `public`, which pg_trgm and the catalog's
# trigram indexes depend on; that fails, and so does the CREATE after it. The
# tables in public are still restored.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

dump="${1:-}"
[[ -f "$dump" ]] || die "usage: $0 <db-STAMP.dump>"
uploads="${dump%/*}/uploads-$(basename "$dump" .dump | sed 's/^db-//').tar.gz"
[[ -f "$uploads" ]] || die "no uploads archive beside it: $uploads"

docker compose cp "$dump" postgres:/tmp/restore.dump
docker compose exec -T postgres sh -ec '
  pg_restore -l /tmp/restore.dump | grep -v " SCHEMA - public " > /tmp/restore.list
  pg_restore -U bookshelf -d bookshelf --clean --if-exists --no-owner \
    --exit-on-error -L /tmp/restore.list /tmp/restore.dump
  rm /tmp/restore.dump /tmp/restore.list
'

docker compose exec -T app tar -C /data -xzf - < "$uploads"

docker compose exec -T postgres psql -U bookshelf -d bookshelf -Atc \
  "SELECT 'users: ' || count(*) FROM app.users"
