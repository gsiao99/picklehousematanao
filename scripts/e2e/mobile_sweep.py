"""
Mobile and page-health sweep: every screen at 360 px wide, as a visitor, a
player, staff and an admin, against the local test stack. For each page:
no sideways scrolling, no JavaScript errors, no "could not load" error state.
Also downloads each CSV report and checks it against the database.

Run after community_local.py (it reuses that test data):
  scripts/e2e/setup_local.sh /tmp/dd-e2e
  python3 scripts/e2e/community_local.py /tmp/dd-e2e
  python3 scripts/e2e/mobile_sweep.py /tmp/dd-e2e
"""
import asyncio
import csv
import io
import re
import subprocess
import sys

from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/dd-e2e"
APP = "http://localhost:4175"
PSQL = ["psql", "-X", "-q", "-tA", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "dd_test", "-c"]
WIDTH = 360
results = []


def check(name, ok, detail=""):
    results.append((bool(ok), name, detail))


def sql(q):
    return subprocess.run(PSQL + [q], check=True, capture_output=True, text=True).stdout.strip()


async def session(browser, email=None):
    ctx = await browser.new_context(viewport={"width": WIDTH, "height": 780}, accept_downloads=True)
    page = await ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # The local API stand-in has no Realtime server; its refused WebSocket is expected here.
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "/realtime/v1/websocket" not in m.text else None)
    if email:
        await page.goto(f"{APP}/login", wait_until="networkidle")
        await page.fill("input[name=email]", email)
        await page.fill("input[name=password]", "courts2026")
        await page.click("button[type=submit]")
        await page.wait_for_url(re.compile(r"/(player/dashboard|admin)$"), timeout=15000)
    return page, errors


async def sweep(page, errors, who, paths):
    for path in paths:
        errors.clear()
        await page.goto(f"{APP}{path}", wait_until="networkidle")
        await page.wait_for_timeout(400)
        width = await page.evaluate("document.documentElement.scrollWidth")
        failed_lists = await page.get_by_text("could not load").count()
        check(f"{who} {path}: fits {WIDTH}px, loads, no script errors",
              width <= WIDTH and failed_lists == 0 and not errors,
              f"width={width} errorStates={failed_lists} errors={errors[:2]}")


async def main():
    booking = sql("select id from public.bookings where player_id = '11111111-1111-4111-8111-111111111111' order by created_at limit 1")
    cup = sql("select id || '|' || slug from public.events where title = 'Test Cup'").split("|")
    op = sql("select id || '|' || slug from public.events where title = 'Test Open Play'").split("|")
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        page, errors = await session(browser)
        await sweep(page, errors, "visitor", ["/", "/courts", "/open-play", "/login", "/signup", "/forgot-password", "/live",
                                             "/events", f"/events/{cup[1]}", "/no-such-page"])

        page, errors = await session(browser, "ana.reyes@test.local")
        await sweep(page, errors, "player", ["/player/dashboard", "/player/profile", "/player/book", "/player/bookings",
                                            f"/player/bookings/{booking}" if booking else "/player/bookings",
                                            "/player/notifications", "/player/open-play", "/player/events", "/player/events/mine",
                                            "/player/paddle-stacking", "/player/payments", "/player/history", "/player/leaderboard",
                                            f"/player/events/{op[1]}", f"/player/events/{cup[1]}", f"/events/{cup[1]}"])

        page, errors = await session(browser, "carla.mendoza@test.local")
        await sweep(page, errors, "staff", ["/admin", "/admin/schedule", "/admin/bookings", "/admin/players?q=ana",
                                           "/admin/payments", "/admin/reports"])
        check("staff without reports.view: reports refused", await page.get_by_text("This page is for club staff").count() == 1)

        page, errors = await session(browser, "lea.navarro@test.local")
        await sweep(page, errors, "admin", ["/admin", "/admin/events", f"/admin/events/{cup[0]}", f"/admin/events/{cup[0]}?tab=matches",
                                           f"/admin/events/{cup[0]}?tab=setup", f"/admin/events/{op[0]}?tab=queue",
                                           "/admin/members", "/admin/settings", "/admin/payments", "/admin/reports"])

        # CSV reports, downloaded through the browser and checked against the database
        today = sql("select private.operating_date_of(now())")
        first = today[:8] + "01"
        last = sql("select private.operating_date_of(now()) + 30")
        expected = {
            "check_ins": int(sql(f"select count(*) from public.check_ins where private.operating_date_of(checked_in_at) between '{first}' and '{last}'")),
            "bookings": int(sql("select count(*) from public.bookings b where b.status not in ('cart', 'held') and coalesce("
                                "(select min(operating_date) from public.booking_slots s where s.booking_id = b.id and s.status <> 'released'), "
                                f"private.operating_date_of(b.created_at)) between '{first}' and '{last}'")),
        }
        download_button = page.get_by_role("button", name=re.compile("^Download"))

        async def fetch_csv():
            await page.get_by_role("button", name="Prepare report").click()
            await download_button.wait_for()
            async with page.expect_download() as info:
                await download_button.click()
            download = await info.value
            raw = open(await download.path(), "rb").read()
            return download.suggested_filename, raw

        await page.goto(f"{APP}/admin/reports", wait_until="networkidle")
        for kind, label in (("check_ins", "Check-ins (attendance)"), ("bookings", "Bookings")):
            await page.get_by_label("Report", exact=True).select_option(label=label)
            await page.get_by_label("From", exact=True).fill(first)
            await page.get_by_label("To", exact=True).fill(last)
            name, raw = await fetch_csv()
            rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
            check(f"CSV {kind}: header plus one row per database record", len(rows) - 1 == expected[kind] and expected[kind] > 0,
                  f"{len(rows) - 1} rows, expected {expected[kind]}")
            check(f"CSV {kind}: .csv file with a UTF-8 BOM for Excel", name.endswith(".csv") and raw.startswith(b"\xef\xbb\xbf"), name)
        await page.get_by_label("Report", exact=True).select_option(label="Event registrations")
        await page.get_by_label("Event", exact=True).wait_for()
        option = await page.get_by_label("Event", exact=True).locator("option", has_text="Test Cup").get_attribute("value")
        await page.get_by_label("Event", exact=True).select_option(option)
        name, raw = await fetch_csv()
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        check("CSV registrations: every entry with its registered category",
              len(rows) == int(sql(f"select count(*) from public.event_registrations where event_id = '{cup[0]}'"))
              and {r["Category"] for r in rows if r["Status"] == "confirmed"} == {"Mixed Doubles", "Singles"}, rows[:2])
        await browser.close()

    failed = 0
    for ok, name, detail in results:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {str(detail)[:300]}"))
        failed += 0 if ok else 1
    print(f"\n# {len(results) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
