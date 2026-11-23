#!/usr/bin/env python3
"""
Concurrency test for the booking engine, using real parallel sessions.

Each worker is a separate psql connection acting as a different player. All
workers wait on a shared advisory lock held by a controller session; when the
controller lets go, they all call hold_slots() at the same moment.

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


def hour(h: int) -> str:
    return f"(((private.operating_date_of(now()) + 1)::timestamp + interval '{h} hours') at time zone 'Asia/Manila')"


def slot(court: int, h: int) -> str:
    return f"jsonb_build_object('court_id', (select id from public.courts where number = {court}), 'starts_at', {hour(h)})"


def worker(user_id: str, call: str):
    """One player session: wait at the barrier, then make the call."""
    script = f"""
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{{"sub":"{user_id}","role":"authenticated"}}', true);
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
sql("delete from public.operating_hours; insert into public.operating_hours (weekday, opens_at, closes_at) "
    "select d, '06:00', '01:00' from generate_series(0, 6) d")
sql("delete from public.rate_rules; insert into public.rate_rules (product, label, starts_at, ends_at, price_centavos, unit) "
    "values ('court_rental', 'Concurrency test rate', '06:00', '01:00', 10000, 'per_court_hour')")
sql("update public.venue_settings set max_slots_per_booking = 20")

try:
    # A. 20 players, the same slot, the same instant
    out = race([(u, f"public.hold_slots(jsonb_build_array({slot(1, 14)}))") for u in users])
    wins = sum(ok for ok, _ in out)
    taken = sum("was just taken" in msg for ok, msg in out if not ok)
    check("A. 20 simultaneous holds on one slot: exactly one succeeds", wins == 1, f"{wins} succeeded")
    check("A. the other 19 get the 'just taken' message", taken == 19, f"{taken} got it; sample: {out[0][1][:160]}")
    check("A. the database holds exactly one live slot", live_holders(1, 14) == 1)

    # B. 20 players, 20 different slots, the same instant
    pairs = [(c, h) for c in (1, 2, 3) for h in range(15, 22)][:20]
    out = race([(u, f"public.hold_slots(jsonb_build_array({slot(c, h)}))") for u, (c, h) in zip(users, pairs)])
    check("B. 20 simultaneous holds on different slots all succeed", all(ok for ok, _ in out),
          "; ".join(m for ok, m in out if not ok)[:300])

    # C. Overlapping multi-slot requests in opposite orders (deadlock bait)
    reqs = []
    for i, u in enumerate(users[:10]):
        hours = [8, 9, 10, 11] if i % 2 == 0 else [11, 10, 9, 8]
        reqs.append((u, "public.hold_slots(jsonb_build_array(" + ",".join(slot(2, h) for h in hours) + "))"))
    out = race(reqs)
    wins = sum(ok for ok, _ in out)
    deadlocks = sum("deadlock" in m for ok, m in out if not ok)
    check("C. overlapping multi-slot requests: exactly one wins all four hours", wins == 1, f"{wins} succeeded")
    check("C. no deadlocks", deadlocks == 0, f"{deadlocks} deadlocks")
    check("C. each of those hours has exactly one live holder",
          all(live_holders(2, h) == 1 for h in (8, 9, 10, 11)))

    # D. One player, five parallel requests: one cart, five slots
    me = users[19]
    out = race([(me, f"public.hold_slots(jsonb_build_array({slot(3, h)}))") for h in (8, 9, 10, 11, 12)])
    carts = int(sql(f"select count(*) from public.bookings where player_id = '{me}' and status = 'held'"))
    slots = int(sql(f"select count(*) from public.booking_slots s join public.bookings b on b.id = s.booking_id "
                    f"where b.player_id = '{me}' and b.status = 'held' and s.status = 'held'"))
    check("D. parallel requests from one player all succeed", all(ok for ok, _ in out),
          "; ".join(m for ok, m in out if not ok)[:300])
    check("D. they land in a single cart", carts == 1, f"{carts} carts, {slots} slots")

    # E. Confirm racing against expiry: an expired hold cannot be confirmed
    sql(f"update public.bookings set hold_expires_at = now() - interval '1 second' "
        f"where player_id = '{me}' and status = 'held'")
    booking = sql(f"select id from public.bookings where player_id = '{me}' and status = 'held'")
    out = race([(me, f"(public.confirm_booking('{booking}')).status")] +
               [(u, f"public.hold_slots(jsonb_build_array({slot(3, 8)}))") for u in users[10:14]])
    confirm_status = out[0][1].splitlines()[-1] if out[0][0] else out[0][1]
    takers = sum(ok for ok, _ in out[1:])
    check("E. confirming an expired hold reports 'expired'", "expired" in confirm_status, confirm_status[:160])
    check("E. exactly one other player gets the released time", takers == 1, f"{takers} succeeded")
    check("E. the released hour has exactly one live holder", live_holders(3, 8) == 1)
    # F. Capacity under a rush: 12 players register for 3 places at once
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
        "delete from public.operating_hours; update public.venue_settings set max_slots_per_booking = 8")
    ids = ",".join(f"'{u}'" for u in users)
    sql(f"delete from auth.users where id in ({ids})")

failed = 0
for ok, name, detail in results:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {detail}"))
    failed += 0 if ok else 1
print(f"\n# {len(results) - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
