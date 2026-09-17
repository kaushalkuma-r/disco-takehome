#!/usr/bin/env python
"""Run the prototype's accessibility/layout audit against the live app (signed in), light + dark, desktop + mobile.

    .venv/bin/python tools/audit_app.py --web http://localhost:3100 --email you@example.com --password ...

Creates a throwaway user when no credentials are given. Reuses AUDIT_JS from review_prototype.py.
"""
from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "backend"))
from review_prototype import AUDIT_JS, Finding, Report  # noqa: E402
from app.config import get_settings  # noqa: E402

S = get_settings()
ROUTES = ["/dashboard/", "/new/", "/history/", "/memory/", "/credits/", "/chat/"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", default="http://localhost:3100")
    ap.add_argument("--out", default="design/review-app/audit")
    ap.add_argument("--campaign", help="campaign id to include campaign tabs")
    a = ap.parse_args()
    out = ROOT / a.out
    out.mkdir(parents=True, exist_ok=True)
    email = f"audit-{uuid.uuid4().hex[:6]}@example.com"
    r = httpx.post(f"{S.supabase_url}/auth/v1/signup", headers={"apikey": S.supabase_anon_key}, json={"email": email, "password": "disco-demo-123"}, timeout=30).json()
    uid = r["user"]["id"]
    report = Report()
    routes = list(ROUTES)
    if a.campaign:
        routes += [f"/campaign/?id={a.campaign}&tab={t}" for t in ("overview", "publishers", "creatives", "config", "checks", "export")]
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for theme in ("light", "dark"):
                for vp, (w, h) in {"desktop": (1440, 900), "mobile": (400, 860)}.items():
                    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme)
                    page = ctx.new_page()
                    page.goto(f"{a.web}/login/")
                    page.fill("#email", email); page.fill("#pw", "disco-demo-123"); page.click("#submit")
                    page.wait_for_url("**/dashboard/**", timeout=30000)
                    page.evaluate(f"document.documentElement.setAttribute('data-theme','{theme}')")
                    for route in routes:
                        page.goto(f"{a.web}{route}")
                        page.wait_for_selector(".page", timeout=20000)
                        page.wait_for_timeout(900)
                        name = route.strip("/").replace("/", "_").replace("?", "_").replace("&", "_").replace("=", "-") or "root"
                        page.screenshot(path=str(out / f"{name}--{theme}--{vp}.png"), full_page=True)
                        for item in page.evaluate(AUDIT_JS):
                            report.findings.append(Finding(route, theme, vp, item["check"], item["severity"], item["detail"]))
                    ctx.close()
            browser.close()
    finally:
        httpx.delete(f"{S.supabase_url}/auth/v1/admin/users/{uid}", headers={"apikey": S.supabase_service_role_key, "Authorization": f"Bearer {S.supabase_service_role_key}"}, timeout=30)
    (out / "report.md").write_text(report.to_markdown())
    print(report.to_markdown()[:3000])
    return 1 if any(f.severity == "error" for f in report.findings) else 0


if __name__ == "__main__":
    sys.exit(main())
