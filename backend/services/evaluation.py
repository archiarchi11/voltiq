"""Model evaluation, ported from Cells 12, 15, 16, 16b and 17b of ``EV_updated.ipynb``.

* Chronological 70 / 10 / 20 split of the daily series.
* Validation stage: every candidate is fitted on the training split and forecasts the
  validation period; the model with the lowest validation RMSE is selected.
* Test stage: every candidate is refitted on train+validation and forecasts the test period.
  Test metrics are reported for comparison only and never used for selection.
* MAPE is computed only on days with non-zero actual demand.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import MIN_DAILY_OBSERVATIONS
from database import SessionLocal
from models import Dataset, EvaluationRun, ModelEvaluation
from services import data_service
from services.forecasting import (
    MODEL_SPECS,
    InsufficientDataError,
    LagRandomForest,
    fit_model,
    predict,
)

log = logging.getLogger("voltiq.evaluation")

_running: set[int] = set()
_running_lock = threading.Lock()


def chronological_split(daily: pd.Series) -> dict[str, pd.Series]:
    n = len(daily)
    train_end = int(n * 0.70)
    val_end = int(n * 0.80)
    return {
        "train": daily.iloc[:train_end],
        "validation": daily.iloc[train_end:val_end],
        "test": daily.iloc[val_end:],
        "train_validation": daily.iloc[:val_end],
    }


def split_summary(parts: dict[str, pd.Series]) -> dict[str, Any]:
    def rng(s: pd.Series) -> dict[str, Any]:
        return {
            "size": int(len(s)),
            "start": s.index[0].strftime("%Y-%m-%d") if len(s) else None,
            "end": s.index[-1].strftime("%Y-%m-%d") if len(s) else None,
        }

    return {k: rng(parts[k]) for k in ("train", "validation", "test")} | {"ratios": [0.7, 0.1, 0.2]}


def compute_metrics(actual: pd.Series, predicted: pd.Series) -> dict[str, float | None]:
    a = np.asarray(actual, dtype=float)
    p = np.asarray(predicted, dtype=float)
    mse = float(mean_squared_error(a, p))
    nonzero = a != 0
    mape = float(np.mean(np.abs((a[nonzero] - p[nonzero]) / a[nonzero])) * 100) if nonzero.any() else None
    r2 = float(r2_score(a, p)) if len(a) > 1 else None
    return {
        "mae": float(mean_absolute_error(a, p)),
        "mse": mse,
        "rmse": float(np.sqrt(mse)),
        "mape": mape,
        "nonzero_days": int(nonzero.sum()),
        "r2": r2,
    }


def is_running(dataset_id: int) -> bool:
    with _running_lock:
        return dataset_id in _running


def latest_run(db: Session, dataset_id: int, completed_only: bool = False) -> EvaluationRun | None:
    q = select(EvaluationRun).where(EvaluationRun.dataset_id == dataset_id)
    if completed_only:
        q = q.where(EvaluationRun.status == "completed")
    return db.scalar(q.order_by(EvaluationRun.id.desc()))


def start_evaluation(dataset_id: int, background: bool = True) -> int | None:
    """Create an evaluation run and execute it (in a background thread by default).

    Returns the run id, or None if an evaluation for this dataset is already running.
    ``background=False`` runs it to completion in the calling thread (used at image build time).
    """
    with _running_lock:
        if dataset_id in _running:
            return None
        _running.add(dataset_id)

    db = SessionLocal()
    try:
        run = EvaluationRun(dataset_id=dataset_id, status="running", total_steps=2 * len(MODEL_SPECS) + 1,
                            message="Queued")
        db.add(run)
        db.commit()
        run_id = run.id
    except Exception:
        with _running_lock:
            _running.discard(dataset_id)
        raise
    finally:
        db.close()

    if not background:
        _execute(dataset_id, run_id)
        return run_id
    thread = threading.Thread(target=_execute, args=(dataset_id, run_id), name=f"eval-{run_id}", daemon=True)
    thread.start()
    return run_id


def _execute(dataset_id: int, run_id: int) -> None:
    db = SessionLocal()
    try:
        _evaluate(db, dataset_id, run_id)
    except Exception as exc:  # pragma: no cover - safety net
        log.exception("Evaluation %s failed", run_id)
        db.rollback()
        run = db.get(EvaluationRun, run_id)
        if run is not None:
            run.status = "failed"
            run.message = f"Evaluation failed: {str(exc)[:300]}"
            run.finished_at = data_service.now()
            db.commit()
    finally:
        db.close()
        with _running_lock:
            _running.discard(dataset_id)


def _evaluate(db: Session, dataset_id: int, run_id: int) -> None:
    run = db.get(EvaluationRun, run_id)
    ds = db.get(Dataset, dataset_id)
    if ds is None or not ds.cleaned_path:
        raise RuntimeError("Dataset has not been preprocessed.")

    daily = data_service.load_dataset(ds.id, ds.cleaned_path).daily
    if len(daily) < MIN_DAILY_OBSERVATIONS:
        raise InsufficientDataError(
            f"At least {MIN_DAILY_OBSERVATIONS} daily observations are required for model evaluation "
            f"(the dataset has {len(daily)})."
        )

    parts = chronological_split(daily)
    train, validation, test, train_val = parts["train"], parts["validation"], parts["test"], parts["train_validation"]
    run.split = split_summary(parts)

    def step(message: str) -> None:
        run.progress += 1
        run.message = message
        db.commit()

    # --- Validation stage (Cell 15) -------------------------------------------------
    rows: dict[str, ModelEvaluation] = {}
    for spec in MODEL_SPECS:
        row = ModelEvaluation(run_id=run.id, model_key=spec.key, model_name=spec.name,
                              family=spec.family, is_baseline=spec.is_baseline)
        rows[spec.key] = row
        db.add(row)
        try:
            model = fit_model(train, spec)
            preds = predict(model, train, len(validation))
            m = compute_metrics(validation, preds)
            row.validation_mae, row.validation_rmse = m["mae"], m["rmse"]
        except Exception as exc:
            row.validation_error = str(exc)[:300]
        step(f"Validation: {spec.name}")

    scored = [r for r in rows.values() if r.validation_rmse is not None]
    if not scored:
        raise RuntimeError("Every candidate model failed on the validation split.")
    best = min(scored, key=lambda r: r.validation_rmse)
    run.best_model_key = best.model_key
    db.commit()

    # --- Test stage (Cell 16) ---------------------------------------------------------
    test_preds: dict[str, list[float]] = {}
    feature_importance = None
    for spec in MODEL_SPECS:
        row = rows[spec.key]
        try:
            t0 = time.perf_counter()
            model = fit_model(train_val, spec)
            row.fit_seconds = round(time.perf_counter() - t0, 3)
            preds = predict(model, train_val, len(test))
            m = compute_metrics(test, preds)
            row.test_mae, row.test_mse, row.test_rmse = m["mae"], m["mse"], m["rmse"]
            row.test_mape, row.test_r2 = m["mape"], m["r2"]
            test_preds[spec.key] = [round(float(v), 3) for v in preds.values]
            if isinstance(model, LagRandomForest):
                # Cell 17b: RF fitted on train+validation (same random_state, so identical to a refit)
                feature_importance = sorted(model.feature_importance(), key=lambda d: -d["importance"])
        except Exception as exc:
            row.test_error = str(exc)[:300]
        step(f"Test: {spec.name}")

    run.test_series = {
        "dates": [d.strftime("%Y-%m-%d") for d in test.index],
        "actual": [round(float(v), 3) for v in test.values],
        "predictions": test_preds,
    }
    run.feature_importance = feature_importance
    db.commit()

    # --- Final forecast (Cell 19): validation-selected model refitted on all data --------
    try:
        from services.forecasting import generate_forecast

        generate_forecast(db, ds, requested_model="auto", horizon=30, source="evaluation", evaluation=run)
        final_msg = f"Completed. Selected {best.model_name} (validation RMSE {best.validation_rmse:,.2f} kWh)."
    except Exception as exc:
        log.warning("Automatic 30-day forecast failed: %s", exc)
        final_msg = f"Completed, but the automatic 30-day forecast failed: {str(exc)[:200]}"

    run.progress = run.total_steps
    run.status = "completed"
    run.message = final_msg
    run.finished_at = data_service.now()
    db.commit()
