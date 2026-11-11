"""Database tables."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Dataset(Base):
    """An uploaded CSV file. Only one processed dataset is active at a time."""

    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(1024))
    cleaned_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    # uploaded -> validated | invalid -> processed
    status: Mapped[str] = mapped_column(String(32), default="uploaded")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    meta: Mapped["DatasetMetadata | None"] = relationship(
        back_populates="dataset", uselist=False, cascade="all, delete-orphan"
    )


class DatasetMetadata(Base):
    """Profiling, validation and cleaning results for a dataset."""

    __tablename__ = "dataset_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), unique=True)

    row_count: Mapped[int] = mapped_column(Integer, default=0)
    column_count: Mapped[int] = mapped_column(Integer, default=0)
    columns: Mapped[list[str]] = mapped_column(JSON, default=list)
    missing_values: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    preview: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    validation: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    session_status_counts: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    date_min: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_max: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Filled by preprocessing
    cleaned_row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cleaned_date_min: Mapped[date | None] = mapped_column(Date, nullable=True)
    cleaned_date_max: Mapped[date | None] = mapped_column(Date, nullable=True)
    daily_observations: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_energy_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    station_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quality_summary: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    dataset: Mapped[Dataset] = relationship(back_populates="meta")


class EvaluationRun(Base):
    """One run of the notebook's validation + test evaluation over all candidate models."""

    __tablename__ = "evaluation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="running")  # running | completed | failed
    progress: Mapped[int] = mapped_column(Integer, default=0)
    total_steps: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    best_model_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    split: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # {"dates": [...], "actual": [...], "predictions": {model_key: [...]}}
    test_series: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    feature_importance: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)

    results: Mapped[list["ModelEvaluation"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="ModelEvaluation.id"
    )


class ModelEvaluation(Base):
    """Validation and test metrics for one candidate model."""

    __tablename__ = "model_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("evaluation_runs.id", ondelete="CASCADE"), index=True)
    model_key: Mapped[str] = mapped_column(String(64))
    model_name: Mapped[str] = mapped_column(String(128))
    family: Mapped[str] = mapped_column(String(64))
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False)

    validation_mae: Mapped[float | None] = mapped_column(Float, nullable=True)
    validation_rmse: Mapped[float | None] = mapped_column(Float, nullable=True)
    validation_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    test_mae: Mapped[float | None] = mapped_column(Float, nullable=True)
    test_mse: Mapped[float | None] = mapped_column(Float, nullable=True)
    test_rmse: Mapped[float | None] = mapped_column(Float, nullable=True)
    test_mape: Mapped[float | None] = mapped_column(Float, nullable=True)
    test_r2: Mapped[float | None] = mapped_column(Float, nullable=True)
    test_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    fit_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    run: Mapped[EvaluationRun] = relationship(back_populates="results")


class ForecastRun(Base):
    """A forecast generated from the full history of the active dataset."""

    __tablename__ = "forecast_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    requested_model: Mapped[str] = mapped_column(String(64))  # "auto" or a model key
    model_key: Mapped[str] = mapped_column(String(64))
    model_name: Mapped[str] = mapped_column(String(128))
    horizon: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(32), default="user")  # user | evaluation
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    total_kwh: Mapped[float] = mapped_column(Float)
    average_kwh: Mapped[float] = mapped_column(Float)
    previous_period_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    pct_change: Mapped[float | None] = mapped_column(Float, nullable=True)

    validation_rmse: Mapped[float | None] = mapped_column(Float, nullable=True)
    validation_mae: Mapped[float | None] = mapped_column(Float, nullable=True)
    evaluation_run_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    history_start: Mapped[date] = mapped_column(Date)
    history_end: Mapped[date] = mapped_column(Date)
    n_observations: Mapped[int] = mapped_column(Integer)
    fit_seconds: Mapped[float] = mapped_column(Float, default=0.0)

    predictions: Mapped[list["ForecastPrediction"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="ForecastPrediction.date"
    )


class ForecastPrediction(Base):
    __tablename__ = "forecast_predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("forecast_runs.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)
    predicted_kwh: Mapped[float] = mapped_column(Float)

    run: Mapped[ForecastRun] = relationship(back_populates="predictions")
