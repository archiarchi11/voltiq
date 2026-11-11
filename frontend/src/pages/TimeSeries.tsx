import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { MonthlyChart, WeeklyChart } from "../components/charts/Charts";
import { C, Legend, axisProps, gridProps, makeTooltip, yAxisKwh } from "../components/charts/theme";
import { Badge, Card, ChartSkeleton, ErrorState, NoDatasetState, PageHeader, Stat, cx } from "../components/ui";
import { useApi } from "../hooks/useApi";
import { useDataset } from "../hooks/useDataset";
import { api } from "../services/api";
import type { AdfResult } from "../types/api";
import { fmtDate, fmtKwh, fmtNum, fmtPValue } from "../utils/format";

const dateTick = (d: string) => fmtDate(d, { month: "short", year: "2-digit" });
const tipTitle = (l: string | number) => fmtDate(String(l), { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default function TimeSeries() {
  const { hasDataset, loading: dsLoading, version } = useDataset();
  const ts = useApi(() => api.timeseries(), [version], hasDataset);
  const monthly = useApi(() => api.monthly(), [version], hasDataset);
  const weekly = useApi(() => api.weekly(), [version], hasDataset);

  if (!dsLoading && !hasDataset) {
    return (
      <>
        <PageHeader title="Time-Series Analysis" description="Trend, variability and stationarity of daily demand." />
        <NoDatasetState />
      </>
    );
  }

  const d = ts.data;
  const TrendTip = makeTooltip({ title: tipTitle, format: (v) => fmtKwh(v, 1), names: { energy_kwh: "Daily demand", rolling_mean_30: "30-day moving average" } });
  const StdTip = makeTooltip({ title: tipTitle, format: (v) => fmtKwh(v, 1), names: { rolling_std_30: "30-day rolling std" } });
  const DiffTip = makeTooltip({ title: tipTitle, format: (v) => `${v > 0 ? "+" : ""}${fmtKwh(v, 1)}`, names: { diff_kwh: "Day-over-day change" } });

  return (
    <>
      <PageHeader
        title="Time-Series Analysis"
        description="Trend, variability and stationarity diagnostics on the full daily demand series. These checks inform the ARIMA-family model orders (d = 0 vs d = 1)."
      />

      {ts.error && !ts.loading ? (
        <div className="card"><ErrorState message={ts.error} onRetry={ts.reload} /></div>
      ) : (
        <>
          {/* ADF results */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <AdfCard title="ADF test · original series" result={d?.adf_original ?? null} loading={ts.loading} />
            <AdfCard title="ADF test · first-differenced series" result={d?.adf_differenced ?? null} loading={ts.loading} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 text-sm leading-relaxed text-ink-2 md:grid-cols-2">
            <div className="card p-5">
              <p className="mb-1 font-medium text-ink">What stationarity means</p>
              A stationary series has a constant mean and variance over time, so the past is a reliable guide to the future.
              The Augmented Dickey-Fuller test assumes a unit root (non-stationarity). A p-value below 0.05 rejects that
              assumption. Rising trends or shifts in level, visible in the moving average below, usually cause non-stationarity.
            </div>
            <div className="card p-5">
              <p className="mb-1 font-medium text-ink">Why difference the series</p>
              First differencing replaces each day&apos;s demand with its change from the previous day
              (<span className="font-mono text-xs">yₜ − yₜ₋₁</span>). This removes a changing level and often makes the series stationary.
              ARIMA models with <span className="font-mono text-xs">d = 1</span> apply this internally. AR, MA and ARMA models use the undifferenced series.
            </div>
          </div>

          {/* Trend */}
          <Card className="mt-6" title="Daily demand with 30-day moving average" subtitle={d ? `${d.summary.observations.toLocaleString()} daily observations · mean ${fmtKwh(d.summary.mean_kwh)} · std ${fmtKwh(d.summary.std_kwh)}` : undefined}>
            {ts.loading || !d ? (
              <ChartSkeleton height={320} />
            ) : (
              <>
                <div className="mb-3">
                  <Legend items={[{ label: "Daily demand", color: C.history }, { label: "30-day moving average", color: C.rolling }]} />
                </div>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={d.series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...axisProps} tickFormatter={dateTick} minTickGap={48} />
                      <YAxis {...yAxisKwh} label={{ value: "kWh / day", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 6, dy: 30 }} />
                      <Tooltip content={<TrendTip />} cursor={{ stroke: C.cursor }} />
                      <Line dataKey="energy_kwh" stroke={C.history} strokeOpacity={0.55} strokeWidth={1} dot={false} isAnimationActive={false} />
                      <Line dataKey="rolling_mean_30" stroke={C.rolling} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Card>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="30-day rolling standard deviation" subtitle="Variability of daily demand over a trailing 30-day window.">
              {ts.loading || !d ? (
                <ChartSkeleton height={260} />
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={d.series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                      <defs>
                        <linearGradient id="stdFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#9085e9" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#9085e9" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...axisProps} tickFormatter={dateTick} minTickGap={48} />
                      <YAxis {...yAxisKwh} label={{ value: "kWh", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 6 }} />
                      <Tooltip content={<StdTip />} cursor={{ stroke: C.cursor }} />
                      <Area dataKey="rolling_std_30" stroke="#9085e9" strokeWidth={1.75} fill="url(#stdFill)" dot={false} isAnimationActive={false} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card
              title="First-differenced demand"
              subtitle={d?.summary.diff_std_kwh != null ? `Day-over-day change · mean ${fmtNum(d.summary.diff_mean_kwh, 2)} kWh · std ${fmtNum(d.summary.diff_std_kwh, 1)} kWh` : "Day-over-day change in demand."}
            >
              {ts.loading || !d ? (
                <ChartSkeleton height={260} />
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={d.differenced} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...axisProps} tickFormatter={dateTick} minTickGap={48} />
                      <YAxis {...yAxisKwh} label={{ value: "Δ kWh", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 6 }} />
                      <ReferenceLine y={0} stroke={C.cursor} />
                      <Tooltip content={<DiffTip />} cursor={{ stroke: C.cursor }} />
                      <Line dataKey="diff_kwh" stroke={C.forecast} strokeWidth={1} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Monthly trend" subtitle="Total kWh per calendar month.">
              {monthly.loading ? <ChartSkeleton /> : monthly.error ? <ErrorState compact message={monthly.error} onRetry={monthly.reload} /> : <MonthlyChart points={monthly.data?.points ?? []} />}
            </Card>
            <Card title="Weekly trend" subtitle="Average daily kWh by weekday across the full history.">
              {weekly.loading ? <ChartSkeleton /> : weekly.error ? <ErrorState compact message={weekly.error} onRetry={weekly.reload} /> : <WeeklyChart points={weekly.data?.points ?? []} />}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function AdfCard({ title, result, loading }: { title: string; result: AdfResult | null; loading: boolean }) {
  return (
    <div className={cx("card p-5", result?.stationary ? "border-good/25" : result ? "border-warn/25" : "")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {result &&
          (result.stationary ? (
            <Badge tone="good"><CircleCheck className="size-3" /> Stationary</Badge>
          ) : (
            <Badge tone="warn"><TriangleAlert className="size-3" /> Non-stationary</Badge>
          ))}
      </div>
      {loading || !result ? (
        <div className="mt-4 grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Stat label="ADF statistic" value={fmtNum(result.statistic, 4)} />
            <Stat label="p-value" value={<span className={result.stationary ? "text-good" : "text-warn"}>{fmtPValue(result.p_value)}</span>} sub="threshold 0.05" />
            <Stat label="Lags · obs" value={`${result.used_lag} · ${result.n_obs.toLocaleString()}`} />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
            <span>Critical values:</span>
            {Object.entries(result.critical_values).map(([k, v]) => (
              <span key={k} className="tabular">{k} <span className="text-ink-2">{fmtNum(v, 3)}</span></span>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-2">{result.interpretation}</p>
        </>
      )}
    </div>
  );
}
