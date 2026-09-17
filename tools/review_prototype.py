#!/usr/bin/env python
"""Screenshot + lint an Artifact-style HTML prototype across routes, themes and viewports.

Usage:
    .venv/bin/python tools/review_prototype.py design/prototype.html --out design/review

Produces:
    <out>/<route>--<theme>--<viewport>.png   screenshots
    <out>/report.md                          findings (console errors, overflow, contrast,
                                             touch targets, clipped text, duplicate ids)

The HTML file is an Artifact fragment (no <html>/<head>/<body>); we wrap it with the same
skeleton the Artifact host uses so what we screenshot is what reviewers see.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

SKELETON = """<!doctype html><html lang="en"{theme_attr}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{{color-scheme:light dark}}body{{margin:0;font:14px system-ui}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
</head><body>{fragment}</body></html>"""

VIEWPORTS = {"desktop": (1440, 900), "mobile": (400, 860)}
THEMES = ("light", "dark")

# Routes and the localStorage state that puts the app in a realistic working state for each.
DEFAULT_ROUTES = [
    "#/login",
    "#/dashboard",
    "#/new",
    "#/campaign/cmp_2057",
    "#/campaign/cmp_2057/publishers",
    "#/campaign/cmp_2057/creatives",
    "#/campaign/cmp_2057/config",
    "#/campaign/cmp_2057/export",
    "#/chat",
    "#/chat?c=cmp_2057",
    "#/history",
    "#/compare/cmp_2041/cmp_2057",
    "#/memory",
    "#/credits",
]
SESSION = {"name": "Demo Advertiser", "email": "demo@disconetwork.com", "provider": "email"}

# Browser-side audit. Returns a list of {check, severity, detail} objects.
AUDIT_JS = r"""
() => {
  const out = [];
  const push = (check, severity, detail) => out.push({check, severity, detail});
  // 1. horizontal overflow of the page body
  if (document.documentElement.scrollWidth > window.innerWidth + 1)
    push('horizontal-scroll', 'error', `scrollWidth ${document.documentElement.scrollWidth} > viewport ${window.innerWidth}`);
  // 2. elements sticking out of the viewport horizontally (skip those inside an overflow container)
  const inScroller = el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > window.innerWidth + 2 || r.left < -2) && !inScroller(el))
      push('element-overflow', 'error', `<${el.tagName.toLowerCase()} class="${el.className}"> right=${Math.round(r.right)} left=${Math.round(r.left)}`);
  }
  // 3. duplicate ids
  const ids = {};
  for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
  for (const [id, n] of Object.entries(ids)) if (n > 1) push('duplicate-id', 'warning', `#${id} ×${n}`);
  // 4. touch targets: interactive elements smaller than 32px on either axis (icon-only buttons allowed at 28+)
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue; // inline text links are exempt (WCAG 2.5.8)
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio') && el.closest('label') && el.closest('label').getBoundingClientRect().height >= 30) continue; // label is the target
    const isIconOnly = !el.textContent.trim() && el.querySelector('svg');
    const min = isIconOnly ? 28 : 30;
    if (r.height < min) push('small-touch-target', 'warning', `<${el.tagName.toLowerCase()}> "${(el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,30)}" h=${Math.round(r.height)}`);
  }
  // 5. clipped text: elements with overflow hidden whose scrollWidth exceeds clientWidth without ellipsis
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && !el.classList.contains('sr-only')) {
      if (el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && !el.querySelector('svg,canvas,pre,table'))
        push('clipped-text', 'warning', `<${el.tagName.toLowerCase()} class="${el.className}"> scroll=${el.scrollWidth} client=${el.clientWidth}`);
    }
  }
  // 6. tiny text
  for (const el of document.querySelectorAll('body *')) {
    if (!el.textContent.trim() || el.children.length) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs && fs < 10.5) push('tiny-text', 'warning', `<${el.tagName.toLowerCase()} class="${el.className}"> ${fs}px "${el.textContent.trim().slice(0,30)}"`);
  }
  // 7. contrast (WCAG 2.x) for text nodes against the nearest opaque background
  const parse = c => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r,g,b,a=1] = m.map(Number); return {r,g,b,a}; };
  const lum = ({r,g,b}) => { const f = v => { v/=255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); }; return .2126*f(r)+.7152*f(g)+.0722*f(b); };
  const bgOf = el => { for (let p = el; p; p = p.parentElement) { const c = parse(getComputedStyle(p).backgroundColor); if (c && c.a > 0.9) return c; const bi = getComputedStyle(p).backgroundImage; if (bi && bi !== 'none') return null; } return {r:255,g:255,b:255,a:1}; };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const fg = parse(cs.color); const bg = bgOf(el);
    if (!fg || !bg || fg.a < 0.9) continue;
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
    const fs = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700;
    const large = fs >= 24 || (fs >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      const key = `${cs.color}|${el.className}`; if (seen.has(key)) continue; seen.add(key);
      push('low-contrast', ratio < need - 1 ? 'error' : 'warning', `<${el.tagName.toLowerCase()} class="${el.className}"> ${ratio.toFixed(2)}:1 (need ${need}) "${el.textContent.trim().slice(0,30)}"`);
    }
  }
  // 8. images without alt, links without text
  for (const img of document.images) if (!img.alt) push('img-no-alt', 'warning', img.src.slice(0,60));
  for (const a of document.querySelectorAll('a[href]')) if (!a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('svg')) push('empty-link', 'warning', a.href);
  return out;
}
"""


@dataclass
class Finding:
    route: str
    theme: str
    viewport: str
    check: str
    severity: str
    detail: str


@dataclass
class Report:
    shots: list[str] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)

    def to_markdown(self) -> str:
        lines = ["# Prototype review", ""]
        errors = [f for f in self.findings if f.severity == "error"]
        warns = [f for f in self.findings if f.severity == "warning"]
        lines += [f"- Screenshots: {len(self.shots)}", f"- Errors: {len(errors)}", f"- Warnings: {len(warns)}", ""]
        by_check: dict[str, list[Finding]] = {}
        for f in self.findings:
            by_check.setdefault(f.check, []).append(f)
        for check, items in sorted(by_check.items(), key=lambda kv: (-sum(i.severity == "error" for i in kv[1]), kv[0])):
            lines.append(f"## {check} ({len(items)})")
            for f in items[:40]:
                lines.append(f"- [{f.severity}] `{f.route}` {f.theme}/{f.viewport}: {f.detail}")
            if len(items) > 40:
                lines.append(f"- … {len(items) - 40} more")
            lines.append("")
        return "\n".join(lines)


def wrap(fragment: str, theme: str) -> str:
    return SKELETON.format(theme_attr=f' data-theme="{theme}"', fragment=fragment)


def prime_session(page: Page) -> None:
    """Put the app in a signed-in, populated state before routing."""
    page.evaluate(
        """(s) => { localStorage.setItem('dcs.session', JSON.stringify(s)); }""",
        SESSION,
    )


def shoot(page: Page, route: str, theme: str, vp: str, out: Path, report: Report) -> None:
    page.goto(page.url.split("#")[0] + route)
    page.wait_for_timeout(350)  # animations + fonts
    # advance the wizard "generate" progress if it's running, so we don't screenshot a spinner
    page.wait_for_timeout(150)
    name = route.strip("#/").replace("/", "_").replace("?", "_") or "root"
    path = out / f"{name}--{theme}--{vp}.png"
    page.screenshot(path=str(path), full_page=True)
    report.shots.append(str(path))
    for item in page.evaluate(AUDIT_JS):
        report.findings.append(Finding(route, theme, vp, item["check"], item["severity"], item["detail"]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("html", type=Path)
    ap.add_argument("--out", type=Path, default=Path("design/review"))
    ap.add_argument("--routes", nargs="*", default=DEFAULT_ROUTES)
    ap.add_argument("--themes", nargs="*", default=list(THEMES))
    ap.add_argument("--viewports", nargs="*", default=list(VIEWPORTS))
    args = ap.parse_args()

    fragment = args.html.read_text()
    args.out.mkdir(parents=True, exist_ok=True)
    report = Report()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in args.themes:
            # write next to the source so relative asset paths (css/js) resolve
            wrapped = args.html.parent / f"_review-wrapped-{theme}.html"
            wrapped.write_text(wrap(fragment, theme))
            for vp in args.viewports:
                w, h = VIEWPORTS[vp]
                ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, color_scheme=theme)
                page = ctx.new_page()
                console: list[str] = []
                page.on("console", lambda m: console.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
                page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
                page.goto(wrapped.resolve().as_uri())
                prime_session(page)
                page.reload()  # the app reads the session at boot
                for route in args.routes:
                    before = len(console)
                    shoot(page, route, theme, vp, args.out, report)
                    for line in console[before:]:
                        report.findings.append(Finding(route, theme, vp, "console", "error", line))
                ctx.close()
        browser.close()
    for theme in args.themes:
        (args.html.parent / f"_review-wrapped-{theme}.html").unlink(missing_ok=True)

    (args.out / "report.md").write_text(report.to_markdown())
    (args.out / "report.json").write_text(json.dumps([f.__dict__ for f in report.findings], indent=1))
    print(report.to_markdown())
    return 1 if any(f.severity == "error" for f in report.findings) else 0


if __name__ == "__main__":
    sys.exit(main())
