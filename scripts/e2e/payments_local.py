"""
End-to-end payment test: the real app against the real local test database,
through the local API stand-in (scripts/local-db/rest-shim.py), which runs every
request as the signed-in user so Row Level Security and storage policies apply.

  scripts/e2e/setup_local.sh /tmp/dd-e2e
  python3 scripts/e2e/payments_local.py /tmp/dd-e2e

Covers: payment method setup with QR upload, player submission with proof,
rejection with reason, resubmission, approval, notifications, self-review
block, permission refusals (UI and API), dashboard, booking search and player
lookup. Hours, rates and account details are TEST VALUES, not the club's.
Realtime is not emulated, so pages are reloaded where a live update would occur.
"""
import asyncio
import json
import re
import struct
import subprocess
import sys
import urllib.error
import urllib.request
import zlib

from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/dd-e2e"
APP = "http://localhost:4175"
API = "http://127.0.0.1:54321"
PASSWORD = "courts2026"
PSQL = ["psql", "-X", "-q", "-tA", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "dd_test", "-c"]
ANA, BEN, LEA = ("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
                 "55555555-5555-4555-8555-555555555555")
results, errors = [], []


def check(name, ok, detail=""):
    results.append((bool(ok), name, detail))


def sql(q):
    return subprocess.run(PSQL + [q], check=True, capture_output=True, text=True).stdout.strip()


def png(path, color, size=24):
    """A small solid-colour PNG (test receipt / QR stand-in)."""
    raw = b"".join(b"\x00" + bytes(color) * size for _ in range(size))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(data)
    return path


def api(method, path, body=None, token=None, raw=None, ctype="application/json"):
    headers = {"apikey": "sb_publishable_localtest", "Content-Type": ctype}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode() or "null"
            return r.status, json.loads(text)
    except urllib.error.HTTPError as e:
        text = e.read().decode() or "null"
        return e.code, json.loads(text)


def token_for(email):
    status, body = api("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": PASSWORD})
    assert status == 200, body
    return body["access_token"]


def book_as(user_id, court, hour):
    """Hold and confirm one hour as a player (the booking UI is covered by booking_local.py)."""
    return sql(f"""
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{{"sub":"{user_id}","role":"authenticated"}}', true);
      select (public.confirm_booking(public.hold_slots(jsonb_build_array(jsonb_build_object(
        'court_id', (select id from public.courts where number = {court}),
        'starts_at', ((private.operating_date_of(now()) + 1)::timestamp + interval '{hour} hours') at time zone 'Asia/Manila'))))).booking_id;
      commit;""").splitlines()[-1]


async def login(browser, email, width=1280):
    ctx = await browser.new_context(viewport={"width": width, "height": 900})
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


async def image_loaded(locator):
    await locator.wait_for(timeout=10000)
    return await locator.evaluate("img => img.complete ? img.naturalWidth > 0 : new Promise(r => img.onload = () => r(img.naturalWidth > 0))")


async def no_sideways_scroll(page, width):
    return await page.evaluate("document.documentElement.scrollWidth") <= width


