import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BatteryCharging, Cpu, Gauge, MapPin, PlugZap, Sigma, TrendingUp, Trophy } from "lucide-react";
import { DateRangePicker } from "../components/DateRangePicker";
import { DailyDemandChart, ForecastChart, MonthlyChart, StationBarChart, WeeklyChart } from "../components/charts/Charts";
import {
  Callout,
  Card,
  ChartSkeleton,
  EmptyState,
  ErrorState,
  KpiCard,
  NoDatasetState,
  PageHeader,
  Skeleton,
} from "../components/ui";
import { useApi } from "../hooks/useApi";
import { useDataset } from "../hooks/useDataset";
import { api } from "../services/api";
import type { DateRange } from "../types/api";
import { fmtDate, fmtDateTime, fmtEnergyCompact, fmtInt, fmtKwh, fmtNum } from "../utils/format";

export default function Overview() {
  const { hasDataset, loading: dsLoading, version, summary } = useDataset();
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const key = [range.start, range.end, version];

  const overview = useApi(() => api.overview(range), key, hasDataset);
  const daily = useApi(() => api.daily(range), key, hasDataset);
  const monthly = useApi(() => api.monthly(range), key, hasDataset);
  const weekly = useApi(() => api.weekly(range), key, hasDataset);
  const stations = useApi(() => api.stations({ ...range, limit: 10 }), key, hasDataset);
  const forecast = useApi(() => api.latestForecast(), [version], hasDataset);

  if (!dsLoading && !hasDataset) {
    return (
      <>
        <PageHeader title="Overview" description="Aggregate EV charging energy demand, model status and forecasts." />
        <NoDatasetState />
      </>
    );
  }

  const o = overview.data;
  const k = o?.kpis;
  const energy = fmtEnergyCompact(k?.total_energy_kwh);
  const ds = o?.dataset;
  const evalRunning = summary?.evaluation.status === "running";

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          ds ? (
            <>
              {fmtInt(ds.records)} cleaned charging sessions from <span className="text-ink">{ds.filename}</span> ·{" "}
              {fmtDate(ds.date_min)} – {fmtDate(ds.date_max)}
              {o?.last_updated && <> · Last updated {fmtDateTime(o.last_updated)}</>}
            </>
          ) : (
            "Aggregate EV charging energy demand, model status and forecasts."
          )
        }
        actions={<DateRangePicker value={range} onChange={setRange} min={ds?.date_min} max={ds?.date_max} />}
      />

      {overview.error && !overview.loading && (
        <div className="mb-6">
          <Callout tone="bad" title="Overview unavailable">{overview.error}</Callout>
        </div>
      )}

      {o?.data_warnings?.map((w) => (
        <div key={w.type} className="mb-4">
          <Callout tone="warn" title="Data quality notice">{w.message}</Callout>
        </div>
      ))}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label="Total energy" icon={BatteryCharging} loading={overview.loading} value={energy.value} unit={energy.unit} hint={k ? fmtKwh(k.total_energy_kwh) : undefined} />
        <KpiCard label="Charging sessions" icon={PlugZap} loading={overview.loading} value={fmtInt(k?.total_sessions)} hint="PAID + ROAMING" />
        <KpiCard label="Charging stations" icon={MapPin} loading={overview.loading} value={fmtInt(k?.station_count)} hint="with sessions in range" />
        <KpiCard
          label="Avg daily demand"
          icon={Sigma}
          loading={overview.loading}
          value={fmtNum(k?.avg_daily_kwh, 0)}
          unit="kWh"
          hint={o?.range ? `over ${fmtInt(o.range.days)} days` : undefined}
        />
        <KpiCard
          label="Best model"
          icon={Trophy}
          accent
          loading={overview.loading}
          value={o?.best_model ? <span className="text-lg">{o.best_model.model_name}</span> : evalRunning ? <span className="text-base text-ink-2">Evaluating…</span> : "—"}
          hint={o?.best_model ? "selected by validation RMSE" : evalRunning ? `${summary?.evaluation.progress}/${summary?.evaluation.total_steps} steps` : "no evaluation yet"}
        />
        <KpiCard
          label="Model RMSE"
          icon={Gauge}
          accent
          loading={overview.loading}
          value={fmtNum(o?.best_model?.validation_rmse, 1)}
          unit={o?.best_model ? "kWh" : undefined}
          hint={o?.best_model?.test_rmse != null ? `validation · test ${fmtNum(o.best_model.test_rmse, 1)}` : "validation"}
        />
      </div>

      {/* Daily */}
      <Card
        className="mt-6"
        title="Daily energy consumption"
        subtitle="Total kWh delivered per calendar day. Days without sessions count as zero demand."
      >
        {daily.loading ? (
          <ChartSkeleton height={300} />
        ) : daily.error ? (
          <ErrorState message={daily.error} onRetry={daily.reload} compact />
        ) : daily.data?.points.length ? (
          <DailyDemandChart points={daily.data.points} />
        ) : (
          <EmptyState compact title="No days in this range" />
        )}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Monthly energy consumption" subtitle="Calendar-month totals (kWh).">
          {monthly.loading ? (
            <ChartSkeleton />
          ) : monthly.error ? (
            <ErrorState message={monthly.error} onRetry={monthly.reload} compact />
          ) : monthly.data?.points.length ? (
            <MonthlyChart points={monthly.data.points} />
          ) : (
            <EmptyState compact title="No months in this range" />
          )}
        </Card>
        <Card title="Weekly demand distribution" subtitle="Average daily energy by weekday. Highest day highlighted.">
          {weekly.loading ? (
            <ChartSkeleton />
          ) : weekly.error ? (
            <ErrorState message={weekly.error} onRetry={weekly.reload} compact />
          ) : weekly.data?.points.some((p) => p.days > 0) ? (
            <WeeklyChart points={weekly.data.points} />
          ) : (
            <EmptyState compact title="No data in this range" />
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card
          className="xl:col-span-2"
          title="Top 10 charging stations"
          subtitle="By total energy in the selected range."
          actions={
            <Link to="/stations" className="flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
              All stations <ArrowRight className="size-3.5" />
            </Link>
          }
        >
          {stations.loading ? (
            <div className="space-y-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : stations.error ? (
            <ErrorState message={stations.error} onRetry={stations.reload} compact />
          ) : stations.data?.items.length ? (
            <StationBarChart items={stations.data.items} />
          ) : (
            <EmptyState compact title="No stations in this range" />
          )}
        </Card>

        <Card
          className="xl:col-span-3"
          title="Historical vs predicted demand"
          subtitle={
            forecast.data
              ? `Latest forecast run #${forecast.data.run.id} · ${forecast.data.run.horizon} days · ${forecast.data.run.model_name}${
                  forecast.data.run.requested_model === "auto" ? " (validation-selected)" : ""
                }`
              : "Most recent forecast against the last 90 days of observed demand."
          }
          actions={
            <Link to="/forecasting" className="flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
              Forecasting <ArrowRight className="size-3.5" />
            </Link>
          }
        >
          {forecast.loading ? (
            <ChartSkeleton height={320} />
          ) : forecast.error ? (
            <ErrorState message={forecast.error} onRetry={forecast.reload} compact />
          ) : forecast.data ? (
            <ForecastChart history={forecast.data.history} predictions={forecast.data.predictions} modelName={forecast.data.run.model_name} />
          ) : (
            <EmptyState
              compact
              icon={evalRunning ? Cpu : TrendingUp}
              title={evalRunning ? "Models are being evaluated" : "No forecast yet"}
              description={
                evalRunning
                  ? "A 30-day forecast with the validation-selected model is generated automatically when evaluation finishes."
                  : "Run a forecast on the Demand Forecasting page."
              }
              action={
                !evalRunning && (
                  <Link to="/forecasting" className="inline-flex h-8 items-center gap-2 rounded-lg bg-accent px-3 text-xs font-medium text-white">
                    Open forecasting
                  </Link>
                )
              }
            />
          )}
        </Card>
      </div>
    </>
  );
}
