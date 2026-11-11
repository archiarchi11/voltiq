# VoltIQ – EV Energy Intelligence Platform

**Predict. Analyse. Optimise.**

VoltIQ is a full-stack web application that wraps the EV charging-demand forecasting pipeline from
`EV_updated.ipynb` in a FastAPI backend and a React dashboard. It forecasts **total daily energy demand (kWh)**
across all charging stations from session-level charging data.

Every number in the UI comes from the backend: the uploaded dataset, the cleaning rules, the fitted models and
the stored forecast runs. Nothing is hard-coded or simulated.

---

## Run the website

Prerequisites: **Python 3.11+** and **Node.js 20.19+**.

```bash
cd ~/Desktop/project/VoltIQ
./start.sh
```

Then open **http://localhost:8000**. On first run, `start.sh` creates the Python environment and installs the
frontend packages. Every time, it builds the React app and serves the dashboard, the REST API (`/api/...`) and the
API docs (`/docs`) from one FastAPI server. Page links such as `/forecasting` work directly and survive a refresh.

| Option | Effect |
|---|---|
| `PORT=8080 ./start.sh` | Use another port |
| `HOST=0.0.0.0 ./start.sh` | Reachable from other devices on your network at `http://<your-computer-ip>:8000` |
| `SKIP_BUILD=1 ./start.sh` | Reuse the existing build (faster restart) |

### Putting it online (free, Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/archiarchi11/voltiq)

`render.yaml` describes a free Render web service built from the `Dockerfile`. The image builds the React app
and runs the single FastAPI server. Because free instances have no persistent disk, the bundled dataset
(`seed/ev_charging.csv.gz`) is loaded and evaluated automatically whenever the database is empty, so the site
is never blank after a restart.

Free-plan behaviour: the service sleeps after 15 minutes without traffic, so the first request afterwards takes
1–2 minutes. Model evaluation then runs for a few minutes on the shared CPU (the dashboard shows progress), and
uploads made on the live site are lost when it restarts.

Every push to `main` redeploys automatically.

Other hosts: any Docker host works:

```bash
docker build -t voltiq .
docker run -p 8000:8000 -v voltiq-data:/data voltiq
```

`deploy/huggingface.sh <user>/<space>` publishes to a Hugging Face Docker Space, which requires a PRO plan.

## Development mode (hot reload)

Run the backend and the Vite dev server separately:

### 1. Backend (FastAPI, port 8000)

```bash
cd ~/Desktop/project/VoltIQ/backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

API docs: http://127.0.0.1:8000/docs · Health check: http://127.0.0.1:8000/api/health

### 2. Frontend (React + Vite, port 5173)

```bash
cd ~/Desktop/project/VoltIQ/frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend, so no CORS setup is needed.

### 3. Load data

1. Go to **Dataset Management** and upload the charging CSV
   (e.g. `Electric_Vehicle_(EV)_Charging_Data_-_Municipal_Lots_and_Garages_20261104.csv`).
2. Check the validation results and the 10-row preview, then click **Run preprocessing**.
3. The cleaned dataset becomes active, and model evaluation starts in the background (≈10–15 s for the full dataset).
   When it finishes, a 30-day forecast with the validation-selected model is generated automatically.

In development mode, use the app at http://localhost:5173. `npm run build` writes `frontend/dist`, which the backend serves as the website.

---

## What the application does

| Page | Contents |
|---|---|
| **Overview** | KPIs (total kWh, sessions, stations, average daily demand, validation-selected model and its RMSE), daily, monthly and weekday charts, top-10 stations, latest historical-vs-forecast chart, date-range selector, dataset status and last-updated time |
| **Demand Forecasting** | Choose a model (or *Automatic*, which uses the lowest validation RMSE) and a 7/14/30-day horizon, then run. Shows the forecast chart (observed vs. dashed forecast in a shaded window), a daily forecast table, total and average predicted kWh, % change vs. the previous equivalent period, CSV export and the persisted forecast history |
| **Model Performance** | Validation and test metrics (MAE, MSE, RMSE, MAPE, R²) for all 12 models, with the validation-selected model highlighted. Also: baseline comparison, RMSE/MAE bar charts (test or validation), actual-vs-predicted on the test period, Random Forest feature importance, re-run evaluation and CSV export |
| **Station Analytics** | Top-15 stations, searchable/filterable/sortable station table, and per-station details (sessions, kWh/session, share, history, monthly, weekday, session-energy distribution). This page is historical only; station-level forecasts are not produced |
| **Time-Series Analysis** | Daily series with 30-day moving average, 30-day rolling std, ADF statistic/p-value/critical values for the original and differenced series, the first-differenced series, and monthly and weekly trends |
| **Dataset Management** | CSV upload (drag-and-drop), required-column validation, row/column counts, missing values, date range, session-status breakdown, 10-row preview, preprocessing with original-vs-cleaned counts and a quality summary, cleaned-CSV download, upload history and dataset re-activation |

