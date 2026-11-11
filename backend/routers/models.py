"""Model catalogue, evaluation results and feature importance."""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from models import EvaluationRun
from routers.dataset import evaluation_status
from services import data_service, evaluation
from services.forecasting import BASELINE_KEY, MODEL_SPECS, MODELS_BY_KEY

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("/catalog")
def catalog():
    return {
        "models": [
            {
                "key": s.key,
                "name": s.name,
                "family": s.family,
                "is_baseline": s.is_baseline,
                "description": s.description,
            }
            for s in MODEL_SPECS
        ],
        "families": ["Naive", "Seasonal Naive", "ARIMA", "SARIMA", "Exponential Smoothing", "Random Forest"],
    }


def _completed_run(db: Session) -> tuple[int, EvaluationRun | None]:
    ds = data_service.require_active_dataset(db)
    return ds.id, evaluation.latest_run(db, ds.id, completed_only=True)


@router.get("/comparison")
def comparison(db: Session = Depends(get_db)):
    dataset_id, run = _completed_run(db)
    status = evaluation_status(db, dataset_id)
    if run is None:
        return {"available": False, "evaluation": status}

    rows = run.results
    baseline = next((r for r in rows if r.model_key == BASELINE_KEY), None)
    baseline_rmse = baseline.test_rmse if baseline else None

    results = []
    for r in rows:
        improvement = None
        if baseline_rmse and r.test_rmse is not None:
            improvement = (baseline_rmse - r.test_rmse) / baseline_rmse * 100
        results.append(
            {
                "model_key": r.model_key,
                "model_name": r.model_name,
                "family": r.family,
                "is_baseline": r.is_baseline,
                "is_selected": r.model_key == run.best_model_key,
                "validation_mae": r.validation_mae,
                "validation_rmse": r.validation_rmse,
                "validation_error": r.validation_error,
                "mae": r.test_mae,
                "mse": r.test_mse,
                "rmse": r.test_rmse,
                "mape": r.test_mape,
                "r2": r.test_r2,
                "test_error": r.test_error,
                "fit_seconds": r.fit_seconds,
                "rmse_improvement_vs_baseline_pct": improvement,
                "beats_baseline": (r.test_rmse < baseline_rmse) if (baseline_rmse and r.test_rmse is not None) else None,
            }
        )

    validation_ranked = sorted(
        [r for r in results if r["validation_rmse"] is not None], key=lambda r: r["validation_rmse"]
    )
    for i, r in enumerate(validation_ranked, start=1):
        r["validation_rank"] = i
    test_ranked = sorted([r for r in results if r["rmse"] is not None], key=lambda r: r["rmse"])
    for i, r in enumerate(test_ranked, start=1):
        r["test_rank"] = i

    best_spec = MODELS_BY_KEY.get(run.best_model_key or "")
    series = run.test_series or {}
    return {
        "available": True,
        "evaluation": status,
        "run_id": run.id,
        "finished_at": run.finished_at,
        "split": run.split,
        "selected_model": {
            "key": run.best_model_key,
            "name": best_spec.name if best_spec else None,
            "selection_metric": "validation RMSE",
        },
        "baseline": {"key": BASELINE_KEY, "name": MODELS_BY_KEY[BASELINE_KEY].name, "rmse": baseline_rmse},
        "best_on_test_reference_only": test_ranked[0]["model_key"] if test_ranked else None,
        "models_beating_baseline": sum(1 for r in results if r["beats_baseline"]),
        "results": sorted(results, key=lambda r: (r["rmse"] is None, r["rmse"] or 0)),
        "test_series": series,
    }


@router.get("/feature-importance")
def feature_importance(db: Session = Depends(get_db)):
    _, run = _completed_run(db)
    if run is None or not run.feature_importance:
        return {"available": False, "features": []}
    return {
        "available": True,
        "model": MODELS_BY_KEY["rf"].name,
        "trained_on": "train + validation split",
        "features": run.feature_importance,
    }


@router.post("/evaluate", status_code=202)
def run_evaluation(db: Session = Depends(get_db)):
    ds = data_service.require_active_dataset(db)
    run_id = evaluation.start_evaluation(ds.id)
    if run_id is None:
        raise HTTPException(status_code=409, detail="An evaluation is already running for the active dataset.")
    return {"run_id": run_id, "message": "Model evaluation started."}


@router.get("/evaluation-status")
def eval_status(db: Session = Depends(get_db)):
    ds = data_service.get_active_dataset(db)
    return evaluation_status(db, ds.id if ds else None)


@router.get("/comparison/export")
def export_comparison(db: Session = Depends(get_db)):
    data = comparison(db)
    if not data.get("available"):
        raise HTTPException(status_code=404, detail="No completed evaluation to export.")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Model", "Validation MAE", "Validation RMSE", "MAE", "MSE", "RMSE",
                "MAPE (%) non-zero days", "R2", "RMSE improvement vs baseline (%)", "Selected (validation RMSE)"])
    for r in data["results"]:
        w.writerow([r["model_name"], r["validation_mae"], r["validation_rmse"], r["mae"], r["mse"], r["rmse"],
                    r["mape"], r["r2"], r["rmse_improvement_vs_baseline_pct"], "yes" if r["is_selected"] else ""])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="EV_Model_Comparison.csv"'},
    )
