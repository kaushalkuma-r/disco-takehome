"""One-page campaign brief as PDF (fpdf2, pure Python — no system deps, so it runs on any free host)."""
from __future__ import annotations

from datetime import datetime, timezone

from fpdf import FPDF

from ..catalog import Catalog
from ..schemas.domain import Campaign, ValidationResult

PURPLE = (109, 40, 217)
INK = (17, 17, 17)
MUTED = (107, 114, 128)


def _txt(s: str) -> str:
    """fpdf core fonts are Latin-1; swap the few typographic characters we use."""
    return (s.replace("—", "-").replace("–", "-").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("·", "|")
            .replace("≤", "<=").replace("≥", ">=").replace("→", "->").replace("×", "x").replace("…", "...").encode("latin-1", "replace").decode("latin-1"))


class Brief(FPDF):
    def header(self):
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 5, "CAMPAIGN BRIEF  |  DISCO CAMPAIGN STUDIO", new_x="LMARGIN", new_y="NEXT")

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*MUTED)
        self.cell(0, 5, _txt(self._foot), align="L")
        self.cell(0, 5, f"Page {self.page_no()}", align="R")

    def section(self, text: str):
        self.ln(3)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*PURPLE)
        self.cell(0, 6, _txt(text.upper()), new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(*INK)

    def para(self, text: str, size: float = 9, style: str = ""):
        self.set_font("Helvetica", style, size)
        self.set_text_color(*INK)
        self.multi_cell(0, 4.6, _txt(text), new_x="LMARGIN", new_y="NEXT")


def render(c: Campaign, catalog: Catalog, validation: list[ValidationResult], author: str) -> bytes:
    pdf = Brief()
    pdf._foot = f"{c.id} | v{c.version} | generated {datetime.now(timezone.utc).isoformat(timespec='seconds')} | checks {sum(v.passed for v in validation)}/{len(validation)} passing"
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(16, 14, 16)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(*INK)
    pdf.cell(0, 9, _txt(c.name), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 4.6, _txt(f'"{c.brief}"'), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(0, 5, _txt(f"Prepared by {author}  |  {datetime.now().strftime('%b %d, %Y')}  |  version {c.version}  |  clarity {c.clarity.score}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*PURPLE)
    pdf.set_line_width(0.6)
    pdf.line(16, pdf.get_y() + 1, 194, pdf.get_y() + 1)

    pdf.section("Interpretation")
    pdf.para(c.clarity.summary)

    pdf.section("Recommended publishers")
    for i, p in enumerate(c.publishers, 1):
        alloc = next((a.pct for a in c.config.allocation if a.publisher_id == p.id), None) if c.config else None
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 5, _txt(f"{i}. {catalog.publisher(p.id).name}  |  score {p.score}  |  budget {alloc}%" if alloc is not None else f"{i}. {catalog.publisher(p.id).name}  |  score {p.score}"), new_x="LMARGIN", new_y="NEXT")
        pdf.para(p.why, 8.5)

    pdf.section("Creative variants")
    for i, cr in enumerate(c.creatives):
        pk = next((x for x in c.personas if x.id == cr.persona_id), None)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 5, _txt(f"{chr(65 + i)}  |  {catalog.persona(cr.persona_id).name}" + (f"  (fit {pk.fit})" if pk else "")), new_x="LMARGIN", new_y="NEXT")
        pdf.para(cr.headline, 9.5, "B")
        pdf.para(f"{cr.body}  [{cr.cta}]", 8.5)

    if c.config:
        k = c.config
        pdf.section("Config")
        pdf.para(f"Objective: {k.objective}  |  KPI: {k.primary_kpi}")
        pdf.para(f"Bid: {k.bid.strategy}  |  CPM {k.bid.cpm_range_usd}  |  CPC {k.bid.cpc_range_usd}")
        pdf.para(f"Budget: ${k.budget.total_usd:,} total  |  ${k.budget.daily_usd:,}/day  |  {k.flight.start} -> {k.flight.end}")
        pdf.para(f"Targeting: {k.targeting.age_range}  |  {k.targeting.gender}  |  {', '.join(k.targeting.geos)}  |  {', '.join(k.targeting.income_tiers)}")
        pdf.para(f"Why: {k.bid.rationale}", 8.5)

    if c.excluded:
        pdf.section("Excluded publishers")
        for e in c.excluded[:5]:
            pdf.para(f"{catalog.publisher(e.id).name} - {e.why}", 8.5)

    failing = [v for v in validation if not v.passed]
    if failing:
        pdf.section("Open checks")
        for v in failing:
            pdf.para(f"[{v.severity}] {v.message}", 8.5)
    return bytes(pdf.output())