A new upload **never replaces the active dataset** unless it passes validation *and* preprocessing completes.

---

## ML methodology (preserved from `EV_updated.ipynb`)

| Notebook | Backend implementation |
|---|---|
| Cell 4 – cleaning | `services/preprocessing.py::clean` — parse `Date` as `%m/%d/%Y`, coerce energy to numeric, drop invalid date / missing energy, keep energy ≥ 0, keep `Session Status ∈ {PAID, ROAMING}` (after strip + upper) |
| Cell 5 – daily demand | `services/analysis.py::build_daily` — sum kWh per date, `asfreq("D")`, missing days = 0 |
| Cells 7–11 – trends, ADF, differencing | `services/analysis.py` — 30-day rolling mean/std, `resample("ME")`, weekday means, `adfuller` on the original and first-differenced series |
| Cell 12 – split | `services/evaluation.py::chronological_split` — 70 / 10 / 20, chronological |
| Cells 13–14 – models | `services/forecasting.py` — the same 12 candidates with identical parameters: Naive, Seasonal naive (7), AR(1), MA(1), ARMA(1,1), ARIMA(1,1,1), ARIMA(2,1,1), ARIMA(1,1,2), SARIMA(1,0,1)(1,0,1,7), SARIMA(1,1,1)(1,1,1,7), Exponential Smoothing (additive damped trend, additive weekly seasonality), Random Forest (200 trees, `min_samples_leaf=2`, `random_state=42`) on `lag_1, lag_2, lag_3, lag_7, lag_14, mean_last_7, mean_last_30, day_of_week, month, day_of_month` with recursive multi-step forecasting |
| Cell 15 – selection | Fit on train, forecast validation, **select lowest validation RMSE** |
| Cell 16 – test | Refit on train + validation, forecast the test period; MAE, MSE, RMSE, MAPE (non-zero actual days only), R² |
| Cell 16b – baseline | RMSE improvement vs. *same day last week* |
| Cell 17b – feature importance | Random Forest fitted on train + validation |
| Cell 19 – final forecast | Validation-selected model **refitted on all history**, predictions clipped at 0 |

Test-set performance is reported for comparison only and is never used to choose a model. Fitted
full-history models are cached with `joblib` in `data/models/`, so repeated forecasts with the same model are instant.

### Results on the supplied dataset (verified)

Run against `Electric_Vehicle_(EV)_Charging_Data_-_Municipal_Lots_and_Garages_20261104.csv`:

* 258,755 raw records → **252,973** after cleaning (5,782 DISCONNECTED / INVALID / ABORTED removed)
* 1,866 daily observations (31 Jul 2021 – 8 Sep 2026), 165 stations, 5,784,085.284 kWh
* ADF on daily demand: statistic −2.1331, p = 0.2314 (non-stationary); after differencing p ≈ 7.1 × 10⁻²²
* Split: 1,306 train / 186 validation / 374 test days
* Validation-selected model: **Exponential Smoothing** (validation RMSE 596.9 kWh; test RMSE 1,177.8 kWh)
* Lowest test RMSE: Random Forest (1,094.6 kWh). This is shown for reference only and not used for selection

These match the notebook's printed outputs (cleaned shape, date range, total energy, top-15 stations, ADF values).

> **Data note:** the last day in this extract (2026-09-08) has 23 sessions / 418 kWh, about 10% of a normal day,
> so it is probably a partial day. As in the notebook it stays in the series, but VoltIQ shows a data-quality
> notice because it pulls short-horizon forecasts (especially Exponential Smoothing and Naive) down.

---

## Project structure

