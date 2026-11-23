#!/usr/bin/env bash
# Run migrations and database tests against a throwaway local PostgreSQL.
#
#   PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres scripts/local-db/run-tests.sh
#
# With the Supabase CLI and Docker available, prefer the real thing:
#   supabase db reset && supabase test db
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="${TEST_DB:-dd_test}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54322}" PGUSER="${PGUSER:-postgres}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

echo "# Recreating database $DB"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"

echo "# Loading local Supabase stand-in (auth, storage, roles)"
"${PSQL[@]}" -d "$DB" -f "$ROOT/scripts/local-db/supabase-shim.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "# Applying $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -1 -f "$f"
done

if "${PSQL[@]}" -d "$DB" -tAc "select 1 from pg_available_extensions where name = 'pgtap'" | grep -q 1; then
  echo "# Using pgTAP extension"
  "${PSQL[@]}" -d "$DB" -c "create extension pgtap"
else
  echo "# pgTAP not installed; using local pgTAP-compatible subset"
  "${PSQL[@]}" -d "$DB" -f "$ROOT/scripts/local-db/pgtap-lite.sql"
fi

pass=0; fail=0; failed_files=()
for t in "$ROOT"/supabase/tests/*.test.sql; do
  name="$(basename "$t")"
  if out="$("${PSQL[@]}" -d "$DB" -tA -f "$t" 2>&1)"; then status=0; else status=$?; fi
  ok_count=$(grep -c '^ok ' <<<"$out" || true)
  bad_count=$(grep -c '^not ok' <<<"$out" || true)
  pass=$((pass + ok_count)); fail=$((fail + bad_count))
  if [[ $status -ne 0 || $bad_count -gt 0 ]] || grep -q '^# Looks like' <<<"$out"; then
    failed_files+=("$name")
    echo "FAIL $name ($ok_count passed, $bad_count failed)"
    grep -E '^(not ok|#|psql|ERROR)' <<<"$out" | sed 's/^/    /'
    [[ $status -ne 0 ]] && fail=$((fail + 1))
  else
    echo "ok   $name ($ok_count passed)"
  fi
done

echo
echo "# $pass assertions passed, $fail failed"
[[ ${#failed_files[@]} -eq 0 ]]
