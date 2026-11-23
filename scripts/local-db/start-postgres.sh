#!/usr/bin/env bash
# LOCAL TEST ONLY: start a throwaway PostgreSQL 16 on 127.0.0.1:54322 (trust auth)
# for npm run test:db and the e2e scripts. Never use for real data.
set -euo pipefail
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DATA="${PGDATA_DIR:-/var/lib/postgresql/dd54322}"
if pg_isready -q -h 127.0.0.1 -p 54322; then echo "already running"; exit 0; fi
if [[ ! -d "$DATA" ]]; then
  mkdir -p "$DATA" && chown postgres:postgres "$DATA"
  su postgres -c "$PGBIN/initdb -D $DATA -A trust -U postgres >/dev/null"
fi
su postgres -c "$PGBIN/pg_ctl -D $DATA -o '-p 54322 -k /tmp' -l $DATA/log.txt start" >/dev/null
for _ in $(seq 1 20); do pg_isready -q -h 127.0.0.1 -p 54322 && { echo "started"; exit 0; }; sleep 0.5; done
echo "PostgreSQL did not start; see $DATA/log.txt" >&2; exit 1
