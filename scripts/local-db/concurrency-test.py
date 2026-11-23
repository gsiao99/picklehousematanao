#!/usr/bin/env python3
"""
Concurrency test for the booking engine, using real parallel sessions.

Each worker is a separate psql connection: an anonymous guest booking through
guest_create_booking(), or (for the event races, until Phase 2) a player
account. All workers wait on a shared advisory lock held by a controller
session; when the controller lets go, they all make their call at once.

Run after scripts/local-db/run-tests.sh (which leaves dd_test migrated):
    python3 scripts/local-db/concurrency-test.py
"""
import os
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

DB = os.environ.get("TEST_DB", "dd_test")
BASE = ["psql", "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-h", os.environ.get("PGHOST", "127.0.0.1"),
        "-p", os.environ.get("PGPORT", "54322"), "-U", os.environ.get("PGUSER", "postgres"), "-d", DB]
ENV = {**os.environ, "PGOPTIONS": "-c client_min_messages=warning"}
BARRIER = 424242
results = []


def sql(statement: str) -> str:
    return subprocess.run(BASE + ["-c", statement], check=True, capture_output=True, text=True, env=ENV).stdout.strip()


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((ok, name, detail))


TEST_DAY = None  # tomorrow's operating date, worked out once (guests cannot call private helpers)


def hour(h: int) -> str:
    return f"(('{TEST_DAY}'::date::timestamp + interval '{h} hours') at time zone 'Asia/Manila')"


def slot(court: int, h: int) -> str:
    court_id = COURTS[court]
    return f"jsonb_build_object('court_id', '{court_id}'::uuid, 'starts_at', {hour(h)})"


def worker(user_id, call: str):
    """One session (a guest when user_id is None): wait at the barrier, then make the call."""
    role = "anon" if user_id is None else "authenticated"
    claims = '{"role":"anon"}' if user_id is None else f'{{"sub":"{user_id}","role":"authenticated"}}'
    script = f"""
begin;
set local role {role};
select set_config('request.jwt.claims', '{claims}', true);
select pg_advisory_xact_lock_shared({BARRIER});
select {call};
commit;
"""
    p = subprocess.run(BASE + ["-c", script], capture_output=True, text=True, env=ENV)
    return p.returncode == 0, (p.stderr or p.stdout).strip()


def race(calls):
    """Start every call at once behind the barrier; return [(ok, output)]."""
    controller = subprocess.Popen(BASE + ["-c", f"select pg_advisory_lock({BARRIER}); select pg_sleep(2);"],
                                  env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.4)
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        futures = [pool.submit(worker, u, c) for u, c in calls]
        out = [f.result() for f in futures]
    controller.wait()
    return out


def book(slots, i: int) -> str:
    """A guest booking call; i picks a distinct mobile number."""
    return f"(public.guest_create_booking(jsonb_build_array({','.join(slots)}), 'Racer {i}', '0917{i:07d}')).reference"


def live_holders(court: int, h: int) -> int:
    return int(sql(f"""select count(*) from public.booking_slots s
      where s.court_id = (select id from public.courts where number = {court})
        and s.slot && tstzrange({hour(h)}, {hour(h)} + interval '1 hour')
        and s.status not in ('released', 'cancelled')"""))


# ---------------------------------------------------------------------------
# Fixtures (committed; removed at the end)
# ---------------------------------------------------------------------------
users = [str(uuid.uuid4()) for _ in range(20)]
values = ",".join(f"('{u}', 'racer{i}@test.local', '{{\"full_name\":\"Racer {i}\"}}')" for i, u in enumerate(users))
sql(f"insert into auth.users (id, email, raw_user_meta_data) values {values}")
# Event races (F-H) still use player accounts until Phase 2.
sql("insert into public.user_roles (user_id, role) select id, 'player' from auth.users where email like 'racer%@test.local'")
sql("insert into public.courts (number, name, sort_order) values (1, 'Court 1', 1), (2, 'Court 2', 2), (3, 'Court 3', 3)")
COURTS = dict((int(n), i) for n, i in (row.split("|") for row in sql("select number, id from public.courts").splitlines()))
TEST_DAY = sql("select private.operating_date_of(now()) + 1")
sql("delete from public.operating_hours; insert into public.operating_hours (weekday, opens_at, closes_at) "
    "select d, '06:00', '01:00' from generate_series(0, 6) d")
