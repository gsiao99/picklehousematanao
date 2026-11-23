"""
End-to-end Phase 5 test: open play, tournaments, registrations, Who's Playing,
attendance, the paddle queue, matches and standings, the live court view and
the player pages — the real app against the real local test database through
the local API stand-in (requests run as the signed-in user, so RLS applies).

  scripts/e2e/setup_local.sh /tmp/dd-e2e
  python3 scripts/e2e/community_local.py /tmp/dd-e2e

Hours, rates, events and extra players are TEST VALUES, not the club's.
Realtime is not emulated, so pages are reloaded where a live update would occur.
"""
import asyncio
import datetime as dt
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request

from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/dd-e2e"
APP = "http://localhost:4175"
API = "http://127.0.0.1:54321"
PASSWORD = "courts2026"
PSQL = ["psql", "-X", "-q", "-tA", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "dd_test", "-c"]
MANILA = dt.timezone(dt.timedelta(hours=8))
BEN = "22222222-2222-4222-8222-222222222222"
EXTRA = [  # extra test players for a full queue
    ("a1000000-0000-4000-8000-000000000001", "hal.uy@test.local", "Hal Uy"),
    ("a1000000-0000-4000-8000-000000000002", "ivy.lim@test.local", "Ivy Lim"),
    ("a1000000-0000-4000-8000-000000000003", "joe.tan@test.local", "Joe Tan"),
    ("a1000000-0000-4000-8000-000000000004", "kim.go@test.local", "Kim Go"),
]
results, errors = [], []


def check(name, ok, detail=""):
    results.append((bool(ok), name, detail))


def sql(q):
    return subprocess.run(PSQL + [q], check=True, capture_output=True, text=True).stdout.strip()


def api(method, path, body=None, token=None):
    headers = {"apikey": "sb_publishable_localtest", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def token_for(email):
    status, body = api("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": PASSWORD})
    assert status == 200, body
    return body["access_token"]


def local(d: dt.datetime) -> str:
    """datetime → value for <input type=datetime-local> in Manila time."""
    return d.astimezone(MANILA).strftime("%Y-%m-%dT%H:%M")


async def login(browser, email, width=1280):
    ctx = await browser.new_context(viewport={"width": width, "height": 900})
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"{email}: {e}"))
    # Anything the production Content-Security-Policy blocks is a failure too.
    page.on("console", lambda m: errors.append(f"{email}: {m.text}") if "Content Security Policy" in m.text else None)
    page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    await page.goto(f"{APP}/login", wait_until="networkidle")
    await page.fill("input[name=email]", email)
    await page.fill("input[name=password]", PASSWORD)
    await page.click("button[type=submit]")
    await page.wait_for_url(re.compile(r"/(player/dashboard|admin)$"), timeout=15000)
    return page


async def no_sideways_scroll(page, width):
    return await page.evaluate("document.documentElement.scrollWidth") <= width


