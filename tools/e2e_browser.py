#!/usr/bin/env python
"""Full-stack browser E2E: Next.js (3000) → FastAPI (8000) → Supabase + OpenAI, driven by Playwright.

    .venv/bin/python tools/e2e_browser.py [--web http://localhost:3000] [--shots design/review-app]

Signs up a throwaway user in the real UI, generates a campaign with the live SSE stages, exercises
feedback, checks, config, chat, memory, credits, compare and export, screenshots every screen in
light + dark, then deletes the user.
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid
from pathlib import Path

import httpx
from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import get_settings  # noqa: E402

S = get_settings()
fails: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("  ok  " if cond else "  FAIL") + " " + msg)
    if not cond:
        fails.append(msg)


def shot(page: Page, out: Path, name: str) -> None:
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / f"{name}.png"), full_page=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", default="http://localhost:3000")
    ap.add_argument("--shots", default="design/review-app")
    ap.add_argument("--keep-user", action="store_true")
    a = ap.parse_args()
    out = ROOT / a.shots
    out.mkdir(parents=True, exist_ok=True)
    email = f"e2e-ui-{uuid.uuid4().hex[:6]}@example.com"
    user_id: str | None = None

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            # ---- sign up through the UI
            page.goto(f"{a.web}/login/")
            page.wait_for_selector("#email")
            shot(page, out, "01-login")
            page.click("a:has-text('Create an account')")
            page.fill("#name", "E2E Reviewer")
            page.fill("#email", email)
            page.fill("#pw", "disco-demo-123")
            page.click("#submit")
            page.wait_for_url("**/dashboard/**", timeout=30000)
            page.wait_for_selector(".credit-pill span:has-text('100')", timeout=30000)
            check(True, "signup → dashboard with 100 credits")
            shot(page, out, "02-dashboard-empty")

            # ---- vague brief → clarity gate → answers → streamed generation
            page.fill("#desc", "We help people feel better.")
            page.click("#go")
            page.wait_for_url("**/new/**")
            page.wait_for_selector(".meter", timeout=30000)
            check(page.locator("#gen").is_disabled(), "clarity gate disables Generate on a vague brief")
            check(page.locator(".q").count() == 3, "three clarifying questions rendered")
            shot(page, out, "03-clarity-gate")
            for i in range(3):
                page.locator(f".q >> nth={i} >> .chip").first.click()
            expect(page.locator("#gen")).to_be_enabled()
            page.click("#gen")
            page.wait_for_selector(".pstep.done", timeout=60000)
            shot(page, out, "04-generating")
            page.wait_for_url("**/campaign/?id=*", timeout=120000)
            page.wait_for_selector(".sumstrip", timeout=30000)
            cid = page.url.split("id=")[1].split("&")[0]
            check(True, f"campaign generated and opened ({cid})")
            bal1 = int(page.locator(".credit-pill span").inner_text())
            check(bal1 <= 90, f"credits charged for generation (balance {bal1})")
            shot(page, out, "05-overview")

            # ---- publishers: feedback repair + drop
            page.goto(f"{a.web}/campaign/?id={cid}&tab=publishers")
            page.wait_for_selector(".pubcard")
            n = page.locator(".pubcard").count()
            shot(page, out, "06-publishers")
            page.locator(".pubcard").last.locator("button:has-text('Drop')").click()
            page.wait_for_function(f"document.querySelectorAll('.pubcard').length === {n - 1}", timeout=20000)
            check(int(page.locator(".credit-pill span").inner_text()) == bal1, "drop publisher is free")

            # ---- creatives: 👎 with comment → repair (charged)
            page.goto(f"{a.web}/campaign/?id={cid}&tab=creatives")
            page.wait_for_selector(".creative .ad h4")
            first = page.locator(".creative .ad h4").first.inner_text()
            page.locator(".creative").first.locator("button[aria-label*='Needs work']").click()
            page.fill(".popover textarea", "too clinical, make it warmer")
            page.click(".popover button:has-text('Send & fix')")
            page.wait_for_function(f"document.querySelector('.creative .ad h4').innerText !== {first!r}", timeout=60000)
            bal2 = int(page.locator(".credit-pill span").inner_text())
            check(bal2 < bal1, f"feedback repair rewrote the creative and charged ({bal1}→{bal2})")
            shot(page, out, "07-creatives")
            # inline edit (free)
            page.locator(".creative").first.locator("button[aria-label='Edit creative']").click()
            page.fill(".creative .edit input >> nth=0", "Edited in the browser.")
            page.click(".creative .edit button:has-text('Save')")
            page.wait_for_selector(".creative .ad h4:has-text('Edited in the browser.')", timeout=20000)
            check(int(page.locator(".credit-pill span").inner_text()) == bal2, "manual edit is free")

            # ---- checks tab
            page.goto(f"{a.web}/campaign/?id={cid}&tab=checks")
            page.wait_for_selector(".checkrow")
            check(page.locator(".checkrow").count() == 11, "11 checks rendered")
            shot(page, out, "08-checks")

            # ---- config: slider + save
            page.goto(f"{a.web}/campaign/?id={cid}&tab=config")
            page.wait_for_selector("#f_total")
            page.fill("#f_total", "15000")
            page.fill("#f_daily", "500")
            page.click("button:has-text('Save changes')")
            page.wait_for_selector(".toast:has-text('Config saved')", timeout=20000)
            check(True, "config saved")
            shot(page, out, "09-config")

            # ---- export
            page.goto(f"{a.web}/campaign/?id={cid}&tab=export")
            page.wait_for_selector(".brief")
            with page.expect_download(timeout=30000) as dl:
                page.click("button:has-text('Download PDF')")
            path = dl.value.path()
            check(path is not None and Path(path).read_bytes()[:4] == b"%PDF", "PDF downloaded through the authenticated API")
            shot(page, out, "10-export")

            # ---- chat: memory + edit
            page.goto(f"{a.web}/chat/?c={cid}")
            page.wait_for_selector("#ci")
            page.fill("#ci", "Never use Swiftcart")
            page.press("#ci", "Enter")
            page.wait_for_selector(".minicard:has-text('Saved to memory')", timeout=60000)
            check(True, "chat saved a preference")
            page.fill("#ci", "Why does the top publisher rank first?")
            page.press("#ci", "Enter")
            page.wait_for_function("document.querySelectorAll('.msg.ai').length >= 2 && !document.querySelector('.msg.ai .typing')", timeout=60000)
            check("rank" in page.locator(".msg.ai").last.inner_text().lower() or len(page.locator(".msg.ai").last.inner_text()) > 40, "chat answered the explain question")
            shot(page, out, "11-chat")

            # ---- memory page reflects it
            page.goto(f"{a.web}/memory/")
            page.wait_for_selector("#p_ban")
            page.wait_for_function("document.querySelectorAll('#p_ban option:checked').length >= 1", timeout=20000)
            check(True, "memory page lists the banned publisher")
            page.fill("#factText", "Our AOV is $85")
            page.click("button:has-text('Add')")
            page.wait_for_selector(".memrow:has-text('Our AOV is $85')", timeout=20000)
            shot(page, out, "12-memory")

            # ---- second campaign via dashboard hero (clear brief) → history compare
            page.goto(f"{a.web}/dashboard/")
            page.wait_for_selector("#desc")
            page.fill("#desc", "A sustainable activewear brand for women. Made from recycled ocean plastic. Price point sits between Lululemon and Girlfriend Collective.")
            page.click("#go")
            page.wait_for_url("**/new/**")
            page.wait_for_selector("#gen:not([disabled])", timeout=30000)
            page.click("#gen")
            page.wait_for_url("**/campaign/?id=*", timeout=120000)
            page.wait_for_selector(".sumstrip")
            page.goto(f"{a.web}/history/")
            page.wait_for_function("document.querySelectorAll('tbody tr').length === 2", timeout=20000)
            check(True, "history lists 2 campaigns")
            page.locator("tbody input[type=checkbox]").nth(0).check()
            page.locator("tbody input[type=checkbox]").nth(1).check()
            shot(page, out, "13-history")
            page.click("button:has-text('Compare selected')")
            page.wait_for_selector(".cmp", timeout=20000)
            check(page.locator(".delta").count() >= 3, "compare shows deltas")
            shot(page, out, "14-compare")

            # ---- credits ledger
            page.goto(f"{a.web}/credits/")
            page.wait_for_selector(".ledger tbody tr")
            rows = page.locator(".ledger td.neg, .ledger td.pos").all_inner_texts()
            total = sum(int(t.replace("+", "")) for t in rows)
            shown = int(page.locator(".credit-pill span").inner_text())
            check(total == shown, f"ledger sum {total} == balance {shown}")
            shot(page, out, "15-credits")

            # ---- dark mode + mobile snapshots
            page.click("button:has-text('Toggle theme')")
            page.goto(f"{a.web}/campaign/?id={cid}")
            page.wait_for_selector(".sumstrip")
            shot(page, out, "16-overview-dark")
            page.set_viewport_size({"width": 400, "height": 860})
            page.goto(f"{a.web}/new/")
            page.wait_for_selector("#desc")
            shot(page, out, "17-new-mobile")
            page.goto(f"{a.web}/campaign/?id={cid}&tab=publishers")
            page.wait_for_selector(".pubcard")
            check(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "no horizontal scroll on mobile")
            shot(page, out, "18-publishers-mobile")

            check(not errors, f"no page errors ({errors[:2]})")
            # capture user id for cleanup
            user_id = page.evaluate("() => { const k = Object.keys(localStorage).find(k => k.startsWith('sb-')); return k ? JSON.parse(localStorage.getItem(k)).user.id : null }")
        finally:
            browser.close()
            if user_id and not a.keep_user:
                httpx.delete(f"{S.supabase_url}/auth/v1/admin/users/{user_id}", headers={"apikey": S.supabase_service_role_key, "Authorization": f"Bearer {S.supabase_service_role_key}"}, timeout=30)
    print("\nRESULT:", "FAILED" if fails else "ALL GOOD", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
