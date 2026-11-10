#!/usr/bin/env bash
# Back up a Railway environment's data (Postgres + the /data media volume) to
# local disk. Dry run by default, like scripts/sweep-orphan-media.mjs:
#
#   bash scripts/backup-railway.sh                    # dry run against production
#   bash scripts/backup-railway.sh --apply            # write the backup
#   bash scripts/backup-railway.sh --env <environment> --apply
#   bash scripts/backup-railway.sh --apply --out /mnt/nas/heirloom
#
# The dry run reads sizes and streams both archives into a byte counter, so it
# proves the whole pipeline without writing anything. --apply writes
#   <out>/<env>-<timestamp>/{db.dump,media.tar.gz,SHA256SUMS}
# and then verifies them: the dump must list with pg_restore (via podman, or
# the PGDMP header when podman is missing) and the tarball must hold as many
# files as the volume. A backup that fails a check stays in a *.partial folder.
#
# Everything streams over `railway ssh`, so no credentials are read or stored
# here. Requires a logged-in railway CLI with SSH access to the project. The
# output holds real family data: keep it out of the repository.
#
# Restore:
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_PUBLIC_URL" db.dump
#   tar -xzf media.tar.gz -C /data          # inside the app service
set -euo pipefail

ENVIRONMENT="production"
OUT_ROOT="${HOME}/genealogy-backups"
APPLY=0
DB_SERVICE="Postgres"
APP_SERVICE="Heirloom"
PG_IMAGE="docker.io/library/postgres:17"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --env) ENVIRONMENT="${2:?--env needs a value}"; shift ;;
    --env=*) ENVIRONMENT="${1#*=}" ;;
    --out) OUT_ROOT="${2:?--out needs a value}"; shift ;;
    --out=*) OUT_ROOT="${1#*=}" ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

command -v railway >/dev/null || { echo "railway CLI not found" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "$(realpath -m "$OUT_ROOT")/" in
  "$REPO_ROOT"/*) echo "Refusing to write family data inside the repository: $OUT_ROOT" >&2; exit 1 ;;
esac

ERR_LOG="$(mktemp)"
trap 'rm -f "$ERR_LOG"' EXIT

# Run a command in a service. Railway CLI chatter (SSH key notice, config
# deprecation warning) goes to stderr; keep it in ERR_LOG for failure reports.
remote() {
  local service="$1"; shift
  railway ssh -s "$service" -e "$ENVIRONMENT" -- "$@" 2>>"$ERR_LOG"
}

fail() {
  echo "FAILED: $*" >&2
  grep -v -i -E 'Using SSH key|config as code|config migrate|existing files keep' "$ERR_LOG" >&2 || true
  exit 1
}

# Single quotes are intentional: these expand in the remote shell.
# shellcheck disable=SC2016
MEDIA_DIR_CMD='cd "${DATA_DIR:-/data}"'
dump_db() { remote "$DB_SERVICE" pg_dump -U postgres -d railway -Fc; }
tar_media() { remote "$APP_SERVICE" sh -c "$MEDIA_DIR_CMD && tar -czf - ."; }

echo "Environment: $ENVIRONMENT ($([ $APPLY = 1 ] && echo apply || echo dry run))"

db_size="$(remote "$DB_SERVICE" psql -U postgres -d railway -Atc \
  "select pg_size_pretty(pg_database_size('railway'))")" || fail "could not reach $DB_SERVICE"
media_files="$(remote "$APP_SERVICE" sh -c "$MEDIA_DIR_CMD && find . ! -type d | wc -l" | tr -d '[:space:]')" \
  || fail "could not reach $APP_SERVICE"
media_size="$(remote "$APP_SERVICE" sh -c "$MEDIA_DIR_CMD && du -sh . | cut -f1")" || fail "could not size media"
echo "Database:    $db_size"
echo "Media:       $media_size in $media_files files"

if [ $APPLY = 0 ]; then
  db_bytes="$(dump_db | wc -c)" || fail "pg_dump stream"
  media_bytes="$(tar_media | wc -c)" || fail "media tar stream"
  [ "$db_bytes" -gt 0 ] || fail "pg_dump streamed nothing"
  [ "$media_bytes" -gt 0 ] || fail "media tar streamed nothing"
  echo "Streamed:    db.dump $db_bytes bytes, media.tar.gz $media_bytes bytes (discarded)"
  echo "Dry run OK. Re-run with --apply to write to $OUT_ROOT."
  exit 0
fi

DEST="$OUT_ROOT/$ENVIRONMENT-$(date +%Y%m%d-%H%M%S)"
WORK="$DEST.partial"
( umask 077; mkdir -p "$OUT_ROOT" "$WORK" )

echo "Writing:     $WORK"
dump_db > "$WORK/db.dump" || fail "pg_dump"
tar_media > "$WORK/media.tar.gz" || fail "media tar"

if command -v podman >/dev/null; then
  podman run --rm -v "$WORK:/b:ro,Z" "$PG_IMAGE" pg_restore --list /b/db.dump > "$WORK/db.list" 2>>"$ERR_LOG" \
    || fail "pg_restore could not read db.dump"
  tables="$(grep -c 'TABLE DATA' "$WORK/db.list" || true)"
  [ "$tables" -gt 0 ] || fail "db.dump has no table data"
  echo "Verified:    db.dump lists $tables tables"
else
  [ "$(head -c 5 "$WORK/db.dump")" = "PGDMP" ] || fail "db.dump is not a pg_dump archive"
  echo "Verified:    db.dump header only (install podman for a pg_restore check)"
fi

archived="$(tar -tzf "$WORK/media.tar.gz" | grep -vc '/$' || true)"
[ "$archived" = "$media_files" ] || fail "media.tar.gz holds $archived files, volume has $media_files"
echo "Verified:    media.tar.gz holds all $archived files"

( cd "$WORK" && sha256sum db.dump media.tar.gz > SHA256SUMS )
mv "$WORK" "$DEST"
echo "Done:        $DEST"