async def main():
    # ---- Test fixtures (SQL): hours and a rate for rentals, four extra players ----
    sql("insert into public.operating_hours (weekday, opens_at, closes_at) select d, '05:00', '04:00' from generate_series(0, 6) d "
        "on conflict (weekday) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at, is_closed = false")
    sql("delete from public.rate_rules; insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit) "
        "values ('court_rental', 'Test rate', 'off_peak', '05:00', '04:00', 25000, 'per_court_hour')")
    values = ",".join(f"('{i}', '{e}', '{{\"full_name\":\"{n}\"}}')" for i, e, n in EXTRA)
    sql(f"insert into auth.users (id, email, raw_user_meta_data) values {values} on conflict do nothing")
    sql("update public.profiles set self_rated_level = 'advanced' where id = '11111111-1111-4111-8111-111111111111'")

    now = dt.datetime.now(MANILA)
    tomorrow = (now + dt.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    op_start = (now - dt.timedelta(minutes=30)).replace(second=0, microsecond=0)
    op_end = op_start + dt.timedelta(hours=4)

    # Ben rents Court 3 tomorrow at 10:00 (a court the tournament will then not get)
    sql(f"""begin; set local role authenticated;
      select set_config('request.jwt.claims', '{{"sub":"{BEN}","role":"authenticated"}}', true);
      select (public.confirm_booking(public.hold_slots(jsonb_build_array(jsonb_build_object(
        'court_id', (select id from public.courts where number = 3), 'starts_at', '{(tomorrow + dt.timedelta(hours=1)).isoformat()}'))))).status;
      commit;""")

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        lea = await login(browser, "lea.navarro@test.local")

        # ---- Categories and a tournament, through the staff screens ----------
        await lea.goto(f"{APP}/admin/events", wait_until="networkidle")
        for cat in ("Mixed Doubles", "Singles"):
            await lea.get_by_label("New category").fill(cat)
            await lea.get_by_role("button", name="Add category").click()
            await lea.wait_for_selector(f"text={cat} added.")
        check("admin: custom categories saved", sql("select count(*) from public.event_categories") == "2")

        await lea.get_by_role("button", name="New session or event").click()
        form = lea.get_by_role("region", name="New session or event")
        await form.get_by_label("Type").select_option("tournament")
        await form.get_by_label("Title").fill("Test Cup")
        await form.get_by_label("Starts").fill(local(tomorrow))
        await form.get_by_label("Ends").fill(local(tomorrow + dt.timedelta(hours=8)))
        await form.get_by_role("button", name="Create").click()
        await lea.wait_for_url(re.compile(r"/admin/events/[0-9a-f-]{36}"))
        cup_url = lea.url
        cup = sql("select id from public.events where title = 'Test Cup'")
        check("admin: tournament created and opened for registration",
              sql(f"select status from public.events where id = '{cup}'") == "registration_open")

        await lea.get_by_role("tab", name="Setup").click()
        divisions = lea.get_by_role("region", name="Divisions")
        for name, cat, size, cap in (("Mixed Doubles Open", "Mixed Doubles", "2", "2"), ("Singles Open", "Singles", "1", "4")):
            await divisions.get_by_role("button", name="Add division").click()
            await divisions.get_by_label("Category", exact=True).select_option(label=cat)
            await divisions.get_by_label("Division name").fill(name)
            await divisions.get_by_label("Players per entry").select_option(size)
            await divisions.get_by_label("Entries (optional)").fill(cap)
            await divisions.get_by_role("button", name="Save division").click()
            await lea.wait_for_selector(f"text={name} saved.")
        check("admin: two divisions with their own categories",
              sql(f"select string_agg(d.name || '/' || c.name, ',' order by d.name) from public.event_divisions d "
                  f"join public.event_categories c on c.id = d.category_id where d.event_id = '{cup}'")
              == "Mixed Doubles Open/Mixed Doubles,Singles Open/Singles")

        courts = lea.get_by_role("region", name="Courts")
        for n in (1, 2, 3):
            await courts.get_by_label(f"Court {n}", exact=True).check()
        await courts.get_by_role("button", name="Reserve 3 courts").click()
        await courts.get_by_role("alert").wait_for()
        alert = await courts.get_by_role("alert").text_content()
        check("court conflict: the tournament cannot take Court 3 while Ben's rental is on it",
              "Court 3 is already taken" in alert, alert)
        check("court conflict: nothing was reserved (all or nothing)",
              sql(f"select count(*) from public.booking_slots where event_id = '{cup}'") == "0")
        await courts.get_by_label("Court 3", exact=True).uncheck()
        await courts.get_by_role("button", name="Reserve 2 courts").click()
        await lea.wait_for_selector("text=Courts reserved for this event.")
        check("admin: Courts 1 and 2 reserved for the tournament",
              sql(f"select count(*) from public.booking_slots where event_id = '{cup}' and kind = 'event'") == "2")
        ben_token = token_for("ben.cruz@test.local")
        day = tomorrow.strftime("%Y-%m-%d")
        status, avail = api("POST", "/rest/v1/rpc/get_court_availability", {"_date": day}, token=ben_token)
        at10 = {r["court_number"]: r["status"] for r in avail if r["starts_at"].startswith((tomorrow + dt.timedelta(hours=1)).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H"))}
        check("booking grid: tournament courts show as taken to players", at10.get(1) == "event" and at10.get(2) == "event", at10)

        # ---- Players register; the registration records the chosen category ----
        ana = await login(browser, "ana.reyes@test.local", width=390)
        await ana.goto(f"{APP}/events", wait_until="networkidle")
        await ana.get_by_role("link", name=re.compile("Test Cup")).click()
        await ana.wait_for_selector("text=Register")
        await ana.get_by_label("Division", exact=True).select_option(label="Singles Open · Singles")
        await ana.get_by_role("button", name="Register", exact=True).click()
        await ana.wait_for_selector("text=You’re in")
        ana_token = token_for("ana.reyes@test.local")
        singles = sql(f"select id from public.event_divisions where event_id = '{cup}' and name = 'Singles Open'")
        status, body = api("POST", "/rest/v1/rpc/register_for_event", {"_event_id": cup, "_division_id": singles}, token=ana_token)
        check("duplicates: registering again for the same division is refused", status in (400, 409) and "already" in body.get("message", ""), body)
        mixed = sql(f"select id from public.event_divisions where event_id = '{cup}' and name = 'Mixed Doubles Open'")
        status, body = api("POST", "/rest/v1/rpc/register_for_event",
                           {"_event_id": cup, "_division_id": mixed, "_partner_email": "ana.reyes@test.local"}, token=ben_token)
        check("doubles: Ben enters Mixed Doubles with Ana as partner", status == 200, body)
        hal_token = token_for("hal.uy@test.local")
        status, body = api("POST", "/rest/v1/rpc/register_for_event",
                           {"_event_id": cup, "_division_id": mixed, "_partner_email": "ana.reyes@test.local"}, token=hal_token)
        check("duplicates: a partner already entered in the division cannot be entered again", status in (400, 409), body)

        await ana.reload(wait_until="networkidle")
        panel = ana.get_by_role("region", name="Who’s playing")
        await panel.wait_for()
        text = await panel.inner_text()
        check("Who's Playing: shows each entry's registered category", "Mixed Doubles" in text and "Singles" in text, text)
        check("Who's Playing: does not show a profile skill level", "Advanced" not in text, text)
        stored = sql(f"select string_agg(c.name, ',' order by c.name) from public.event_registrations r "
                     f"join public.event_categories c on c.id = r.category_id where r.event_id = '{cup}' and r.status = 'confirmed'")
        check("database: each registration stores its category", stored == "Mixed Doubles,Singles", stored)
        check("player: no sideways scrolling on the event page (phone)", await no_sideways_scroll(ana, 390))

        # ---- Open play session with a capacity, check-in and the paddle queue ----
        await lea.goto(f"{APP}/admin/events", wait_until="networkidle")
        await lea.get_by_role("button", name="New session or event").click()
        form = lea.get_by_role("region", name="New session or event")
        await form.get_by_label("Title").fill("Test Open Play")
        await form.get_by_label("Starts").fill(local(op_start))
        await form.get_by_label("Ends").fill(local(op_end))
        await form.get_by_label("Places (players)").fill("5")
        await form.get_by_role("button", name="Create").click()
        await lea.wait_for_url(re.compile(r"/admin/events/[0-9a-f-]{36}"))
        op_url = lea.url
        op = sql("select id from public.events where title = 'Test Open Play'")
        await lea.goto(f"{op_url}?tab=setup", wait_until="networkidle")
        courts = lea.get_by_role("region", name="Courts")
        await courts.get_by_label("Court 3", exact=True).check()
        await courts.get_by_role("button", name="Reserve court").click()
        await lea.wait_for_selector("text=Courts reserved for this event.")
        # The session is under way, so online registration is closed; staff add walk-ins at the desk.
        await lea.goto(op_url, wait_until="networkidle")
        add_panel = lea.get_by_role("region", name="Add a player")
        await add_panel.get_by_label("Player").fill("Ana")
        await add_panel.get_by_role("button", name="Find").click()
        await add_panel.get_by_role("button", name=re.compile("^Ana Reyes")).click()
        await add_panel.get_by_role("button", name="Add to event").click()
        await lea.wait_for_selector("text=Ana Reyes added.")
        lea_token = token_for("lea.navarro@test.local")
        for pid in [x[0] for x in EXTRA[:3]] + [BEN]:
            status, body = api("POST", "/rest/v1/rpc/staff_register_player", {"_event_id": op, "_player_id": pid}, token=lea_token)
            assert status == 200, body
        status, body = api("POST", "/rest/v1/rpc/staff_register_player", {"_event_id": op, "_player_id": BEN}, token=lea_token)
        check("duplicates: staff cannot add the same player twice", status in (400, 409) and "already" in body.get("message", ""), body)
        status, body = api("POST", "/rest/v1/rpc/staff_register_player", {"_event_id": op, "_player_id": EXTRA[3][0]}, token=lea_token)
        check("capacity: a sixth player is refused when 5 places are taken", status == 400 and "full" in body.get("message", ""), body)
        check("capacity: five places taken, never more",
              sql(f"select count(*) from public.event_registrations where event_id = '{op}' and status = 'confirmed'") == "5")
        kim = await login(browser, "kim.go@test.local", width=390)
        await kim.goto(f"{APP}/events?type=open_play", wait_until="networkidle")
        await kim.get_by_role("link", name=re.compile("Test Open Play")).click()
        await kim.wait_for_selector("text=0 of 5 left")
        check("capacity: a full session shows no places left and no Register button",
              await kim.get_by_role("button", name="Register", exact=True).count() == 0)
        status, body = api("POST", "/rest/v1/rpc/register_for_event", {"_event_id": op}, token=token_for("kim.go@test.local"))
        check("deadline: online registration is closed once a session has started", status == 400 and "closed" in body.get("message", ""), body)

        await lea.goto(op_url, wait_until="networkidle")
        regs = lea.get_by_role("region", name="Registrations and attendance")
        await regs.get_by_role("button", name="Check in").first.wait_for()
        for i in range(5):
            await regs.get_by_role("button", name="Check in").first.click()
            # Wait for the list to refresh (one fewer "Check in" button); no eval, so it works under the CSP
            for _ in range(50):
                if await regs.get_by_role("button", name="Check in").count() == 4 - i:
                    break
                await lea.wait_for_timeout(100)
        check("attendance: five players checked in",
              sql(f"select count(*) from public.event_registrations where event_id = '{op}' and attendance = 'present'") == "5"
              and sql(f"select count(*) from public.check_ins where event_id = '{op}'") == "5")

        op_slug = sql(f"select slug from public.events where id = '{op}'")
        await ana.goto(f"{APP}/events/{op_slug}", wait_until="networkidle")
        await ana.get_by_role("button", name="Join the queue").click()
        await ana.wait_for_selector("text=in line")
        check("queue: Ana joins and sees her place", await ana.get_by_text("#1").count() >= 1)
        status, body = api("POST", "/rest/v1/rpc/join_queue", {"_event_id": op}, token=ana_token)
        check("queue: a second active entry for the same player is refused", status in (400, 409) and "already in the queue" in body.get("message", ""), body)

        await lea.goto(f"{op_url}?tab=queue", wait_until="networkidle")
        add = lea.get_by_label("Add a checked-in player")
        for _, _, name in EXTRA[:3]:
            await add.select_option(label=name)
            await lea.get_by_role("button", name="Add to queue").click()
            await lea.wait_for_selector(f"text={name} added to the queue.")
        await add.select_option(label="Ben Cruz")
        await lea.get_by_role("button", name="Add to queue").click()
        await lea.wait_for_selector("text=Ben Cruz added to the queue.")
        check("queue: five players waiting in join order",
              sql(f"select count(*) from public.queue_entries where event_id = '{op}' and status = 'waiting'") == "5")
        court3 = lea.locator('[aria-label="Court 3 queue game"]')
        await court3.get_by_role("button", name="Call next 4").click()
        await lea.wait_for_selector("text=Next 4 players called to Court 3.")
        called = sql(f"select string_agg(p.full_name, ',' order by q.queued_at) from public.queue_entries q join public.profiles p on p.id = q.player_id "
                     f"where q.event_id = '{op}' and q.status = 'called'")
        check("queue: the first four in line are called (waiting → called)", called == "Ana Reyes,Hal Uy,Ivy Lim,Joe Tan", called)
        await court3.get_by_role("button", name="No-show").first.click()
        await lea.wait_for_selector("text=marked no-show; next player called.")
        called = sql(f"select string_agg(p.full_name, ',' order by p.full_name) from public.queue_entries q join public.profiles p on p.id = q.player_id "
                     f"where q.event_id = '{op}' and q.status = 'called'")
        check("queue: a no-show is replaced by the next waiting player", called == "Ben Cruz,Hal Uy,Ivy Lim,Joe Tan", called)
        check("queue: the no-show is recorded and Ana goes to the back of the queue",
              sql(f"select count(*) from public.queue_entries q where q.event_id = '{op}' and q.status = 'no_show'") == "1"
              and sql(f"select count(*) from public.queue_entries q where q.event_id = '{op}' and q.status = 'waiting' "
                      "and q.player_id = '11111111-1111-4111-8111-111111111111'") == "1")
        await court3.get_by_role("button", name="Start game").click()
        await lea.wait_for_selector("text=Game started.")
        check("queue: called → playing",
              sql(f"select count(*) from public.queue_entries where event_id = '{op}' and status = 'playing'") == "4")

        await ana.goto(f"{APP}/live", wait_until="networkidle")
        live = await ana.get_by_text(re.compile("Test Open Play")).first.text_content()
        check("live court view: Court 3 shows the open-play game in progress", "game in progress" in live, live)

        await court3.get_by_role("button", name="Game finished").click()
        await lea.wait_for_selector("text=Game finished; players are back in the queue.")
        check("queue: playing → completed, and the four rejoin at the back",
              sql(f"select count(*) from public.queue_entries where event_id = '{op}' and status = 'completed'") == "4"
              and sql(f"select count(*) from public.queue_entries where event_id = '{op}' and status = 'waiting'") == "5")
        first = sql(f"select p.full_name from public.queue_entries q join public.profiles p on p.id = q.player_id "
                    f"where q.event_id = '{op}' and q.status = 'waiting' order by q.queued_at limit 1")
        check("queue: Ana (re-queued after her no-show) is now first in line", first == "Ana Reyes", first)

        # ---- Matches, results and standings ---------------------------------
        await lea.goto(cup_url, wait_until="networkidle")
        add_panel = lea.get_by_role("region", name="Add a player")
        await add_panel.get_by_label("Division", exact=True).select_option(label="Singles Open")
        await add_panel.get_by_label("Player").fill("Hal")
        await add_panel.get_by_role("button", name="Find").click()
        await add_panel.get_by_role("button", name=re.compile("^Hal Uy")).click()
        await add_panel.get_by_role("button", name="Add to event").click()
        await lea.wait_for_selector("text=Hal Uy added.")
        await lea.goto(f"{cup_url}?tab=matches", wait_until="networkidle")
        singles_panel = lea.get_by_role("region", name="Singles Open")
        await singles_panel.get_by_role("button", name="Create matches").click()
        await lea.wait_for_selector("text=Matches created from confirmed entries.")
        check("matches: a round robin of two entries makes one match",
              sql(f"select count(*) from public.event_matches where division_id = '{singles}'") == "1")
        match = sql(f"select id from public.event_matches where division_id = '{singles}'")
        c3 = sql("select id from public.courts where number = 3")
        status, body = api("POST", "/rest/v1/rpc/staff_schedule_match",
                           {"_match_id": match, "_court_id": c3, "_starts_at": tomorrow.isoformat(),
                            "_ends_at": (tomorrow + dt.timedelta(minutes=30)).isoformat()}, token=lea_token)
        check("court conflict: a match cannot use a court not reserved for the event", status == 400 and "not reserved" in body.get("message", ""), body)
        await singles_panel.get_by_role("button", name="Schedule").click()
        await singles_panel.get_by_role("button", name="Save schedule").click()
        await lea.wait_for_selector("text=Match scheduled.")
        await singles_panel.get_by_role("button", name="Enter result").click()
        scores = singles_panel.get_by_label(re.compile(r"score$"))
        await scores.nth(0).fill("11")
        await scores.nth(1).fill("7")
        await singles_panel.get_by_role("button", name="Save result").click()
        await lea.wait_for_selector("text=Result recorded.")
        check("results: the score and winner are stored",
              sql(f"select status || ' ' || score_a || '-' || score_b || ' ' || (winner is not null) from public.event_matches where id = '{match}'")
              == "completed 11-7 true")
        await lea.reload(wait_until="networkidle")
        table = await singles_panel.get_by_role("table").inner_text()
        check("standings: the winner ranks first with one win", re.search(r"1\s+\S+ \S+\s+1\s+1\s+0\s+\+4", table) is not None, table)

        # ---- Player pages ----------------------------------------------------
        await ana.goto(f"{APP}/leaderboard", wait_until="networkidle")
        await ana.wait_for_selector("text=Ana R.")
        board = await ana.locator("main").inner_text()
        check("leaderboard: points follow the published rule (win 3)", re.search(r"Ana R\.[\s\S]*?\b3\b", board) is not None, board[:300])
        await ana.goto(f"{APP}/history", wait_until="networkidle")
        await ana.wait_for_selector("text=Test Open Play")
        check("play history: built from the actual check-in", await ana.get_by_text("Test Open Play").count() >= 1)
        await ana.goto(f"{APP}/my/events", wait_until="networkidle")
        await ana.wait_for_selector("text=Test Cup")
        check("my events: lists the tournament and the open play session",
              await ana.get_by_text("Test Cup").count() >= 1 and await ana.get_by_text("Test Open Play").count() >= 1)
        await ana.goto(f"{APP}/payments", wait_until="networkidle")
        await ana.wait_for_selector("text=No payments yet")
        check("my payments: page loads (no payments for free events)", True)
        check("player pages: no sideways scrolling on a phone", await no_sideways_scroll(ana, 390))

        # ---- Permissions -----------------------------------------------------
        status, _ = api("POST", "/rest/v1/rpc/staff_call_next", {"_event_id": op, "_court_id": c3}, token=ana_token)
        check("permissions: players cannot run the queue", status == 403)
        carla_token = token_for("carla.mendoza@test.local")
        status, _ = api("POST", "/rest/v1/rpc/staff_record_match_result", {"_match_id": match, "_score_a": 1, "_score_b": 11}, token=carla_token)
        check("permissions: staff without events.manage cannot record results", status == 403)
        status, _ = api("POST", "/rest/v1/events", {"slug": "x", "title": "Hack", "event_type": "social",
                                                     "starts_at": tomorrow.isoformat(), "ends_at": op_end.isoformat()}, token=ana_token)
        check("permissions: players cannot create events", status == 403)

        mobile = await login(browser, "lea.navarro@test.local", width=390)
        for path in (f"{op_url[len(APP):]}?tab=queue", cup_url[len(APP):] + "?tab=matches", "/admin/events"):
            await mobile.goto(f"{APP}{path}", wait_until="networkidle")
            await mobile.wait_for_timeout(300)
            check(f"mobile: {path.split('?')[0][-20:]}{'?' + path.split('?')[1] if '?' in path else ''} has no sideways scrolling",
                  await no_sideways_scroll(mobile, 390))
        await mobile.goto(f"{op_url}?tab=queue", wait_until="networkidle")
        await mobile.screenshot(path=f"{OUT}/queue-mobile.png", full_page=True)
        await ana.goto(f"{APP}/events/{sql(f'select slug from public.events where id = {chr(39)}{cup}{chr(39)}')}", wait_until="networkidle")
        await ana.screenshot(path=f"{OUT}/event-mobile.png", full_page=True)
        await browser.close()

    check("no JavaScript errors on any page", not errors, "; ".join(errors)[:400])
    failed = 0
    for ok, name, detail in results:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {str(detail)[:300]}"))
        failed += 0 if ok else 1
    print(f"\n# {len(results) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
