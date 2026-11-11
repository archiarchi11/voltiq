import axios, { AxiosError } from "axios";
import type {
  ComparisonResponse,
  DailyPoint,
  DatasetDetail,
  DatasetInfo,
  DatasetSummary,
  DateRange,
  EvaluationStatus,
  FeatureImportanceResponse,
  ForecastResponse,
  ForecastRun,
  Horizon,
  ModelChoice,
  ModelInfo,
  MonthlyPoint,
  Overview,
  PreprocessResponse,
  PreviewResponse,
  Series,
  StationDetail,
  StationsResponse,
  TimeseriesResponse,
  WeeklyPoint,
} from "../types/api";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export const http = axios.create({ baseURL: API_BASE_URL, timeout: 120_000 });

/** Extract a human-readable message from any API/network error. */
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const e = err as AxiosError<{ detail?: unknown }>;
    if (!e.response) return "Cannot reach the VoltIQ API. Is the backend running on port 8000?";
    const detail = e.response.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d: { loc?: (string | number)[]; msg?: string }) =>
          [d.loc?.filter((x) => x !== "body").join("."), d.msg].filter(Boolean).join(": "),
        )
        .join("; ");
    }
    return `Request failed (${e.response.status})`;
  }
  return err instanceof Error ? err.message : "Unexpected error";
}

export function isNoDataset(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.response?.data as { code?: string } | undefined)?.code === "NO_ACTIVE_DATASET";
}

const rangeParams = (r?: DateRange) => ({
  ...(r?.start ? { start: r.start } : {}),
  ...(r?.end ? { end: r.end } : {}),
});

const get = async <T>(url: string, params?: object) => (await http.get<T>(url, { params })).data;

export const api = {
  health: () => get<{ status: string; database: boolean; version: string }>("/api/health"),

  // dataset
  datasetSummary: () => get<DatasetSummary>("/api/dataset/summary"),
  datasetPreview: (datasetId?: number) =>
    get<PreviewResponse>("/api/dataset/preview", datasetId ? { dataset_id: datasetId } : undefined),
  uploadDataset: async (file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    const res = await http.post<DatasetDetail>("/api/dataset/upload", form, {
      timeout: 0,
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    });
    return res.data;
  },
  preprocess: async (datasetId?: number) =>
    (await http.post<PreprocessResponse>("/api/dataset/preprocess", { dataset_id: datasetId ?? null }, { timeout: 0 })).data,
  activateDataset: async (datasetId: number) =>
    (await http.post<DatasetInfo>(`/api/dataset/${datasetId}/activate`)).data,
  cleanedDownloadUrl: (datasetId?: number) =>
    `${API_BASE_URL}/api/dataset/download${datasetId ? `?dataset_id=${datasetId}` : ""}`,

  // dashboard & analytics
  overview: (r?: DateRange) => get<Overview>("/api/dashboard/overview", rangeParams(r)),
  daily: (r?: DateRange) => get<Series<DailyPoint>>("/api/analytics/daily", rangeParams(r)),
  monthly: (r?: DateRange) => get<Series<MonthlyPoint>>("/api/analytics/monthly", rangeParams(r)),
  weekly: (r?: DateRange) => get<Series<WeeklyPoint>>("/api/analytics/weekly", rangeParams(r)),
  stations: (p: { search?: string; location?: string; sort?: string; limit?: number; offset?: number } & DateRange) =>
    get<StationsResponse>("/api/analytics/stations", {
      ...rangeParams(p),
      ...(p.search ? { search: p.search } : {}),
      ...(p.location ? { location: p.location } : {}),
      sort: p.sort ?? "energy",
      limit: p.limit ?? 15,
      offset: p.offset ?? 0,
    }),
  stationDetail: (name: string, r?: DateRange) =>
    get<StationDetail>("/api/analytics/station-detail", { name, ...rangeParams(r) }),
  timeseries: () => get<TimeseriesResponse>("/api/analytics/timeseries"),

  // models
  catalog: () => get<{ models: ModelInfo[]; families: string[] }>("/api/models/catalog"),
  comparison: () => get<ComparisonResponse>("/api/models/comparison"),
  featureImportance: () => get<FeatureImportanceResponse>("/api/models/feature-importance"),
  evaluationStatus: () => get<EvaluationStatus>("/api/models/evaluation-status"),
  runEvaluation: async () => (await http.post<{ run_id: number; message: string }>("/api/models/evaluate")).data,
  comparisonExportUrl: () => `${API_BASE_URL}/api/models/comparison/export`,

  // forecasting
  runForecast: async (model: ModelChoice, horizon: Horizon) =>
    (await http.post<ForecastResponse>("/api/forecast/run", { model, horizon }, { timeout: 0 })).data,
  latestForecast: () => get<ForecastResponse | null>("/api/forecast/latest"),
  forecast: (id: number) => get<ForecastResponse>(`/api/forecast/${id}`),
  forecastHistory: (limit = 50) => get<{ runs: ForecastRun[] }>("/api/forecast/history", { limit }),
  forecastExportUrl: (id: number) => `${API_BASE_URL}/api/forecast/${id}/export`,
};

/** Trigger a browser download for a backend CSV endpoint, surfacing API errors. */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await http.get<Blob>(url, { responseType: "blob", timeout: 0 });
  const disposition = (res.headers["content-disposition"] as string | undefined) ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
