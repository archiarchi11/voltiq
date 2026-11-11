import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Cpu, Download, LoaderCircle, RefreshCw, Trophy } from "lucide-react";
import { C, Legend, axisProps, gridProps, makeTooltip, yAxisKwh } from "../components/charts/theme";
import {
  Badge,
  Button,
  Callout,
  Card,
  ChartSkeleton,
  EmptyState,
  ErrorState,
  NoDatasetState,
  PageHeader,
  Segmented,
  Stat,
  cx,
} from "../components/ui";
import { useToast } from "../components/Toast";
import { useApi } from "../hooks/useApi";
import { useDataset } from "../hooks/useDataset";
import { api, downloadFile, errorMessage } from "../services/api";
import type { ModelResult } from "../types/api";
import { fmtDate, fmtDateShort, fmtDateTime, fmtKwh, fmtNum, fmtPct, isNum } from "../utils/format";

type Stage = "test" | "validation";

const barColor = (r: ModelResult) => (r.is_selected ? C.selected : r.is_baseline ? C.baseline : C.history);

export default function ModelPerformance() {
  const { hasDataset, loading: dsLoading, version, summary, refresh } = useDataset();
  const toast = useToast();
  const comparison = useApi(() => api.comparison(), [version], hasDataset);
  const importance = useApi(() => api.featureImportance(), [version], hasDataset);
  const [stage, setStage] = useState<Stage>("test");
  const [sortBy, setSortBy] = useState<Stage>("test");
  const [extraModel, setExtraModel] = useState<string>("");
  const [starting, setStarting] = useState(false);

  const ev = summary?.evaluation;
  const d = comparison.data;
  const results = useMemo(() => d?.results ?? [], [d]);

  const sorted = useMemo(() => {
    const key = sortBy === "test" ? "rmse" : "validation_rmse";
    return [...results].sort((a, b) => (a[key] ?? Infinity) - (b[key] ?? Infinity));
  }, [results, sortBy]);

  const chartRows = useMemo(() => {
    const rmseKey = stage === "test" ? "rmse" : "validation_rmse";
    return [...results]
      .filter((r) => isNum(r[rmseKey]))
      .sort((a, b) => (a[rmseKey] ?? 0) - (b[rmseKey] ?? 0))
      .map((r) => ({
        ...r,
        name: r.model_name.replace("Baseline: ", ""),
        rmse_v: stage === "test" ? r.rmse : r.validation_rmse,
        mae_v: stage === "test" ? r.mae : r.validation_mae,
      }));
  }, [results, stage]);

  const series = useMemo(() => {
    const ts = d?.test_series;
    if (!ts || !d?.selected_model) return [];
    const sel = ts.predictions[d.selected_model.key] ?? [];
    const base = ts.predictions[d.baseline?.key ?? "snaive"] ?? [];
    const extra = extraModel ? ts.predictions[extraModel] ?? [] : [];
    return ts.dates.map((date, i) => ({
      date,
      actual: ts.actual[i],
      selected: sel[i],
      baseline: base[i],
      ...(extraModel ? { extra: extra[i] } : {}),
    }));
  }, [d, extraModel]);

  const startEvaluation = async () => {
    setStarting(true);
    try {
      await api.runEvaluation();
      toast.info("Model evaluation started", "All 12 models are refitted on the validation and test splits.");
      await refresh();
    } catch (err) {
      toast.error("Could not start evaluation", errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const exportCsv = async () => {
    try {
      await downloadFile(api.comparisonExportUrl(), "EV_Model_Comparison.csv");
      toast.success("Model comparison exported");
    } catch (err) {
      toast.error("Export failed", errorMessage(err));
    }
  };

  if (!dsLoading && !hasDataset) {
    return (
      <>
        <PageHeader title="Model Performance" description="Validation-based model selection and held-out test evaluation." />
        <NoDatasetState />
      </>
    );
  }

  const selected = results.find((r) => r.is_selected);
  const baseline = results.find((r) => r.model_key === d?.baseline?.key);
  const isRunning = ev?.status === "running";

  const RmseTip = makeTooltip({ title: (l) => String(l), format: (v) => fmtKwh(v, 1), names: { rmse_v: "RMSE", mae_v: "MAE" } });
  const SeriesTip = makeTooltip({
    title: (l) => fmtDate(String(l), { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    format: (v) => fmtKwh(v, 1),
    names: {
      actual: "Actual",
      selected: selected?.model_name ?? "Selected",
      baseline: "Baseline (same day last week)",
      extra: results.find((r) => r.model_key === extraModel)?.model_name ?? "Comparison",
    },
    dashed: ["baseline"],
  });

  return (
    <>
      <PageHeader
        title="Model Performance"
        description="Each model is fitted on the training split (70%) and scored on validation (10%); the lowest validation RMSE is selected. All models are then refitted on train + validation and evaluated on the held-out test split (20%). Test scores are never used for selection."
        actions={
          <>
            <Button icon={Download} onClick={exportCsv} disabled={!d?.available}>Export CSV</Button>
            <Button variant="primary" icon={RefreshCw} loading={starting} disabled={isRunning} onClick={startEvaluation}>
              {isRunning ? "Evaluating…" : "Re-run evaluation"}
            </Button>
          </>
        }
      />

      {isRunning && ev && (
        <div className="card mb-6 p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-ink">
              <LoaderCircle className="size-4 animate-spin text-accent" /> {ev.message ?? "Evaluating models…"}
            </span>
            <span className="tabular text-xs text-ink-3">{ev.progress}/{ev.total_steps}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-cyan transition-all" style={{ width: `${(ev.progress / Math.max(ev.total_steps, 1)) * 100}%` }} />
          </div>
        </div>
      )}
      {ev?.status === "failed" && (
        <div className="mb-6">
          <Callout tone="bad" title="Last evaluation failed">{ev.message}</Callout>
        </div>
      )}

      {comparison.loading && !d ? (
        <div className="grid gap-6"><div className="card p-5"><ChartSkeleton height={160} /></div><div className="card p-5"><ChartSkeleton /></div></div>
      ) : comparison.error ? (
        <div className="card"><ErrorState message={comparison.error} onRetry={comparison.reload} /></div>
      ) : !d?.available ? (
        <div className="card">
          <EmptyState
            icon={Cpu}
            title={isRunning ? "Evaluation in progress" : "No evaluation results yet"}
            description={isRunning ? "Results appear here automatically when all models have been scored." : "Run the evaluation to fit and score all 12 candidate models."}
            action={!isRunning && <Button variant="primary" icon={RefreshCw} onClick={startEvaluation} loading={starting}>Run evaluation</Button>}
          />
        </div>
      ) : (
        <>
          {/* Selection summary */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="card border-cyan/25 bg-gradient-to-br from-cyan/[0.07] to-surface/80 p-5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-3">
                <Trophy className="size-4 text-cyan" /> Validation-selected model
              </div>
              <p className="mt-2 text-xl font-semibold text-ink">{selected?.model_name}</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Stat label="Val RMSE" value={fmtNum(selected?.validation_rmse, 1)} sub="kWh" />
                <Stat label="Test RMSE" value={fmtNum(selected?.rmse, 1)} sub="kWh" />
                <Stat label="Test MAPE" value={fmtPct(selected?.mape, 1)} sub="non-zero days" />
              </div>
            </div>
            <div className="card p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-3">Baseline comparison</p>
              <p className="mt-2 text-sm text-ink-2">
                <span className="tabular text-xl font-semibold text-ink">{d.models_beating_baseline}</span> of {results.length - 1} models beat{" "}
                <span className="text-ink">{d.baseline?.name.replace("Baseline: ", "")}</span> on test RMSE.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Baseline test RMSE" value={fmtNum(baseline?.rmse, 1)} sub="kWh" />
                <Stat
                  label="Selected vs baseline"
                  value={<span className={cx(selected?.beats_baseline ? "text-good" : "text-[#f87171]")}>{fmtPct(selected?.rmse_improvement_vs_baseline_pct, 1, true)}</span>}
                  sub={selected?.beats_baseline ? "lower RMSE" : "higher RMSE"}
                />
              </div>
            </div>
            <div className="card p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-3">Chronological split</p>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
                <div className="bg-[#3987e5]" style={{ width: "70%" }} />
                <div className="ml-0.5 bg-[#d95926]" style={{ width: "10%" }} />
                <div className="ml-0.5 bg-[#199e70]" style={{ width: "20%" }} />
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                {(["train", "validation", "test"] as const).map((k, i) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 capitalize text-ink-2">
                      <span className="size-2 rounded-sm" style={{ background: ["#3987e5", "#d95926", "#199e70"][i] }} />
                      {k} · {[70, 10, 20][i]}%
                    </span>
                    <span className="tabular text-ink-3">
                      {d.split?.[k].size} days · {fmtDate(d.split?.[k].start)} – {fmtDate(d.split?.[k].end)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-ink-3">Evaluated {fmtDateTime(d.finished_at)}</p>
            </div>
          </div>

          {/* Table */}
          <Card
            className="mt-6"
            title="Model comparison"
            subtitle="Validation metrics drive selection; test metrics (held-out 20%) are reported for comparison. MAPE excludes zero-demand days."
            actions={
              <Segmented<Stage>
                ariaLabel="Sort table by"
                value={sortBy}
                onChange={setSortBy}
                options={[{ value: "test", label: "Sort: test RMSE" }, { value: "validation", label: "Sort: validation RMSE" }]}
              />
            }
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-surface-2/60 text-xs text-ink-3">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-medium">Model</th>
                    <th className="border-l border-line px-3 py-2.5 text-right font-medium">Val MAE</th>
                    <th className="px-3 py-2.5 text-right font-medium">Val RMSE</th>
                    <th className="border-l border-line px-3 py-2.5 text-right font-medium">MAE</th>
                    <th className="px-3 py-2.5 text-right font-medium">MSE</th>
                    <th className="px-3 py-2.5 text-right font-medium">RMSE</th>
                    <th className="px-3 py-2.5 text-right font-medium">MAPE</th>
                    <th className="px-3 py-2.5 text-right font-medium">R²</th>
                    <th className="px-5 py-2.5 text-right font-medium">vs baseline</th>
                  </tr>
                  <tr className="text-[10px] uppercase tracking-wider">
                    <th />
                    <th colSpan={2} className="border-l border-line px-3 pb-2 text-center font-medium text-ink-3">Validation (selection)</th>
                    <th colSpan={6} className="border-l border-line px-3 pb-2 text-center font-medium text-ink-3">Test (held-out)</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {sorted.map((r) => (
                    <tr key={r.model_key} className={cx("border-t border-line/60", r.is_selected ? "bg-cyan/[0.06]" : "hover:bg-surface-2/40")}>
                      <td className="px-5 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cx("font-medium", r.is_selected ? "text-cyan" : "text-ink")}>{r.model_name}</span>
                          {r.is_selected && <Badge tone="cyan"><Trophy className="size-3" /> Selected</Badge>}
                          {r.is_baseline && <Badge>Baseline</Badge>}
                        </div>
                        {(r.validation_error || r.test_error) && (
                          <p className="mt-0.5 text-xs text-[#f87171]">{r.validation_error || r.test_error}</p>
                        )}
                      </td>
                      <td className="border-l border-line px-3 py-2.5 text-right text-ink-2">{fmtNum(r.validation_mae, 1)}</td>
                      <td className={cx("px-3 py-2.5 text-right", r.is_selected ? "font-semibold text-cyan" : "text-ink-2")}>{fmtNum(r.validation_rmse, 1)}</td>
                      <td className="border-l border-line px-3 py-2.5 text-right text-ink">{fmtNum(r.mae, 1)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-2">{isNum(r.mse) ? Math.round(r.mse).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-ink">{fmtNum(r.rmse, 1)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-2">{fmtPct(r.mape, 1)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-2">{fmtNum(r.r2, 3)}</td>
                      <td className="px-5 py-2.5 text-right">
                        {r.is_baseline && r.model_key === d.baseline?.key ? (
                          <span className="text-ink-3">reference</span>
                        ) : (
                          <span className={cx(r.beats_baseline ? "text-good" : "text-[#f87171]")}>{fmtPct(r.rmse_improvement_vs_baseline_pct, 1, true)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line/70 px-5 py-3 text-xs text-ink-3">
              Errors in kWh/day. “vs baseline” = RMSE reduction relative to the same-day-last-week baseline on the test split (positive is better).
              {d.best_on_test_reference_only && d.best_on_test_reference_only !== d.selected_model?.key && (
                <> Lowest test RMSE: {results.find((r) => r.model_key === d.best_on_test_reference_only)?.model_name} (reference only — not used for selection).</>
              )}
            </p>
          </Card>

          {/* RMSE & MAE charts */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Legend items={[{ label: "Validation-selected", color: C.selected, area: true }, { label: "Baseline", color: C.baseline, area: true }, { label: "Other models", color: C.history, area: true }]} />
            <Segmented<Stage> ariaLabel="Metric stage" value={stage} onChange={setStage} options={[{ value: "test", label: "Test split" }, { value: "validation", label: "Validation split" }]} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-6 xl:grid-cols-2">
            {(["rmse_v", "mae_v"] as const).map((metric) => (
              <Card key={metric} title={`${metric === "rmse_v" ? "RMSE" : "MAE"} comparison`} subtitle={`${stage === "test" ? "Held-out test" : "Validation"} split · kWh per day · lower is better`}>
                <div style={{ height: chartRows.length * 28 + 40 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartRows} layout="vertical" margin={{ top: 0, right: 16, bottom: 4, left: 4 }} barCategoryGap={3}>
                      <CartesianGrid stroke={C.grid} horizontal={false} />
                      <XAxis type="number" {...axisProps} tickFormatter={(v: number) => Math.round(v).toLocaleString()} label={{ value: "kWh", position: "insideBottomRight", fill: C.axis, fontSize: 11, dy: 4 }} height={34} />
                      <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={176} interval={0} tick={{ fill: C.axis, fontSize: 11 }} />
                      <Tooltip content={<RmseTip />} cursor={{ fill: "rgba(59,130,246,0.06)" }} />
                      <Bar dataKey={metric} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                        {chartRows.map((r) => <Cell key={r.model_key} fill={barColor(r)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            ))}
          </div>

          {/* Actual vs predicted */}
          <Card
            className="mt-6"
            title="Actual vs predicted · test period"
            subtitle={`Models refitted on train + validation, then forecasting ${d.split?.test.size ?? ""} days ahead without seeing test data.`}
            actions={
              <select className="input h-8 text-xs" value={extraModel} onChange={(e) => setExtraModel(e.target.value)} aria-label="Add a comparison model">
                <option value="">+ Compare another model</option>
                {results.filter((r) => !r.is_selected && r.model_key !== d.baseline?.key && d.test_series?.predictions[r.model_key]).map((r) => (
                  <option key={r.model_key} value={r.model_key}>{r.model_name}</option>
                ))}
              </select>
            }
          >
            <div className="mb-3">
              <Legend
                items={[
                  { label: "Actual", color: "#c9d4e5" },
                  { label: `Predicted · ${selected?.model_name}`, color: C.selected },
                  { label: "Baseline (same day last week)", color: C.baseline, dashed: true },
                  ...(extraModel ? [{ label: results.find((r) => r.model_key === extraModel)?.model_name ?? "", color: "#d95926" }] : []),
                ]}
              />
            </div>
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={fmtDateShort} minTickGap={40} />
                  <YAxis {...yAxisKwh} label={{ value: "kWh", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 6 }} />
                  <Tooltip content={<SeriesTip />} cursor={{ stroke: C.cursor }} />
                  <Line dataKey="actual" stroke="#c9d4e5" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line dataKey="baseline" stroke={C.baseline} strokeWidth={1.25} strokeDasharray="4 3" dot={false} strokeOpacity={0.75} isAnimationActive={false} />
                  {extraModel && <Line dataKey="extra" stroke="#d95926" strokeWidth={1.75} dot={false} isAnimationActive={false} />}
                  <Line dataKey="selected" stroke={C.selected} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Feature importance */}
          <Card className="mt-6" title="Random Forest feature importance" subtitle="Impurity-based importance of the lag features, from the Random Forest fitted on train + validation.">
            {importance.loading ? (
              <ChartSkeleton height={280} />
            ) : importance.error ? (
              <ErrorState message={importance.error} onRetry={importance.reload} compact />
            ) : importance.data?.available ? (
              <div style={{ height: importance.data.features.length * 30 + 40 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={importance.data.features} layout="vertical" margin={{ top: 0, right: 24, bottom: 4, left: 4 }} barCategoryGap={4}>
                    <CartesianGrid stroke={C.grid} horizontal={false} />
                    <XAxis type="number" {...axisProps} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} label={{ value: "Share of importance", position: "insideBottomRight", fill: C.axis, fontSize: 11, dy: 4 }} height={34} />
                    <YAxis type="category" dataKey="feature" {...axisProps} axisLine={false} width={110} interval={0} tick={{ fill: C.axis, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                    <Tooltip content={<FeatureTip />} cursor={{ fill: "rgba(59,130,246,0.06)" }} />
                    <Bar dataKey="importance" fill={C.history} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState compact title="Feature importance unavailable" description="The Random Forest did not complete in the latest evaluation." />
            )}
          </Card>
        </>
      )}
    </>
  );
}

const FeatureTip = makeTooltip({ title: (l) => String(l), format: (v) => fmtPct(v * 100, 2), names: { importance: "Importance" } });