async def main():
    receipt1 = png(f"{OUT}/receipt-1.png", (20, 120, 200))
    receipt2 = png(f"{OUT}/receipt-2.png", (200, 40, 90))
    qr = png(f"{OUT}/qr.png", (0, 0, 0), 32)
    with open(f"{OUT}/not-an-image.pdf", "wb") as f:
        f.write(b"%PDF-1.4 test")

    # Test fixtures: hours and an off-peak rate (entered through the UI in booking_local.py)
    sql("insert into public.operating_hours (weekday, opens_at, closes_at) select d, '06:00', '23:00' from generate_series(0, 6) d "
        "on conflict (weekday) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at, is_closed = false")
    sql("delete from public.rate_rules; insert into public.rate_rules (product, label, tier, starts_at, ends_at, price_centavos, unit) "
        "values ('court_rental', 'Test rate', 'off_peak', '06:00', '23:00', 25000, 'per_court_hour')")

    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # ---- Admin adds a payment method with a QR code ----------------------
        lea = await login(browser, "lea.navarro@test.local")
        await lea.goto(f"{APP}/admin/settings", wait_until="networkidle")
        await lea.get_by_role("button", name="Add payment method").click()
        await lea.get_by_label("Account name").fill("TEST ACCOUNT NAME")
        await lea.get_by_label("Mobile number").fill("09000000001")
        await lea.get_by_label("Instructions (optional)").fill("Send the exact amount.")
        await lea.set_input_files("#method-qr", qr)
        await lea.get_by_role("button", name="Save payment method").click()
        await lea.wait_for_selector("text=GCash saved.")
        check("admin: payment method saved through settings",
              sql("select count(*) from public.payment_methods where kind = 'gcash' and is_active and qr_image_path like 'methods/%'") == "1")
        check("admin: QR code stored in the private payment-qr bucket",
              sql("select count(*) from storage.objects where bucket_id = 'payment-qr'") == "1"
              and sql("select public from storage.buckets where id = 'payment-qr'") == "f")
        check("admin: QR thumbnail loads through a signed link",
              await image_loaded(lea.get_by_role("img", name="GCash QR code").first))

        status, body = api("GET", "/rest/v1/payment_methods?select=account_number")
        check("security: visitors cannot read the club's account details", status in (401, 403), f"{status} {body}")
        ana_token = token_for("ana.reyes@test.local")
        status, body = api("GET", "/rest/v1/payment_methods?select=account_number", token=ana_token)
        check("security: players cannot list account details directly", status == 200 and body == [], f"{status} {body}")

        # ---- Player pays ------------------------------------------------------
        ana_booking = book_as(ANA, 1, 14)
        ana = await login(browser, "ana.reyes@test.local", width=390)
        await ana.goto(f"{APP}/bookings/{ana_booking}", wait_until="networkidle")
        await ana.wait_for_selector("text=Amount to pay")
        check("player: sees the server-computed amount due",
              await ana.locator("form").get_by_text("₱250", exact=True).count() == 1)
        check("player: sees the configured account and instructions",
              await ana.get_by_text("09000000001").count() == 1 and await ana.get_by_text("Send the exact amount.").count() == 1)
        check("player: QR code shown", await image_loaded(ana.get_by_role("img", name="GCash QR code")))
        await ana.set_input_files("#proof-file", f"{OUT}/not-an-image.pdf")
        check("player: a non-image file is refused before upload",
              await ana.get_by_text("Upload a photo or screenshot (JPG, PNG or WebP).").count() == 1)
        await ana.get_by_role("button", name="Submit payment for checking").click()
        check("player: cannot submit without a screenshot", await ana.get_by_text("Add a screenshot of your payment.").count() == 1)
        await ana.set_input_files("#proof-file", receipt1)
        check("player: preview of the chosen screenshot", await image_loaded(ana.get_by_role("img", name="Preview of your payment screenshot")))
        await ana.get_by_label("4. Reference number (optional)").fill("GC-0001")
        check("player: no sideways scrolling on a phone", await no_sideways_scroll(ana, 390))
        await ana.get_by_role("button", name="Submit payment for checking").click()
        await ana.wait_for_selector("text=We’re checking your payment", timeout=10000)
        check("player: sees that the payment is being checked", True)
        check("player: booking stays confirmed; payment status shown separately",
              await ana.get_by_text("Payment being checked").count() >= 1 and await ana.get_by_text("Confirmed", exact=True).count() >= 1)
        row = sql(f"select status || '|' || amount_centavos || '|' || reference_no || '|' || (proof_sha256 is not null) "
                  f"from public.payments where booking_id = '{ana_booking}'")
        check("database: submission recorded as waiting, amount from the server, receipt hashed",
              row == "submitted|25000|GC-0001|true", row)
        check("database: booking confirmed / pending_verification",
              sql(f"select status || '/' || payment_status from public.bookings where id = '{ana_booking}'") == "confirmed/pending_verification")
        proof_path = sql(f"select proof_path from public.payments where booking_id = '{ana_booking}'")
        check("storage: receipt saved in the player's private booking folder",
              proof_path.startswith(f"{ANA}/{ana_booking}/")
              and sql("select public from storage.buckets where id = 'payment-proofs'") == "f")

        # ---- API-level refusals (what a modified browser could try) ----------
        status, _ = api("POST", f"/storage/v1/object/payment-proofs/{ANA}/{ana_booking}/x.pdf", token=ana_token,
                        raw=b"%PDF", ctype="application/pdf")
        check("storage: non-image upload refused by the bucket", status == 400)
        status, _ = api("POST", f"/storage/v1/object/payment-proofs/{BEN}/{ana_booking}/x.png", token=ana_token,
                        raw=open(receipt1, "rb").read(), ctype="image/png")
        check("storage: upload into another player's folder refused", status == 400)
        status, body = api("POST", "/rest/v1/rpc/staff_review_payment",
                           {"_payment_id": sql(f"select id from public.payments where booking_id = '{ana_booking}'"), "_approve": True},
                           token=ana_token)
        check("security: a player cannot approve their own payment", status == 403, f"{status} {body}")
        status, _ = api("PATCH", f"/rest/v1/payments?booking_id=eq.{ana_booking}", {"status": "approved"}, token=ana_token)
        check("security: a player cannot change a payment's status directly", status == 403)
        status, _ = api("PATCH", f"/rest/v1/bookings?id=eq.{ana_booking}", {"payment_status": "paid"}, token=ana_token)
        check("security: a player cannot mark the booking paid", status == 403)
        ben_token = token_for("ben.cruz@test.local")
        status, _ = api("POST", f"/storage/v1/object/sign/payment-proofs/{proof_path}", {"expiresIn": 60}, token=ben_token)
        check("security: another player cannot open Ana's receipt", status in (400, 404))
        status, _ = api("POST", f"/storage/v1/object/sign/payment-proofs/{proof_path}", {"expiresIn": 60})
        check("security: visitors cannot open receipts", status in (400, 404))

        # ---- Staff without payments.verify ------------------------------------
        carla = await login(browser, "carla.mendoza@test.local")
        await carla.goto(f"{APP}/admin/payments", wait_until="networkidle")
        check("staff without permission: payments screen refused",
              await carla.get_by_text("This page is for club staff").count() == 1)
        check("staff without permission: no Payments link in the staff menu",
              await carla.get_by_role("navigation", name="Staff").count() == 0
              or await carla.get_by_role("link", name="Payments", exact=True).count() == 0)
        status, _ = api("POST", "/rest/v1/rpc/staff_list_payments", {}, token=token_for("carla.mendoza@test.local"))
        check("staff without permission: verification queue refused by the database", status == 403)

        # ---- Verifier rejects --------------------------------------------------
        dan = await login(browser, "dan.villanueva@test.local")
        await dan.goto(f"{APP}/admin/payments", wait_until="networkidle")
        check("verifier: notified of the new submission",
              await dan.get_by_role("link", name="Notifications, 1 unread").count() == 1)
        card = dan.get_by_role("article").filter(has_text="Ana Reyes")
        await card.wait_for()
        check("verifier: queue shows amount, reference number and player",
              await card.get_by_role("heading", name="₱250").count() == 1 and await card.get_by_text("GC-0001").count() == 1)
        await card.get_by_role("button", name="View receipt").click()
        check("verifier: receipt opens through a signed link", await image_loaded(card.get_by_role("img")))
        await card.get_by_role("button", name="Reject…").click()
        await card.get_by_role("button", name="Reject payment").click()
        reason_box = card.get_by_label("Reason for rejecting (the player will see this)")
        check("verifier: a rejection reason is required",
              await reason_box.evaluate("el => !el.checkValidity()"))
        await reason_box.fill("No matching transfer found for this reference.")
        await card.get_by_role("button", name="Reject payment").click()
        await dan.wait_for_selector("text=No payments waiting", timeout=10000)
        check("verifier: rejected payment leaves the queue", True)
        row = sql(f"select status || '|' || (reviewed_by = '44444444-4444-4444-8444-444444444444') || '|' || (reviewed_at is not null) "
                  f"|| '|' || review_note from public.payments where booking_id = '{ana_booking}'")
        check("database: rejection records reviewer, time and reason",
              row == "rejected|true|true|No matching transfer found for this reference.", row)
        check("database: booking back to confirmed / unpaid",
              sql(f"select status || '/' || payment_status from public.bookings where id = '{ana_booking}'") == "confirmed/unpaid")
        audit = sql("select count(*) from public.audit_log where table_name = 'payments' and action = 'update' "
                    "and actor_id = '44444444-4444-4444-8444-444444444444' and reason like 'No matching%'")
        check("audit: the rejection is in the audit trail with the reviewer and reason", audit == "1", audit)

        # ---- Player sees the rejection and pays again ----------------------
        await ana.reload(wait_until="networkidle")
        check("player: notified of the rejection",
              await ana.get_by_role("link", name="Notifications, 1 unread").count() == 1)
        check("player: sees why the payment was not accepted",
              await ana.get_by_text("Your last payment was not accepted").count() == 1
              and await ana.get_by_text("No matching transfer found for this reference.").count() >= 1)
        await ana.set_input_files("#proof-file", receipt2)
        await ana.get_by_role("button", name="Submit payment for checking").click()
        await ana.wait_for_selector("text=We’re checking your payment", timeout=10000)
        check("player: can submit again after a rejection (reference optional)",
              sql(f"select count(*) from public.payments where booking_id = '{ana_booking}' and status = 'submitted' "
                  "and reference_no is null") == "1")

        # ---- Admin's own booking: cannot approve it --------------------------
        lea_booking = book_as(LEA, 2, 15)
        await lea.goto(f"{APP}/bookings/{lea_booking}", wait_until="networkidle")
        await lea.set_input_files("#proof-file", qr)
        await lea.get_by_role("button", name="Submit payment for checking").click()
        await lea.wait_for_selector("text=We’re checking your payment", timeout=10000)
        await lea.goto(f"{APP}/admin/payments", wait_until="networkidle")
        own = lea.get_by_role("article").filter(has_text="Lea Navarro")
        await own.wait_for()
        check("admin: own payment is marked and cannot be approved",
              await own.get_by_text("You can’t review a payment for your own booking").count() == 1
              and await own.get_by_role("button", name="Approve…").count() == 0)
        status, body = api("POST", "/rest/v1/rpc/staff_review_payment",
                           {"_payment_id": sql(f"select id from public.payments where booking_id = '{lea_booking}'"),
                            "_approve": True}, token=token_for("lea.navarro@test.local"))
        check("admin: the database refuses self-approval too", status == 403 and "own booking" in body.get("message", ""), body)

        # ---- Verifier approves ------------------------------------------------
        await dan.reload(wait_until="networkidle")
        card = dan.get_by_role("article").filter(has_text="Ana Reyes")
        await card.get_by_role("button", name="Approve…").click()
        await card.get_by_role("button", name="Yes, approve payment").click()
        await card.wait_for(state="detached", timeout=10000)
        check("verifier: approved payment leaves the queue", True)
        check("database: approval marks the booking paid and keeps it confirmed",
              sql(f"select status || '/' || payment_status from public.bookings where id = '{ana_booking}'") == "confirmed/paid")
        await dan.get_by_role("tab", name="Approved").click()
        await dan.wait_for_selector("text=Approved by", timeout=10000)
        check("verifier: approved list shows who approved it",
              await dan.get_by_text(re.compile(r"Approved by Dan Villanueva")).count() == 1)

        await ana.reload(wait_until="networkidle")
        check("player: sees the booking as paid", await ana.get_by_text("Paid", exact=True).count() >= 1
              and await ana.get_by_role("button", name="Submit payment for checking").count() == 0)
        await ana.goto(f"{APP}/notifications", wait_until="networkidle")
        check("player: notification list has the approval and the rejection",
              await ana.get_by_text("Payment approved").count() == 1 and await ana.get_by_text("Payment not accepted").count() == 1)
        await ana.get_by_role("button", name="Mark all as read").click()
        await ana.wait_for_selector("text=Mark all as read", state="detached")
        check("player: notifications marked read", await ana.get_by_role("link", name="Notifications", exact=True).count() == 1)

        # ---- Dashboard, search, player lookup ---------------------------------
        await dan.goto(f"{APP}/admin", wait_until="networkidle")
        await dan.wait_for_selector("text=Payments to check")
        tile = dan.get_by_role("link").filter(has_text="Payments to check")
        check("dashboard: one payment waiting (the admin's own)", await tile.get_by_text("1", exact=True).count() == 1)
        check("dashboard: payment setup shown as healthy", await dan.get_by_text("1 payment method enabled").count() == 1)
        await dan.goto(f"{APP}/admin/bookings?q=ana", wait_until="networkidle")
        await dan.wait_for_selector("text=1 booking")
        check("bookings: search by player name finds Ana's paid booking",
              await dan.locator("main li").filter(has_text="Ana Reyes").get_by_text("Paid", exact=True).count() == 1)
        await dan.goto(f"{APP}/admin/bookings?payment=pending_verification", wait_until="networkidle")
        await dan.wait_for_selector("text=1 booking")
        check("bookings: filter by payment status", await dan.get_by_text("Lea Navarro").count() == 1)
        await dan.goto(f"{APP}/admin/players?q=reyes", wait_until="networkidle")
        await dan.wait_for_selector("text=Ana Reyes")
        check("players: lookup shows phone and booking counts",
              await dan.get_by_text("09171234567").count() == 1)
        check("players: email hidden from staff without players.manage",
              await dan.get_by_text("ana.reyes@test.local").count() == 0)
        await lea.goto(f"{APP}/admin/players?q=reyes", wait_until="networkidle")
        await lea.wait_for_selector("text=Ana Reyes")
        check("players: admins see the email", await lea.get_by_text(re.compile("ana.reyes@test.local")).count() == 1)

        mobile = await login(browser, "dan.villanueva@test.local", width=390)
        for path in ("/admin", "/admin/payments?status=approved", "/admin/bookings", "/admin/players?q=reyes"):
            await mobile.goto(f"{APP}{path}", wait_until="networkidle")
            await mobile.wait_for_timeout(300)
            check(f"mobile: {path} has no sideways scrolling", await no_sideways_scroll(mobile, 390))
        await mobile.screenshot(path=f"{OUT}/players-mobile.png", full_page=True)
        await dan.goto(f"{APP}/admin", wait_until="networkidle")
        await dan.screenshot(path=f"{OUT}/dashboard.png", full_page=True)
        await ana.goto(f"{APP}/bookings/{ana_booking}", wait_until="networkidle")
        await ana.screenshot(path=f"{OUT}/player-paid.png", full_page=True)
        await browser.close()

    check("no JavaScript errors on any page", not errors, "; ".join(errors)[:400])
    failed = 0
    for ok, name, detail in results:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {detail}"))
        failed += 0 if ok else 1
    print(f"\n# {len(results) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
