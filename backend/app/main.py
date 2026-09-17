"""FastAPI app factory. Shape A (SERVE_STATIC=1) also serves the Next.js export from /."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, observability
from .catalog import load_catalog
from .config import get_settings
from .llm.client import client
from .routers import campaigns, chat, credits, export, feedback, me, memory

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_catalog()
    log.info("catalog loaded; models fast=%s strong=%s", get_settings().model_fast, get_settings().model_strong)
    observability.enabled()
    yield
    observability.shutdown()
    await db.close_pool()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Disco Campaign Studio API", version="0.1.0", lifespan=lifespan, docs_url="/api/docs" if s.debug else None, redoc_url=None,
                  openapi_url="/api/openapi.json")
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    for r in (me, campaigns, chat, feedback, memory, credits, export):
        app.include_router(r.router)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail)}
        return JSONResponse({"error": detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.get("/healthz")
    async def healthz():
        ok_db = await db.healthcheck()
        return JSONResponse({"ok": ok_db, "db": ok_db, "openai": bool(s.openai_api_key)}, status_code=200 if ok_db else 503)

    if s.serve_static and s.static_dir.exists():
        app.mount("/_next", StaticFiles(directory=s.static_dir / "_next"), name="next-assets")
        app.mount("/assets", StaticFiles(directory=s.static_dir / "assets"), name="assets") if (s.static_dir / "assets").exists() else None

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            # Static export: serve the matching html if it exists, else fall back to index.html (client routing).
            candidates = [s.static_dir / path, s.static_dir / f"{path}.html", s.static_dir / path / "index.html", s.static_dir / "index.html"]
            for c in candidates:
                if c.is_file():
                    return FileResponse(c)
            raise HTTPException(404)

    return app


app = create_app()
