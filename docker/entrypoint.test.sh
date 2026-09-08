#!/bin/bash
#
# Control-flow tests for the container entrypoint (F10).
#
# These run the real docker/entrypoint.sh against stand-in binaries, so they
# exercise the shell logic that decides whether anything listens — the part
# the review reproduced by replacing the migration with `false` and watching
# the server start anyway.
#
# Deliberately does not need Docker: it is the ordering that was wrong, not
# the image.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/entrypoint.sh"

failures=0
pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; failures=$((failures + 1)); }

# --- Fixtures ---------------------------------------------------------------

make_workspace() {
  local dir
  dir="$(mktemp -d)"
  mkdir -p "$dir/data"

  # Stand-in for the Next.js standalone server: records that it started, then
  # waits so the supervisor has something to supervise.
  cat > "$dir/server.js" <<'JS'
const fs = require('node:fs');
fs.writeFileSync(process.env.SERVER_MARKER, 'started');
setInterval(() => {}, 1000);
JS

  printf '%s' "$dir"
}

# $1 = workspace, $2 = migrate exit code
make_watcher() {
  local dir="$1" migrate_status="$2"
  cat > "$dir/watcher" <<EOF
#!/bin/bash
if [ "\${1:-}" = "db" ]; then
  action="\${!#}"
  case "\$action" in
    migrate)
      if [ "$migrate_status" != "0" ]; then
        echo "migration blew up" >&2
        exit $migrate_status
      fi
      echo '{"applied":[],"version":4}'
      exit 0
      ;;
    query-one)
      cat > /dev/null
      echo '{"row":{"total":0}}'
      exit 0
      ;;
  esac
  exit 0
fi

# No subcommand: this is the library watcher itself.
echo "started" > "\$WATCHER_MARKER"
trap 'exit 0' TERM INT
while true; do sleep 0.2; done
EOF
  chmod +x "$dir/watcher"
}

# --- Test: a failing migration must stop everything -------------------------

test_failed_migration_blocks_serving() {
  local dir; dir="$(make_workspace)"
  make_watcher "$dir" 1

  ( cd "$dir" && \
    NEXTAUTH_SECRET=test-secret \
    DATABASE_PATH="$dir/data/library.db" \
    WATCHER_RS_BIN="$dir/watcher" \
    SERVER_ENTRY="$dir/server.js" \
    SERVER_MARKER="$dir/server-started" \
    WATCHER_MARKER="$dir/watcher-started" \
    timeout 20 "$ENTRYPOINT" >/dev/null 2>&1 )
  local status=$?

  if [ "$status" -ne 0 ]; then
    pass "a failing migration exits non-zero (status $status)"
  else
    fail "a failing migration exited 0"
  fi

  if [ ! -e "$dir/server-started" ]; then
    pass "a failing migration never starts the HTTP server"
  else
    fail "the HTTP server started despite a failed migration"
  fi

  if [ ! -e "$dir/watcher-started" ]; then
    pass "a failing migration never starts the watcher"
  else
    fail "the watcher started despite a failed migration"
  fi

  rm -rf "$dir"
}

# --- Test: the shape the review reproduced ----------------------------------

test_old_command_shape_would_have_served() {
  local dir; dir="$(make_workspace)"

  # The original CMD, with the migration replaced by `false`. `&` binds to
  # the whole AND-list, so the foreground server runs regardless.
  ( cd "$dir" && \
    SERVER_MARKER="$dir/server-started" \
    timeout 10 bash -c 'false && echo seeded && sleep 5 & exec node "$0"' "$dir/server.js" \
    >/dev/null 2>&1 )

  if [ -e "$dir/server-started" ]; then
    pass "the previous CMD shape did start the server after a failed migration"
  else
    fail "could not reproduce the previous CMD shape"
  fi

  rm -rf "$dir"
}

# --- Test: missing required configuration -----------------------------------

test_missing_secret_is_fatal() {
  local dir; dir="$(make_workspace)"
  make_watcher "$dir" 0

  ( cd "$dir" && \
    DATABASE_PATH="$dir/data/library.db" \
    WATCHER_RS_BIN="$dir/watcher" \
    SERVER_ENTRY="$dir/server.js" \
    SERVER_MARKER="$dir/server-started" \
    WATCHER_MARKER="$dir/watcher-started" \
    timeout 20 "$ENTRYPOINT" >/dev/null 2>&1 )
  local status=$?

  if [ "$status" -ne 0 ] && [ ! -e "$dir/server-started" ]; then
    pass "a missing NEXTAUTH_SECRET stops startup"
  else
    fail "startup continued without NEXTAUTH_SECRET (status $status)"
  fi

  rm -rf "$dir"
}

