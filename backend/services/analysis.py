"""Descriptive and time-series analysis (notebook Cells 5-11)."""
from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import adfuller

from services.preprocessing import DATE_COL, ENERGY_COL, LOCATION_COL, STATION_COL

WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def build_daily(df: pd.DataFrame) -> pd.Series:
    """Daily total energy demand (kWh) on a continuous calendar (notebook Cell 5).

    Dates with no recorded sessions are assumed to represent zero demand.
    """
    daily = df.groupby(DATE_COL)[ENERGY_COL].sum().sort_index()
    daily = daily.asfreq("D")
    daily = daily.fillna(0)
    daily.name = "Daily_Demand"
    return daily.astype(float)


def build_daily_sessions(df: pd.DataFrame, index: pd.DatetimeIndex) -> pd.Series:
    return df.groupby(DATE_COL).size().reindex(index, fill_value=0).astype(int)


def _f(x: Any) -> float | None:
    if x is None:
        return None
    x = float(x)
    return None if not np.isfinite(x) else round(x, 4)


def filter_frame(df: pd.DataFrame, start: date | None, end: date | None) -> pd.DataFrame:
    mask = pd.Series(True, index=df.index)
    if start:
        mask &= df[DATE_COL] >= pd.Timestamp(start)
    if end:
        mask &= df[DATE_COL] <= pd.Timestamp(end)
    return df[mask]


def slice_series(series: pd.Series, start: date | None, end: date | None) -> pd.Series:
    if start:
        series = series[series.index >= pd.Timestamp(start)]
    if end:
        series = series[series.index <= pd.Timestamp(end)]
    return series


# ---------------------------------------------------------------------------
# Aggregate trends
# ---------------------------------------------------------------------------


def daily_points(daily: pd.Series, sessions: pd.Series) -> list[dict[str, Any]]:
    return [
        {"date": d.strftime("%Y-%m-%d"), "energy_kwh": _f(v), "sessions": int(sessions.get(d, 0))}
        for d, v in daily.items()
    ]


def monthly_points(daily: pd.Series, sessions: pd.Series) -> list[dict[str, Any]]:
    """Monthly energy totals (notebook: ``daily.resample("ME").sum()``)."""
    if daily.empty:
        return []
    monthly = daily.resample("ME").sum()
    monthly_sessions = sessions.resample("ME").sum()
    days = daily.resample("ME").count()
    return [
        {
            "month": d.strftime("%Y-%m"),
            "energy_kwh": _f(v),
            "sessions": int(monthly_sessions.get(d, 0)),
            "days": int(days.get(d, 0)),
            "avg_daily_kwh": _f(v / days.get(d, 1)) if days.get(d, 0) else None,
        }
        for d, v in monthly.items()
    ]


def weekly_points(daily: pd.Series) -> list[dict[str, Any]]:
    """Average daily demand by weekday (notebook Cell 8)."""
    if daily.empty:
        return []
    grouped = daily.groupby(daily.index.day_name())
    mean = grouped.mean().reindex(WEEKDAY_ORDER)
    median = grouped.median().reindex(WEEKDAY_ORDER)
    std = grouped.std().reindex(WEEKDAY_ORDER)
    count = grouped.count().reindex(WEEKDAY_ORDER)
    total = grouped.sum().reindex(WEEKDAY_ORDER)
    return [
        {
            "weekday": day,
            "short": day[:3],
            "avg_kwh": _f(mean[day]),
            "median_kwh": _f(median[day]),
            "std_kwh": _f(std[day]),
            "total_kwh": _f(total[day]),
            "days": int(count[day]) if pd.notna(count[day]) else 0,
        }
        for day in WEEKDAY_ORDER
    ]


# ---------------------------------------------------------------------------
# Stations (notebook Cell 9)
# ---------------------------------------------------------------------------


