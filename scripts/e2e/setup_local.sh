#!/usr/bin/env bash
# Prepare the local stack for scripts/e2e/booking_local.py and payments_local.py:
# fresh migrated dd_test, test accounts, an app build wired to the local API
# stand-in, and both servers running. Test-only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/dd-e2e}"
mkdir -p "$OUT"

"$ROOT/scripts/local-db/run-tests.sh" >/dev/null

psql -X -q -h 127.0.0.1 -p 54322 -U postgres -d dd_test <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'ana.reyes@test.local', '{"full_name":"Ana Reyes","phone":"09171234567"}'),
  ('22222222-2222-4222-8222-222222222222', 'ben.cruz@test.local', '{"full_name":"Ben Cruz"}'),
  ('33333333-3333-4333-8333-333333333333', 'carla.mendoza@test.local', '{"full_name":"Carla Mendoza"}'),
  ('44444444-4444-4444-8444-444444444444', 'dan.villanueva@test.local', '{"full_name":"Dan Villanueva"}'),
  ('55555555-5555-4555-8555-555555555555', 'lea.navarro@test.local', '{"full_name":"Lea Navarro"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-4333-8333-333333333333', 'staff'), ('44444444-4444-4444-8444-444444444444', 'staff'),
  ('55555555-5555-4555-8555-555555555555', 'admin');
insert into public.staff_permissions (user_id, permission) values
  ('33333333-3333-4333-8333-333333333333', 'schedule.manage'),
  ('33333333-3333-4333-8333-333333333333', 'bookings.cancel'),
  ('44444444-4444-4444-8444-444444444444', 'payments.verify');
SQL

cd "$ROOT"
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_localtest \
  VITE_SITE_URL=http://localhost:4175 npx vite build --outDir "$OUT/dist-local" --emptyOutDir >/dev/null

for port in 54321 4175; do
  pid=$(lsof -ti tcp:$port 2>/dev/null || true)
  [[ -n "$pid" ]] && kill $pid && sleep 1
done
rm -rf "$OUT/storage"
SHIM_STORAGE_DIR="$OUT/storage" setsid python3 scripts/local-db/rest-shim.py >"$OUT/shim.log" 2>&1 &
if [[ "${E2E_HEADERS:-1}" == "1" ]]; then
  # Production headers from vercel.json (CSP etc.), so tests catch anything they would block
  setsid python3 scripts/e2e/serve_with_headers.py "$OUT/dist-local" 4175 >"$OUT/preview.log" 2>&1 &
else
  setsid npx vite preview --outDir "$OUT/dist-local" --port 4175 --strictPort >"$OUT/preview.log" 2>&1 &
fi
sleep 3
echo "Ready: app http://localhost:4175, API stand-in http://127.0.0.1:54321"
