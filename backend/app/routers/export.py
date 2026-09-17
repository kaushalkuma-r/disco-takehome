import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response

from .. import db, repo
from ..agent import validators
from ..agent.registry import UserCtx
from ..auth import get_current_user
from ..catalog import load_catalog
from ..services import export_pdf

router = APIRouter(prefix="/api", tags=["export"])


@router.get("/campaigns/{campaign_id}/export.pdf")
async def export_pdf_route(campaign_id: UUID, user: UserCtx = Depends(get_current_user)):
    catalog = load_catalog()
    async with db.connection() as conn:
        c = await repo.get_campaign(conn, campaign_id, user.id)
        if not c:
            raise HTTPException(404, "campaign not found")
        memory = await repo.load_memory(conn, user.id)
    pdf = export_pdf.render(c, catalog, validators.run_all(c, catalog, memory), user.name or user.email)
    slug = re.sub(r"[^a-z0-9]+", "-", c.name.lower()).strip("-")[:48] or "campaign"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{slug}-brief-v{c.version}.pdf"'})


@router.get("/campaigns/{campaign_id}/export.json")
async def export_json(campaign_id: UUID, user: UserCtx = Depends(get_current_user)):
    catalog = load_catalog()
    async with db.connection() as conn:
        c = await repo.get_campaign(conn, campaign_id, user.id)
        if not c:
            raise HTTPException(404, "campaign not found")
    k = c.config
    return {
        "schema": "campaign_config.v1", "campaign_id": str(c.id), "name": c.name, "version": c.version, "brief": c.brief, "interpretation": c.clarity.summary,
        "objective": k.objective if k else None, "primary_kpi": k.primary_kpi if k else None,
        "bid": k.bid.model_dump() if k else None, "budget": k.budget.model_dump() if k else None, "flight": k.flight.model_dump() if k else None,
        "targeting": {**k.targeting.model_dump(), "personas": [p.id for p in c.personas]} if k else None,
        "placements": [{"publisher_id": a.publisher_id, "publisher": catalog.publisher(a.publisher_id).name, "allocation_pct": a.pct,
                        "budget_usd": round(k.budget.total_usd * a.pct / 100), "creative_ids": [f"{c.id}_cr_{chr(65 + i)}" for i in range(len(c.creatives))]}
                       for a in (k.allocation if k else [])],
        "creatives": [{"id": f"{c.id}_cr_{chr(65 + i)}", "persona_id": x.persona_id, "persona": catalog.persona(x.persona_id).name, "headline": x.headline,
                       "body": x.body, "cta": x.cta} for i, x in enumerate(c.creatives)],
        "frequency_cap": k.frequency_cap if k else None, "attribution": k.attribution if k else None,
        "excluded": [{"publisher_id": e.id, "reason": e.why} for e in c.excluded],
    }
