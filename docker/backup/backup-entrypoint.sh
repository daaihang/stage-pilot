#!/bin/sh
set -eu

if [ "${1:-}" = "restore-drill" ]; then
  exec gosu postgres sh /usr/local/bin/restore-drill.sh
fi

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:=stagepilot}"
: "${WALG_S3_PREFIX:?WALG_S3_PREFIX is required}"
: "${WALG_SLOTNAME:=walg}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"
: "${BASE_BACKUP_RETRY_SECONDS:=300}"
: "${WAL_WATERMARK_INTERVAL_SECONDS:=300}"
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE WALG_SLOTNAME

until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do sleep 2; done

case "$WALG_SLOTNAME" in
  ''|*[!A-Za-z0-9_]*) echo "WALG_SLOTNAME may contain only letters, digits, and underscores" >&2; exit 1 ;;
esac

ensure_replication_slot() {
  slot_state=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atq -v ON_ERROR_STOP=1 \
    -c "SELECT COALESCE(restart_lsn::text,'')||'|'||active::text||'|'||COALESCE(wal_status,'') FROM pg_replication_slots WHERE slot_name='$WALG_SLOTNAME'")
  if [ -z "$slot_state" ]; then
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
      -c "SELECT pg_create_physical_replication_slot('$WALG_SLOTNAME',true)" >/dev/null
    return
  fi
  IFS='|' read -r restart_lsn slot_active wal_status <<EOF
$slot_state
EOF
  if [ "$wal_status" = "lost" ]; then
    echo "WAL-G replication slot '$WALG_SLOTNAME' has lost required WAL; operator recovery is required" >&2
    exit 1
  fi
  if [ -z "$restart_lsn" ]; then
    if [ "$slot_active" != "f" ]; then
      echo "WAL-G replication slot '$WALG_SLOTNAME' is active but has no reserved WAL position" >&2
      exit 1
    fi
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
      -c "SELECT pg_drop_replication_slot('$WALG_SLOTNAME')" >/dev/null
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
      -c "SELECT pg_create_physical_replication_slot('$WALG_SLOTNAME',true)" >/dev/null
  fi
}

ensure_replication_slot

wal-g wal-receive &
receiver_pid=$!
stop_receiver() { kill "$receiver_pid" 2>/dev/null || true; wait "$receiver_pid" 2>/dev/null || true; }
trap stop_receiver EXIT INT TERM

record_base_backup() {
  if wal-g backup-push --pghost "$PGHOST"; then
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
      -c "UPDATE file_backup_status SET last_base_backup_at=NOW(),updated_at=NOW(),details=jsonb_set(details,'{wal_g_version}',to_jsonb('3.0.9'::text),true) WHERE id=1" >/dev/null
    wal-g delete retain FULL 31 --use-sentinel-time --confirm || echo "WAL-G retention cleanup failed" >&2
    return 0
  else
    echo "WAL-G base backup failed; prior backup remains available" >&2
    return 1
  fi
}

record_wal_watermark() {
  target_lsn=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atq -v ON_ERROR_STOP=1 -c "SELECT pg_switch_wal()" 2>/dev/null || true)
  [ -n "$target_lsn" ] || return 1
  attempt=0
  while [ "$attempt" -lt 24 ]; do
    acked=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Atq -v ON_ERROR_STOP=1 \
      -c "SELECT EXISTS(SELECT 1 FROM pg_stat_replication WHERE application_name='walg' AND state='streaming' AND flush_lsn >= '${target_lsn}'::pg_lsn)" 2>/dev/null || echo f)
    if [ "$acked" = "t" ]; then
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
        -c "UPDATE file_backup_status SET wal_archived_through=NOW(),updated_at=NOW(),details=jsonb_set(details,'{last_wal_lsn}',to_jsonb('${target_lsn}'::text),true) WHERE id=1" >/dev/null
      return 0
    fi
    attempt=$((attempt+1)); sleep 5
  done
  echo "WAL-G receiver did not acknowledge ${target_lsn} within two minutes" >&2
  return 1
}

now=$(date +%s)
if record_base_backup; then next_backup=$((now+BACKUP_INTERVAL_SECONDS)); else next_backup=$((now+BASE_BACKUP_RETRY_SECONDS)); fi
while :; do
  if ! kill -0 "$receiver_pid" 2>/dev/null; then
    wait "$receiver_pid" || true
    echo "WAL-G receiver exited; restarting" >&2
    wal-g wal-receive & receiver_pid=$!
  fi
  record_wal_watermark || true
  now=$(date +%s)
  if [ "$now" -ge "$next_backup" ]; then
    if record_base_backup; then next_backup=$((now+BACKUP_INTERVAL_SECONDS)); else next_backup=$((now+BASE_BACKUP_RETRY_SECONDS)); fi
  fi
  sleep "$WAL_WATERMARK_INTERVAL_SECONDS"
done
