"""
End-to-end booking test: the real app against the real local test database.

Setup:
  scripts/local-db/run-tests.sh                   # migrate dd_test
  (test accounts: see scripts/e2e/README or the SQL in this file's docstring)
  python3 scripts/local-db/rest-shim.py &         # local API stand-in on :54321
  VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_localtest \
    VITE_SITE_URL=http://localhost:4175 npx vite build --outDir /tmp/dist-local
  npx vite preview --outDir /tmp/dist-local --port 4175 &
  python3 scripts/e2e/booking_local.py /tmp

Hours and rates are entered through the admin settings screen during the
test; they are test values, not the club's.
"""
import asyncio
import re
import subprocess
import sys

from playwright.async_api import async_playwright, expect

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp"
APP = "http://localhost:4175"
PASSWORD = "courts2026"
PSQL = ["psql", "-X", "-q", "-tA", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "dd_test", "-c"]
results = []
errors = []


def check(name, ok, detail=""):
    results.append((bool(ok), name, detail))


def sql(q):
    return subprocess.run(PSQL + [q], check=True, capture_output=True, text=True).stdout.strip()


DAY = sql("select private.operating_date_of(now()) + 1")


def cell(page, court, time):
    return page.get_by_role("button", name=re.compile(rf"^Court {court}, {re.escape(time)} to"))


def label(page, court, time):
    return page.locator(f'[aria-label^="Court {court}, {time} to"]').first


