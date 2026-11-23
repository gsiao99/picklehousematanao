#!/usr/bin/env python3
"""
End-to-end guest booking test: the real app (built with the production
headers) against the real local test database, through the local API
stand-in. No accounts for guests; staff sign in.

Setup and run (test-only, never against staging or production):
    scripts/e2e/setup_local.sh /tmp/ph-e2e
    python3 scripts/e2e/guest_booking_local.py /tmp/ph-e2e

Courts, rates and the GCash account are TEST FIXTURES from setup_local.sh.
"""
import asyncio
import os
import re
import struct
import subprocess
import sys
import zlib

from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ph-e2e"
APP = "http://localhost:4175"
PASSWORD = "courts2026"
PSQL = ["psql", "-X", "-q", "-tA", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "dd_test", "-c"]
results = []
errors = []


def check(name, ok, detail=""):
    results.append((bool(ok), name, detail))


def sql(q):
    return subprocess.run(PSQL + [q], check=True, capture_output=True, text=True).stdout.strip()


def png(path, color, size=24):
    """A small solid-colour PNG (test receipt)."""
    raw = b"".join(b"\x00" + bytes(color) * size for _ in range(size))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(data)
    return path


DAY = sql("select private.operating_date_of(now()) + 1")


def watch(page, who):
    page.on("pageerror", lambda e: errors.append(f"{who}: {e}"))
    # Anything the production Content-Security-Policy blocks is a failure too.
    page.on("console", lambda m: errors.append(f"{who}: {m.text}") if "Content Security Policy" in m.text else None)


async def new_page(browser, who, width=1280, height=900, **kw):
    ctx = await browser.new_context(viewport={"width": width, "height": height}, **kw)
    page = await ctx.new_page()
    watch(page, who)
    return page


async def staff_login(browser, email):
    page = await new_page(browser, email)
    await page.goto(f"{APP}/login", wait_until="networkidle")
    await page.fill("input[name=email]", email)
    await page.fill("input[name=password]", PASSWORD)
    await page.click("button[type=submit]")
    await page.wait_for_url(re.compile(r"/admin$"), timeout=15000)
    return page


def pill(page, court, time):
    return page.get_by_role("button", name=re.compile(rf"^Court {court}, {re.escape(time)} "))


async def no_sideways_scroll(page, width):
    return await page.evaluate("document.documentElement.scrollWidth") <= width


