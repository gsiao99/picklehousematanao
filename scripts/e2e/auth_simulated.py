# Browser test of the auth screens against a SIMULATED Supabase API.
#
# Setup (two production builds, served side by side):
#   npx vite build && npx vite preview --port 4173 &
#   VITE_SUPABASE_URL=https://dd-test.example.com VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_localtest \
#     VITE_SITE_URL=http://localhost:4174 npx vite build --outDir /tmp/dist-fake
#   npx vite preview --outDir /tmp/dist-fake --port 4174 &
#   pip install playwright && playwright install chromium
#   python3 scripts/e2e/auth_simulated.py /tmp
#
# Requests to the fake project URL are answered by this script the way
# Supabase Auth and PostgREST would. This checks UI flows and the exact
# requests the app sends; it does not replace testing against a real project.
import asyncio, base64, json, sys, time
from playwright.async_api import async_playwright

OUT = sys.argv[1]
API = "https://dd-test.example.com"
results = []


def check(name, cond, detail=""):
    results.append((bool(cond), name, detail))


def b64(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


ADMIN_ID = "55555555-5555-4555-8555-555555555555"
exp = int(time.time()) + 3600
fake_jwt = ".".join([b64({"alg": "HS256", "typ": "JWT"}),
                     b64({"sub": ADMIN_ID, "role": "authenticated", "exp": exp, "aud": "authenticated",
                          "email": "lea.navarro@test.local", "session_id": "s1"}), "sig"])
user = {"id": ADMIN_ID, "aud": "authenticated", "role": "authenticated", "email": "lea.navarro@test.local",
        "app_metadata": {"provider": "email"}, "user_metadata": {}, "created_at": "2026-10-11T00:00:00Z"}
session = {"access_token": fake_jwt, "token_type": "bearer", "expires_in": 3600, "expires_at": exp,
           "refresh_token": "r1", "user": user}
profile = {"id": ADMIN_ID, "full_name": "Lea Navarro", "display_name": None, "phone": "09171234567",
           "self_rated_level": "advanced", "level": None, "avatar_path": None, "leaderboard_opt_out": False,
           "status": "active", "privacy_consent_at": None, "created_at": "2026-10-11T00:00:00Z",
           "updated_at": "2026-10-11T00:00:00Z"}

seen = {"signup_body": None, "signup_url": "", "recover": 0, "recover_url": "", "rpc": []}
mode = {"login": "fail"}


async def handle(route):
    req = route.request
    url = req.url
    path = url.replace(API, "").split("?")[0]
    body = req.post_data_json if req.post_data else None
    cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*",
            "access-control-allow-methods": "*", "content-type": "application/json"}
    if req.method == "OPTIONS":
        return await route.fulfill(status=204, headers=cors)
    if path == "/auth/v1/signup":
        seen["signup_body"] = body
        seen["signup_url"] = url
        return await route.fulfill(status=200, headers=cors, body=json.dumps(
            {**user, "id": "11111111-1111-4111-8111-111111111111", "email": body["email"], "identities": []}))
    if path == "/auth/v1/token":
        if mode["login"] == "fail":
            return await route.fulfill(status=400, headers=cors, body=json.dumps(
                {"code": "invalid_credentials", "error_code": "invalid_credentials", "msg": "Invalid login credentials"}))
        return await route.fulfill(status=200, headers=cors, body=json.dumps(session))
    if path == "/auth/v1/recover":
        seen["recover"] += 1
        seen["recover_url"] = url
        return await route.fulfill(status=200, headers=cors, body="{}")
    if path == "/auth/v1/user":
        return await route.fulfill(status=200, headers=cors, body=json.dumps(user))
    if path == "/auth/v1/logout":
        return await route.fulfill(status=204, headers=cors)
    if path == "/rest/v1/rpc/get_my_access":
        seen["rpc"].append("get_my_access")
        return await route.fulfill(status=200, headers=cors, body=json.dumps(
            [{"user_id": ADMIN_ID, "roles": ["admin", "player"], "permissions": ["payments.verify"], "status": "active"}]))
    if path == "/rest/v1/rpc/admin_list_members":
        seen["rpc"].append("admin_list_members")
        return await route.fulfill(status=200, headers=cors, body=json.dumps([
            {"id": ADMIN_ID, "full_name": "Lea Navarro", "email": "lea.navarro@test.local", "phone": None,
             "roles": ["admin", "player"], "permissions": [], "status": "active", "created_at": "2026-10-11T00:00:00Z"},
            {"id": "22222222-2222-4222-8222-222222222222", "full_name": "Ben Cruz", "email": "ben.cruz@test.local",
             "phone": "09181234567", "roles": ["player"], "permissions": [], "status": "active",
             "created_at": "2026-10-11T00:00:00Z"}]))
    if path == "/rest/v1/rpc/admin_grant_role":
        seen["rpc"].append(("admin_grant_role", body))
        return await route.fulfill(status=204, headers=cors)
    if path == "/rest/v1/rpc/admin_set_staff_permissions":
        seen["rpc"].append(("admin_set_staff_permissions", body))
        return await route.fulfill(status=204, headers=cors)
    if path == "/rest/v1/profiles":
        return await route.fulfill(status=200, headers=cors, body=json.dumps(profile))
    return await route.fulfill(status=404, headers=cors, body=json.dumps({"message": "not mocked: " + path}))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ---- A. Unconfigured build: honest notice, no crash ------------------
        pg = await b.new_page(viewport={"width": 390, "height": 844})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://localhost:4173/login", wait_until="networkidle")
        check("unconfigured: /login says accounts are not open", "not open yet" in await pg.inner_text("main"))
        await pg.goto("http://localhost:4173/account", wait_until="networkidle")
        check("unconfigured: /account shows the same notice", "not open yet" in await pg.inner_text("main"))
        check("unconfigured: no page errors", not errs, str(errs))
        await pg.close()

        # ---- B. Configured build against the simulated API -------------------
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        await ctx.route(API + "/**", handle)
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))

        await pg.goto("http://localhost:4174/account", wait_until="networkidle")
        check("signed out: /account redirects to sign-in with next", "/login?next=%2Fplayer%2Fprofile" in pg.url, pg.url)

        await pg.click("button[type=submit]")
        check("sign-in: empty form shows field errors", await pg.is_visible("text=Enter a valid email address."))

        await pg.fill("input[name=email]", "lea.navarro@test.local")
        await pg.fill("input[name=password]", "wrongpass1")
        await pg.click("button[type=submit]")
        await pg.wait_for_selector("text=do not match")
        check("sign-in: wrong password shows a clear message", True)

        # Register
        await pg.click("role=tab[name='Create account']")
        await pg.click("button[type=submit]")
        check("register: requires consent", await pg.is_visible("text=Agree to the Terms"))
        await pg.fill("input[name=fullName]", "Ana Reyes")
        await pg.fill("input[name=email]", "Ana.Reyes@Example.com")
        await pg.fill("input[name=phone]", "+63 917 123 4567")
        await pg.select_option("select[name=selfRatedLevel]", "novice")
        await pg.fill("input[name=password]", "courts2026")
        await pg.check("input[name=consent]")
        await pg.click("button[type=submit]")
        await pg.wait_for_selector("text=Check your inbox")
        await pg.screenshot(path=f"{OUT}/e2e-register-sent.png")
        sb = seen["signup_body"] or {}
        check("register: confirmation screen shown", True)
        check("register: request has normalised email and phone",
              sb.get("email") == "ana.reyes@example.com" and sb.get("data", {}).get("phone") == "09171234567", json.dumps(sb))
        check("register: request carries no role or permission",
              not any(k in json.dumps(sb.get("data", {})) for k in ("role", "admin", "staff", "permission")),
              json.dumps(sb.get("data")))
        check("register: request does not send the password in metadata", "courts2026" not in json.dumps(sb.get("data", {})))
        from urllib.parse import parse_qs, urlparse
        confirm_to = parse_qs(urlparse(seen["signup_url"]).query).get("redirect_to", [""])[0]
        check("auth redirect: confirmation email returns to VITE_SITE_URL/auth/callback",
              confirm_to == "http://localhost:4174/auth/callback", seen["signup_url"])

        # Forgot password
        await pg.goto("http://localhost:4174/forgot-password", wait_until="networkidle")
        await pg.fill("input[name=email]", "ana.reyes@example.com")
        await pg.click("button[type=submit]")
        await pg.wait_for_selector("text=If an account uses that email")
        check("forgot password: generic confirmation, reset requested", seen["recover"] == 1)
        reset_to = parse_qs(urlparse(seen["recover_url"]).query).get("redirect_to", [""])[0]
        check("auth redirect: reset email returns to VITE_SITE_URL/reset-password",
              reset_to == "http://localhost:4174/reset-password", seen["recover_url"])

        # Successful sign-in as admin
        mode["login"] = "ok"
        await pg.goto("http://localhost:4174/login?next=%2Fadmin%2Fmembers", wait_until="networkidle")
        await pg.fill("input[name=email]", "lea.navarro@test.local")
        await pg.fill("input[name=password]", "courts2026")
        await pg.click("button[type=submit]")
        await pg.wait_for_url("**/admin/members", timeout=10000)
        await pg.wait_for_selector("text=Ben Cruz")
        check("sign-in: returns to the requested page", True)
        check("access comes from get_my_access", "get_my_access" in seen["rpc"])

        await pg.click("text=Ben Cruz")
        await pg.check("text=Staff — front-desk access, plus the permissions below")
        await pg.check("text=Verify payments")
        await pg.click("button[type=submit]:has-text('Save changes')")
        check("admin: a change without a reason is blocked", await pg.is_visible("text=Give a short reason"))
        await pg.fill("input[placeholder^='e.g.']", "Hired as front-desk cashier")
        await pg.click("button[type=submit]:has-text('Save changes')")
        await pg.wait_for_selector("text=Changes saved.")
        grants = [r for r in seen["rpc"] if isinstance(r, tuple)]
        check("admin: grant role then set permissions, both with the reason",
              grants[:2] == [("admin_grant_role", {"_user_id": "22222222-2222-4222-8222-222222222222", "_role": "staff",
                                                   "_reason": "Hired as front-desk cashier"}),
                             ("admin_set_staff_permissions", {"_user_id": "22222222-2222-4222-8222-222222222222",
                                                              "_permissions": ["payments.verify"],
                                                              "_reason": "Hired as front-desk cashier"})],
              json.dumps(grants))
        check("admin: no sideways scrolling on a phone", await pg.evaluate("document.documentElement.scrollWidth") <= 390)
        await pg.screenshot(path=f"{OUT}/e2e-members.png", full_page=True)

        await pg.goto("http://localhost:4174/account", wait_until="networkidle")
        await pg.wait_for_selector("h1:has-text(\"My profile\")")
        check("account: profile loads with the player's name",
              await pg.input_value("input[name=fullName]") == "Lea Navarro")
        await pg.screenshot(path=f"{OUT}/e2e-account.png", full_page=True)
        check("configured: no page errors", not errs, str(errs))
        await b.close()

    failed = 0
    for ok, name, detail in results:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {detail}"))
        failed += 0 if ok else 1
    print(f"\n{len(results) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