sql("delete from public.rate_rules; insert into public.rate_rules (product, label, starts_at, ends_at, price_centavos, unit) "
    "values ('court_rental', 'Concurrency test rate', '06:00', '01:00', 10000, 'per_court_hour')")
sql("update public.venue_settings set max_slots_per_booking = 20, guest_bookings_per_hour = 100")

try:
    # A. 20 guests, the same slot, the same instant
    out = race([(None, book([slot(1, 14)], i)) for i in range(20)])
    wins = sum(ok for ok, _ in out)
    taken = sum("was just taken" in msg for ok, msg in out if not ok)
    check("A. 20 simultaneous bookings of one slot: exactly one succeeds", wins == 1, f"{wins} succeeded")
    check("A. the other 19 get the 'just taken' message", taken == 19,
          f"{taken} got it; others: " + " || ".join(m for ok, m in out if not ok and "was just taken" not in m)[:1500])
    check("A. the database holds exactly one live slot", live_holders(1, 14) == 1)

    # B. 20 guests, 20 different slots, the same instant
    pairs = [(c, h) for c in (1, 2, 3) for h in range(15, 22)][:20]
    out = race([(None, book([slot(c, h)], 100 + i)) for i, (c, h) in enumerate(pairs)])
    check("B. 20 simultaneous bookings of different slots all succeed", all(ok for ok, _ in out),
          "; ".join(m for ok, m in out if not ok)[:300])

    # C. Overlapping multi-slot requests in opposite orders (deadlock bait)
    reqs = []
    for i in range(10):
        hours = [8, 9, 10, 11] if i % 2 == 0 else [11, 10, 9, 8]
        reqs.append((None, book([slot(2, h) for h in hours], 200 + i)))
    out = race(reqs)
    wins = sum(ok for ok, _ in out)
    deadlocks = sum("deadlock" in m for ok, m in out if not ok)
    check("C. overlapping multi-slot requests: exactly one wins all four hours", wins == 1, f"{wins} succeeded")
    check("C. no deadlocks", deadlocks == 0, f"{deadlocks} deadlocks: " + " || ".join(m for ok, m in out if not ok and "deadlock" in m)[:1500])
    check("C. each of those hours has exactly one live holder",
          all(live_holders(2, h) == 1 for h in (8, 9, 10, 11)))

    # D. One mobile number, five parallel bookings, a limit of three per hour
    sql("update public.venue_settings set guest_bookings_per_hour = 3")
    out = race([(None, book([slot(3, h)], 300)) for h in (8, 9, 10, 11, 12)])
    wins = sum(ok for ok, _ in out)
    limited = sum("Too many bookings" in m for ok, m in out if not ok)
    check("D. the per-number limit holds under parallel requests (3 of 5)", wins == 3 and limited == 2,
          f"{wins} succeeded, {limited} limited; " + "; ".join(m for ok, m in out if not ok)[:200])
    sql("update public.venue_settings set guest_bookings_per_hour = 100")

    # E. Two cancellations of the same booking at once: exactly one goes through
    sql("create table if not exists public.race_tokens (reference text, token text); grant all on public.race_tokens to anon")
    sql("insert into public.race_tokens select reference, token from public.guest_create_booking("
        f"jsonb_build_array({slot(1, 23)}), 'Racer E', '09170000400')")
    ref, tok = sql("select reference || '|' || token from public.race_tokens limit 1").split("|")
    out = race([(None, f"public.guest_cancel_booking('{ref}', '{tok}') ->> 'status'")] * 2)
    wins = sum(ok for ok, _ in out)
    again = sum("already cancelled" in m for ok, m in out if not ok)
    check("E. two simultaneous cancellations: one succeeds, the other is told it is already cancelled",
          wins == 1 and again == 1, "; ".join(m for _, m in out)[:200])
    check("E. the cancelled hour is free", live_holders(1, 23) == 0)
    sql("drop table public.race_tokens")

    # F. Capacity under a rush (player accounts until Phase 2): 12 players register for 3 places at once
    sql("insert into public.events (id, slug, title, event_type, starts_at, ends_at, capacity, status) values "
        "('f0000000-0000-4000-8000-000000000001', 'race-night', 'Race Night', 'social', now() + interval '2 days', "
        "now() + interval '2 days 2 hours', 3, 'registration_open')")
    out = race([(u, "(public.register_for_event('f0000000-0000-4000-8000-000000000001')).status") for u in users[:12]])
    wins = sum(ok for ok, _ in out)
    full = sum("is full" in m for ok, m in out if not ok)
    taken = int(sql("select count(*) from public.event_registrations where event_id = 'f0000000-0000-4000-8000-000000000001' "
                    "and status in ('pending', 'confirmed')"))
    check("F. 12 simultaneous registrations for 3 places: exactly 3 succeed", wins == 3 and taken == 3, f"{wins} ok, {taken} stored")
    check("F. the other 9 are told the event is full", full == 9, "; ".join(m for ok, m in out if not ok)[:200])

    # G. One player taps Register five times at once
    sql("insert into public.events (id, slug, title, event_type, starts_at, ends_at, status) values "
        "('f0000000-0000-4000-8000-000000000002', 'race-night-2', 'Race Night 2', 'social', now() + interval '2 days', "
        "now() + interval '2 days 2 hours', 'registration_open')")
    me = users[15]
    out = race([(me, "(public.register_for_event('f0000000-0000-4000-8000-000000000002')).status")] * 5)
    stored = int(sql(f"select count(*) from public.event_registrations where player_id = '{me}' "
                     "and status in ('pending', 'confirmed', 'waitlisted')"))
    dupes = sum("already registered" in m for ok, m in out if not ok)
    check("G. five simultaneous registrations by one player store exactly one", stored == 1, f"{stored} stored")
    check("G. the other four are told they are already registered", dupes == 4,
          "; ".join(m for ok, m in out if not ok)[:200])

    # H. One checked-in player taps "Join the queue" five times at once
    sql("insert into public.events (id, slug, title, event_type, starts_at, ends_at, status) values "
        "('f0000000-0000-4000-8000-000000000003', 'race-night-3', 'Race Open Play', 'open_play', now() - interval '10 minutes', "
        "now() + interval '2 hours', 'ongoing')")
    sql(f"insert into public.event_registrations (event_id, player_id, status, attendance) values "
        f"('f0000000-0000-4000-8000-000000000003', '{me}', 'confirmed', 'present')")
    out = race([(me, "public.join_queue('f0000000-0000-4000-8000-000000000003')")] * 5)
    active = int(sql(f"select count(*) from public.queue_entries where player_id = '{me}' "
                     "and status in ('waiting', 'called', 'playing')"))
    check("H. five simultaneous queue joins by one player leave exactly one active entry", active == 1,
          f"{active} active; " + "; ".join(m for ok, m in out if not ok)[:200])
    check("H. the other four are told they are already in the queue", sum("already in the queue" in m for ok, m in out if not ok) == 4,
          "; ".join(m for ok, m in out if not ok)[:200])
finally:
    sql("delete from public.queue_entries; delete from public.queue_games; delete from public.check_ins; ")
    sql("delete from public.event_registrations; delete from public.events where slug like 'race-night%'; ")
    sql("delete from public.booking_slots; delete from public.bookings; delete from public.rate_rules; "
        "delete from public.operating_hours; update public.venue_settings set max_slots_per_booking = 8, guest_bookings_per_hour = 10")
    sql("delete from public.courts")
    ids = ",".join(f"'{u}'" for u in users)
    sql(f"delete from auth.users where id in ({ids})")

failed = 0
for ok, name, detail in results:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {detail}"))
    failed += 0 if ok else 1
print(f"\n# {len(results) - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
