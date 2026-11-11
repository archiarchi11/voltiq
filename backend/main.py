"""VoltIQ – EV Energy Intelligence Platform API."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

import config
from database import SessionLocal, init_db
from routers import analytics, dashboard, dataset, forecasting, models
from services.data_service import NoActiveDatasetError, repair_paths

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("voltiq")

VERSION = "1.0.0"


def _has_frontend() -> bool:
    return (config.FRONTEND_DIST / "index.html").is_file()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with SessionLocal() as db:
        if (n := repair_paths(db)):
            log.info("Updated %d stored file path(s) to the current data directory", n)
    if _has_frontend():
        log.info("Serving the VoltIQ web app from %s", config.FRONTEND_DIST)
    else:
        log.warning("Frontend build not found at %s - API only. Run `npm run build` in frontend/.", config.FRONTEND_DIST)
    log.info("VoltIQ API ready (data dir: %s)", config.DATA_DIR)
    yield


app = FastAPI(
    title="VoltIQ API",
    description="EV Energy Intelligence & Forecasting Platform – Predict. Analyse. Optimise.",
    version=VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.exception_handler(NoActiveDatasetError)
async def _no_dataset(_req: Request, exc: NoActiveDatasetError):
    return JSONResponse(status_code=404, content={"detail": str(exc), "code": "NO_ACTIVE_DATASET"})


@app.exception_handler(Exception)
async def _unhandled(_req: Request, exc: Exception):
    log.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"detail": f"Internal server error: {str(exc)[:200]}"})


for r in (dataset.router, dashboard.router, analytics.router, models.router, forecasting.router):
    app.include_router(r)


@app.get("/api/health", tags=["health"])
def health():
    db_ok = True
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": db_ok, "version": VERSION}


# ---------------------------------------------------------------------------
# Website: serve the built React app. Registered last so /api/* and /docs win.
# ---------------------------------------------------------------------------

if _has_frontend():
    _dist = config.FRONTEND_DIST.resolve()
    if (_dist / "assets").is_dir():
        # Hashed, immutable bundles
        app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def web_app(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (_dist / full_path).resolve()
        if full_path and candidate.is_file() and _dist in candidate.parents:
            return FileResponse(candidate)
        # Client-side routes (/forecasting, /models, ...) all load the single-page app.
        return FileResponse(_dist / "index.html", headers={"Cache-Control": "no-cache"})
