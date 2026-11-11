"""Dataset upload, validation, preview, preprocessing and export."""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import AUTO_EVALUATE
from database import get_db
from models import Dataset, DatasetMetadata
from schemas import (
    CleaningSummary,
    DatasetDetail,
    DatasetInfo,
    DatasetProfile,
    DatasetSummary,
    EvaluationStatus,
    PreprocessRequest,
    PreprocessResponse,
    PreviewResponse,
    ValidationReport,
)
from services import data_service, evaluation, preprocessing
from services.analysis import build_daily, edge_day_warnings
from services.forecasting import MODELS_BY_KEY

router = APIRouter(prefix="/api/dataset", tags=["dataset"])
log = logging.getLogger("voltiq.dataset")


def _detail(ds: Dataset | None) -> DatasetDetail | None:
    if ds is None:
        return None
    meta: DatasetMetadata | None = ds.meta
    profile = validation = cleaning = None
    if meta is not None:
        profile = DatasetProfile(
            row_count=meta.row_count,
            column_count=meta.column_count,
            columns=meta.columns or [],
            missing_values=meta.missing_values or {},
            date_min=meta.date_min,
            date_max=meta.date_max,
            session_status_counts=meta.session_status_counts or {},
        )
        if meta.validation:
            validation = ValidationReport(**meta.validation)
        if meta.cleaned_row_count is not None:
            cleaning = CleaningSummary(
                cleaned_row_count=meta.cleaned_row_count,
                cleaned_date_min=meta.cleaned_date_min,
                cleaned_date_max=meta.cleaned_date_max,
                daily_observations=meta.daily_observations,
                total_energy_kwh=meta.total_energy_kwh,
                station_count=meta.station_count,
                quality_summary=meta.quality_summary,
            )
    return DatasetDetail(dataset=DatasetInfo.model_validate(ds), profile=profile, validation=validation, cleaning=cleaning)