async def main():
    receipt = png(f"{OUT}/receipt.png", (20, 120, 200))
    sql("update auth.users set encrypted_password = 'x' where false")  # connection check

    async with async_playwright() as p:
        # The pre-installed Chromium (no browser download needed).
        browser = await p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)

        # ---- Guest on a desktop: choose two times and book -------------------------
        ana = await new_page(browser, "guest Ana")
        await ana.goto(f"{APP}/book?date={DAY}", wait_until="networkidle")
        check("book: no account needed (no sign-in link in the way)", await ana.get_by_role("link", name="Sign in to book").count() == 0)
        await pill(ana, 1, "2:00 PM").click()
        await pill(ana, 2, "4:00 PM").click()
        panel = ana.get_by_role("region", name=re.compile("Your times"))
        check("book: chosen times are listed with the total", await panel.get_by_text("₱200").count() >= 1, await panel.inner_text())
        await panel.get_by_role("button", name=re.compile(r"^Book")).click()
        check("book: name and mobile are required", await panel.get_by_text("Enter a name of up to 30 characters.").count() == 1
              and await panel.get_by_text("Enter a PH mobile number like 0917 123 4567.").count() == 1)
        await panel.get_by_label("Your name").fill("Ana R.")
        await panel.get_by_label("Mobile number").fill("12345")
        await panel.get_by_role("button", name=re.compile(r"^Book")).click()
        check("book: a non-PH number is refused in the form", await panel.get_by_text("Enter a PH mobile number like 0917 123 4567.").count() == 1)
        await panel.get_by_label("Mobile number").fill("+63 917 123 4567")
        await panel.get_by_role("button", name=re.compile(r"^Book")).click()
        await ana.wait_for_url(re.compile(r"/booking/PH-\d{6}-\d{4}#[A-Za-z0-9_-]{43}$"), timeout=15000)
        manage_url = ana.url
        reference = re.search(r"/booking/(PH-[\d-]+)#", manage_url).group(1)
        check("book: lands on the private manage link with the reference", True, manage_url.split("#")[0])
        await ana.get_by_text("Booked! Your court times are reserved.").wait_for(timeout=10000)
        check("manage: shows the name, masked mobile and both times",
              await ana.get_by_text("Ana R.").count() >= 1 and await ana.get_by_text("Mobile 0917•••4567").count() == 1
              and await ana.get_by_text("Court 1").count() >= 1 and await ana.get_by_text("Court 2").count() >= 1)
        row = sql(f"select guest_phone || '|' || total_centavos || '|' || status || '|' || coalesce(player_id::text, 'none') "
                  f"from public.bookings where reference = '{reference}'")
        check("database: guest booking stored with the normalised phone and server price", row == "09171234567|20000|confirmed|none", row)
        token = manage_url.split("#", 1)[1]
        check("database: only the token's hash is stored",
              sql(f"select count(*) from public.bookings where reference = '{reference}' and manage_token_hash = sha256(convert_to('{token}', 'UTF8'))") == "1"
              and sql(f"select count(*) from public.bookings where manage_token_hash::text like '%{token[:12]}%'") == "0")
        check("manage: the page asks browsers not to send a referrer",
              await ana.evaluate("document.querySelector('meta[name=referrer]')?.content") == "no-referrer")

        # ---- The link works anywhere; a wrong token does not ----------------------
        other = await new_page(browser, "another device")
        await other.goto(manage_url, wait_until="networkidle")
        check("manage: the link opens the booking on another device", await other.get_by_text("Ana R.").count() >= 1)
        # Only the fragment changes, as when another link is pasted into the same tab: no page load.
        await other.goto(manage_url.split("#")[0] + "#" + "x" * 43, wait_until="networkidle")
        try:
            await other.get_by_text("Booking not found").wait_for(timeout=10000)
            check("manage: a wrong token shows 'Booking not found' (also when pasted into the same tab)", True)
        except Exception:
            check("manage: a wrong token shows 'Booking not found' (also when pasted into the same tab)", False, (await other.inner_text("main"))[:300])
        await other.goto(manage_url.split("#")[0], wait_until="networkidle")
        check("manage: a link without its key says so", await other.get_by_text("This link is missing its private key").count() == 1)

        # ---- Pay by GCash: upload a receipt ---------------------------------------
        await ana.set_input_files("#proof-file", receipt)
        await ana.get_by_label(re.compile("Amount you sent")).fill("200")
        await ana.get_by_label(re.compile("Reference number")).fill("GC-E2E-0001")
        await ana.get_by_role("button", name="Submit payment for checking").click()
        await ana.get_by_text("Payment being checked").first.wait_for(timeout=10000)
        check("pay: receipt submitted; the booking waits for staff", True)
        check("database: receipt stored under the booking's folder, payment waiting",
              sql(f"select count(*) from public.payments p join public.bookings b on b.id = p.booking_id "
                  f"where b.reference = '{reference}' and p.status = 'submitted' and p.proof_path like b.id || '/%'") == "1")

        # ---- Staff: the verifier approves -----------------------------------------
        dan = await staff_login(browser, "dan.villanueva@test.local")
        await dan.goto(f"{APP}/admin/payments", wait_until="networkidle")
        card = dan.get_by_role("article").filter(has_text="Ana R.")
        check("staff: the queue shows the guest's name and mobile",
              await card.count() == 1 and await card.get_by_text("09171234567").count() >= 1, await card.inner_text() if await card.count() else "")
        await card.get_by_role("button", name="Approve…").click()
        await card.get_by_label(re.compile("Amount on the receipt")).fill("200")
        await card.get_by_role("button", name="Yes, approve payment").click()
        try:
            await card.wait_for(state="detached", timeout=10000)
        except Exception:
            check("staff: approving removes the receipt from the queue", False, (await card.inner_text())[:500])
        check("database: approval marks the booking paid",
              sql(f"select payment_status from public.bookings where reference = '{reference}'") == "paid")
        await ana.reload(wait_until="networkidle")
        check("manage: the guest sees it paid", await ana.get_by_text("Your payment was received. See you on court!").count() == 1)

        # ---- Guest cancels a paid booking: refund due -----------------------------
        await ana.get_by_role("button", name="Cancel this booking").click()
        check("cancel: paid bookings warn that the club refunds", await ana.get_by_text(re.compile("the club will arrange your refund")).count() == 1)
        await ana.get_by_role("button", name="Yes, cancel this booking").click()
        await ana.get_by_text("Refund due").first.wait_for(timeout=10000)
        check("cancel: the booking is cancelled and a refund is due",
              sql(f"select status || '/' || payment_status from public.bookings where reference = '{reference}'") == "cancelled/refund_due")

        # ---- This device remembers the booking ------------------------------------
        await ana.goto(f"{APP}/my-bookings", wait_until="networkidle")
        check("my bookings: the booking is remembered on this device", await ana.get_by_role("link", name=reference).count() == 1)

        # ---- Phone (360 px): book through the drawer ------------------------------
        ben = await new_page(browser, "guest Ben", width=360, height=780, has_touch=True, is_mobile=True)
        await ben.goto(f"{APP}/book?date={DAY}&court=3", wait_until="networkidle")
        check("phone: the Book page fits 360 px", await no_sideways_scroll(ben, 360))
        await pill(ben, 3, "6:00 PM").click()
        await ben.get_by_role("button", name=re.compile(r"^Open your chosen times, 1 court-hour")).click()
        drawer = ben.get_by_role("region", name=re.compile("Your times"))
        await drawer.get_by_label("Your name").fill("Ben C.")
        await drawer.get_by_label("Mobile number").fill("0917 000 0002")
        await drawer.get_by_role("button", name=re.compile(r"^Book")).click()
        await ben.wait_for_url(re.compile(r"/booking/PH-"), timeout=15000)
        ben_ref = re.search(r"/booking/(PH-[\d-]+)#", ben.url).group(1)
        check("phone: booked from the drawer", True, ben_ref)
        check("phone: the manage page fits 360 px", await no_sideways_scroll(ben, 360))
        await ben.goto(f"{APP}/book?date={DAY}&court=3", wait_until="networkidle")
        check("live grid: the guest's name shows on the booked time",
              await ben.locator('[aria-label^="Court 3, 6:00 PM"]').first.get_attribute("title") is not None)

        # ---- Staff: hide a guest's name -------------------------------------------
        carla = await staff_login(browser, "carla.mendoza@test.local")
        ben_id = sql(f"select id from public.bookings where reference = '{ben_ref}'")
        await carla.goto(f"{APP}/admin/bookings/{ben_id}", wait_until="networkidle")
        check("staff: the booking shows the guest and their mobile", await carla.get_by_text("09170000002").count() >= 1)
        await carla.get_by_role("button", name="Edit or hide name").click()
        await carla.get_by_label("Hide the name from the court board and live view").check()
        await carla.get_by_label("Reason").fill("Asked not to be shown")
        await carla.get_by_role("button", name="Save").click()
        await carla.get_by_text("Name hidden").first.wait_for(timeout=10000)
        check("database: the name is hidden", sql(f"select display_name_hidden from public.bookings where id = '{ben_id}'") == "t")
        guest = await new_page(browser, "visitor")
        await guest.goto(f"{APP}/book?date={DAY}", wait_until="networkidle")
        label = await guest.locator('[aria-label^="Court 3, 6:00 PM"]').first.get_attribute("title") or ""
        check("public: the hidden name no longer shows on the grid", "Ben" not in label, label)

        # ---- Staff sign-in only ----------------------------------------------------
        visitor = await new_page(browser, "visitor 2")
        await visitor.goto(f"{APP}/signup", wait_until="networkidle")
        check("old sign-up link goes to the homepage (no player accounts)", visitor.url.rstrip("/") == APP)
        await visitor.goto(f"{APP}/player/bookings", wait_until="networkidle")
        check("old player bookings link goes to bookings on this device", visitor.url.endswith("/my-bookings"))

        await browser.close()

    check("no page errors or blocked resources (production CSP)", not errors, "; ".join(errors)[:600])
    sys.exit(1 if report() else 0)


def report():
    failed = 0
    for ok, name, detail in results:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {detail}"))
        failed += 0 if ok else 1
    print(f"\n# {len(results) - failed} passed, {failed} failed")
    return failed


try:
    asyncio.run(main())
except Exception as e:  # a step could not run: report what passed so far, then fail
    check("the test ran to the end", False, f"{type(e).__name__}: {str(e)[:400]}")
    sys.exit(1 if report() else 0)
