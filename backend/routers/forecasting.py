"""Forecast execution, latest result, history and CSV export."""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import ForecastRun
from schemas import ForecastHistoryResponse, ForecastRequest, ForecastResponse, ForecastRunOut
from services import data_service
from services.analysis import edge_day_warnings
from services.forecasting import (
    MODELS_BY_KEY,
    EvaluationPendingError,
    InsufficientDataError,
    ModelFitError,
    generate_forecast,
)

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


def _run_out(run: ForecastRun) -> ForecastRunOut:
    out = ForecastRunOut.model_validate(run)
    spec = MODELS_BY_KEY.get(run.model_key)
    out.model_family = spec.family if spec else None
    return out


def _response(db: Session, run: ForecastRun, history_days: int = 90) -> ForecastResponse:
    history = []
    warnings: list[dict] = []
    ds = data_service.get_active_dataset(db)
    if ds is not None and ds.id == run.dataset_id and ds.cleaned_path:
        daily = data_service.load_dataset(ds.id, ds.cleaned_path).daily
        daily = daily[daily.index <= str(run.history_end)]
        warnings = [w for w in edge_day_warnings(daily) if w["type"] == "possibly_incomplete_last_day"]
        tail = daily.iloc[-max(history_days, run.horizon * 3):]
        history = [{"date": d.date(), "energy_kwh": float(v)} for d, v in tail.items()]
    return ForecastResponse(
        run=_run_out(run),
        predictions=[{"date": p.date, "predicted_kwh": p.predicted_kwh} for p in run.predictions],
        history=history,
        warnings=warnings,
    )


@router.post("/run", response_model=ForecastResponse)
def run_forecast(body: ForecastRequest, db: Session = Depends(get_db)):
    ds = data_service.require_active_dataset(db)
    try:
        run = generate_forecast(db, ds, requested_model=body.model, horizon=body.horizon, source="user")
    except EvaluationPendingError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except InsufficientDataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ModelFitError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return _response(db, run)


@router.get("/latest", response_model=ForecastResponse | None)
def latest_forecast(db: Session = Depends(get_db)):
    ds = data_service.get_active_dataset(db)
    if ds is None:
        return None
    run = db.scalar(select(ForecastRun).where(ForecastRun.dataset_id == ds.id).order_by(ForecastRun.id.desc()))
    return _response(db, run) if run else None


@router.get("/history", response_model=ForecastHistoryResponse)
def forecast_history(limit: int = Query(50, ge=1, le=500), all_datasets: bool = False, db: Session = Depends(get_db)):
    q = select(ForecastRun).order_by(ForecastRun.id.desc()).limit(limit)
    if not all_datasets:
        ds = data_service.get_active_dataset(db)
        if ds is None:
            return ForecastHistoryResponse(runs=[])
        q = q.where(ForecastRun.dataset_id == ds.id)
    return ForecastHistoryResponse(runs=[_run_out(r) for r in db.scalars(q)])


@router.get("/{run_id}", response_model=ForecastResponse)
def get_forecast(run_id: int, db: Session = Depends(get_db)):
    run = db.get(ForecastRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Forecast run not found.")
    return _response(db, run)


@router.get("/{run_id}/export")
def export_forecast(run_id: int, db: Session = Depends(get_db)):
    run = db.get(ForecastRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Forecast run not found.")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Forecasted Energy (kWh)", "Model", "Run ID"])
    for p in run.predictions:
        w.writerow([p.date.isoformat(), round(p.predicted_kwh, 3), run.model_name, run.id])
    buf.seek(0)
    filename = f"EV_Charging_{run.horizon}_Day_Forecast_run{run.id}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
