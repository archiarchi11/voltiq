"""Dataset lifecycle operations shared by the API routes and startup seeding."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from config import AUTO_EVALUATE
from database import SessionLocal
from models import Dataset, DatasetMetadata
from services import data_service, evaluation, preprocessing
from services.analysis import build_daily, edge_day_warnings

log = logging.getLogger("voltiq.dataset")


def register_upload(db: Session, path: Path, filename: str, size: int) -> Dataset:
    """Record an uploaded file, then validate and profile it. Never changes the active dataset."""
    ds = Dataset(filename=Path(filename).name, stored_path=str(path), file_size_bytes=size, status="uploaded")
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
    return ds


def preprocess(db: Session, ds: Dataset) -> dict[str, Any]:
    """Clean a validated upload with the notebook rules and make it the active dataset.

    Raises ``preprocessing.DatasetValidationError`` if cleaning leaves no usable records.
    Returns the quality summary.
    """
    raw = preprocessing.read_raw_csv(ds.stored_path)
    cleaned, summary = preprocessing.clean(raw)

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
    return summary


def seed_from_csv(csv_path: Path) -> None:
    """Load a dataset automatically when the database has none (e.g. a fresh hosted container).

    Runs the same upload -> validate -> preprocess -> evaluate path as the UI.
    """
    if not csv_path.is_file():
        log.warning("Seed CSV not found at %s - skipping", csv_path)
        return
    with SessionLocal() as db:
        if db.scalar(select(Dataset.id).limit(1)) is not None:
            return  # data already present; never overwrite user data
        target = data_service.UPLOAD_DIR / f"seed_{csv_path.name}"
        shutil.copyfile(csv_path, target)
        log.info("Seeding database from %s", csv_path.name)
        ds = register_upload(db, target, csv_path.name, target.stat().st_size)
        if ds.status != "validated":
            log.warning("Seed CSV failed validation: %s", ds.error)
            return
        try:
            summary = preprocess(db, ds)
        except preprocessing.DatasetValidationError as exc:
            log.warning("Seed CSV could not be cleaned: %s", exc)
            return
        log.info("Seeded dataset #%s with %s cleaned records", ds.id, f"{summary['cleaned_rows']:,}")
        if AUTO_EVALUATE:
            evaluation.start_evaluation(ds.id)