# --- Test: happy path, and SIGTERM stops both children ----------------------

test_successful_start_and_clean_shutdown() {
  local dir; dir="$(make_workspace)"
  make_watcher "$dir" 0

  cd "$dir" || return
  env NEXTAUTH_SECRET=test-secret \
    DATABASE_PATH="$dir/data/library.db" \
    WATCHER_RS_BIN="$dir/watcher" \
    SERVER_ENTRY="$dir/server.js" \
    SERVER_MARKER="$dir/server-started" \
    WATCHER_MARKER="$dir/watcher-started" \
    "$ENTRYPOINT" > "$dir/out.log" 2>&1 &
  local entrypoint_pid=$!
  cd - >/dev/null || return

  local waited=0
  while [ ! -e "$dir/server-started" ] && [ "$waited" -lt 100 ]; do
    sleep 0.1
    waited=$((waited + 1))
  done

  if [ -e "$dir/server-started" ] && [ -e "$dir/watcher-started" ]; then
    pass "a successful migration starts both the watcher and the server"
  else
    fail "children did not start after a successful migration"
  fi

  if grep -q "Open /setup" "$dir/out.log"; then
    pass "an empty database points the operator at /setup"
  else
    fail "no first-run guidance was printed for an empty database"
  fi

  if ! grep -qi "seed" "$dir/out.log"; then
    pass "startup does not provision an account"
  else
    fail "startup mentions seeding an account"
  fi

  kill -TERM "$entrypoint_pid" 2>/dev/null
  wait "$entrypoint_pid" 2>/dev/null
  sleep 0.5

  if ! pgrep -f "$dir/server.js" >/dev/null 2>&1; then
    pass "SIGTERM stops the HTTP server"
  else
    fail "the HTTP server survived SIGTERM"
    pkill -f "$dir/server.js" 2>/dev/null
  fi

  if ! pgrep -f "$dir/watcher" >/dev/null 2>&1; then
    pass "SIGTERM stops the watcher"
  else
    fail "the watcher survived SIGTERM"
    pkill -f "$dir/watcher" 2>/dev/null
  fi

  rm -rf "$dir"
}

# --- Test: a dying watcher is visible --------------------------------------

test_watcher_exit_stops_the_container() {
  local dir; dir="$(make_workspace)"
  make_watcher "$dir" 0

  # A watcher that exits immediately, so its failure must surface.
  cat > "$dir/watcher-quits" <<EOF
#!/bin/bash
if [ "\${1:-}" = "db" ]; then
  exec "$dir/watcher" "\$@"
fi
exit 7
EOF
  chmod +x "$dir/watcher-quits"

  ( cd "$dir" && \
    NEXTAUTH_SECRET=test-secret \
    DATABASE_PATH="$dir/data/library.db" \
    WATCHER_RS_BIN="$dir/watcher-quits" \
    SERVER_ENTRY="$dir/server.js" \
    SERVER_MARKER="$dir/server-started" \
    WATCHER_MARKER="$dir/watcher-started" \
    timeout 20 "$ENTRYPOINT" > "$dir/out.log" 2>&1 )
  local status=$?

  if [ "$status" -eq 7 ]; then
    pass "a watcher crash exits the container with the watcher's status"
  else
    fail "expected exit status 7 from a crashed watcher, got $status"
  fi

  if grep -q "watcher exited" "$dir/out.log"; then
    pass "a watcher crash is reported"
  else
    fail "a watcher crash was not reported"
  fi

  if ! pgrep -f "$dir/server.js" >/dev/null 2>&1; then
    pass "a watcher crash stops the HTTP server too"
  else
    fail "the HTTP server outlived the watcher"
    pkill -f "$dir/server.js" 2>/dev/null
  fi

  rm -rf "$dir"
}

echo "entrypoint control flow"
test_failed_migration_blocks_serving
test_old_command_shape_would_have_served
test_missing_secret_is_fatal
test_successful_start_and_clean_shutdown
test_watcher_exit_stops_the_container

if [ "$failures" -gt 0 ]; then
  printf '\n%d check(s) failed\n' "$failures"
  exit 1
fi

printf '\nall entrypoint checks passed\n'
