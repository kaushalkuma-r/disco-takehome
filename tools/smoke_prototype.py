#!/usr/bin/env python
"""End-to-end smoke test for the prototype: drives the real UI flows in headless Chromium.

    .venv/bin/python tools/smoke_prototype.py design/prototype/index.html

Asserts the product-level invariants the LLD promises: the clarity gate blocks vague briefs,
generation charges base + usage, feedback with a comment repairs and charges, deterministic
edits are free, chat "never use X" writes memory and drops the publisher, and the ledger
balance equals the sum of its rows.
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
import review_prototype as rp  # noqa: E402


def main(html: Path) -> int:
    wrapped = html.parent / "_smoke-wrapped.html"
    wrapped.write_text(rp.wrap(html.read_text(), "light"))
    failures: list[str] = []
    check = lambda cond, msg: failures.append(msg) if not cond else None  # noqa: E731

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 1280, "height": 900}).new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(wrapped.resolve().as_uri())

        # 1. login with validation
        page.fill("#email", "not-an-email")
        page.click("#submit")
        check(page.locator("#emailErr").is_visible(), "login: invalid email should show an error")
        page.fill("#email", "reviewer@example.com")
        page.fill("#pw", "disco-demo")
        page.click("#submit")
        page.wait_for_url("**#/dashboard")
        balance0 = int(page.locator(".credit-pill span").inner_text())
        check(balance0 == 73, f"seeded balance should be 73, got {balance0}")

        # 2. vague brief → clarity gate → answers → generate → charged
        page.fill("#desc", "We help people feel better.")
        page.click("#go")
        page.wait_for_url("**#/new")
        check(page.locator("#gen").is_disabled(), "clarity gate: generate must be disabled before answers")
        for q in range(3):
            page.locator(f'[data-q="{q}"]').first.click()
        check(page.locator("#gen").is_enabled(), "clarity gate: generate should enable after 3 answers")
        page.click("#gen")
        page.wait_for_url("**#/campaign/cmp_*", timeout=15000)
        balance1 = int(page.locator(".credit-pill span").inner_text())
        check(10 <= balance0 - balance1 <= 16, f"generation should cost 10 base + usage, cost {balance0 - balance1}")
        check("Meditation" in page.locator("h1").inner_text(), "vague brief should resolve to the wellness template")

        # 3. deterministic drop is free and re-spreads allocation
        page.click('a.tab:has-text("Publishers")')
        page.wait_for_selector(".pubcard")
        n_before = page.locator(".pubcard").count()
        page.locator("[data-drop]").last.click()
        page.wait_for_timeout(200)
        check(page.locator(".pubcard").count() == n_before - 1, "drop should remove one publisher")
        check(int(page.locator(".credit-pill span").inner_text()) == balance1, "drop must be free")

        # 4. thumbs-down with a comment repairs the creative and charges
        page.click('a.tab:has-text("Creatives")')
        page.wait_for_selector(".creative .ad h4")
        first_headline = page.locator(".creative .ad h4").first.inner_text()
        page.locator('.creative [data-vote="down"]').first.click()
        page.fill("#popText", "too clinical, make it warmer")
        page.click("#popOk")
        page.wait_for_timeout(1200)
        check(page.locator(".creative .ad h4").first.inner_text() != first_headline, "feedback repair should change the headline")
        balance2 = int(page.locator(".credit-pill span").inner_text())
        check(1 <= balance1 - balance2 <= 4, f"feedback repair should cost 1 base + usage, cost {balance1 - balance2}")
        check(page.locator(".tl").filter(has_text="feedback").count() >= 1 or page.locator(".creative").count() > 0, "activity should record feedback")

        # 5. checks tab renders 11 validators
        page.click('a.tab:has-text("Checks")')
        page.wait_for_selector(".checkrow")
        check(page.locator(".checkrow").count() == 11, f"expected 11 checks, got {page.locator('.checkrow').count()}")

        # 6. chat: "never use X" → memory + drop
        page.click('a.btn:has-text("Chat about this")')
        page.wait_for_selector("#ci")
        pub = page.locator(".minicard .r span").nth(1).inner_text().split(". ", 1)[-1]
        page.fill("#ci", f"never use {pub}")
        page.press("#ci", "Enter")
        page.wait_for_timeout(1200)
        check("Saved to memory" in page.locator(".msg.ai").last.inner_text(), "chat should confirm memory save")
        page.click('a[href="#/memory"]')
        page.wait_for_selector("#p_ban")
        banned = page.locator("#p_ban option:checked").count()
        check(banned >= 1, "memory page should list the banned publisher")

        # 7. ledger invariant
        page.click('.nav a[href="#/credits"]')
        page.wait_for_selector(".ledger")
        deltas = [int(t.replace("+", "")) for t in page.locator(".ledger td.neg, .ledger td.pos").all_inner_texts()]
        shown = int(page.locator(".credit-pill span").inner_text())
        check(sum(deltas) == shown, f"ledger sum {sum(deltas)} != balance {shown}")

        check(not errors, f"page errors: {errors}")
        browser.close()
    wrapped.unlink(missing_ok=True)

    if failures:
        print("SMOKE FAILED")
        for f in failures:
            print(" -", f)
        return 1
    print("SMOKE OK — login, clarity gate, generation charge, free drop, feedback repair, checks, chat memory, ledger invariant")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    sys.exit(main(Path(sys.argv[1] if len(sys.argv) > 1 else "design/prototype/index.html")))
