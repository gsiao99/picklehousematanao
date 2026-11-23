"""
Acceptance test for the separate player area (/player/...): routing, sign-in
and sign-up redirects, role routing, guards, the dashboard's real data, other
players' records, logout, and desktop/phone layouts.

Runs the real app against the local test database through the API stand-in
(scripts/local-db/rest-shim.py), so Row Level Security applies to every read.

  scripts/e2e/setup_local.sh /tmp/dd-e2e
  python3 scripts/e2e/player_dashboard.py /tmp/dd-e2e

TEST DATA ONLY: hours, rates, bookings and payments here are fixtures.
Email delivery is not part of this test: the stand-in's sign-up mimics a
project with confirmation on (@confirm.test addresses) or off (others).
"""
import asyncio
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
ANA, BEN, DAN = ("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
                 "44444444-4444-4444-8444-444444444444")
results, errors = [], []


def check(name, ok, detail=""):
    results.append((bool(ok), name, detail))


def sql(q):
    return subprocess.run(PSQL + [q], check=True, capture_output=True, text=True).stdout.strip()


def api(method, path, body=None, token=None):
    headers = {"apikey": "sb_publishable_localtest", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def token_for(email):
    status, body = api("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": PASSWORD})
    assert status == 200, body
    return body["access_token"]


def book_as(user_id, court, hour, days=1):
    return sql(f"""
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{{"sub":"{user_id}","role":"authenticated"}}', true);
      select (public.confirm_booking(public.hold_slots(jsonb_build_array(jsonb_build_object(
        'court_id', (select id from public.courts where number = {court}),
        'starts_at', ((private.operating_date_of(now()) + {days})::timestamp + interval '{hour} hours') at time zone 'Asia/Manila'))))).booking_id;
      commit;""").splitlines()[-1]


async def new_page(browser, width=1280, height=900, label=""):
    ctx = await browser.new_context(viewport={"width": width, "height": height})
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"{label}: {e}"))
    page.on("console", lambda m: errors.append(f"{label}: {m.text}") if "Content Security Policy" in m.text else None)
    return page


async def sign_in(page, email):
    await page.fill("input[name=email]", email)
    await page.fill("input[name=password]", PASSWORD)
    await page.get_by_role("button", name="Sign in", exact=True).click()


