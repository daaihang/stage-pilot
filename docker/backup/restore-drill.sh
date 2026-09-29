#!/bin/sh
set -eu

restore_dir="/tmp/stagepilot-restore-$$"
umask 077
mkdir -p "$restore_dir"
cleanup() {
  if [ -f "$restore_dir/postmaster.pid" ]; then pg_ctl -D "$restore_dir" -m immediate stop >/dev/null 2>&1 || true; fi
  rm -rf -- "$restore_dir"
}
trap cleanup EXIT INT TERM

wal-g backup-fetch "$restore_dir" LATEST
touch "$restore_dir/recovery.signal"
printf "restore_command = 'wal-g wal-fetch %%f %%p'\nrecovery_target_action = 'promote'\n" >> "$restore_dir/postgresql.auto.conf"
pg_ctl -D "$restore_dir" -o "-c listen_addresses='' -c unix_socket_directories='$restore_dir'" -w start
psql -h "$restore_dir" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c 'SELECT 1 AS restore_validation' >/dev/null
pg_ctl -D "$restore_dir" -m fast -w stop
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  -c "UPDATE file_backup_status SET last_restore_validation_at=NOW(),last_restore_validation_status='passed',updated_at=NOW() WHERE id=1" >/dev/null
echo "WAL-G backup restored and opened in an isolated temporary PostgreSQL cluster"
