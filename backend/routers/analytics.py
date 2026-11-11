"""Descriptive analytics: daily / monthly / weekly trends, stations, stationarity."""
from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from services import analysis, data_service
from services.preprocessing import LOCATION_COL, STATION_COL

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _check_range(start: date | None, end: date | None) -> None:
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="Start date must be on or before end date.")


@router.get("/daily")
def daily(start: date | None = None, end: date | None = None, db: Session = Depends(get_db)):
    _check_range(start, end)
    data = data_service.load_active(db)
    d = analysis.slice_series(data.daily, start, end)
    s = data.daily_sessions.reindex(d.index, fill_value=0)
    return {"points": analysis.daily_points(d, s), "unit": "kWh"}


@router.get("/monthly")
def monthly(start: date | None = None, end: date | None = None, db: Session = Depends(get_db)):
    _check_range(start, end)
    data = data_service.load_active(db)
    d = analysis.slice_series(data.daily, start, end)
    s = data.daily_sessions.reindex(d.index, fill_value=0)
    return {"points": analysis.monthly_points(d, s), "unit": "kWh"}


@router.get("/weekly")
def weekly(start: date | None = None, end: date | None = None, db: Session = Depends(get_db)):
    _check_range(start, end)
    data = data_service.load_active(db)
    d = analysis.slice_series(data.daily, start, end)
    return {"points": analysis.weekly_points(d), "unit": "kWh (average per day)"}


@router.get("/stations")
def stations(
    search: str | None = Query(None, max_length=100),
    location: str | None = Query(None, max_length=200),
    start: date | None = None,
    end: date | None = None,
    sort: Literal["energy", "sessions", "avg", "name"] = "energy",
    limit: int = Query(15, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    _check_range(start, end)
    data = data_service.load_active(db)
    df = analysis.filter_frame(data.df, start, end)
    table = analysis.station_table(df)
    table["rank"] = range(1, len(table) + 1)  # rank by energy over the selected period

    locations = sorted({str(x) for x in table["location"].dropna().unique()}) if len(table) else []
    if search:
        s = search.strip().lower()
        table = table[
            table["station"].str.lower().str.contains(s, regex=False)
            | table["location"].fillna("").str.lower().str.contains(s, regex=False)
        ]
    if location:
        table = table[table["location"] == location]

    sort_col = {"energy": "energy_kwh", "sessions": "sessions", "avg": "avg_kwh_per_session", "name": "station"}[sort]
    table = table.sort_values(sort_col, ascending=(sort == "name"))
    total = len(table)
    page = table.iloc[offset : offset + limit]
    return {
        "total": total,
        "total_stations": int(df[STATION_COL].nunique()) if len(df) else 0,
        "total_energy_kwh": float(df["Energy Provided (kWh)"].sum()) if len(df) else 0.0,
        "locations": locations,
        "items": analysis.station_records(page),
    }


@router.get("/station-detail")
def station_detail(
    name: str = Query(..., min_length=1, max_length=200),
    start: date | None = None,
    end: date | None = None,
    db: Session = Depends(get_db),
):
    _check_range(start, end)
    data = data_service.load_active(db)
    df = analysis.filter_frame(data.df, start, end)
    table = analysis.station_table(df)
    table["rank"] = range(1, len(table) + 1)
    row = table[table["station"] == name]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Station '{name}' has no sessions in the selected period.")
    history = analysis.station_history(df, name)
    loc_df = df[df[STATION_COL] == name]
    return {
        "station": analysis.station_records(row)[0],
        "location_name": loc_df[LOCATION_COL].mode().iloc[0] if LOCATION_COL in loc_df and loc_df[LOCATION_COL].notna().any() else None,
        "stations_ranked": int(len(table)),
        **history,
        "note": (
            "Historical demand only. VoltIQ's forecasting pipeline models aggregate daily demand across all "
            "stations; station-level forecasts are not produced."
        ),
    }


@router.get("/timeseries")
def timeseries(db: Session = Depends(get_db)):
    """Rolling statistics, ADF tests and first differencing on the full daily series (Cells 7, 10, 11)."""
    data = data_service.load_active(db)
    return data.timeseries()
