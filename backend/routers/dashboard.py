"""Overview dashboard KPIs."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import ModelEvaluation
from routers.dataset import evaluation_status
from services import analysis, data_service, evaluation
from services.preprocessing import ENERGY_COL, STATION_COL

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/overview")
def overview(start: date | None = None, end: date | None = None, db: Session = Depends(get_db)):
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="Start date must be on or before end date.")
    ds = data_service.get_active_dataset(db)
    if ds is None or not ds.cleaned_path:
        return {"has_dataset": False}

    data = data_service.load_active(db)
    df = analysis.filter_frame(data.df, start, end)
    daily = analysis.slice_series(data.daily, start, end)

    total_energy = float(df[ENERGY_COL].sum())
    days = int(len(daily))

    eval_status = evaluation_status(db, ds.id)
    best = None
    run = evaluation.latest_run(db, ds.id, completed_only=True)
    if run is not None and run.best_model_key:
        row = db.query(ModelEvaluation).filter_by(run_id=run.id, model_key=run.best_model_key).one_or_none()
        if row is not None:
            best = {
                "model_key": row.model_key,
                "model_name": row.model_name,
                "validation_rmse": row.validation_rmse,
                "validation_mae": row.validation_mae,
                "test_rmse": row.test_rmse,
                "evaluated_at": run.finished_at,
            }

    full_min, full_max = data.daily.index[0].date(), data.daily.index[-1].date()
    last_updated = max(
        [t for t in (ds.processed_at, run.finished_at if run else None) if t is not None], default=ds.uploaded_at
    )
    return {
        "has_dataset": True,
        "dataset": {
            "id": ds.id,
            "filename": ds.filename,
            "status": ds.status,
            "processed_at": ds.processed_at,
            "records": int(len(data.df)),
            "date_min": full_min,
            "date_max": full_max,
        },
        "range": {
            "start": daily.index[0].date() if days else start,
            "end": daily.index[-1].date() if days else end,
            "days": days,
        },
        "kpis": {
            "total_energy_kwh": total_energy,
            "total_sessions": int(len(df)),
            "station_count": int(df[STATION_COL].nunique()),
            "avg_daily_kwh": total_energy / days if days else None,
            "peak_day": (
                {"date": daily.idxmax().date(), "energy_kwh": float(daily.max())} if days and daily.max() > 0 else None
            ),
        },
        "best_model": best,
        "evaluation": eval_status,
        "last_updated": last_updated,
        "data_warnings": analysis.edge_day_warnings(data.daily),
    }