async def login(ctx, email, viewport=None):
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"{email}: {e}"))
    # Anything the production Content-Security-Policy blocks is a failure too.
    page.on("console", lambda m: errors.append(f"{email}: {m.text}") if "Content Security Policy" in m.text else None)
    await page.goto(f"{APP}/login", wait_until="networkidle")
    await page.fill("input[name=email]", email)
    await page.fill("input[name=password]", PASSWORD)
    await page.click("button[type=submit]")
    await page.wait_for_url(re.compile(r"/(player/dashboard|admin)$"), timeout=15000)
    return page


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        desktop = {"viewport": {"width": 1280, "height": 900}}
        mobile = {"viewport": {"width": 390, "height": 844}}

        # ---- Admin configures hours and rates through the settings screen ----
        lea = await login(await browser.new_context(**desktop), "lea.navarro@test.local")
        await lea.goto(f"{APP}/admin/settings", wait_until="networkidle")
        await lea.wait_for_selector("text=Weekly opening hours")
        for day in ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]:
            await lea.get_by_label(f"{day} status").select_option("open")
        opens, closes = lea.get_by_label("Opens", exact=True), lea.get_by_label("Closes", exact=True)
        for i in range(7):
            await opens.nth(i).select_option("06:00")
            await closes.nth(i).select_option("01:00")
        await lea.click("text=Save opening hours")
        await lea.wait_for_selector("text=Opening hours saved.")
        for name, tier, price, start, end in [("Off-peak", "off_peak", "250", "08:00", "17:00"),
                                              ("Peak", "peak", "300", "17:00", "01:00")]:
            await lea.get_by_label("Name", exact=True).fill(name)
            await lea.get_by_label("Type", exact=True).select_option(tier)
            await lea.get_by_label("Price per court-hour (₱)").fill(price)
            await lea.get_by_label("From", exact=True).select_option(start)
            await lea.get_by_label("Until", exact=True).select_option(end)
            await lea.click("button:has-text('Add rate')")
            await lea.wait_for_selector("text=Rate added.")
        check("admin: hours saved to the database",
              sql("select count(*) from public.operating_hours where opens_at = '06:00' and closes_at = '01:00'") == "7")
        check("admin: peak and off-peak rates saved",
              sql("select string_agg(tier || ':' || price_centavos, ',' order by price_centavos) from public.rate_rules")
              == "off_peak:25000,peak:30000")
        await lea.goto(f"{APP}/#rates", wait_until="networkidle")
        rates_text = await lea.locator("#rates").inner_text()
        check("homepage: rates and hours now come from the database",
              "₱250" in rates_text and "₱300" in rates_text and "6:00 AM – 1:00 AM" in rates_text, rates_text[:300])

        # ---- 1 + 2. Ana books one cart: three courts, nonconsecutive hours (phone) ----
        ana_ctx = await browser.new_context(**mobile)
        ana = await login(ana_ctx, "ana.reyes@test.local")
        await ana.goto(f"{APP}/book?date={DAY}", wait_until="networkidle")
        await cell(ana, 1, "2:00 PM").wait_for()
        check("book: Court 1 at 2:00 PM is offered at the off-peak rate",
              "₱250" in (await cell(ana, 1, "2:00 PM").get_attribute("aria-label")))
        check("book: no sideways scrolling on a phone", await ana.evaluate("document.documentElement.scrollWidth") <= 390)
        await ana.screenshot(path=f"{OUT}/p3-book-mobile.png")
        for court, time in [(1, "2:00 PM"), (3, "7:00 PM"), (2, "9:00 PM")]:
            await cell(ana, court, time).click()
        await expect(ana.get_by_text("3 times selected")).to_be_visible()
        await ana.click("button:has-text('Add to cart')")
        await ana.wait_for_selector("text=Added 3 times to your cart.")
        cart = ana.locator("section[aria-labelledby=cart-title]")
        await expect(cart.get_by_text("₱850")).to_be_visible()
        check("cart: three court-hours held, total computed by the server (₱850)", True)
        check("cart: shows the hold countdown", await cart.get_by_text(re.compile(r"Held for \d+:\d\d")).count() == 1)
        await ana.screenshot(path=f"{OUT}/p3-cart-mobile.png", full_page=True)
        await ana.click("button:has-text('Reserve and pay')")
        await ana.wait_for_url("**/bookings/*?confirmed=1", timeout=15000)
        await ana.wait_for_selector("text=Your courts are reserved")
        reference = (await ana.locator("#booking-title").inner_text()).strip()
        check("confirm: booking confirmed with a unique reference", re.match(r"^DD-\d{6}-\d{4}$", reference), reference)
        check("confirm: payment status shown separately as not paid", await ana.get_by_text("Not paid yet").count() == 1)
        check("database: booking confirmed, three confirmed slots, payment unpaid",
              sql(f"select b.status || '/' || b.payment_status || '/' || count(s.*) from public.bookings b "
                  f"join public.booking_slots s on s.booking_id = b.id and s.status = 'confirmed' "
                  f"where b.reference = '{reference}' group by b.status, b.payment_status") == "confirmed/unpaid/3")
        await ana.screenshot(path=f"{OUT}/p3-confirmed-mobile.png", full_page=True)

        # ---- 3. Same slot twice: Ben selects, Ana grabs it first, Ben is refused ----
        ben = await login(await browser.new_context(**desktop), "ben.cruz@test.local")
        await ben.goto(f"{APP}/book?date={DAY}", wait_until="networkidle")
        await cell(ben, 1, "3:00 PM").click()
        await ana.goto(f"{APP}/book?date={DAY}", wait_until="networkidle")
        await cell(ana, 1, "3:00 PM").click()
        await ana.click("button:has-text('Add to cart')")
        await ana.wait_for_selector("text=Added 1 time to your cart.")
        # Ben's page may already have refreshed (focus, poll) and set the time aside,
        # or he submits and the server refuses it. Either way he must not get it.
        refreshed_first = await ben.get_by_text("Court 1 at 3:00 PM was just taken by someone else").count() > 0
        print("  race path:", "page refreshed first" if refreshed_first else "server refused the submit")
        if not refreshed_first:
            add = ben.locator("button:has-text('Add to cart')")
            if await add.is_enabled():
                await add.click()
        await ben.wait_for_selector("text=/Court 1 at 3:00 PM (was just taken|.*just taken by someone else)/")
        check("double booking: the second player is refused with a clear message", True)
        check("double booking: Ben holds nothing",
              sql("select count(*) from public.bookings where player_id = '22222222-2222-4222-8222-222222222222' "
                  "and status = 'held'") == "0")
        await expect(label(ben, 1, "3:00 PM")).to_have_attribute("aria-label", re.compile("Being booked"), timeout=10000)
        check("double booking: the refused player's grid now shows the time as taken", True)
        check("double booking: one live slot only",
              sql(f"select count(*) from public.booking_slots s join public.courts c on c.id = s.court_id "
                  f"where c.number = 1 and s.status in ('held','confirmed') and s.operating_date = '{DAY}' "
                  f"and lower(s.slot) = ('{DAY}'::date + time '15:00') at time zone 'Asia/Manila'") == "1")
        await ben.screenshot(path=f"{OUT}/p3-taken-desktop.png", full_page=True)

        # ---- 6. Live view reflects a database change without a reload ----
        live = await (await browser.new_context(**desktop)).new_page()
        live.on("pageerror", lambda e: errors.append(f"live: {e}"))
        await live.goto(f"{APP}/live", wait_until="networkidle")
        court2 = live.locator("article", has=live.locator("h2", has_text="Court 2"))
        await court2.wait_for()
        before = await court2.inner_text()
        sql("insert into public.booking_slots (court_id, slot, kind, status, note) "
            "select id, tstzrange(date_trunc('hour', now()), date_trunc('hour', now()) + interval '1 hour'), "
            "'maintenance', 'confirmed', 'E2E live check' from public.courts where number = 2")
        await expect(court2).to_contain_text("Maintenance", timeout=35000)
        check("live view: a maintenance block written to the database appears without reloading",
              "Maintenance" not in before, before)
        await live.screenshot(path=f"{OUT}/p3-live-desktop.png", full_page=True)

        # ---- 5. Staff: see who booked, block courts, cancel a booking ----
        carla = await login(await browser.new_context(**desktop), "carla.mendoza@test.local")
        await carla.goto(f"{APP}/admin/schedule?date={DAY}", wait_until="networkidle")
        entry = carla.locator("li", has_text=reference)
        await expect(entry).to_contain_text("Ana Reyes")
        check("staff schedule: shows the booking with the player's name", True)
        await carla.get_by_label("Court 2", exact=True).check()
        await carla.get_by_label("From", exact=True).select_option(label="9:00 AM")
        await carla.get_by_label("Until", exact=True).select_option(label="11:00 AM")
        await carla.get_by_label("Note shown to staff").fill("Net repair")
        await carla.get_by_label("Reason (for the audit log)").fill("Scheduled net repair")
        await carla.click("button:has-text('Block courts')")
        await carla.wait_for_selector("text=Blocked 1 court.")
        await expect(label(carla, 2, "9:00 AM")).to_have_attribute("aria-label", re.compile("Maintenance"), timeout=10000)
        check("blocks: maintenance block appears on the staff grid", True)
        await entry.get_by_role("button", name="Cancel booking…").click()
        await entry.get_by_label("Reason for cancelling").fill("Court closed for an event")
        await entry.get_by_role("button", name="Cancel booking", exact=True).click()
        await expect(carla.locator("li", has_text=reference)).to_have_count(0, timeout=10000)
        check("cancel: staff cancellation removes the booking from the live schedule", True)
        check("database: cancelled booking keeps its reason and releases its slots",
              sql(f"select b.status || '/' || b.cancel_reason || '/' || "
                  f"(select count(*) from public.booking_slots where booking_id = b.id and status = 'cancelled') "
                  f"from public.bookings b where b.reference = '{reference}'") == "cancelled/Court closed for an event/3")
        await carla.screenshot(path=f"{OUT}/p3-schedule-desktop.png", full_page=True)

        # ---- Ana sees the result ----
        await ana.goto(f"{APP}/bookings", wait_until="networkidle")
        mine = ana.locator("a", has_text=reference)
        await expect(mine).to_contain_text("Cancelled")
        check("history: the player sees the booking as cancelled", True)
        await ana.goto(f"{APP}/book?date={DAY}", wait_until="networkidle")
        await expect(cell(ana, 1, "2:00 PM")).to_be_visible()
        check("release: the cancelled time is bookable again", True)
        await expect(label(ana, 2, "9:00 AM")).to_have_attribute("aria-label", re.compile("Maintenance"))
        check("blocks: players see the maintenance block and cannot select it",
              await cell(ana, 2, "9:00 AM").count() == 0)

        check("no uncaught errors in any page", not errors, "; ".join(errors)[:400])
        await browser.close()

    failed = 0
    for ok, name, detail in results:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {detail}"))
        failed += 0 if ok else 1
    print(f"\n# {len(results) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
