"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())


# ---------------------------------------------------------------- dataset


class ValidationCheck(BaseModel):
    name: str
    passed: bool
    detail: str
    level: Literal["error", "warning"]


class ValidationReport(BaseModel):
    valid: bool
    errors: list[str]
    warnings: list[str]
    checks: list[ValidationCheck]


class DatasetInfo(ORMModel):
    id: int
    filename: str
    file_size_bytes: int
    status: str
    is_active: bool
    error: str | None = None
    uploaded_at: datetime
    processed_at: datetime | None = None


class DatasetProfile(BaseModel):
    row_count: int
    column_count: int
    columns: list[str]
    missing_values: dict[str, int]
    date_min: date | None
    date_max: date | None
    session_status_counts: dict[str, int]


class CleaningSummary(BaseModel):
    cleaned_row_count: int | None
    cleaned_date_min: date | None
    cleaned_date_max: date | None
    daily_observations: int | None
    total_energy_kwh: float | None
    station_count: int | None
    quality_summary: dict[str, Any] | None


class DatasetDetail(BaseModel):
    dataset: DatasetInfo
    profile: DatasetProfile | None
    validation: ValidationReport | None
    cleaning: CleaningSummary | None


class EvaluationStatus(BaseModel):
    run_id: int | None
    status: str  # none | running | completed | failed
    progress: int = 0
    total_steps: int = 0
    message: str | None = None
    best_model_key: str | None = None
    best_model_name: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class DatasetSummary(BaseModel):
    has_active_dataset: bool
    active: DatasetDetail | None
    latest_upload: DatasetDetail | None
    datasets: list[DatasetInfo]
    evaluation: EvaluationStatus
    required_columns: list[str]


class PreviewResponse(BaseModel):
    dataset_id: int
    filename: str
    columns: list[str]
    rows: list[dict[str, Any]]


class PreprocessRequest(BaseModel):
    dataset_id: int | None = Field(None, description="Dataset to preprocess; defaults to the latest validated upload.")


class PreprocessResponse(BaseModel):
    dataset: DatasetInfo
    original_rows: int
    cleaned_rows: int
    quality_summary: dict[str, Any]
    evaluation_run_id: int | None
    message: str


# ---------------------------------------------------------------- forecasting

ModelChoice = Literal[
    "auto", "naive", "snaive", "ar1", "ma1", "arma11", "arima111", "arima211", "arima112",
    "sarima101", "sarima111", "ets", "rf",
]


class ForecastRequest(BaseModel):
    model: ModelChoice = "auto"
    horizon: Literal[7, 14, 30] = 30


class ForecastPoint(BaseModel):
    date: date
    predicted_kwh: float


class HistoryPoint(BaseModel):
    date: date
    energy_kwh: float


class ForecastRunOut(ORMModel):
    id: int
    dataset_id: int
    requested_model: str
    model_key: str
    model_name: str
    model_family: str | None = None
    horizon: int
    source: str
    created_at: datetime
    total_kwh: float
    average_kwh: float
    previous_period_kwh: float | None
    pct_change: float | None
    validation_rmse: float | None
    validation_mae: float | None
    evaluation_run_id: int | None
    history_start: date
    history_end: date
    n_observations: int
    fit_seconds: float


class ForecastResponse(BaseModel):
    run: ForecastRunOut
    predictions: list[ForecastPoint]
    history: list[HistoryPoint]
    warnings: list[dict[str, Any]] = []


class ForecastHistoryResponse(BaseModel):
    runs: list[ForecastRunOut]
