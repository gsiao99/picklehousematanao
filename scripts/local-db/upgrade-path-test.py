#!/usr/bin/env python3
"""
LOCAL TEST ONLY — migration upgrade-path test on a throwaway database.

Later migrations will land on a database with real rows in it. This applies
the migrations in stages the same way: the baseline with live bookings and a
payment made through its own functions, then the guest-bookings migration.
After each stage it checks that existing rows survived unchanged and that the
new features work on top of them. Each migration runs in one transaction, like
`supabase db push`. Add a stage here for every future migration.

  python3 scripts/local-db/upgrade-path-test.py
"""
import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = "dd_upgrade"
BASE = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres"]
ENV = {**os.environ, "PGOPTIONS": "-c client_min_messages=warning"}
results = []


def check(name, ok, detail=""):
    results.append((bool(ok), name, detail))


def psql(*args, db=DB):
    p = subprocess.run(BASE + ["-d", db, *args], capture_output=True, text=True, env=ENV)
    if p.returncode:
        raise subprocess.CalledProcessError(p.returncode, "psql", p.stdout, p.stderr)
    return p.stdout.strip()


def sql(q):
    return psql("-tA", "-c", q)


def as_user(uid, q):
    return psql("-tA", "-c", f"""begin; set local role authenticated;
      select set_config('request.jwt.claims', '{{"sub":"{uid}","role":"authenticated"}}', true);
      {q}; commit;""").splitlines()[-1]


migrations = sorted(glob.glob(f"{ROOT}/supabase/migrations/*.sql"))
stage = lambda upto: [m for m in migrations if os.path.basename(m)[:14] <= upto]
applied = set()


def apply_until(upto):
    for m in stage(upto):
        if m in applied:
            continue
        psql("-1", "-f", m)
        applied.add(m)


ANA, BEN, LEA = ("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
                 "55555555-5555-4555-8555-555555555555")

psql("-c", f"drop database if exists {DB} with (force)", "-c", f"create database {DB}", db="postgres")
psql("-f", f"{ROOT}/scripts/local-db/supabase-shim.sql")

# ---- Stage 1: the baseline with live bookings and a payment -------------------
apply_until("20261201000100")
sql(f"""insert into auth.users (id, email, raw_user_meta_data) values
  ('{ANA}', 'ana@test.local', '{{"full_name":"Ana Reyes"}}'), ('{BEN}', 'ben@test.local', '{{"full_name":"Ben Cruz"}}'),
  ('{LEA}', 'lea@test.local', '{{"full_name":"Lea Navarro"}}');
  insert into public.user_roles (user_id, role) values ('{LEA}', 'admin');
  insert into public.courts (number, name, sort_order) values (1, 'Court 1', 1), (2, 'Court 2', 2);
  insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit)
  values ('court_rental', 'Test rate', 'standard', '08:00', '23:00', 25000, 'per_court_hour');""")
check("stage 1: the baseline seeds Monday to Sunday hours", sql("select count(*) from public.operating_hours") == "7")
DAY = sql("select private.operating_date_of(now()) + 2")  # worked out once: guests cannot call private helpers
slot = lambda court, h: (f"jsonb_build_array(jsonb_build_object('court_id', (select id from public.courts where number = {court}), "
                         f"'starts_at', ('{DAY}'::date::timestamp + interval '{h} hours') at time zone 'Asia/Manila'))")
ana_booking = as_user(ANA, f"select (public.confirm_booking(public.hold_slots({slot(1, 10)}))).booking_id")
ben_booking = as_user(BEN, f"select (public.confirm_booking(public.hold_slots({slot(2, 10)}))).booking_id")
sql("""update public.payment_methods set account_name = 'TEST ACCOUNT', account_number = '09000000001', is_active = true where kind = 'gcash'""")
path = f"{ANA}/{ana_booking}/receipt.png"
sql(f"insert into storage.objects (bucket_id, name, owner, owner_id) values ('payment-proofs', '{path}', '{ANA}', '{ANA}')")
method = sql("select id from public.payment_methods where kind = 'gcash'")
as_user(ANA, f"select public.submit_payment('{ana_booking}', '{method}', '{path}')")
as_user(LEA, "select public.staff_review_payment((select id from public.payments limit 1), true, null, 25000)")
before = sql("select string_agg(reference || ':' || status || ':' || payment_status || ':' || total_centavos, ',' order by reference) from public.bookings")
slots_before = sql("select string_agg(court_id || slot::text || status, ',' order by court_id) from public.booking_slots")
paid_before = sql("select string_agg(id || ':' || status || ':' || amount_centavos, ',') from public.payments")
check("stage 1: two confirmed account bookings, one paid", before.count("confirmed") == 2 and before.count(":paid:") == 1, before)

# ---- Stage 2: guest bookings on top of existing data ---------------------------
apply_until("20261201000200")
check("stage 2: bookings unchanged by the guest migration",
      sql("select string_agg(reference || ':' || status || ':' || payment_status || ':' || total_centavos, ',' order by reference) from public.bookings") == before)
check("stage 2: payments unchanged", sql("select string_agg(id || ':' || status || ':' || amount_centavos, ',') from public.payments") == paid_before)
check("stage 2: court slots unchanged",
      sql("select string_agg(court_id || slot::text || status, ',' order by court_id) from public.booking_slots") == slots_before)
check("stage 2: existing references keep their format; new ones start with PH-",
      sql("select count(*) from public.bookings where reference !~ '^PH-'") == "2")
guest = sql(f"""begin; set local role anon; select set_config('request.jwt.claims', '{{"role":"anon"}}', true);
  select reference || '|' || token from public.guest_create_booking({slot(1, 12)}, 'Upgrade Guest', '09170000001'); commit;""").splitlines()
ref, tok = [l for l in guest if '|' in l][-1].split("|")
check("stage 2: a guest can book after the upgrade", ref.startswith("PH-"), ref)
seen = sql(f"""begin; set local role anon; select set_config('request.jwt.claims', '{{"role":"anon"}}', true);
  select public.guest_get_booking('{ref}', '{tok}') ->> 'display_name'; commit;""").splitlines()
check("stage 2: the guest's manage link opens the booking", "Upgrade Guest" in seen, seen)
try:
    sql(f"""begin; set local role anon; select set_config('request.jwt.claims', '{{"role":"anon"}}', true);
      select public.guest_create_booking({slot(2, 10)}, 'Clash', '09170000002'); commit;""")
    check("stage 2: the double-booking guard still holds for an existing booking", False, "a guest took Court 2 at 10:00")
except subprocess.CalledProcessError as e:
    check("stage 2: the double-booking guard still holds for an existing booking", "just taken" in e.stderr, e.stderr[:200])

psql("-c", f"drop database if exists {DB} with (force)", db="postgres")
failed = 0
for ok, name, detail in results:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {detail}"))
    failed += 0 if ok else 1
print(f"\n# {len(results) - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
