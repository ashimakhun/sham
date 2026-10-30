#!/usr/bin/env bash
# Database tests: applies supabase/migrations to a throwaway Postgres (with Supabase stand-ins from
# _supabase_stubs.sql) and runs every supabase/tests/*.test.sql against a fresh copy.
#
#   npm run test:db                 # starts a temporary local Postgres (needs Postgres 15+ binaries)
#   DATABASE_URL=postgres://... npm run test:db   # or use an existing server (needs CREATEDB + CREATEROLE)
#
# Each test file runs in its own database, so tests never depend on each other.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
chmod 755 "$tmp"
started=""

run_as=()
if [ "$(id -u)" = 0 ] && [ -z "${DATABASE_URL:-}" ]; then
  # Postgres refuses to run as root; use the postgres OS user when we are root (e.g. containers).
  chown postgres "$tmp"
  run_as=(runuser -u postgres --)
fi

cleanup() {
  if [ -n "$started" ]; then "${run_as[@]}" "$bindir/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

if [ -z "${DATABASE_URL:-}" ]; then
  bindir="$(pg_config --bindir 2>/dev/null || true)"
  if [ ! -x "$bindir/initdb" ]; then bindir="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"; fi
  if [ ! -x "$bindir/initdb" ]; then echo "Postgres binaries not found; install Postgres or set DATABASE_URL." >&2; exit 1; fi
  # UTF8 like Supabase, whatever the machine's locale (a POSIX locale would give SQL_ASCII, where char_length()
  # counts bytes and multibyte limits are tested wrongly).
  "${run_as[@]}" "$bindir/initdb" -D "$tmp/data" -U postgres -A trust -E UTF8 --locale=C >/dev/null
  "${run_as[@]}" "$bindir/pg_ctl" -D "$tmp/data" -l "$tmp/pg.log" -w \
    -o "-c listen_addresses='' -c unix_socket_directories='$tmp' -c fsync=off" start >/dev/null
  started=1
  base="postgresql://postgres@/postgres?host=$tmp"
  db_url() { echo "postgresql://postgres@/$1?host=$tmp"; }
else
  base="$DATABASE_URL"
  db_url() { echo "${DATABASE_URL%/*}/$1"; }
fi

psql_q() { PGOPTIONS="-c client_min_messages=error" psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# Template: Supabase stand-ins + all migrations in order + test helpers.
psql_q "$base" -c "drop database if exists sham_test_template" -c "create database sham_test_template"
tpl="$(db_url sham_test_template)"
psql_q "$tpl" -f "$here/_supabase_stubs.sql"
for m in "$root"/supabase/migrations/*.sql; do
  psql_q "$tpl" -f "$m" || { echo "Migration failed: $m" >&2; exit 1; }
done
psql_q "$tpl" -f "$here/_helpers.sql"

pass=0; fail=0; failed=()
for f in "$here"/*.test.sql; do
  name="$(basename "$f" .test.sql)"
  db="sham_test_${name//[^a-zA-Z0-9]/_}"
  psql_q "$base" -c "drop database if exists $db" -c "create database $db template sham_test_template"
  if out="$(psql -X -v ON_ERROR_STOP=1 "$(db_url "$db")" -f "$f" 2>&1)"; then
    n="$(grep -c 'NOTICE:  ok - ' <<<"$out" || true)"
    echo "PASS $name ($n checks)"
    [ -n "${VERBOSE:-}" ] && grep 'NOTICE:  ok - ' <<<"$out" | sed 's/.*NOTICE:  /  /'
    pass=$((pass + 1))
  else
    echo "FAIL $name"
    grep -E 'NOTICE:  ok - |ERROR|FAIL' <<<"$out" | sed 's/^.*NOTICE:  /  /; s/^/  /'
    fail=$((fail + 1)); failed+=("$name")
  fi
  psql_q "$base" -c "drop database $db"
done
psql_q "$base" -c "drop database sham_test_template"

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
