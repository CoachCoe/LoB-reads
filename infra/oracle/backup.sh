#!/usr/bin/env bash
#
# Nightly backup of what cannot be rebuilt: the app and public schemas, and the
# uploads. The catalog is left out because it is rebuilt from the Open Library
# dumps and restored with restore-catalog.sh. restore-backup.sh reads these.
#
#   0 3 * * *  /path/to/repo/infra/oracle/backup.sh >> /var/log/lob-backup.log 2>&1
#
# These land on the same disk as the database, which protects against a bad
# migration or a deleted row, not against losing the volume. An OCI block
# volume backup policy on the boot volume covers that; see
# bookshelf/DEPLOYMENT-ORACLE.md.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

DEST="${BACKUP_DIR:-/var/backups/lob}"
KEEP_DAYS="${KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DEST"

docker compose exec -T postgres \
  pg_dump -U bookshelf -d bookshelf -Fc --schema=app --schema=public \
  > "$DEST/db-$stamp.dump.partial"
mv "$DEST/db-$stamp.dump.partial" "$DEST/db-$stamp.dump"

docker compose exec -T app tar -C /data -czf - uploads \
  > "$DEST/uploads-$stamp.tar.gz.partial"
mv "$DEST/uploads-$stamp.tar.gz.partial" "$DEST/uploads-$stamp.tar.gz"

find "$DEST" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "backed up $stamp: $(du -h "$DEST/db-$stamp.dump" | cut -f1) db, $(du -h "$DEST/uploads-$stamp.tar.gz" | cut -f1) uploads"
