#!/usr/bin/env python3
"""
LOCAL TEST ONLY — migration upgrade-path test on a throwaway database.

Production will receive the migrations in stages, with real rows already in
the tables. This applies them the same way: up to Phase 3, add bookings; then
Phase 4, add a payment; then Phase 5, add an event entry. After each stage it
checks that existing rows survived unchanged and that the new features work
on top of them. Each migration runs in one transaction, like `supabase db push`.

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

# ---- Stage 1: Phase 2–3 schema with live bookings ---------------------------
apply_until("20261011001000")
sql(f"""insert into auth.users (id, email, raw_user_meta_data) values
  ('{ANA}', 'ana@test.local', '{{"full_name":"Ana Reyes"}}'), ('{BEN}', 'ben@test.local', '{{"full_name":"Ben Cruz"}}'),
  ('{LEA}', 'lea@test.local', '{{"full_name":"Lea Navarro"}}');
  insert into public.user_roles (user_id, role) values ('{LEA}', 'admin');
  insert into public.operating_hours (weekday, opens_at, closes_at) select d, '06:00', '23:00' from generate_series(0, 6) d;
  insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit)
  values ('court_rental', 'Test rate', 'off_peak', '06:00', '23:00', 25000, 'per_court_hour');""")
slot = lambda court, h: (f"jsonb_build_array(jsonb_build_object('court_id', (select id from public.courts where number = {court}), "
                         f"'starts_at', ((private.operating_date_of(now()) + 2)::timestamp + interval '{h} hours') at time zone 'Asia/Manila'))")
ana_booking = as_user(ANA, f"select (public.confirm_booking(public.hold_slots({slot(1, 10)}))).booking_id")
ben_booking = as_user(BEN, f"select (public.confirm_booking(public.hold_slots({slot(2, 10)}))).booking_id")
before = sql("select string_agg(reference || ':' || status || ':' || total_centavos, ',' order by reference) from public.bookings")
slots_before = sql("select string_agg(court_id || slot::text || status, ',' order by court_id) from public.booking_slots")
check("stage 1: two confirmed bookings exist before the Phase 4 migrations", before.count("confirmed") == 2, before)

# ---- Stage 2: Phase 4 (payments) on top of existing bookings ----------------
apply_until("20261011001100")
check("stage 2: bookings unchanged by the Phase 4 migrations",
      sql("select string_agg(reference || ':' || status || ':' || total_centavos, ',' order by reference) from public.bookings") == before)
check("stage 2: existing bookings start as unpaid with no deadline",
      sql("select count(*) from public.bookings where payment_status = 'unpaid' and payment_due_at is null") == "2")
sql("""insert into public.payment_methods (kind, label, account_name, account_number, is_active)
       values ('gcash', 'GCash', 'TEST ACCOUNT', '09000000001', true)""")
path = f"{ANA}/{ana_booking}/receipt.png"
as_user(ANA, f"insert into storage.objects (bucket_id, name, owner, owner_id) values ('payment-proofs', '{path}', '{ANA}', '{ANA}') returning 1")
method = sql("select id from public.payment_methods limit 1")  # players cannot list methods directly
as_user(ANA, f"select public.submit_payment('{ana_booking}', '{method}', '{path}')")
as_user(LEA, f"select public.staff_review_payment((select id from public.payments limit 1), true)")
check("stage 2: a payment can be submitted and approved on a pre-existing booking",
      sql(f"select status || '/' || payment_status from public.bookings where id = '{ana_booking}'") == "confirmed/paid")
check("stage 2: court slots unchanged",
      sql("select string_agg(court_id || slot::text || status, ',' order by court_id) from public.booking_slots") == slots_before)
paid_before = sql("select string_agg(id || ':' || status || ':' || amount_centavos, ',') from public.payments")

# ---- Stage 3: Phase 5 (community) on top of bookings and payments -----------
apply_until("99999999999999")
check("stage 3: bookings unchanged by the Phase 5 migrations",
      sql("select string_agg(reference || ':' || status || ':' || total_centavos, ',' order by reference) from public.bookings") == before)
check("stage 3: payments unchanged", sql("select string_agg(id || ':' || status || ':' || amount_centavos, ',') from public.payments") == paid_before)
check("stage 3: court slots unchanged",
      sql("select string_agg(court_id || slot::text || status, ',' order by court_id) from public.booking_slots") == slots_before)
check("stage 3: notifications from Phase 4 survive the new kind constraint",
      sql("select count(*) from public.notifications where kind in ('payment_submitted', 'payment_approved')") != "0")
sql("""insert into public.events (slug, title, event_type, starts_at, ends_at, capacity, status)
       values ('upgrade-social', 'Upgrade Social', 'social', now() + interval '3 days', now() + interval '3 days 2 hours', 2, 'registration_open')""")
r = as_user(BEN, "select (public.register_for_event((select id from public.events where slug = 'upgrade-social'))).status")
check("stage 3: event registration works after the upgrade", r == "confirmed", r)
try:
    as_user(ANA, f"select public.hold_slots({slot(2, 10)})")
    check("stage 3: the double-booking guard still holds after all upgrades", False, "second hold on Court 2 succeeded")
except subprocess.CalledProcessError as e:
    check("stage 3: the double-booking guard still holds after all upgrades", "just taken" in e.stderr, e.stderr[:200])

psql("-c", f"drop database if exists {DB} with (force)", db="postgres")
failed = 0
for ok, name, detail in results:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {detail}"))
    failed += 0 if ok else 1
print(f"\n# {len(results) - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
