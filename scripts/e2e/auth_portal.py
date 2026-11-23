"""
Acceptance tests for the full-screen sign-in portal (AuthLayout), against the
local test stack with the production headers (scripts/e2e/setup_local.sh).

  scripts/e2e/setup_local.sh /tmp/dd-e2e
  python3 scripts/e2e/auth_portal.py /tmp/dd-e2e

Sign-up and password-reset requests are covered by auth_simulated.py (the
local API stand-in has no sign-up or email endpoints).
"""
import asyncio
import sys

from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/dd-e2e"
APP = "http://localhost:4175"
AUTH_PAGES = ["/login", "/signup", "/login?mode=register", "/forgot-password", "/reset-password", "/auth/callback"]
results, errors = [], []


def check(name, ok, detail=""):
    results.append((bool(ok), name, detail))


async def new_page(browser, width=1440, height=900, reduced=False):
    ctx = await browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce" if reduced else "no-preference")
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "/realtime/v1/websocket" not in m.text else None)
    return page


CONTRAST = """([fgSel, bgSel]) => {
  // Resolve any CSS colour (rgb, oklab, color-mix…) to sRGB pixels via a canvas.
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const px = (fill, under) => { ctx.clearRect(0, 0, 1, 1); if (under) { ctx.fillStyle = under; ctx.fillRect(0, 0, 1, 1) } ctx.fillStyle = fill; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data] }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const bgColor = getComputedStyle(document.querySelector(bgSel)).backgroundColor
  const alpha = px(bgColor)[3] / 255
  // Worst case: the panel over the darkest purple of the background
  const bg = px(bgColor, 'rgb(32, 8, 66)')
  const fg = px(getComputedStyle(document.querySelector(fgSel)).color, `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`)
  const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return { ratio: (l1 + 0.05) / (l2 + 0.05), alpha }
}"""


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # 1–3. No public header, navigation or footer on any auth screen
        page = await new_page(browser)
        for path in AUTH_PAGES:
            await page.goto(APP + path, wait_until="networkidle")
            await page.wait_for_timeout(300)
            banners = await page.locator("header").count()
            footers = await page.locator("footer").count()
            nav = await page.get_by_role("navigation", name="Main").count()
            check(f"{path}: no public header, navigation or footer", banners == 0 and footers == 0 and nav == 0,
                  f"header={banners} footer={footers} nav={nav}")
            check(f"{path}: one page heading and the court background", await page.locator("h1").count() == 1
                  and await page.get_by_test_id("auth-court-background").count() == 1)
        await page.goto(APP + "/", wait_until="networkidle")
        check("homepage still has its header and footer", await page.locator("header").count() == 1 and await page.locator("footer").count() == 1)

        # 4–6. Background, readability, logo
        await page.goto(APP + "/login", wait_until="networkidle")
        await page.wait_for_timeout(2500)
        bg = page.get_by_test_id("auth-court-background")
        check("background is decorative: hidden from assistive tech and never takes clicks",
              await bg.get_attribute("aria-hidden") == "true" and await bg.evaluate("e => getComputedStyle(e).pointerEvents") == "none")
        hit = await page.evaluate("""() => { const i = document.querySelector('input[name=email]'); const r = i.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === i }""")
        check("form controls receive clicks (nothing on top of them)", hit)
        base = await bg.evaluate("e => getComputedStyle(e.querySelector('.auth-tone')).backgroundImage")
        check("background uses the brand purple tones", "rgb(72, 21, 138)" in base and "rgb(56, 15, 110)" in base, base[:160])
        lines = await bg.evaluate("e => [...e.querySelectorAll('svg')].length")
        check("background draws two oversized court outlines (boundary, kitchen, centre lines, net)",
              lines == 2 and await bg.locator("svg").first.locator("path").count() == 6)
        card = "section[aria-labelledby]"
        heading = await page.evaluate(CONTRAST, ["#auth-title", card])
        body = await page.evaluate(CONTRAST, ["label", card])
        check("form stays readable: panel is opaque enough and text meets WCAG AA contrast",
              heading["alpha"] >= 0.95 and heading["ratio"] >= 4.5 and body["ratio"] >= 4.5, f"{heading} {body}")
        logo = await page.evaluate("""() => { const img = document.querySelector('section img'); const r = img.getBoundingClientRect();
          return { fit: getComputedStyle(img).objectFit, natural: img.naturalWidth / img.naturalHeight, box: r.width / r.height, loaded: img.complete && img.naturalWidth > 0 } }""")
        check("official logo loads and is not distorted (object-fit: contain or matching aspect ratio)",
              logo["loaded"] and (logo["fit"] == "contain" or abs(logo["natural"] - logo["box"]) < 0.01), logo)
        heading_text = (await page.locator("#auth-title").inner_text()).strip().lower()
        check("heading and supporting text", heading_text == "sign in to book"
              and await page.get_by_text("Welcome back. Sign in to book courts and manage your games.").count() == 1, heading_text)
        check("Sign in and Create account tabs", await page.get_by_role("tab", name="Sign in").count() == 1
              and await page.get_by_role("tab", name="Create account").count() == 1)
        await page.get_by_role("tab", name="Create account").click()
        await page.wait_for_selector("input[name=fullName]")
        check("Create account tab opens the registration form at /signup",
              "/signup" in page.url and await page.locator("input[name=fullName]").count() == 1)
        await page.get_by_role("tab", name="Sign in").click()

        # Password visibility toggle
        pw = page.locator("input[name=password]")
        await pw.fill("secret123")
        await page.get_by_role("button", name="Show password").click()
        shown = await pw.get_attribute("type")
        await page.get_by_role("button", name="Hide password").click()
        check("password visibility toggle shows and hides the password", shown == "text" and await pw.get_attribute("type") == "password")

        # Validation still works
        await pw.fill("")
        await page.get_by_role("button", name="Sign in", exact=True).click()
        check("validation messages still appear", await page.locator("[id$=-error]").count() >= 1)

        # Motion: on by default, off under reduced motion, simplified on phones
        motion = await page.evaluate("""() => ({ main: getComputedStyle(document.querySelector('.auth-court--main')).animationName,
          ball: getComputedStyle(document.querySelector('.auth-ball:not(.auth-ball--trail)')).animationName,
          sweep: getComputedStyle(document.querySelector('.auth-sweep > *')).animationName })""")
        check("desktop: court pans, light sweeps the lines, the ball travels", motion == {"main": "auth-pan-main", "ball": "auth-ball", "sweep": "auth-sweep"}, motion)
        transform_only = await page.evaluate("""() => { const names = new Set(); for (const sheet of document.styleSheets) { let rules; try { rules = sheet.cssRules } catch { continue }
          for (const r of rules) { const walk = (rr) => { if (rr.type === 7 && rr.name.startsWith('auth-pan') || rr.name === 'auth-ball') for (const k of rr.cssRules) for (const p of k.style) names.add(p); if (rr.cssRules) for (const c of rr.cssRules) walk(c) }; walk(r) } }
          return [...names] }""")
        check("moving layers animate only transform and opacity (GPU-composited)",
              set(transform_only) <= {"transform", "opacity"} and "transform" in transform_only, transform_only)
        reduced = await new_page(browser, reduced=True)
        await reduced.goto(APP + "/login", wait_until="networkidle")
        r = await reduced.evaluate("""() => ({ main: getComputedStyle(document.querySelector('.auth-court--main')).animationName,
          line: getComputedStyle(document.querySelector('.court-draw > *')).animationName,
          ball: getComputedStyle(document.querySelector('.auth-ball')).display,
          sweep: getComputedStyle(document.querySelector('.auth-sweep')).display })""")
        check("reduced motion: no panning, no line drawing, no ball, no light sweep",
              r == {"main": "none", "line": "none", "ball": "none", "sweep": "none"}, r)
        phone = await new_page(browser, 360, 740)
        await phone.goto(APP + "/login", wait_until="networkidle")
        ph = await phone.evaluate("""() => ({ ball: getComputedStyle(document.querySelector('.auth-ball')).display,
          far: getComputedStyle(document.querySelector('.auth-court--far')).display,
          main: getComputedStyle(document.querySelector('.auth-court--main')).animationName })""")
        check("phone: simplified background (one slow court, no ball or sweep)", ph == {"ball": "none", "far": "none", "main": "auth-pan-phone"}, ph)

        # 12. Layout at phone, tablet and desktop widths; short screens scroll
        for w, h in ((360, 640), (390, 844), (768, 1024), (1024, 768), (1440, 900)):
            pg = await new_page(browser, w, h)
            for path in AUTH_PAGES[:3]:
                await pg.goto(APP + path, wait_until="networkidle")
                sw = await pg.evaluate("document.documentElement.scrollWidth")
                check(f"{w}x{h} {path}: no sideways scrolling", sw <= w, f"scrollWidth={sw}")
        short = await new_page(browser, 360, 560)
        await short.goto(APP + "/login?mode=register", wait_until="networkidle")
        btn = short.get_by_role("button", name="Create account", exact=True).last
        await btn.scroll_into_view_if_needed()
        check("short screen: the page scrolls and the last button is reachable",
              await short.evaluate("document.documentElement.scrollHeight > innerHeight") and await btn.is_visible())

        # 7 & 9. Sign-in and role redirects
        player = await new_page(browser)
        await player.goto(APP + "/bookings", wait_until="networkidle")
        check("signed-out visit to a player page goes to sign-in with next", "/login?next=%2Fplayer%2Fbookings" in player.url, player.url)
        await player.fill("input[name=email]", "ana.reyes@test.local")
        await player.fill("input[name=password]", "courts2026")
        await player.get_by_role("button", name="Sign in", exact=True).click()
        await player.wait_for_url("**/player/bookings", timeout=15000)
        check("player sign-in returns to the requested page", True)
        await player.goto(APP + "/admin", wait_until="networkidle")
        check("player is still refused the staff area", await player.get_by_text("This page is for club staff").count() == 1)
        await player.goto(APP + "/login", wait_until="networkidle")
        await player.wait_for_url("**/player/dashboard", timeout=10000)
        check("signed-in visit to /login goes to the player dashboard", True)

        admin = await new_page(browser)
        await admin.goto(APP + "/admin/settings", wait_until="networkidle")
        await admin.fill("input[name=email]", "lea.navarro@test.local")
        await admin.fill("input[name=password]", "courts2026")
        await admin.get_by_role("button", name="Sign in", exact=True).click()
        await admin.wait_for_url("**/admin/settings", timeout=15000)
        await admin.wait_for_selector("text=Weekly opening hours")
        check("admin sign-in returns to the admin page and it loads", True)

        bad = await (await browser.new_context(viewport={"width": 1440, "height": 900})).new_page()  # its 400 response is expected
        await bad.goto(APP + "/login", wait_until="networkidle")
        await bad.fill("input[name=email]", "ana.reyes@test.local")
        await bad.fill("input[name=password]", "wrongpass1")
        await bad.get_by_role("button", name="Sign in", exact=True).click()
        await bad.wait_for_selector("text=That email and password do not match")
        check("wrong password shows the clear error", True)

        # Screenshots for review
        for w, h, name in ((1440, 900, "desktop"), (820, 1180, "tablet"), (390, 844, "phone")):
            pg = await new_page(browser, w, h)
            await pg.goto(APP + "/login", wait_until="networkidle")
            await pg.wait_for_timeout(2600)
            await pg.screenshot(path=f"{OUT}/portal-login-{name}.png")
        await browser.close()

    check("no script errors or blocked resources on any page", not errors, "; ".join(errors)[:300])
    failed = 0
    for ok, name, detail in results:
        print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else f"\n     {str(detail)[:300]}"))
        failed += 0 if ok else 1
    print(f"\n# {len(results) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
