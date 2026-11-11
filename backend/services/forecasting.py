"""Forecasting models, ported from Cells 13, 13b and 14 of ``EV_updated.ipynb``.

Model configurations are kept exactly as in the notebook:

* Naive (last value) and Seasonal naive (same day last week, season=7)
* AR(1), MA(1), ARMA(1,1), ARIMA(1,1,1), ARIMA(2,1,1), ARIMA(1,1,2)
* SARIMA(1,0,1)(1,0,1,7) and SARIMA(1,1,1)(1,1,1,7)
* Exponential Smoothing (additive damped trend, additive weekly seasonality)
* Random Forest on lag features (200 trees, min_samples_leaf=2, random_state=42),
  forecasting recursively
"""
from __future__ import annotations

import time
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.holtwinters import ExponentialSmoothing

from config import MODEL_DIR


class ModelFitError(RuntimeError):
    pass


class InsufficientDataError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Model registry (notebook "candidates" dictionary)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ModelSpec:
    key: str
    name: str  # exact notebook label
    family: str
    model_type: str
    params: Any
    is_baseline: bool = False
    description: str = ""


MODEL_SPECS: list[ModelSpec] = [
    ModelSpec("naive", "Baseline: Naive (last value)", "Naive", "naive", None, True,
              "Repeats the last observed daily demand."),
    ModelSpec("snaive", "Baseline: Same day last week", "Seasonal Naive", "snaive", None, True,
              "Repeats the last 7 days (weekly pattern)."),
    ModelSpec("ar1", "AR(1)", "ARIMA", "arima", (1, 0, 0), description="Autoregressive, order 1."),
    ModelSpec("ma1", "MA(1)", "ARIMA", "arima", (0, 0, 1), description="Moving average, order 1."),
    ModelSpec("arma11", "ARMA(1,1)", "ARIMA", "arima", (1, 0, 1), description="ARMA with one AR and one MA term."),
    ModelSpec("arima111", "ARIMA(1,1,1)", "ARIMA", "arima", (1, 1, 1), description="First-differenced ARMA(1,1)."),
    ModelSpec("arima211", "ARIMA(2,1,1)", "ARIMA", "arima", (2, 1, 1), description="First-differenced ARMA(2,1)."),
    ModelSpec("arima112", "ARIMA(1,1,2)", "ARIMA", "arima", (1, 1, 2), description="First-differenced ARMA(1,2)."),
    ModelSpec("sarima101", "SARIMA(1,0,1)(1,0,1,7)", "SARIMA", "sarima", ((1, 0, 1), (1, 0, 1, 7)),
              description="ARMA(1,1) with weekly seasonal ARMA terms."),
    ModelSpec("sarima111", "SARIMA(1,1,1)(1,1,1,7)", "SARIMA", "sarima", ((1, 1, 1), (1, 1, 1, 7)),
              description="Differenced ARIMA with weekly seasonal differencing."),
    ModelSpec("ets", "Exponential Smoothing", "Exponential Smoothing", "ets", None,
              description="Additive damped trend with additive weekly seasonality."),
    ModelSpec("rf", "Random Forest (lag features)", "Random Forest", "rf", None,
              description="Random Forest on lag features with recursive multi-step forecasting."),
]

MODELS_BY_KEY: dict[str, ModelSpec] = {s.key: s for s in MODEL_SPECS}
BASELINE_KEY = "snaive"  # notebook Cell 16b compares against "same day last week"


def get_spec(key: str) -> ModelSpec:
    try:
        return MODELS_BY_KEY[key]
    except KeyError as exc:
        raise ValueError(f"Unknown model '{key}'. Valid options: auto, {', '.join(MODELS_BY_KEY)}") from exc


# ---------------------------------------------------------------------------
# Notebook helper models (Cell 13b)
# ---------------------------------------------------------------------------


def make_future_index(series: pd.Series, steps: int) -> pd.DatetimeIndex:
    """Dates that come right after the last date of the series."""
    return pd.date_range(start=series.index[-1] + pd.Timedelta(days=1), periods=steps, freq="D")


class NaiveBaseline:
    """Tomorrow = today. Repeats the last known value."""

    def __init__(self, series: pd.Series):
        self.series = series
        self.last_value = series.iloc[-1]

    def forecast(self, steps: int) -> pd.Series:
        idx = make_future_index(self.series, steps)
        return pd.Series(self.last_value, index=idx)