def station_table(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(
            columns=["station", "location", "energy_kwh", "sessions", "avg_kwh_per_session",
                     "first_date", "last_date", "active_days", "share_pct"]
        )
    g = df.groupby(STATION_COL)
    table = pd.DataFrame(
        {
            "energy_kwh": g[ENERGY_COL].sum(),
            "sessions": g.size(),
            "first_date": g[DATE_COL].min(),
            "last_date": g[DATE_COL].max(),
            "active_days": g[DATE_COL].nunique(),
        }
    )
    if LOCATION_COL in df.columns:
        table["location"] = g[LOCATION_COL].agg(
            lambda s: s.mode().iloc[0] if not s.dropna().empty else None
        )
    else:
        table["location"] = None
    table["avg_kwh_per_session"] = table["energy_kwh"] / table["sessions"]
    total = table["energy_kwh"].sum()
    table["share_pct"] = table["energy_kwh"] / total * 100 if total else 0.0
    table = table.sort_values("energy_kwh", ascending=False)
    table.index.name = "station"
    return table.reset_index()


def station_records(table: pd.DataFrame) -> list[dict[str, Any]]:
    out = []
    for rank, row in enumerate(table.itertuples(index=False), start=1):
        out.append(
            {
                "rank": int(getattr(row, "rank", rank)),
                "station": str(row.station),
                "location": row.location if isinstance(row.location, str) else None,
                "energy_kwh": _f(row.energy_kwh),
                "sessions": int(row.sessions),
                "avg_kwh_per_session": _f(row.avg_kwh_per_session),
                "share_pct": _f(row.share_pct),
                "first_date": row.first_date.strftime("%Y-%m-%d"),
                "last_date": row.last_date.strftime("%Y-%m-%d"),
                "active_days": int(row.active_days),
            }
        )
    return out


def station_history(df: pd.DataFrame, station: str) -> dict[str, Any] | None:
    sdf = df[df[STATION_COL] == station]
    if sdf.empty:
        return None
    daily = sdf.groupby(DATE_COL)[ENERGY_COL].sum().sort_index().asfreq("D").fillna(0)
    sessions = sdf.groupby(DATE_COL).size().reindex(daily.index, fill_value=0)
    monthly = daily.resample("ME").sum()
    monthly_sessions = sessions.resample("ME").sum()
    weekly = weekly_points(daily)
    return {
        "daily": [
            {"date": d.strftime("%Y-%m-%d"), "energy_kwh": _f(v), "sessions": int(sessions[d])}
            for d, v in daily.items()
        ],
        "monthly": [
            {"month": d.strftime("%Y-%m"), "energy_kwh": _f(v), "sessions": int(monthly_sessions[d])}
            for d, v in monthly.items()
        ],
        "weekly": weekly,
        "energy_distribution": _energy_histogram(sdf[ENERGY_COL]),
    }


def _energy_histogram(values: pd.Series, bins: int = 12) -> list[dict[str, Any]]:
    values = values.dropna()
    if values.empty:
        return []
    upper = float(np.percentile(values, 99)) or float(values.max()) or 1.0
    edges = np.linspace(0, upper, bins + 1)
    counts, _ = np.histogram(values.clip(upper=upper), bins=edges)
    return [
        {"range": f"{edges[i]:.0f}–{edges[i + 1]:.0f}", "from": _f(edges[i]), "to": _f(edges[i + 1]), "count": int(c)}
        for i, c in enumerate(counts)
    ]


# ---------------------------------------------------------------------------
# Stationarity (Cells 7, 10, 11)
# ---------------------------------------------------------------------------


def adf_summary(series: pd.Series) -> dict[str, Any]:
    result = adfuller(series.dropna())
    stat, pvalue, used_lag, nobs, critical = result[0], result[1], result[2], result[3], result[4]
    stationary = bool(pvalue < 0.05)
    return {
        "statistic": _f(stat),
        "p_value": float(pvalue),
        "used_lag": int(used_lag),
        "n_obs": int(nobs),
        "critical_values": {k: _f(v) for k, v in critical.items()},
        "stationary": stationary,
        "interpretation": (
            "Stationary: the p-value is below 0.05, so the unit-root null hypothesis is rejected."
            if stationary
            else "Non-stationary: the p-value is at or above 0.05, so a unit root cannot be ruled out."
        ),
    }


def timeseries_analysis(daily: pd.Series) -> dict[str, Any]:
    rolling_mean = daily.rolling(30).mean()
    rolling_std = daily.rolling(30).std()
    diff = daily.diff().dropna()

    points = [
        {
            "date": d.strftime("%Y-%m-%d"),
            "energy_kwh": _f(v),
            "rolling_mean_30": _f(rolling_mean[d]) if pd.notna(rolling_mean[d]) else None,
            "rolling_std_30": _f(rolling_std[d]) if pd.notna(rolling_std[d]) else None,
        }
        for d, v in daily.items()
    ]
    diff_points = [{"date": d.strftime("%Y-%m-%d"), "diff_kwh": _f(v)} for d, v in diff.items()]

    original = adf_summary(daily) if len(daily) > 20 else None
    differenced = adf_summary(diff) if len(diff) > 20 else None
    return {
        "series": points,
        "differenced": diff_points,
        "adf_original": original,
        "adf_differenced": differenced,
        "summary": {
            "observations": int(len(daily)),
            "mean_kwh": _f(daily.mean()),
            "std_kwh": _f(daily.std()),
            "zero_days": int((daily == 0).sum()),
            "diff_mean_kwh": _f(diff.mean()) if len(diff) else None,
            "diff_std_kwh": _f(diff.std()) if len(diff) else None,
        },
    }


def edge_day_warnings(daily: pd.Series, threshold: float = 0.25) -> list[dict[str, Any]]:
    """Flag first/last days whose demand is far below the surrounding level.

    Data extracts often cut off part-way through the final day. The notebook methodology keeps
    every day in the series, so these days are reported to the user rather than removed.
    """
    out: list[dict[str, Any]] = []
    if len(daily) < 30:
        return out
    for label, day, ref in (
        ("last", daily.index[-1], daily.iloc[-29:-1]),
        ("first", daily.index[0], daily.iloc[1:29]),
    ):
        median = float(ref.median())
        value = float(daily[day])
        if median > 0 and value < threshold * median:
            out.append(
                {
                    "type": f"possibly_incomplete_{label}_day",
                    "date": day.strftime("%Y-%m-%d"),
                    "energy_kwh": round(value, 3),
                    "reference_median_kwh": round(median, 3),
                    "message": (
                        f"The {label} day in the data ({day:%Y-%m-%d}) has {value:,.0f} kWh, "
                        f"{value / median:.0%} of the 4-week median ({median:,.0f} kWh). It may be a partial day. "
                        "It is kept in the series, as in the original notebook, and can pull short-horizon "
                        "forecasts down."
                    ),
                }
            )
    return out
