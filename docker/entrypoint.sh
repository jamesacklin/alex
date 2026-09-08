#!/bin/bash
#
# Container entrypoint (F10).
#
# The previous CMD was:
#
#   sh -c "pnpm db:push && pnpm db:seed && /app/watcher-rs/watcher-rs & exec node ..."
#
# `&` binds to the whole AND-list, so the migrations, the seed *and* the
# watcher were all backgrounded and the HTTP server started immediately.
# A failed migration did not stop the server; it just served requests
# against a database that had never been created. `db:seed` also ran on
# every start, restoring a published default administrator password over
# whatever the owner had chosen.
#
# This script instead:
#   * validates required configuration before doing anything;
#   * applies migrations synchronously and exits non-zero on failure;
#   * never provisions an account (first-run setup does that, gated by a
#     one-time token this script surfaces);
#   * supervises the watcher and the HTTP server, exiting when either dies;
#   * forwards SIGTERM/SIGINT to both children so `docker stop` is clean.

set -euo pipefail

log() { printf '[alex] %s\n' "$*" >&2; }
fatal() { log "FATAL: $*"; exit 1; }

: "${DATABASE_PATH:=/app/data/library.db}"
: "${WATCHER_RS_BIN:=/app/watcher-rs/watcher-rs}"
: "${SERVER_ENTRY:=.next/standalone/server.js}"

# --- Required configuration -------------------------------------------------

if [ -z "${NEXTAUTH_SECRET:-}" ]; then
  fatal "NEXTAUTH_SECRET is not set. Generate one with 'openssl rand -hex 32' and pass it in."
fi

if [ ! -x "$WATCHER_RS_BIN" ]; then
  fatal "watcher binary not found or not executable at $WATCHER_RS_BIN"
fi

mkdir -p "$(dirname "$DATABASE_PATH")"

# --- Schema migrations ------------------------------------------------------
#
# Synchronous and fatal: nothing listens until storage is usable.

log "Applying database migrations to $DATABASE_PATH ..."
if ! migrate_output="$("$WATCHER_RS_BIN" db --db-path "$DATABASE_PATH" migrate)"; then
  fatal "database migrations failed; refusing to start the server."
fi
log "Migrations complete: $migrate_output"

# --- First-run notice -------------------------------------------------------
#
# No account is created here. If the database has no users, print where to
# find the one-time setup token so the owner can complete setup themselves.

user_count="$(
  printf '%s' '{"sql":"SELECT COUNT(*) AS total FROM users","params":[]}' \
    | "$WATCHER_RS_BIN" db --db-path "$DATABASE_PATH" query-one \
    | sed -n 's/.*"total":\([0-9]*\).*/\1/p'
)"

if [ "${user_count:-0}" = "0" ]; then
  log ""
  log "No accounts exist yet. Open /setup to create the first administrator."
  log "Alex will print a one-time setup token here (and write it next to the"
  log "database) the first time /setup is opened."
  log ""
fi

# --- Supervision ------------------------------------------------------------

watcher_pid=""
server_pid=""
shutting_down=0

shutdown() {
  if [ "$shutting_down" = "1" ]; then return; fi
  shutting_down=1
  log "Shutting down..."
  for pid in "$server_pid" "$watcher_pid"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  # Give them a moment, then insist.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    still_running=0
    for pid in "$server_pid" "$watcher_pid"; do
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then still_running=1; fi
    done
    [ "$still_running" = "0" ] && break
    sleep 1
  done
  for pid in "$server_pid" "$watcher_pid"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}

trap shutdown TERM INT
# Also on EXIT, so an unexpected early exit (`set -e`) still takes the
# children with it rather than leaving orphans holding the port.
trap shutdown EXIT

log "Starting the library watcher..."
"$WATCHER_RS_BIN" &
watcher_pid=$!

log "Starting the HTTP server..."
node "$SERVER_ENTRY" &
server_pid=$!

# Exit as soon as either child does, so a dead watcher or a dead server is
# visible to the orchestrator instead of being silently absent.
#
# `|| first_exit=$?` matters: under `set -e`, a non-zero `wait` would abort
# the script here and skip both the diagnostic and the shutdown.
first_exit=0
wait -n "$watcher_pid" "$server_pid" || first_exit=$?

if kill -0 "$server_pid" 2>/dev/null; then
  log "The library watcher exited (status $first_exit); stopping the server too."
else
  log "The HTTP server exited (status $first_exit)."
fi

shutdown
exit "$first_exit"