def evaluation_status(db: Session, dataset_id: int | None) -> EvaluationStatus:
    if dataset_id is None:
        return EvaluationStatus(run_id=None, status="none")
    run = evaluation.latest_run(db, dataset_id)
    if run is None:
        return EvaluationStatus(run_id=None, status="none")
    status = run.status
    if status == "running" and not evaluation.is_running(dataset_id):
        status = "failed"  # the server restarted while this run was in progress
    spec = MODELS_BY_KEY.get(run.best_model_key or "")
    return EvaluationStatus(
        run_id=run.id,
        status=status,
        progress=run.progress,
        total_steps=run.total_steps,
        message=run.message if status == run.status else "Interrupted by a server restart. Re-run the evaluation.",
        best_model_key=run.best_model_key,
        best_model_name=spec.name if spec else None,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


@router.post("/upload", response_model=DatasetDetail, status_code=201)
def upload_dataset(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a CSV, validate it and profile it. The active dataset is not changed."""
    name = file.filename or "upload.csv"
    if not name.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted.")
    try:
        path, size = data_service.save_upload(file.file, name)
    except data_service.UploadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc

    ds = Dataset(filename=Path(name).name, stored_path=str(path), file_size_bytes=size, status="uploaded")
    db.add(ds)
    db.commit()

    try:
        raw = preprocessing.read_raw_csv(path)
        report = preprocessing.validate(raw)
        prof = preprocessing.profile(raw)
    except preprocessing.DatasetValidationError as exc:
        report = {"valid": False, "errors": [str(exc)], "warnings": [],
                  "checks": [{"name": "Readable CSV", "passed": False, "detail": str(exc), "level": "error"}]}
        prof = {"row_count": 0, "column_count": 0, "columns": [], "missing_values": {}, "preview": [],
                "date_min": None, "date_max": None, "session_status_counts": {}}

    ds.meta = DatasetMetadata(validation=report, **prof)
    ds.status = "validated" if report["valid"] else "invalid"
    ds.error = None if report["valid"] else "; ".join(report["errors"])
    db.commit()
    db.refresh(ds)
    return _detail(ds)


@router.get("/summary", response_model=DatasetSummary)
def dataset_summary(db: Session = Depends(get_db)):
    datasets = list(db.scalars(select(Dataset).order_by(Dataset.id.desc()).limit(25)))
    active = data_service.get_active_dataset(db)
    latest = datasets[0] if datasets else None
    return DatasetSummary(
        has_active_dataset=active is not None and bool(active.cleaned_path) and Path(active.cleaned_path).exists(),
        active=_detail(active),
        latest_upload=_detail(latest),
        datasets=[DatasetInfo.model_validate(d) for d in datasets],
        evaluation=evaluation_status(db, active.id if active else None),
        required_columns=preprocessing.REQUIRED_COLUMNS,
    )


@router.get("/preview", response_model=PreviewResponse)
def dataset_preview(dataset_id: int | None = Query(None), db: Session = Depends(get_db)):
    ds = db.get(Dataset, dataset_id) if dataset_id else (
        data_service.get_active_dataset(db) or db.scalar(select(Dataset).order_by(Dataset.id.desc()))
    )
    if ds is None or ds.meta is None:
        raise HTTPException(status_code=404, detail="No dataset has been uploaded yet.")
    return PreviewResponse(dataset_id=ds.id, filename=ds.filename, columns=ds.meta.columns or [], rows=ds.meta.preview or [])


@router.post("/preprocess", response_model=PreprocessResponse)
def preprocess_dataset(body: PreprocessRequest | None = None, db: Session = Depends(get_db)):
    """Clean a validated upload with the notebook rules and make it the active dataset."""
    dataset_id = body.dataset_id if body else None
    if dataset_id is not None:
        ds = db.get(Dataset, dataset_id)
    else:
        ds = db.scalar(
            select(Dataset).where(Dataset.status.in_(["validated", "processed"])).order_by(Dataset.id.desc())
        )
    if ds is None:
        raise HTTPException(status_code=404, detail="No validated upload found. Upload a CSV first.")
    if ds.status == "invalid":
        raise HTTPException(status_code=422, detail=f"This upload failed validation: {ds.error}")
    if not Path(ds.stored_path).exists():
        raise HTTPException(status_code=410, detail="The uploaded file is no longer on disk. Upload it again.")
    if evaluation.is_running(ds.id):
        raise HTTPException(status_code=409, detail="Model evaluation is running for this dataset. Try again when it finishes.")

    try:
        raw = preprocessing.read_raw_csv(ds.stored_path)
        cleaned, summary = preprocessing.clean(raw)
    except preprocessing.DatasetValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    path = data_service.store_cleaned(ds, cleaned)
    data_service.invalidate(ds.id)
    daily = build_daily(cleaned)

    meta = ds.meta
    meta.cleaned_row_count = int(len(cleaned))
    meta.cleaned_date_min = cleaned[preprocessing.DATE_COL].min().date()
    meta.cleaned_date_max = cleaned[preprocessing.DATE_COL].max().date()
    meta.daily_observations = int(len(daily))
    meta.total_energy_kwh = float(cleaned[preprocessing.ENERGY_COL].sum())
    meta.station_count = int(cleaned[preprocessing.STATION_COL].nunique())
    summary["daily_observations"] = int(len(daily))
    summary["zero_demand_days"] = int((daily == 0).sum())
    summary["data_warnings"] = edge_day_warnings(daily)
    meta.quality_summary = summary

    ds.cleaned_path = str(path)
    ds.status = "processed"
    ds.processed_at = data_service.now()
    ds.error = None
    data_service.activate(db, ds)  # only a validated, successfully cleaned upload replaces the active dataset
    db.refresh(ds)

    run_id = evaluation.start_evaluation(ds.id) if AUTO_EVALUATE else None
    msg = f"Cleaned {summary['cleaned_rows']:,} of {summary['original_rows']:,} records. Dataset is now active."
    if run_id:
        msg += " Model evaluation started in the background."
    return PreprocessResponse(
        dataset=DatasetInfo.model_validate(ds),
        original_rows=summary["original_rows"],
        cleaned_rows=summary["cleaned_rows"],
        quality_summary=summary,
        evaluation_run_id=run_id,
        message=msg,
    )


@router.post("/{dataset_id}/activate", response_model=DatasetInfo)
def activate_dataset(dataset_id: int, db: Session = Depends(get_db)):
    ds = db.get(Dataset, dataset_id)
    if ds is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    if ds.status != "processed" or not ds.cleaned_path or not Path(ds.cleaned_path).exists():
        raise HTTPException(status_code=422, detail="Only preprocessed datasets can be activated.")
    data_service.activate(db, ds)
    if AUTO_EVALUATE and evaluation.latest_run(db, ds.id, completed_only=True) is None:
        evaluation.start_evaluation(ds.id)
    db.refresh(ds)
    return DatasetInfo.model_validate(ds)


@router.get("/download")
def download_cleaned(dataset_id: int | None = Query(None), db: Session = Depends(get_db)):
    ds = db.get(Dataset, dataset_id) if dataset_id else data_service.get_active_dataset(db)
    if ds is None or not ds.cleaned_path or not Path(ds.cleaned_path).exists():
        raise HTTPException(status_code=404, detail="No cleaned dataset available. Run preprocessing first.")
    df: pd.DataFrame = data_service.load_dataset(ds.id, ds.cleaned_path).df

    def stream():
        chunk = 20000
        out = df.copy(deep=False)
        out[preprocessing.DATE_COL] = out[preprocessing.DATE_COL].dt.strftime("%m/%d/%Y")
        for i in range(0, len(out), chunk):
            yield out.iloc[i : i + chunk].to_csv(index=False, header=(i == 0))

    stem = Path(ds.filename).stem
    return StreamingResponse(
        stream(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{stem}_cleaned.csv"'},
    )
