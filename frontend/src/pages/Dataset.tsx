import { useRef, useState, type DragEvent } from "react";
import {
  CircleCheck,
  CircleX,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Play,
  Table2,
  TriangleAlert,
  Upload,
  Zap,
} from "lucide-react";
import { Badge, Button, Callout, Card, EmptyState, ErrorState, PageHeader, Skeleton, Stat, cx } from "../components/ui";
import { useToast } from "../components/Toast";
import { useApi } from "../hooks/useApi";
import { useDataset } from "../hooks/useDataset";
import { api, downloadFile, errorMessage } from "../services/api";
import type { DatasetDetail, DatasetInfo, PreprocessResponse, QualitySummary } from "../types/api";
import { fmtBytes, fmtDate, fmtDateTime, fmtInt, fmtKwh, fmtPct } from "../utils/format";

const STATUS_TONE: Record<DatasetInfo["status"], "good" | "bad" | "accent" | "neutral"> = {
  processed: "good",
  invalid: "bad",
  validated: "accent",
  uploaded: "neutral",
};

export default function DatasetPage() {
  const { summary, refresh, loading, error: summaryError } = useDataset();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<DatasetDetail | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<PreprocessResponse | null>(null);
  const [activating, setActivating] = useState<number | null>(null);

  const latest = uploadResult ?? summary?.latest_upload ?? null;
  const active = summary?.active ?? null;
  const preview = useApi(() => api.datasetPreview(latest!.dataset.id), [latest?.dataset.id], !!latest && latest.dataset.status !== "invalid");

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Unsupported file", "Please choose a .csv file.");
      return;
    }
    setUploading(true);
    setProgress(0);
    setPendingName(file.name);
    setProcessResult(null);
    try {
      const res = await api.uploadDataset(file, setProgress);
      setUploadResult(res);
      if (res.validation?.valid) {
        toast.success("Upload validated", `${fmtInt(res.profile?.row_count)} rows · ready for preprocessing`);
      } else {
        toast.error("Validation failed", res.dataset.error ?? "The file does not meet the requirements. The active dataset was not changed.");
      }
      await refresh();
    } catch (err) {
      toast.error("Upload failed", errorMessage(err));
    } finally {
      setUploading(false);
      setPendingName(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files?.[0]);
  };

  const preprocess = async () => {
    if (!latest) return;
    setProcessing(true);
    try {
      const res = await api.preprocess(latest.dataset.id);
      setProcessResult(res);
      setUploadResult(null);
      toast.success("Preprocessing complete", res.message);
      await refresh();
    } catch (err) {
      toast.error("Preprocessing failed", errorMessage(err));
    } finally {
      setProcessing(false);
    }
  };

  const downloadCleaned = async (id?: number) => {
    try {
      await downloadFile(api.cleanedDownloadUrl(id), "cleaned_dataset.csv");
      toast.success("Cleaned dataset downloaded");
    } catch (err) {
      toast.error("Download failed", errorMessage(err));
    }
  };

  const activate = async (id: number) => {
    setActivating(id);
    try {
      await api.activateDataset(id);
      setProcessResult(null); // show the newly active dataset's quality summary
      toast.success("Dataset activated", `Dataset #${id} is now used for analytics and forecasting.`);
      await refresh();
    } catch (err) {
      toast.error("Activation failed", errorMessage(err));
    } finally {
      setActivating(null);
    }
  };

  const required = summary?.required_columns ?? ["Date", "Station Name", "Energy Provided (kWh)", "Session Status"];
  const canProcess = latest?.dataset.status === "validated" || (latest?.dataset.status === "processed" && !latest.dataset.is_active);
  const quality = processResult?.quality_summary ?? active?.cleaning?.quality_summary ?? null;

  return (
    <>
      <PageHeader
        title="Dataset Management"
        description="Upload EV charging-session data, validate it and run the notebook's cleaning pipeline. A new upload only replaces the active dataset after it passes validation and preprocessing."
        actions={active && <Button icon={Download} onClick={() => downloadCleaned()}>Download cleaned CSV</Button>}
      />

      {summaryError && !summary && (
        <div className="mb-6"><Callout tone="bad" title="API unavailable">{summaryError}</Callout></div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Upload */}
        <Card className="xl:col-span-2" title="Upload CSV" subtitle="Session-level charging data. Files up to 200 MB.">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !uploading && inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Choose a CSV file to upload"
            className={cx(
              "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition",
              dragging ? "border-cyan bg-cyan/[0.06]" : "border-line-2 bg-surface-2/40 hover:border-accent/60 hover:bg-accent/[0.03]",
              uploading && "pointer-events-none",
            )}
          >
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
            {uploading ? (
              <>
                <LoaderCircle className="size-7 animate-spin text-accent" />
                <p className="mt-3 text-sm font-medium text-ink">{progress < 100 ? `Uploading ${pendingName}` : "Validating and profiling…"}</p>
                <div className="mt-3 h-1.5 w-64 max-w-full overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-gradient-to-r from-accent to-cyan transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="tabular mt-1.5 text-xs text-ink-3">{progress}%</p>
              </>
            ) : (
              <>
                <div className="grid size-11 place-items-center rounded-xl border border-line-2 bg-surface-2">
                  <Upload className="size-5 text-accent" />
                </div>
                <p className="mt-3 text-sm font-medium text-ink">Drop a CSV here or click to browse</p>
                <p className="mt-1 text-xs text-ink-3">Dates must use MM/DD/YYYY. Only PAID and ROAMING sessions are kept during cleaning.</p>
              </>
            )}
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-ink-2">Required columns</p>
            <div className="flex flex-wrap gap-1.5">
              {required.map((c) => {
                const present = latest?.profile?.columns.includes(c);
                return (
                  <Badge key={c} tone={!latest ? "neutral" : present ? "good" : "bad"}>
                    {latest && (present ? <CircleCheck className="size-3" /> : <CircleX className="size-3" />)}
                    <span className="font-mono">{c}</span>
                  </Badge>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Active dataset */}
        <Card title="Active dataset" subtitle="Used by every analytics, model and forecast view.">
          {loading && !summary ? (
            <div className="space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-16" /></div>
          ) : active ? (
            <div>
              <div className="flex items-start gap-3">
                <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-cyan" />
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium text-ink">{active.dataset.filename}</p>
                  <p className="mt-0.5 text-xs text-ink-3">Processed {fmtDateTime(active.dataset.processed_at)}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Stat label="Cleaned records" value={fmtInt(active.cleaning?.cleaned_row_count)} />
                <Stat label="Daily observations" value={fmtInt(active.cleaning?.daily_observations)} />
                <Stat label="Stations" value={fmtInt(active.cleaning?.station_count)} />
                <Stat label="Total energy" value={fmtKwh(active.cleaning?.total_energy_kwh)} />
              </div>
              <p className="mt-4 text-xs text-ink-3">
                {fmtDate(active.cleaning?.cleaned_date_min)} – {fmtDate(active.cleaning?.cleaned_date_max)}
              </p>
            </div>
          ) : (
            <EmptyState compact icon={Zap} title="No active dataset" description="Upload a CSV and run preprocessing to activate it." />
          )}
        </Card>
      </div>

      {/* Latest upload details */}
      {latest && (
        <Card
          className="mt-6"
          title={
            <span className="flex flex-wrap items-center gap-2">
              Upload: <span className="break-all font-normal text-ink-2">{latest.dataset.filename}</span>
              <Badge tone={STATUS_TONE[latest.dataset.status]}>{latest.dataset.status}</Badge>
              {latest.dataset.is_active && <Badge tone="cyan">active</Badge>}
            </span>
          }
          subtitle={`${fmtBytes(latest.dataset.file_size_bytes)} · uploaded ${fmtDateTime(latest.dataset.uploaded_at)}`}
          actions={
            canProcess && (
              <Button variant="primary" icon={Play} loading={processing} onClick={preprocess}>
                {processing ? "Preprocessing…" : "Run preprocessing"}
              </Button>
            )
          }
        >
          {latest.dataset.status === "invalid" && (
            <div className="mb-5">
              <Callout tone="bad" title="Validation failed — the active dataset was not changed">{latest.dataset.error}</Callout>
            </div>
          )}

          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Rows" value={fmtInt(latest.profile?.row_count)} />
            <Stat label="Columns" value={fmtInt(latest.profile?.column_count)} />
            <Stat label="Date range" value={latest.profile?.date_min ? fmtDate(latest.profile.date_min) : "—"} sub={latest.profile?.date_max ? `to ${fmtDate(latest.profile.date_max)}` : undefined} />
            <Stat label="Missing cells" value={fmtInt(Object.values(latest.profile?.missing_values ?? {}).reduce((a, b) => a + b, 0))} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Validation checks</p>
              <ul className="space-y-1.5">
                {latest.validation?.checks.map((c) => (
                  <li key={c.name} className="flex items-start gap-2 text-sm">
                    {c.passed ? (
                      <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" />
                    ) : c.level === "error" ? (
                      <CircleX className="mt-0.5 size-4 shrink-0 text-bad" />
                    ) : (
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                    )}
                    <span>
                      <span className="text-ink">{c.name}</span>
                      <span className="block text-xs text-ink-3">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Missing values by column</p>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-xs">
                  <tbody className="tabular">
                    {Object.entries(latest.profile?.missing_values ?? {}).map(([col, n]) => (
                      <tr key={col} className="border-t border-line/60 first:border-t-0">
                        <td className={cx("px-3 py-1.5", required.includes(col) ? "text-ink" : "text-ink-2")}>{col}</td>
                        <td className={cx("px-3 py-1.5 text-right", n > 0 ? "text-warn" : "text-ink-3")}>{fmtInt(n)}</td>
                        <td className="w-16 px-3 py-1.5 text-right text-ink-3">{latest.profile?.row_count ? fmtPct((n / latest.profile.row_count) * 100, 1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Session status</p>
              <div className="space-y-2">
                {Object.entries(latest.profile?.session_status_counts ?? {}).map(([st, n]) => {
                  const kept = ["PAID", "ROAMING"].includes(st.toUpperCase());
                  const pct = latest.profile?.row_count ? (n / latest.profile.row_count) * 100 : 0;
                  return (
                    <div key={st}>
                      <div className="flex justify-between text-xs">
                        <span className={kept ? "text-ink" : "text-ink-3"}>{st} {kept ? "· kept" : "· removed"}</span>
                        <span className="tabular text-ink-2">{fmtInt(n)} ({fmtPct(pct, 1)})</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div className={cx("h-full rounded-full", kept ? "bg-accent" : "bg-ink-3/50")} style={{ width: `${Math.max(pct, 0.5)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Preview */}
      {latest && latest.dataset.status !== "invalid" && (
        <Card className="mt-6" title="Preview · first 10 records" subtitle="Raw values as uploaded." bodyClassName="p-0">
          {preview.loading ? (
            <div className="space-y-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4" />)}</div>
          ) : preview.error ? (
            <ErrorState compact message={preview.error} onRetry={preview.reload} />
          ) : preview.data?.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-2/60 text-ink-3">
                  <tr>
                    {preview.data.columns.map((c) => (
                      <th key={c} className={cx("whitespace-nowrap px-3 py-2 text-left font-medium", required.includes(c) && "text-[#8db8ff]")}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {preview.data.rows.map((row, i) => (
                    <tr key={i} className="border-t border-line/60 hover:bg-surface-2/40">
                      {preview.data!.columns.map((c) => (
                        <td key={c} className="max-w-[220px] truncate whitespace-nowrap px-3 py-1.5 text-ink-2" title={String(row[c] ?? "")}>
                          {row[c] ?? <span className="text-ink-3">null</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState compact icon={Table2} title="No rows to preview" />
          )}
        </Card>
      )}

      {/* Quality summary */}
      {quality && <QualityCard q={quality} onDownload={() => downloadCleaned(processResult?.dataset.id)} />}

      {/* History */}
      {summary && summary.datasets.length > 0 && (
        <Card className="mt-6" title="Upload history" subtitle="Preprocessed datasets can be re-activated." bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-2/60 text-xs text-ink-3">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">#</th>
                  <th className="px-3 py-2.5 text-left font-medium">File</th>
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium">Uploaded</th>
                  <th className="px-5 py-2.5 text-right font-medium" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {summary.datasets.map((d) => (
                  <tr key={d.id} className="border-t border-line/60">
                    <td className="tabular px-5 py-2 text-ink-3">{d.id}</td>
                    <td className="max-w-[340px] truncate px-3 py-2 text-ink" title={d.filename}>{d.filename}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                        {d.is_active && <Badge tone="cyan">active</Badge>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-2">{fmtDateTime(d.uploaded_at)}</td>
                    <td className="px-5 py-2 text-right">
                      {d.status === "processed" && !d.is_active && (
                        <Button size="sm" loading={activating === d.id} onClick={() => activate(d.id)}>Activate</Button>
                      )}
                      {d.status === "processed" && (
                        <button className="ml-1 rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink" onClick={() => downloadCleaned(d.id)} aria-label={`Download cleaned dataset ${d.id}`} title="Download cleaned CSV">
                          <Download className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function QualityCard({ q, onDownload }: { q: QualitySummary; onDownload: () => void }) {
  return (
    <Card
      className="mt-6"
      title="Data quality summary"
      subtitle="Notebook cleaning rules: valid MM/DD/YYYY date, numeric non-negative energy, session status PAID or ROAMING."
      actions={<Button size="sm" icon={Download} onClick={onDownload}>Cleaned CSV</Button>}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div>
          <div className="flex items-end gap-4">
            <div>
              <p className="text-xs text-ink-3">Original</p>
              <p className="tabular text-2xl font-semibold text-ink-2">{fmtInt(q.original_rows)}</p>
            </div>
            <span className="pb-1 text-ink-3">→</span>
            <div>
              <p className="text-xs text-ink-3">Cleaned</p>
              <p className="tabular text-2xl font-semibold text-cyan">{fmtInt(q.cleaned_rows)}</p>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-cyan" style={{ width: `${q.retention_pct}%` }} />
          </div>
          <p className="tabular mt-1.5 text-xs text-ink-3">{fmtPct(q.retention_pct, 2)} retained · {fmtInt(q.removed_rows)} removed</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat label="Daily observations" value={fmtInt(q.daily_observations)} />
            <Stat label="Zero-demand days" value={fmtInt(q.zero_demand_days)} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Removed by rule</p>
          <ul className="space-y-1.5 text-sm">
            {q.steps.map((s) => (
              <li key={s.step} className="flex justify-between gap-3">
                <span className="text-ink-2">{s.step}</span>
                <span className={cx("tabular", s.removed ? "text-warn" : "text-ink-3")}>{fmtInt(s.removed)}</span>
              </li>
            ))}
          </ul>
          {Object.keys(q.excluded_status_counts).length > 0 && (
            <p className="mt-3 text-xs text-ink-3">
              Excluded statuses: {Object.entries(q.excluded_status_counts).map(([k, v]) => `${k} ${fmtInt(v)}`).join(" · ")}
            </p>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Energy per session (kWh)</p>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Mean" value={q.energy_stats.mean.toFixed(2)} />
            <Stat label="Median" value={q.energy_stats.median.toFixed(2)} />
            <Stat label="Min" value={q.energy_stats.min.toFixed(2)} />
            <Stat label="Max" value={q.energy_stats.max.toFixed(2)} />
          </div>
          <p className="mt-3 text-xs text-ink-3">{fmtInt(q.zero_energy_sessions)} sessions delivered 0 kWh (kept, as in the notebook).</p>
        </div>
      </div>
      {q.data_warnings?.map((w) => (
        <div key={w.type} className="mt-5"><Callout tone="warn" title="Data quality notice">{w.message}</Callout></div>
      ))}
    </Card>
  );
}
