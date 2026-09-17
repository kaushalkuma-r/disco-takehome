# Design package

| Path | What |
|---|---|
| `prototype/` | Clickable HTML prototype (no build step). Open `index.html` in a browser, or see the published artifact link in the root README. Modules: `assets/js/data.js` (catalog + mocked model outputs), `core.js` (store · mock API · credits · validators · UI helpers), `views/*` (one file per screen), `app.js` (router). |
| `review/` | Output of `tools/review_prototype.py`: 56 screenshots (13 routes × light/dark × desktop/mobile) and `report.md` with automated findings. |

## Reviewing the prototype

```bash
uv venv .venv && uv pip install -r tools/requirements.txt && .venv/bin/python -m playwright install chromium
.venv/bin/python tools/review_prototype.py design/prototype/index.html --out design/review   # screenshots + lint
.venv/bin/python tools/smoke_prototype.py  design/prototype/index.html                       # drives the real flows
```

`review_prototype.py` wraps the artifact fragment in the same skeleton the Artifact host uses, then checks every route for: console/page errors, horizontal page scroll, elements escaping the viewport, WCAG contrast (4.5:1 / 3:1), touch targets <30 px, clipped text, tiny text, duplicate ids, images without alt. It exits non-zero on any error so it can gate CI.

`smoke_prototype.py` asserts the product invariants: clarity gate blocks vague briefs, generation charges base + usage, deterministic edits are free, 👎 + comment repairs and charges, 11 checks render, chat "never use X" writes memory and drops the publisher, ledger sum == balance.
