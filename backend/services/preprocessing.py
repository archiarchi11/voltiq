"""CSV validation, profiling and cleaning.

The cleaning rules reproduce Cell 4 of ``EV_updated.ipynb`` exactly:

1. strip column names
2. parse ``Date`` with format ``%m/%d/%Y`` (invalid -> NaT)
3. coerce ``Energy Provided (kWh)`` to numeric (invalid -> NaN)
4. drop rows with an invalid date or missing energy
5. keep non-negative energy values only
6. normalise ``Session Status`` (strip + upper) and keep ``PAID`` / ``ROAMING`` sessions
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

DATE_COL = "Date"
STATION_COL = "Station Name"
LOCATION_COL = "Location Name"
ENERGY_COL = "Energy Provided (kWh)"
STATUS_COL = "Session Status"

REQUIRED_COLUMNS = [DATE_COL, STATION_COL, ENERGY_COL, STATUS_COL]
VALID_STATUSES = ["PAID", "ROAMING"]
DATE_FORMAT = "%m/%d/%Y"


class DatasetValidationError(ValueError):
    pass


def read_raw_csv(path: str | Path) -> pd.DataFrame:
    """Read an uploaded CSV.

    Every column is read as text so identifiers such as station names ("101337", "EV0445")
    keep a single consistent type; numeric conversion happens explicitly during cleaning.
    Standard missing-value markers (empty, "NULL", "NaN", ...) are still treated as missing.
    """
    try:
        df = pd.read_csv(path, dtype=str, low_memory=False)
    except pd.errors.EmptyDataError as exc:
        raise DatasetValidationError("The file is empty.") from exc
    except (pd.errors.ParserError, UnicodeDecodeError) as exc:
        raise DatasetValidationError(f"The file could not be parsed as CSV: {str(exc)[:200]}") from exc
    df.columns = df.columns.astype(str).str.strip()
    return df


def _parse_dates(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, format=DATE_FORMAT, errors="coerce")


def _json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if np.isnan(value) else float(value)
    return value


def validate(df: pd.DataFrame) -> dict[str, Any]:
    """Validate structure and content. Returns {"valid": bool, "errors": [...], "warnings": [...], "checks": [...]}"""
    errors: list[str] = []
    warnings: list[str] = []
    checks: list[dict[str, Any]] = []

    def check(name: str, passed: bool, detail: str, level: str = "error") -> None:
        checks.append({"name": name, "passed": bool(passed), "detail": detail, "level": level})
        if not passed:
            (errors if level == "error" else warnings).append(detail)

    check("Non-empty file", len(df) > 0, f"{len(df):,} data rows found" if len(df) else "The file has no data rows")

    missing_cols = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    check(
        "Required columns",
        not missing_cols,
        "All required columns present" if not missing_cols else f"Missing required column(s): {', '.join(missing_cols)}",
    )

    dup_cols = df.columns[df.columns.duplicated()].tolist()
    check("Unique column names", not dup_cols, "Column names are unique" if not dup_cols else f"Duplicate columns: {dup_cols}")

    if not missing_cols and len(df) > 0:
        dates = _parse_dates(df[DATE_COL])
        n_dates = int(dates.notna().sum())
        rate = n_dates / len(df)
        check("Date format (MM/DD/YYYY)", n_dates > 0, f"{rate:.1%} of rows have a valid date")
        if n_dates > 0:
            check("Date completeness", rate >= 0.95, f"{len(df) - n_dates:,} rows have an invalid or missing date", "warning")

        energy = pd.to_numeric(df[ENERGY_COL], errors="coerce")
        n_energy = int(energy.notna().sum())
        check("Numeric energy values", n_energy > 0, f"{n_energy / len(df):.1%} of rows have a numeric energy value")
        n_neg = int((energy < 0).sum())
        check("Non-negative energy", n_neg == 0, f"{n_neg:,} rows have negative energy (removed during cleaning)", "warning")

        status = df[STATUS_COL].astype(str).str.strip().str.upper()
        n_valid = int(status.isin(VALID_STATUSES).sum())
        check(
            "Valid session statuses",
            n_valid > 0,
            f"{n_valid:,} rows have status PAID or ROAMING" if n_valid else "No rows with status PAID or ROAMING",
        )

        if n_dates > 0:
            span_days = int((dates.max() - dates.min()).days) + 1
            check(
                "History length",
                span_days >= 60,
                f"Data spans {span_days:,} days" + ("" if span_days >= 60 else " (at least 60 are needed for model fitting)"),
                "warning",
            )

    return {"valid": not errors, "errors": errors, "warnings": warnings, "checks": checks}


def profile(df: pd.DataFrame) -> dict[str, Any]:
    """Row/column counts, missing values, preview and date range of the raw file."""
    preview_df = df.head(10).astype(object).where(df.head(10).notna(), None)
    preview = [{k: _json_value(v) for k, v in row.items()} for row in preview_df.to_dict(orient="records")]

    date_min = date_max = None
    status_counts: dict[str, int] = {}
    if DATE_COL in df.columns:
        dates = _parse_dates(df[DATE_COL]).dropna()
        if not dates.empty:
            date_min, date_max = dates.min().date(), dates.max().date()
    if STATUS_COL in df.columns:
        vc = df[STATUS_COL].fillna("(missing)").astype(str).str.strip().value_counts()
        status_counts = {str(k): int(v) for k, v in vc.items()}

    return {
        "row_count": int(len(df)),
        "column_count": int(df.shape[1]),
        "columns": [str(c) for c in df.columns],
        "missing_values": {str(k): int(v) for k, v in df.isna().sum().items()},
        "preview": preview,
        "date_min": date_min,
        "date_max": date_max,
        "session_status_counts": status_counts,
    }


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Apply the notebook's cleaning rules and report what each step removed."""
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise DatasetValidationError(f"Missing required column(s): {', '.join(missing)}")

    original = len(df)
    df = df.copy()
    df.columns = df.columns.str.strip()

    df[DATE_COL] = _parse_dates(df[DATE_COL])
    df[ENERGY_COL] = pd.to_numeric(df[ENERGY_COL], errors="coerce")

    invalid_date = int(df[DATE_COL].isna().sum())
    missing_energy = int((df[DATE_COL].notna() & df[ENERGY_COL].isna()).sum())
    df = df.dropna(subset=[DATE_COL, ENERGY_COL])

    negative_energy = int((df[ENERGY_COL] < 0).sum())
    df = df[df[ENERGY_COL] >= 0]

    df[STATUS_COL] = df[STATUS_COL].astype(str).str.strip().str.upper()
    excluded_status_counts = {
        str(k): int(v) for k, v in df.loc[~df[STATUS_COL].isin(VALID_STATUSES), STATUS_COL].value_counts().items()
    }
    invalid_status = int(sum(excluded_status_counts.values()))
    df = df[df[STATUS_COL].isin(VALID_STATUSES)].copy()

    if df.empty:
        raise DatasetValidationError("No records remain after cleaning.")

    df[STATION_COL] = df[STATION_COL].astype(str).str.strip()
    df = df.reset_index(drop=True)

    cleaned = len(df)
    zero_energy = int((df[ENERGY_COL] == 0).sum())
    summary = {
        "original_rows": original,
        "cleaned_rows": cleaned,
        "removed_rows": original - cleaned,
        "retention_pct": round(cleaned / original * 100, 3) if original else 0.0,
        "steps": [
            {"step": "Invalid or missing date", "removed": invalid_date},
            {"step": "Missing / non-numeric energy", "removed": missing_energy},
            {"step": "Negative energy", "removed": negative_energy},
            {"step": "Session status not PAID / ROAMING", "removed": invalid_status},
        ],
        "excluded_status_counts": excluded_status_counts,
        "kept_status_counts": {str(k): int(v) for k, v in df[STATUS_COL].value_counts().items()},
        "zero_energy_sessions": zero_energy,
        "energy_stats": {
            "min": float(df[ENERGY_COL].min()),
            "max": float(df[ENERGY_COL].max()),
            "mean": float(df[ENERGY_COL].mean()),
            "median": float(df[ENERGY_COL].median()),
        },
        "missing_after_cleaning": {str(k): int(v) for k, v in df.isna().sum().items() if v > 0},
    }
    return df, summary