```
VoltIQ/
├── EV_updated.ipynb            # original notebook (unchanged)
├── start.sh                    # one command: build + serve the website on :8000
├── Dockerfile                  # single-container deployment
├── render.yaml                 # Render blueprint (free plan)
├── seed/ev_charging.csv.gz     # bundled dataset, auto-loaded when the DB is empty
├── deploy/huggingface.sh       # Hugging Face Spaces deploy (PRO)
├── .env.example
├── data/                       # runtime: uploads/, cleaned/, models/, voltiq.db
├── backend/
│   ├── main.py                 # FastAPI app, CORS, error handlers, /api/health, serves the built website
│   ├── config.py               # environment configuration
│   ├── database.py             # SQLAlchemy engine/session
│   ├── models.py               # tables: datasets, dataset_metadata, evaluation_runs,
│   │                           #         model_evaluations, forecast_runs, forecast_predictions
│   ├── schemas.py              # Pydantic request/response models
│   ├── requirements.txt
│   ├── routers/                # dataset, dashboard, analytics, models, forecasting
│   └── services/               # data_service, preprocessing, analysis, forecasting, evaluation
└── frontend/
    ├── package.json
    └── src/
        ├── components/         # UI kit, toasts, date-range picker, Recharts charts
        ├── hooks/              # useApi, DatasetProvider (polls evaluation status)
        ├── layouts/            # collapsible sidebar + top bar
        ├── pages/              # Overview, Forecasting, ModelPerformance, Stations, TimeSeries, Dataset
        ├── services/api.ts     # Axios client for every endpoint
        ├── types/api.ts
        └── utils/format.ts
```

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check (API + database) |
| POST | `/api/dataset/upload` | Upload CSV (multipart `file`); validates and profiles without activating |
| GET | `/api/dataset/summary` | Active dataset, latest upload, history, evaluation status |
| GET | `/api/dataset/preview?dataset_id=` | First 10 raw records |
| POST | `/api/dataset/preprocess` | `{dataset_id}` clean, activate, start evaluation |
| POST | `/api/dataset/{id}/activate` | Re-activate a preprocessed dataset |
| GET | `/api/dataset/download?dataset_id=` | Cleaned dataset as CSV |
| GET | `/api/dashboard/overview?start=&end=` | KPIs, best model, status |
| GET | `/api/analytics/daily` · `/monthly` · `/weekly` | Aggregate demand (`start`/`end` optional) |
| GET | `/api/analytics/stations` | Station table (`search`, `location`, `sort`, `limit`, `offset`, `start`, `end`) |
| GET | `/api/analytics/station-detail?name=` | One station's history |
| GET | `/api/analytics/timeseries` | Rolling stats, ADF tests, differenced series |
| GET | `/api/models/catalog` | Available models |
| GET | `/api/models/comparison` | Validation + test metrics, split, test-period predictions |
| GET | `/api/models/feature-importance` | Random Forest feature importance |
| POST | `/api/models/evaluate` | Re-run evaluation in the background |
| GET | `/api/models/evaluation-status` | Progress of the running evaluation |
| GET | `/api/models/comparison/export` | Model comparison CSV |
| POST | `/api/forecast/run` | `{model: "auto" \| key, horizon: 7 \| 14 \| 30}` |
| GET | `/api/forecast/latest` · `/history` · `/{id}` · `/{id}/export` | Stored forecasts and CSV export |

Model keys: `naive, snaive, ar1, ma1, arma11, arima111, arima211, arima112, sarima101, sarima111, ets, rf`.

## Configuration

Copy `.env.example` to `.env` (project root or `backend/`). All settings have defaults:
`VOLTIQ_DATA_DIR`, `VOLTIQ_DATABASE_URL`, `VOLTIQ_CORS_ORIGINS`, `VOLTIQ_MAX_UPLOAD_MB`,
`VOLTIQ_AUTO_EVALUATE`, `VOLTIQ_MIN_DAILY_OBSERVATIONS`, `VOLTIQ_SEED_CSV` (dataset auto-loaded into an empty database; `""` disables), `VOLTIQ_FRONTEND_DIST` (built web app to serve,
default `frontend/dist`). If the project folder moves, stored file paths are re-pointed to the new `data/` on startup. Frontend: `VITE_PROXY_TARGET`, `VITE_API_BASE_URL`.

## Error handling

* Invalid CSVs (missing columns, unparseable dates, no PAID/ROAMING sessions, unreadable file) are stored as
  `invalid` with the reasons, and the active dataset is untouched.
* Fewer than 60 daily observations → a clear 422 instead of a model failure. Individual model fit failures are
  recorded per model, and the remaining models still complete.
* Automatic model selection before evaluation has finished → 409 with guidance to wait or pick a model.
* Without an active dataset, every page shows an empty state that links to Dataset Management.
