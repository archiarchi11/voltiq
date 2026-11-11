import { useEffect, useMemo, useState } from "react";
import { Download, History, LoaderCircle, Play, Sparkles, TrendingUp } from "lucide-react";
import { ForecastChart } from "../components/charts/Charts";
import {
  Badge,
  Button,
  Callout,
  Card,
  ChartSkeleton,
  EmptyState,
  ErrorState,
  KpiCard,
  NoDatasetState,
  PageHeader,
  Segmented,
  cx,
} from "../components/ui";
import { useToast } from "../components/Toast";
import { useApi } from "../hooks/useApi";
import { useDataset } from "../hooks/useDataset";
import { api, downloadFile, errorMessage } from "../services/api";
import type { ForecastResponse, Horizon, ModelChoice, ModelInfo } from "../types/api";
import { fmtDate, fmtDateTime, fmtEnergyCompact, fmtKwh, fmtNum, fmtPct, isNum } from "../utils/format";

const FAMILY_ORDER = ["Naive", "Seasonal Naive", "ARIMA", "SARIMA", "Exponential Smoothing", "Random Forest"];

export default function Forecasting() {
  const { hasDataset, loading: dsLoading, version, summary } = useDataset();
  const toast = useToast();
  const [model, setModel] = useState<ModelChoice>("auto");
  const [horizon, setHorizon] = useState<Horizon>(30);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ForecastResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState<number | null>(null);

  const catalog = useApi(() => api.catalog(), []);
  const comparison = useApi(() => api.comparison(), [version], hasDataset);
  const latest = useApi(() => api.latestForecast(), [version], hasDataset);
  const history = useApi(() => api.forecastHistory(25), [version, result?.run.id], hasDataset);

  // Show the most recent stored run whenever it is (re)fetched, e.g. after the dataset changes.
  useEffect(() => {
    if (latest.data) setResult(latest.data);
  }, [latest.data]);

  const valScores = useMemo(() => {
    const m: Record<string, number | null> = {};
    comparison.data?.results?.forEach((r) => (m[r.model_key] = r.validation_rmse));
    return m;
  }, [comparison.data]);

  const ev = summary?.evaluation;
  const bestKey = ev?.status === "completed" ? ev.best_model_key : comparison.data?.selected_model?.key;
  const bestName = ev?.best_model_name ?? comparison.data?.selected_model?.name;
  const autoAvailable = !!bestKey && ev?.status !== "running";

  const grouped = useMemo(() => {
    const g: Record<string, ModelInfo[]> = {};
    catalog.data?.models.forEach((m) => (g[m.family] ??= []).push(m));
    return FAMILY_ORDER.filter((f) => g[f]).map((f) => ({ family: f, models: g[f] }));
  }, [catalog.data]);

  const selectedInfo = model === "auto" ? catalog.data?.models.find((m) => m.key === bestKey) : catalog.data?.models.find((m) => m.key === model);

  const run = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await api.runForecast(model, horizon);
      setResult(res);
      toast.success(
        "Forecast complete",
        `${res.run.model_name} · ${res.run.horizon} days · ${fmtKwh(res.run.total_kwh)} total`,
      );
    } catch (err) {
      const msg = errorMessage(err);
      setRunError(msg);
      toast.error("Forecast failed", msg);
    } finally {
      setRunning(false);
    }
  };

  const openRun = async (id: number) => {
    setLoadingRun(id);
    try {
      setResult(await api.forecast(id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error("Could not load forecast run", errorMessage(err));
    } finally {
      setLoadingRun(null);
    }
  };

  const exportRun = async (id: number) => {
    try {
      await downloadFile(api.forecastExportUrl(id), `forecast_run${id}.csv`);
      toast.success("CSV exported", `Forecast run #${id}`);
    } catch (err) {
      toast.error("Export failed", errorMessage(err));
    }
  };

  if (!dsLoading && !hasDataset) {
    return (
      <>
        <PageHeader title="Demand Forecasting" description="Forecast aggregate daily EV charging energy demand." />
        <NoDatasetState />
      </>
    );
  }

  const r = result?.run;
  const total = fmtEnergyCompact(r?.total_kwh);
  const pct = r?.pct_change;

  return (
    <>
      <PageHeader
        title="Demand Forecasting"
        description="Forecast total daily charging energy (kWh) across all stations. Every model is refitted on the complete history before forecasting; predictions are clipped at zero."
      />

      {/* Controls */}
      <div className="card p-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_auto_auto] lg:items-end">
          <div className="min-w-0">
            <label htmlFor="model" className="mb-1.5 block text-xs font-medium text-ink-2">Forecasting model</label>
            <select id="model" className="input w-full" value={model} onChange={(e) => setModel(e.target.value as ModelChoice)} disabled={catalog.loading}>
              <option value="auto" disabled={!autoAvailable}>
                Automatic — best validation RMSE{bestName && autoAvailable ? ` (${bestName})` : ev?.status === "running" ? " (evaluating…)" : " (unavailable)"}
              </option>
              {grouped.map((g) => (
                <optgroup key={g.family} label={g.family}>
                  {g.models.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                      {isNum(valScores[m.key]) ? ` · val RMSE ${fmtNum(valScores[m.key], 0)}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-2">Horizon</p>
            <Segmented<Horizon>
              ariaLabel="Forecast horizon"
              value={horizon}
              onChange={setHorizon}
              options={[{ value: 7, label: "7 days" }, { value: 14, label: "14 days" }, { value: 30, label: "30 days" }]}
            />
          </div>
          <Button variant="primary" icon={Play} loading={running} onClick={run} disabled={model === "auto" && !autoAvailable} className="h-10 px-6">
            {running ? "Running…" : "Run forecast"}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/70 pt-4 text-xs text-ink-3">
          {model === "auto" ? (
            autoAvailable ? (
              <>
                <Sparkles className="size-3.5 text-cyan" />
                <span>
                  Automatic selection uses <span className="text-ink">{bestName}</span>, the lowest validation RMSE
                  {isNum(valScores[bestKey ?? ""]) && <> ({fmtKwh(valScores[bestKey ?? ""], 1)})</>} on the 70/10 chronological split.
                </span>
              </>
            ) : ev?.status === "running" ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin text-accent" />
                Model evaluation is running ({ev.progress}/{ev.total_steps}). Choose a specific model, or wait for automatic selection.
              </>
            ) : (
              <>No completed evaluation. Run it on the Model Performance page, or choose a specific model.</>
            )
          ) : (
            <>
              <Badge tone="neutral">{selectedInfo?.family}</Badge>
              <span>{selectedInfo?.description}</span>
              {isNum(valScores[model]) && <span>· Validation RMSE {fmtKwh(valScores[model], 1)}</span>}
            </>
          )}
        </div>
      </div>

      {runError && (
        <div className="mt-4">
          <Callout tone="bad" title="Forecast could not be generated">{runError}</Callout>
        </div>
      )}

      {result?.warnings.map((w) => (
        <div key={w.type} className="mt-4">
          <Callout tone="warn" title="Data quality notice">{w.message}</Callout>
        </div>
      ))}

      {/* KPIs */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={`Total predicted · ${r?.horizon ?? horizon} days`} loading={latest.loading && !result} value={total.value} unit={total.unit} hint={r ? fmtKwh(r.total_kwh) : "run a forecast"} accent />
        <KpiCard label="Avg predicted daily demand" loading={latest.loading && !result} value={fmtNum(r?.average_kwh, 0)} unit={r ? "kWh" : undefined} hint={r ? `${fmtDate(result!.predictions[0]?.date)} – ${fmtDate(result!.predictions.at(-1)?.date)}` : undefined} />
        <KpiCard
          label="vs previous period"
          loading={latest.loading && !result}
          value={fmtPct(pct, 1, true)}
          hint={r?.previous_period_kwh != null ? `prior ${r.horizon} days: ${fmtKwh(r.previous_period_kwh)}` : undefined}
        />
        <KpiCard
          label="Model"
          loading={latest.loading && !result}
          value={<span className="text-lg">{r?.model_name ?? "—"}</span>}
          hint={
            r ? (
              <>
                {r.requested_model === "auto" ? "auto-selected · " : ""}
                {isNum(r.validation_rmse) ? `val RMSE ${fmtNum(r.validation_rmse, 1)} kWh` : "not evaluated"}
              </>
            ) : undefined
          }
        />
      </div>

      {/* Chart */}
      <Card
        className="mt-6"
        title="Historical vs predicted daily demand"
        subtitle={
          r
            ? `Run #${r.id} · trained on ${r.n_observations.toLocaleString()} days (${fmtDate(r.history_start)} – ${fmtDate(r.history_end)}) · ${fmtDateTime(r.created_at)}`
            : undefined
        }
        actions={r && <Button size="sm" icon={Download} onClick={() => exportRun(r.id)}>Export CSV</Button>}
      >
        {running ? (
          <div className="relative">
            <ChartSkeleton height={340} />
            <div className="absolute inset-0 grid place-items-center">
              <span className="flex items-center gap-2 rounded-lg border border-line-2 bg-surface-2 px-3 py-2 text-sm text-ink-2">
                <LoaderCircle className="size-4 animate-spin text-accent" /> Fitting model on full history…
              </span>
            </div>
          </div>
        ) : latest.loading && !result ? (
          <ChartSkeleton height={340} />
        ) : latest.error && !result ? (
          <ErrorState message={latest.error} onRetry={latest.reload} compact />
        ) : result ? (
          <ForecastChart history={result.history} predictions={result.predictions} modelName={result.run.model_name} height={340} />
        ) : (
          <EmptyState icon={TrendingUp} title="No forecast yet" description="Choose a model and horizon, then run a forecast." />
        )}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* Forecast table */}
        <Card className="xl:col-span-2" title="Forecast table" subtitle={r ? `${r.horizon} daily predictions · ${r.model_name}` : undefined} bodyClassName="p-0">
          {result ? (
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-xs text-ink-3">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-medium">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium">Day</th>
                    <th className="px-5 py-2.5 text-right font-medium">Predicted energy</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {result.predictions.map((p) => (
                    <tr key={p.date} className="border-t border-line/60 hover:bg-surface-2/50">
                      <td className="px-5 py-2 text-ink">{fmtDate(p.date)}</td>
                      <td className="px-3 py-2 text-ink-3">{fmtDate(p.date, { weekday: "short" })}</td>
                      <td className="px-5 py-2 text-right text-ink">{fmtKwh(p.predicted_kwh, 1)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="tabular sticky bottom-0 bg-surface-2 text-sm">
                  <tr className="border-t border-line-2">
                    <td className="px-5 py-2.5 font-medium text-ink" colSpan={2}>Total</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-cyan">{fmtKwh(r!.total_kwh, 1)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyState compact title="No predictions" description="Run a forecast to populate this table." />
          )}
        </Card>

        {/* History */}
        <Card className="xl:col-span-3" title="Forecast history" subtitle="Previous runs for the active dataset. Select a run to view it." bodyClassName="p-0">
          {history.loading && !history.data ? (
            <div className="p-5"><ChartSkeleton height={200} /></div>
          ) : history.error ? (
            <ErrorState message={history.error} onRetry={history.reload} compact />
          ) : history.data?.runs.length ? (
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="sticky top-0 bg-surface-2 text-xs text-ink-3">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-medium">Run</th>
                    <th className="px-3 py-2.5 text-left font-medium">Model</th>
                    <th className="px-3 py-2.5 text-right font-medium">Days</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total</th>
                    <th className="px-3 py-2.5 text-right font-medium">Change</th>
                    <th className="px-5 py-2.5 text-right font-medium" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="tabular">
                  {history.data.runs.map((h) => (
                    <tr
                      key={h.id}
                      className={cx("cursor-pointer border-t border-line/60 hover:bg-surface-2/50", h.id === r?.id && "bg-accent/[0.07]")}
                      onClick={() => openRun(h.id)}
                    >
                      <td className="px-5 py-2">
                        <p className="text-ink">#{h.id}</p>
                        <p className="text-xs text-ink-3">{fmtDateTime(h.created_at)}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-ink">{h.model_name}</p>
                        <p className="text-xs text-ink-3">
                          {h.requested_model === "auto" ? "auto-selected" : "manual"}
                          {h.source === "evaluation" && " · after evaluation"}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right text-ink-2">{h.horizon}</td>
                      <td className="px-3 py-2 text-right text-ink">{fmtKwh(h.total_kwh)}</td>
                      <td className="px-3 py-2 text-right text-ink-2">{fmtPct(h.pct_change, 1, true)}</td>
                      <td className="px-5 py-2 text-right">
                        <span className="inline-flex items-center gap-1">
                          {loadingRun === h.id && <LoaderCircle className="size-3.5 animate-spin text-accent" />}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void exportRun(h.id);
                            }}
                            className="rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink"
                            aria-label={`Export run ${h.id} as CSV`}
                            title="Export CSV"
                          >
                            <Download className="size-3.5" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState compact icon={History} title="No forecast runs yet" />
          )}
        </Card>
      </div>
    </>
  );
}