class SeasonalNaiveBaseline:
    """Same weekday as last week. Repeats the last 7 days again and again."""

    def __init__(self, series: pd.Series, season: int = 7):
        self.series = series
        self.last_season = series.iloc[-season:].values

    def forecast(self, steps: int) -> pd.Series:
        idx = make_future_index(self.series, steps)
        values = np.resize(self.last_season, steps)
        return pd.Series(values, index=idx)


class LagRandomForest:
    """Random Forest that learns from past demand (lag features)."""

    LAGS = [1, 2, 3, 7, 14]
    WINDOW = 30  # 30 days of history are needed before the first prediction
    FEATURE_NAMES = (
        [f"lag_{l}" for l in LAGS]
        + ["mean_last_7", "mean_last_30", "day_of_week", "month", "day_of_month"]
    )

    def __init__(self, n_estimators: int = 200, random_state: int = 42):
        self.model = RandomForestRegressor(
            n_estimators=n_estimators,
            min_samples_leaf=2,
            random_state=random_state,
            n_jobs=-1,
        )

    def _features(self, history, date):
        lags = [history[-lag] for lag in self.LAGS]
        return lags + [
            np.mean(history[-7:]),
            np.mean(history[-30:]),
            date.dayofweek,
            date.month,
            date.day,
        ]

    def fit(self, series: pd.Series) -> "LagRandomForest":
        self.series = series
        values = series.values.astype(float)

        X, y = [], []
        for i in range(self.WINDOW, len(values)):
            X.append(self._features(values[:i], series.index[i]))
            y.append(values[i])

        if not X:
            raise InsufficientDataError(
                f"Random Forest needs more than {self.WINDOW} daily observations to build lag features."
            )
        self.model.fit(np.array(X), np.array(y))
        return self

    def forecast(self, steps: int) -> pd.Series:
        idx = make_future_index(self.series, steps)
        history = list(self.series.values.astype(float))

        self.model.set_params(n_jobs=1)  # faster for one-row predictions

        predictions = []
        for date in idx:
            x = np.array(self._features(history, date)).reshape(1, -1)
            p = max(self.model.predict(x)[0], 0)
            predictions.append(p)
            history.append(p)  # feed our own prediction back in (recursive forecasting)

        self.model.set_params(n_jobs=-1)
        return pd.Series(predictions, index=idx)

    def feature_importance(self) -> list[dict[str, float]]:
        return [
            {"feature": name, "importance": float(imp)}
            for name, imp in zip(self.FEATURE_NAMES, self.model.feature_importances_)
        ]


# ---------------------------------------------------------------------------
# Fitting (Cell 14) and forecasting
# ---------------------------------------------------------------------------


def _min_observations(spec: ModelSpec) -> int:
    if spec.model_type == "rf":
        return LagRandomForest.WINDOW + 1
    if spec.model_type in ("sarima", "ets"):
        return 3 * 7
    if spec.model_type == "snaive":
        return 7
    return 2


def fit_model(series: pd.Series, spec: ModelSpec):
    """Fit one candidate model on a daily series (notebook ``fit_model``)."""
    if series.isna().any():
        raise InsufficientDataError("The daily series contains missing values.")
    needed = _min_observations(spec)
    if len(series) < needed:
        raise InsufficientDataError(f"{spec.name} needs at least {needed} daily observations (got {len(series)}).")

    model_type, params = spec.model_type, spec.params
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # notebook: warnings.filterwarnings("ignore")
        try:
            if model_type == "naive":
                return NaiveBaseline(series)
            if model_type == "snaive":
                return SeasonalNaiveBaseline(series, season=7)
            if model_type == "rf":
                return LagRandomForest().fit(series)
            if model_type == "arima":
                return ARIMA(series, order=params).fit()
            if model_type == "sarima":
                order, seasonal_order = params
                return ARIMA(series, order=order, seasonal_order=seasonal_order).fit()
            if model_type == "ets":
                return ExponentialSmoothing(
                    series,
                    trend="add",
                    damped_trend=True,
                    seasonal="add",
                    seasonal_periods=7,
                ).fit()
        except InsufficientDataError:
            raise
        except Exception as exc:  # statsmodels / numpy failures
            raise ModelFitError(f"{spec.name} failed to fit: {str(exc)[:200]}") from exc
    raise ValueError(f"Unsupported model type '{model_type}'")