async def main():
    # ---- Fixtures ------------------------------------------------------------
    sql("insert into public.operating_hours (weekday, opens_at, closes_at) select d, '06:00', '23:00' from generate_series(0, 6) d "
        "on conflict (weekday) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at, is_closed = false")
    sql("delete from public.rate_rules; insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit) "
        "values ('court_rental', 'Test rate', 'off_peak', '06:00', '23:00', 25000, 'per_court_hour')")
    ana_next = book_as(ANA, 1, 10)          # Ana: tomorrow 10:00, unpaid
    ana_later = book_as(ANA, 2, 15, days=2)  # Ana: in two days, receipt rejected
    ben_booking = book_as(BEN, 3, 12)        # Ben: someone else's booking
    ana_ref = sql(f"select reference from public.bookings where id = '{ana_next}'")
    ben_ref = sql(f"select reference from public.bookings where id = '{ben_booking}'")
    sql(f"""insert into public.payments (booking_id, method_kind, amount_centavos, proof_path, status, submitted_by, reviewed_by, reviewed_at, review_note)
            values ('{ana_later}', 'gcash', 25000, '{ANA}/{ana_later}/r.png', 'rejected', '{ANA}', '{DAN}', now(), 'TEST: amount does not match')""")
    sql(f"""insert into public.check_ins (player_id, booking_id, checked_in_at, kind)
            values ('{ANA}', '{ana_next}', now() - interval '9 days', 'court_rental')""")

    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # 1. Visitor sees the public homepage --------------------------------------
        v = await new_page(browser, label="visitor")
        await v.goto(APP + "/", wait_until="networkidle")
        main_text = await v.inner_text("main")
        check("1 visitor: homepage shows hero, courts, rates, open play and tournaments",
              all(s in main_text for s in ["dine, drink, enjoy", "The courts", "Open play", "Tournaments"])
              and await v.locator("#rates").count() == 1, main_text[:200])
        check("1 visitor: no player area chrome or personal data on /",
              await v.get_by_role("navigation", name="Player").count() == 0 and "Welcome back" not in main_text)
        header = v.locator("header").first
        check("1 visitor: header offers sign in and create account",
              await header.get_by_role("link", name="Sign in to book").count() >= 1
              and await header.get_by_role("link", name="Create account").count() >= 1)
        for path, text in [("/courts", "The courts"), ("/open-play", "Open play"), ("/events", "Open play and events")]:
            await v.goto(APP + path, wait_until="networkidle")
            check(f"1 visitor: {path} is public", text in await v.inner_text("main") and "/login" not in v.url, v.url)

        # 2. Login and signup are reachable ----------------------------------------
        await v.goto(APP + "/login", wait_until="networkidle")
        check("2 visitor: /login shows the sign-in form", await v.locator("input[name=password]").count() == 1)
        await v.goto(APP + "/signup", wait_until="networkidle")
        check("2 visitor: /signup shows the registration form", await v.locator("input[name=fullName]").count() == 1)

        # 6. Protected page while signed out → login → back to it --------------------
        await v.goto(APP + "/player/payments", wait_until="networkidle")
        check("6 signed out: /player/payments goes to login with the page kept",
              "/login?next=%2Fplayer%2Fpayments" in v.url, v.url)
        await sign_in(v, "ana.reyes@test.local")
        await v.wait_for_url("**/player/payments", timeout=15000)
        check("6 after login: returned to /player/payments", True)
        await v.goto(APP + "/login?next=https%3A%2F%2Fevil.example", wait_until="networkidle")
        await v.wait_for_url("**/player/dashboard", timeout=10000)
        check("6 an outside ?next= address is ignored (dashboard instead)", "evil" not in v.url, v.url)
        await v.goto(APP + "/login?next=%2Flogin%3Fnext%3D%252Flogin", wait_until="networkidle")
        await v.wait_for_url("**/player/dashboard", timeout=10000)
        check("6 no redirect loop through the sign-in page", True)
        await v.context.close()

        # 3. New player signs up (confirmation on) ---------------------------------
        s = await new_page(browser, label="signup")
        await s.goto(APP + "/signup", wait_until="networkidle")
        await s.fill("input[name=fullName]", "Mia Test Santos")
        await s.fill("input[name=email]", "mia@confirm.test")
        await s.fill("input[name=phone]", "09171112222")
        await s.select_option("select[name=selfRatedLevel]", "novice")
        await s.fill("input[name=password]", PASSWORD)
        await s.check("input[name=consent]")
        await s.get_by_role("button", name="Create account", exact=True).last.click()
        await s.wait_for_selector("text=Check your inbox")
        check("3 sign-up with confirmation on: shows the verification screen", True)
        mia = sql("select id from auth.users where email = 'mia@confirm.test'")
        await s.goto(APP + "/login", wait_until="networkidle")
        await sign_in(s, "mia@confirm.test")
        await s.wait_for_selector("text=Confirm your email first")
        check("3 unverified account: a clear 'confirm your email' error", True)
        await s.goto(f"{APP}/auth/callback?code=confirm-{mia}", wait_until="networkidle")
        await s.wait_for_url("**/player/dashboard", timeout=15000)
        await s.wait_for_selector("text=Welcome back, Mia")
        check("3 opening the confirmation link signs in and lands on the dashboard", True)
        # 10b. A brand-new player sees useful empty states
        body = await s.inner_text("main")
        check("10 new player: empty states for bookings, payments and history",
              "No upcoming court bookings" in body and "Nothing to pay or fix right now." in body and "No games recorded yet" in body, body[:400])
        # The callback can run again (refresh, second tab): still one profile
        await s.goto(f"{APP}/auth/callback?code=confirm-{mia}", wait_until="networkidle")
        await s.wait_for_url("**/player/dashboard", timeout=15000)
        status, _ = api("POST", "/auth/v1/signup", {"email": "mia@confirm.test", "password": PASSWORD, "data": {"full_name": "Mia Again"}})
        check("3 repeated callback and repeated sign-up create no duplicate profile",
              sql(f"select count(*) from public.profiles where id = '{mia}'") == "1"
              and sql("select count(*) from auth.users where email = 'mia@confirm.test'") == "1"
              and sql(f"select count(*) from public.user_roles where user_id = '{mia}'") == "1", status)
        await s.context.close()

        # 3b. Sign-up with confirmation off → straight to the dashboard
        s2 = await new_page(browser, label="signup2")
        await s2.goto(APP + "/signup", wait_until="networkidle")
        await s2.fill("input[name=fullName]", "Noel Test Uy")
        await s2.fill("input[name=email]", "noel@instant.test")
        await s2.fill("input[name=phone]", "09173334444")
        await s2.select_option("select[name=selfRatedLevel]", "advanced")
        await s2.fill("input[name=password]", PASSWORD)
        await s2.check("input[name=consent]")
        await s2.get_by_role("button", name="Create account", exact=True).last.click()
        await s2.wait_for_url("**/player/dashboard", timeout=15000)
        await s2.wait_for_selector("text=Welcome back, Noel")
        check("3 sign-up with an immediate session goes to /player/dashboard", True)
        await s2.context.close()

        # 4 & 5 & 10. Returning player lands on the dashboard with real data ----------
        a = await new_page(browser, label="ana")
        await a.goto(APP + "/login", wait_until="networkidle")
        await sign_in(a, "ana.reyes@test.local")
        await a.wait_for_url("**/player/dashboard", timeout=15000)
        check("4/5 returning player lands on /player/dashboard", True)
        await a.wait_for_selector("text=Welcome back, Ana")
        await a.wait_for_selector(f"text={ana_ref}")
        today = await a.evaluate("new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date())")
        check("10 welcome shows the profile name and today's Manila date", today in await a.locator("main header").inner_text(), today)
        nxt = a.get_by_role("region", name="Next reservation")
        nxt_text = await nxt.inner_text()
        check("10 next reservation: reference, court, status from the database",
              ana_ref in nxt_text and "Court 1" in nxt_text and "Confirmed" in nxt_text and "Not paid yet" in nxt_text, nxt_text)
        pay = a.get_by_role("region", name="Payments")
        await pay.get_by_text("Payment rejected").wait_for()
        pay_text = await pay.inner_text()
        check("10 payment alerts: unpaid booking and rejected receipt (with the club's reason)",
              "Pay now" in pay_text and "Rejected" in pay_text and "TEST: amount does not match" in pay_text, pay_text)
        href = await pay.get_by_role("link").filter(has_text="Rejected").first.get_attribute("href")
        check("10 payment alert links to that booking's payment page", href == f"/player/bookings/{ana_later}", href)
        stats = await a.get_by_role("list", name="Your numbers").inner_text()
        db_upcoming = sql(f"select count(*) from public.bookings where player_id = '{ANA}' and status = 'confirmed'")
        check("10 counts come from the records (2 upcoming bookings, 2 payment actions, 1 check-in)",
              re.search(rf"\b{db_upcoming}\s+Upcoming bookings", stats) and re.search(r"\b2\s+Payments to act on", stats)
              and re.search(r"\b1\s+Check-ins", stats), stats)
        hist = await a.get_by_role("region", name="Recent play").inner_text()
        check("10 recent play shows the actual check-in", "Court rental" in hist, hist)
        courts = a.get_by_role("region", name="Court availability")
        grid = courts.get_by_role("grid")
        await grid.wait_for()
        heads = await grid.get_by_role("columnheader").all_inner_texts()
        check("10 availability shows the three courts", [h for h in heads if h.strip() and h.strip() != "Time"] == ["Court 1", "Court 2", "Court 3"], heads)
        await courts.get_by_role("group", name="Choose a day").get_by_role("button").nth(1).click()
        await courts.get_by_role("gridcell").filter(has=a.locator("[aria-label*='Court 1, 10:00 AM']")).first.wait_for()
        booked = await courts.locator("[aria-label^='Court 1, 10:00 AM']").get_attribute("aria-label")
        check("10 availability is live: Ana's own 10:00 booking shows as hers", booked and "Your booking" in booked or "mine" in (booked or "").lower(), booked)
        ben_cell = await courts.locator("[aria-label^='Court 3, 12:00 NN']").get_attribute("aria-label")
        check("10 someone else's booking shows only as booked (no name)", ben_cell and "Booked" in ben_cell and "Ben" not in ben_cell, ben_cell)
        await courts.locator("button[aria-label^='Court 2, 9:00 AM']").click()
        await a.wait_for_url(re.compile(r"/player/book\?date=\d{4}-\d{2}-\d{2}"))
        check("10 an open slot leads into the booking flow for that day", True)
        await a.goto(APP + "/player/dashboard", wait_until="networkidle")
        ev_text = await a.get_by_role("region", name="Upcoming open play & events").inner_text()
        check("10 events card reads the database (none posted yet → empty state)", "No events posted yet" in ev_text, ev_text)
        prof = await a.get_by_role("region", name="My profile").inner_text()
        check("10 profile summary from the profile record", "Ana Reyes" in prof and "09171234567" in prof, prof)

        # 9. Another player's records -------------------------------------------------
        await a.goto(f"{APP}/player/bookings/{ben_booking}", wait_until="networkidle")
        txt = await a.inner_text("main")
        check("9 UI: Ana cannot open Ben's booking", ben_ref not in txt and ("not found" in txt.lower() or "could not" in txt.lower()), txt[:200])
        tok = token_for("ana.reyes@test.local")
        s1, b1 = api("GET", f"/rest/v1/bookings?id=eq.{ben_booking}&select=id", token=tok)
        s2_, b2 = api("GET", f"/rest/v1/payments?select=id,booking_id", token=tok)
        s3, b3 = api("GET", f"/rest/v1/booking_slots?booking_id=eq.{ben_booking}&select=id", token=tok)
        check("9 API: RLS returns none of Ben's booking, slots or payments to Ana",
              s1 == 200 and b1 == [] and s3 == 200 and b3 == [] and all(r["booking_id"] != ben_booking for r in (b2 or [])),
              f"{b1} {b3} {b2}")

        # 8. Player cannot use admin routes ------------------------------------------
        await a.goto(APP + "/admin", wait_until="networkidle")
        check("8 UI: player is refused /admin", await a.get_by_text("This page is for club staff").count() == 1)
        await a.goto(APP + "/admin/payments", wait_until="networkidle")
        check("8 UI: player is refused /admin/payments", await a.get_by_text("This page is for club staff").count() == 1)
        st, body = api("POST", "/rest/v1/rpc/staff_dashboard", {}, token=tok)
        st2, body2 = api("POST", "/rest/v1/rpc/staff_list_payments", {}, token=tok)
        check("8 API: staff functions refuse a player", st >= 400 and st2 >= 400, f"{st} {body} {st2} {body2}")
        # Forged client state does not grant access
        await a.evaluate("localStorage.setItem('role','admin'); localStorage.setItem('dd-role','admin')")
        await a.goto(APP + "/admin", wait_until="networkidle")
        check("8 a role written into browser storage changes nothing", await a.get_by_text("This page is for club staff").count() == 1)

        # 13. Desktop layout ----------------------------------------------------------
        await a.goto(APP + "/player/dashboard", wait_until="networkidle")
        side = a.locator("aside[aria-label=Player]")
        labels = await side.get_by_role("link").all_inner_texts()
        expected = ["Dashboard", "Book a Court", "Open Play", "Tournaments & Events", "Paddle Stacking", "My Bookings",
                    "My Payments", "Play History", "Leaderboard", "Cafe Menu", "Notifications", "My Profile"]
        check("13 desktop: sidebar has the twelve sections plus Logout",
              [l.strip() for l in labels][1:] == expected and await side.get_by_role("button", name="Logout").count() == 1, labels)
        check("13 desktop: active section is marked", await side.get_by_role("link", name="Dashboard", exact=True).get_attribute("aria-current") == "page")
        check("13 desktop: bottom bar hidden", not await a.get_by_role("navigation", name="Player quick links").is_visible())
        for path, heading in [("/player/book", "Book a court"), ("/player/open-play", "Open play"), ("/player/events", "Tournaments and events"),
                              ("/player/paddle-stacking", "Paddle stacking"), ("/player/bookings", "My bookings"), ("/player/payments", "My payments"),
                              ("/player/history", "Play history"), ("/player/leaderboard", "Leaderboard"), ("/player/cafe", "Café menu"), ("/player/notifications", "Notifications"),
                              ("/player/profile", "My profile")]:
            await a.goto(APP + path, wait_until="networkidle")
            h1 = (await a.locator("main h1").first.inner_text()).strip()
            ok = h1.lower() == heading.lower() and await side.is_visible()
            check(f"13 desktop: {path} opens inside the player area", ok, h1)
        await a.screenshot(path=f"{OUT}/player-desktop.png", full_page=False)
        await a.goto(APP + "/player/dashboard", wait_until="networkidle")
        await a.wait_for_selector(f"text={ana_ref}")
        await a.screenshot(path=f"{OUT}/player-dashboard-desktop.png", full_page=True)

        # 11. Homepage still public for a signed-in player, with a dashboard link ------
        await a.goto(APP + "/", wait_until="networkidle")
        check("11 signed-in player can still open the homepage", "dine, drink, enjoy" in await a.inner_text("main") and a.url.endswith("/"))
        check("11 homepage offers the dashboard to a signed-in player",
              await a.locator("header").first.get_by_role("link", name="My dashboard").count() >= 1)

        # 12. Logout -----------------------------------------------------------------
        await a.goto(APP + "/player/dashboard", wait_until="networkidle")
        await a.locator("aside").get_by_role("button", name="Logout").click()
        await a.wait_for_url("**/login?signedout=1")
        await a.get_by_text("You have signed out.").wait_for(timeout=10000)
        check("12 logout lands on sign-in with a confirmation", "/login?signedout=1" in a.url, a.url)
        stored = await a.evaluate("Object.keys(localStorage).filter(k => k.startsWith('sb-'))")
        check("12 logout clears the stored session", stored == [], stored)
        await a.goto(APP + "/player/bookings", wait_until="networkidle")
        check("12 player pages are protected again after logout", "/login?next=%2Fplayer%2Fbookings" in a.url, a.url)
        await a.go_back()
        await a.wait_for_load_state("networkidle")
        check("12 the back button does not show the old dashboard", "/login" in a.url and "Welcome back," not in await a.inner_text("body"), a.url)
        await a.context.close()

        # 7. Staff and admins go to their own dashboard ---------------------------------
        for email, who in [("lea.navarro@test.local", "admin"), ("carla.mendoza@test.local", "staff")]:
            pg = await new_page(browser, label=who)
            await pg.goto(APP + "/login", wait_until="networkidle")
            await sign_in(pg, email)
            await pg.wait_for_url(re.compile(r"/admin$"), timeout=15000)
            await pg.get_by_role("navigation", name="Staff").first.wait_for()
            check(f"7 {who} signs in to the staff dashboard (/admin)", await pg.get_by_role("heading", name="Dashboard").count() >= 1)
            await pg.context.close()

        # 13. Phone layout -----------------------------------------------------------
        m = await new_page(browser, 360, 780, label="phone")
        await m.goto(APP + "/login", wait_until="networkidle")
        await sign_in(m, "ana.reyes@test.local")
        await m.wait_for_url("**/player/dashboard", timeout=15000)
        await m.wait_for_selector(f"text={ana_ref}")
        bottom = m.get_by_role("navigation", name="Player quick links")
        check("13 phone: bottom navigation visible, sidebar hidden",
              await bottom.is_visible() and not await m.locator("aside[aria-label=Player]").is_visible())
        sizes = await bottom.locator("a, button").evaluate_all("els => els.map(e => [e.offsetWidth, e.offsetHeight])")
        check("13 phone: bottom buttons are at least 44 px tall", all(h >= 44 for _, h in sizes), sizes)
        widths = []
        for path in ["/player/dashboard", "/player/book", "/player/bookings", "/player/payments", "/player/events", "/player/open-play",
                     "/player/paddle-stacking", "/player/history", "/player/leaderboard", "/player/notifications", "/player/profile"]:
            await m.goto(APP + path, wait_until="networkidle")
            widths.append((path, await m.evaluate("document.documentElement.scrollWidth")))
        check("13 phone: no sideways scroll on any player page at 360 px", all(w <= 360 for _, w in widths), widths)
        await m.goto(APP + "/player/dashboard", wait_until="networkidle")
        await m.wait_for_selector(f"text={ana_ref}")
        await m.screenshot(path=f"{OUT}/player-dashboard-phone.png", full_page=True)
        await bottom.get_by_role("button", name="More").click()
        drawer = m.get_by_role("dialog", name="Player menu")
        await drawer.wait_for()
        n = await drawer.get_by_role("link").count()
        check("13 phone: More opens the full menu with Logout", n == 11 and await drawer.get_by_role("button", name="Logout").count() == 1, n)
        await m.screenshot(path=f"{OUT}/player-drawer-phone.png")
        await drawer.get_by_role("link", name="Play History").click()
        await m.wait_for_url("**/player/history")
        check("13 phone: menu link navigates and the menu closes", not await drawer.is_visible())
        # The booking cart bar sits above the bottom navigation
        await m.goto(APP + "/player/book", wait_until="networkidle")
        await m.get_by_role("group", name="Choose a day").get_by_role("button").nth(2).click()
        await m.locator("button[aria-label^='Court 1, 8:00 AM']").click()
        cart = m.get_by_role("button", name="Add to cart")
        box, nav = await cart.bounding_box(), await bottom.bounding_box()
        check("13 phone: the booking bar is above the bottom navigation (both usable)",
              box and nav and box["y"] + box["height"] <= nav["y"], f"{box} {nav}")
        await m.context.close()

        await browser.close()

    check("no script errors or blocked resources", not errors, "; ".join(errors[:5]))
    failed = [r for r in results if not r[0]]
    for ok, name, detail in results:
        print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if not ok and detail else ""))
    print(f"# {len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
