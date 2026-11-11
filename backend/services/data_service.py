"""Dataset storage, activation and the in-memory cache of the active cleaned dataset."""
from __future__ import annotations

import re
import shutil
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import CLEANED_DIR, DATA_DIR, MAX_UPLOAD_MB, UPLOAD_DIR
from models import Dataset, DatasetMetadata
from services import preprocessing
from services.analysis import build_daily, build_daily_sessions, timeseries_analysis


class NoActiveDatasetError(LookupError):
    def __init__(self, message: str = "No active dataset. Upload and preprocess a CSV on the Dataset page first."):
        super().__init__(message)


class UploadTooLargeError(ValueError):
    pass


@dataclass
class ActiveData:
    dataset_id: int
    df: pd.DataFrame
    daily: pd.Series
    daily_sessions: pd.Series
    _timeseries: dict | None = None

    def timeseries(self) -> dict:
        if self._timeseries is None:
            self._timeseries = timeseries_analysis(self.daily)
        return self._timeseries


_cache: dict[int, ActiveData] = {}
_cache_lock = threading.Lock()


def _safe_filename(name: str) -> str:
    name = Path(name or "upload.csv").name
    name = re.sub(r"[^A-Za-z0-9._()\- ]+", "_", name).strip() or "upload.csv"
    return name[:180]


def save_upload(fileobj: BinaryIO, original_name: str) -> tuple[Path, int]:
    """Stream an uploaded file to disk, enforcing the size limit."""
    target = UPLOAD_DIR / f"{uuid.uuid4().hex[:12]}_{_safe_filename(original_name)}"
    limit = MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    with target.open("wb") as out:
        while chunk := fileobj.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                out.close()
                target.unlink(missing_ok=True)
                raise UploadTooLargeError(f"File exceeds the {MAX_UPLOAD_MB} MB upload limit.")
            out.write(chunk)
    return target, size


def cleaned_path_for(dataset_id: int) -> Path:
    return CLEANED_DIR / f"dataset_{dataset_id}_cleaned.pkl"


def get_active_dataset(db: Session) -> Dataset | None:
    return db.scalar(select(Dataset).where(Dataset.is_active.is_(True)).order_by(Dataset.id.desc()))


def require_active_dataset(db: Session) -> Dataset:
    ds = get_active_dataset(db)
    if ds is None or not ds.cleaned_path or not Path(ds.cleaned_path).exists():
        raise NoActiveDatasetError()
    return ds


def activate(db: Session, dataset: Dataset) -> None:
    for other in db.scalars(select(Dataset).where(Dataset.is_active.is_(True))):
        other.is_active = False
    dataset.is_active = True
    db.commit()


def store_cleaned(dataset: Dataset, cleaned: pd.DataFrame) -> Path:
    path = cleaned_path_for(dataset.id)
    tmp = path.with_suffix(".tmp")
    cleaned.to_pickle(tmp)
    shutil.move(tmp, path)
    return path


def load_active(db: Session) -> ActiveData:
    """Return the cached cleaned dataframe and daily series for the active dataset."""
    ds = require_active_dataset(db)
    return load_dataset(ds.id, ds.cleaned_path)


def load_dataset(dataset_id: int, cleaned_path: str) -> ActiveData:
    with _cache_lock:
        cached = _cache.get(dataset_id)
        if cached is not None:
            return cached
        df = pd.read_pickle(cleaned_path)
        daily = build_daily(df)
        sessions = build_daily_sessions(df, daily.index)
        data = ActiveData(dataset_id=dataset_id, df=df, daily=daily, daily_sessions=sessions)
        # Keep at most the two most recently used datasets in memory.
        for key in list(_cache)[:-1]:
            _cache.pop(key, None)
        _cache[dataset_id] = data
        return data


def invalidate(dataset_id: int) -> None:
    with _cache_lock:
        _cache.pop(dataset_id, None)


def restore_snapshot() -> bool:
    """Copy a build-time snapshot (database, cleaned data, fitted models) into an empty data directory."""
    from config import DEFAULT_DATABASE, SNAPSHOT_DIR, USING_DEFAULT_DATABASE

    if not USING_DEFAULT_DATABASE or DEFAULT_DATABASE.exists() or not (SNAPSHOT_DIR / "voltiq.db").is_file():
        return False
    shutil.copytree(SNAPSHOT_DIR, DATA_DIR, dirs_exist_ok=True)
    return True


def repair_paths(db: Session) -> int:
    """Re-point stored file paths at this data directory after the project folder has been moved.

    Paths are stored as absolute paths; if one lies outside ``DATA_DIR`` but a file with the same
    name exists in the matching sub-folder here (uploads/ or cleaned/), the stored path is updated.
    """
    fixed = 0
    root = DATA_DIR.resolve()
    for ds in db.scalars(select(Dataset)):
        for attr in ("stored_path", "cleaned_path"):
            value = getattr(ds, attr)
            if not value:
                continue
            path = Path(value)
            if root in path.resolve().parents:
                continue
            candidate = root / path.parent.name / path.name
            if candidate.exists():
                setattr(ds, attr, str(candidate))
                fixed += 1
    if fixed:
        db.commit()
    return fixed


def dataset_meta(dataset: Dataset) -> DatasetMetadata | None:
    return dataset.meta


def now() -> datetime:
    return datetime.now(timezone.utc)