def predict(model, series: pd.Series, steps: int) -> pd.Series:
    """Forecast ``steps`` days ahead, clipped at zero (notebook: ``np.maximum(predictions, 0)``)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            raw = model.forecast(steps)
        except Exception as exc:
            raise ModelFitError(f"Forecasting failed: {str(exc)[:200]}") from exc
    values = np.maximum(np.asarray(raw, dtype=float), 0)
    if not np.all(np.isfinite(values)):
        raise ModelFitError("The model produced non-finite predictions.")
    return pd.Series(values, index=make_future_index(series, steps))


# ---------------------------------------------------------------------------
# Final-model cache (fitted on the full history of a dataset)
# ---------------------------------------------------------------------------


def _model_path(dataset_id: int, key: str, last_date: pd.Timestamp, n_obs: int) -> Path:
    return MODEL_DIR / f"dataset_{dataset_id}" / f"{key}_{last_date:%Y%m%d}_{n_obs}.joblib"


def fit_final_model(dataset_id: int, daily: pd.Series, spec: ModelSpec):
    """Fit (or load from the joblib cache) a model refitted on all available history."""
    path = _model_path(dataset_id, spec.key, daily.index[-1], len(daily))
    if path.exists():
        try:
            return joblib.load(path), 0.0, True
        except Exception:
            path.unlink(missing_ok=True)
    start = time.perf_counter()
    model = fit_model(daily, spec)
    elapsed = time.perf_counter() - start
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(model, path, compress=3)
    except Exception:
        pass  # caching is an optimisation only
    return model, elapsed, False


# ---------------------------------------------------------------------------
# Forecast runs (Cell 19): fit on the full history, forecast, persist
# ---------------------------------------------------------------------------

ALLOWED_HORIZONS = (7, 14, 30)


class EvaluationPendingError(RuntimeError):
    pass


def generate_forecast(db, dataset, requested_model: str, horizon: int, source: str = "user", evaluation=None):
    """Fit the requested (or validation-selected) model on all history and forecast ``horizon`` days.

    Returns the persisted ``ForecastRun``.
    """
    from config import MIN_DAILY_OBSERVATIONS
    from models import ForecastPrediction, ForecastRun, ModelEvaluation
    from services import data_service
    from services.evaluation import is_running, latest_run

    if horizon not in ALLOWED_HORIZONS:
        raise ValueError(f"Forecast horizon must be one of {', '.join(map(str, ALLOWED_HORIZONS))} days.")

    daily = data_service.load_dataset(dataset.id, dataset.cleaned_path).daily
    if len(daily) < MIN_DAILY_OBSERVATIONS:
        raise InsufficientDataError(
            f"At least {MIN_DAILY_OBSERVATIONS} daily observations are required (the dataset has {len(daily)})."
        )

    if evaluation is None:
        evaluation = latest_run(db, dataset.id, completed_only=True)

    if requested_model == "auto":
        if evaluation is None or not evaluation.best_model_key:
            if is_running(dataset.id):
                raise EvaluationPendingError(
                    "Model evaluation is still running. Automatic selection becomes available once the "
                    "validation stage finishes — or choose a specific model."
                )
            raise EvaluationPendingError(
                "No completed model evaluation for this dataset. Run the evaluation on the Model Performance page "
                "or choose a specific model."
            )
        spec = get_spec(evaluation.best_model_key)
    else:
        spec = get_spec(requested_model)

    model, fit_seconds, _cached = fit_final_model(dataset.id, daily, spec)
    preds = predict(model, daily, horizon)

    total = float(preds.sum())
    average = float(preds.mean())
    previous = float(daily.iloc[-horizon:].sum()) if len(daily) >= horizon else None
    pct = (total - previous) / previous * 100 if previous else None

    val_row = None
    if evaluation is not None:
        val_row = db.query(ModelEvaluation).filter_by(run_id=evaluation.id, model_key=spec.key).one_or_none()

    run = ForecastRun(
        dataset_id=dataset.id,
        requested_model=requested_model,
        model_key=spec.key,
        model_name=spec.name,
        horizon=horizon,
        source=source,
        total_kwh=total,
        average_kwh=average,
        previous_period_kwh=previous,
        pct_change=pct,
        validation_rmse=val_row.validation_rmse if val_row else None,
        validation_mae=val_row.validation_mae if val_row else None,
        evaluation_run_id=evaluation.id if evaluation is not None else None,
        history_start=daily.index[0].date(),
        history_end=daily.index[-1].date(),
        n_observations=int(len(daily)),
        fit_seconds=round(fit_seconds, 3),
    )
    run.predictions = [
        ForecastPrediction(date=d.date(), predicted_kwh=float(v)) for d, v in preds.items()
    ]
    db.add(run)
    db.commit()
    db.refresh(run)
    return run
