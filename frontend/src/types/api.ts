// Types mirroring the VoltIQ FastAPI responses.

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
  level: "error" | "warning";
}

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: ValidationCheck[];
}

export interface DatasetInfo {
  id: number;
  filename: string;
  file_size_bytes: number;
  status: "uploaded" | "validated" | "invalid" | "processed";
  is_active: boolean;
  error: string | null;
  uploaded_at: string;
  processed_at: string | null;
}

export interface DatasetProfile {
  row_count: number;
  column_count: number;
  columns: string[];
  missing_values: Record<string, number>;
  date_min: string | null;
  date_max: string | null;
  session_status_counts: Record<string, number>;
}

export interface DataWarning {
  type: string;
  date: string;
  energy_kwh: number;
  reference_median_kwh: number;
  message: string;
}

export interface QualitySummary {
  original_rows: number;
  cleaned_rows: number;
  removed_rows: number;
  retention_pct: number;
  steps: { step: string; removed: number }[];
  excluded_status_counts: Record<string, number>;
  kept_status_counts: Record<string, number>;
  zero_energy_sessions: number;
  energy_stats: { min: number; max: number; mean: number; median: number };
  missing_after_cleaning: Record<string, number>;
  daily_observations?: number;
  zero_demand_days?: number;
  data_warnings?: DataWarning[];
}

export interface CleaningSummary {
  cleaned_row_count: number | null;
  cleaned_date_min: string | null;
  cleaned_date_max: string | null;
  daily_observations: number | null;
  total_energy_kwh: number | null;
  station_count: number | null;
  quality_summary: QualitySummary | null;
}

export interface DatasetDetail {
  dataset: DatasetInfo;
  profile: DatasetProfile | null;
  validation: ValidationReport | null;
  cleaning: CleaningSummary | null;
}

export interface EvaluationStatus {
  run_id: number | null;
  status: "none" | "running" | "completed" | "failed";
  progress: number;
  total_steps: number;
  message: string | null;
  best_model_key: string | null;
  best_model_name: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface DatasetSummary {
  has_active_dataset: boolean;
  active: DatasetDetail | null;
  latest_upload: DatasetDetail | null;
  datasets: DatasetInfo[];
  evaluation: EvaluationStatus;
  required_columns: string[];
}

export interface PreviewResponse {
  dataset_id: number;
  filename: string;
  columns: string[];
  rows: Record<string, string | number | null>[];
}

export interface PreprocessResponse {
  dataset: DatasetInfo;
  original_rows: number;
  cleaned_rows: number;
  quality_summary: QualitySummary;
  evaluation_run_id: number | null;
  message: string;
}

export interface Overview {
  has_dataset: boolean;
  dataset?: {
    id: number;
    filename: string;
    status: string;
    processed_at: string | null;
    records: number;
    date_min: string;
    date_max: string;
  };
  range?: { start: string | null; end: string | null; days: number };
  kpis?: {
    total_energy_kwh: number;
    total_sessions: number;
    station_count: number;
    avg_daily_kwh: number | null;
    peak_day: { date: string; energy_kwh: number } | null;
  };
  best_model?: {
    model_key: string;
    model_name: string;
    validation_rmse: number | null;
    validation_mae: number | null;
    test_rmse: number | null;
    evaluated_at: string | null;
  } | null;
  evaluation?: EvaluationStatus;
  last_updated?: string;
  data_warnings?: DataWarning[];
}

export interface DailyPoint {
  date: string;
  energy_kwh: number;
  sessions: number;
}
export interface MonthlyPoint {
  month: string;
  energy_kwh: number;
  sessions: number;
  days: number;
  avg_daily_kwh: number | null;
}
export interface WeeklyPoint {
  weekday: string;
  short: string;
  avg_kwh: number | null;
  median_kwh: number | null;
  std_kwh: number | null;
  total_kwh: number | null;
  days: number;
}
export interface Series<T> {
  points: T[];
  unit: string;
}

export interface StationRecord {
  rank: number;
  station: string;
  location: string | null;
  energy_kwh: number;
  sessions: number;
  avg_kwh_per_session: number;
  share_pct: number;
  first_date: string;
  last_date: string;
  active_days: number;
}

export interface StationsResponse {
  total: number;
  total_stations: number;
  total_energy_kwh: number;
  locations: string[];
  items: StationRecord[];
}

export interface StationDetail {
  station: StationRecord;
  location_name: string | null;
  stations_ranked: number;
  daily: DailyPoint[];
  monthly: { month: string; energy_kwh: number; sessions: number }[];
  weekly: WeeklyPoint[];
  energy_distribution: { range: string; from: number; to: number; count: number }[];
  note: string;
}

export interface AdfResult {
  statistic: number;
  p_value: number;
  used_lag: number;
  n_obs: number;
  critical_values: Record<string, number>;
  stationary: boolean;
  interpretation: string;
}

export interface TimeseriesResponse {
  series: { date: string; energy_kwh: number; rolling_mean_30: number | null; rolling_std_30: number | null }[];
  differenced: { date: string; diff_kwh: number }[];
  adf_original: AdfResult | null;
  adf_differenced: AdfResult | null;
  summary: {
    observations: number;
    mean_kwh: number;
    std_kwh: number;
    zero_days: number;
    diff_mean_kwh: number | null;
    diff_std_kwh: number | null;
  };
}

export interface ModelInfo {
  key: string;
  name: string;
  family: string;
  is_baseline: boolean;
  description: string;
}

export interface ModelResult {
  model_key: string;
  model_name: string;
  family: string;
  is_baseline: boolean;
  is_selected: boolean;
  validation_mae: number | null;
  validation_rmse: number | null;
  validation_error: string | null;
  mae: number | null;
  mse: number | null;
  rmse: number | null;
  mape: number | null;
  r2: number | null;
  test_error: string | null;
  fit_seconds: number | null;
  rmse_improvement_vs_baseline_pct: number | null;
  beats_baseline: boolean | null;
  validation_rank?: number;
  test_rank?: number;
}

export interface SplitRange {
  size: number;
  start: string | null;
  end: string | null;
}

export interface ComparisonResponse {
  available: boolean;
  evaluation: EvaluationStatus;
  run_id?: number;
  finished_at?: string;
  split?: { train: SplitRange; validation: SplitRange; test: SplitRange; ratios: number[] };
  selected_model?: { key: string; name: string; selection_metric: string };
  baseline?: { key: string; name: string; rmse: number | null };
  best_on_test_reference_only?: string | null;
  models_beating_baseline?: number;
  results?: ModelResult[];
  test_series?: { dates: string[]; actual: number[]; predictions: Record<string, number[]> };
}

export interface FeatureImportanceResponse {
  available: boolean;
  model?: string;
  trained_on?: string;
  features: { feature: string; importance: number }[];
}

export type ModelChoice =
  | "auto" | "naive" | "snaive" | "ar1" | "ma1" | "arma11" | "arima111" | "arima211" | "arima112"
  | "sarima101" | "sarima111" | "ets" | "rf";

export type Horizon = 7 | 14 | 30;

export interface ForecastRun {
  id: number;
  dataset_id: number;
  requested_model: string;
  model_key: string;
  model_name: string;
  model_family: string | null;
  horizon: number;
  source: "user" | "evaluation";
  created_at: string;
  total_kwh: number;
  average_kwh: number;
  previous_period_kwh: number | null;
  pct_change: number | null;
  validation_rmse: number | null;
  validation_mae: number | null;
  evaluation_run_id: number | null;
  history_start: string;
  history_end: string;
  n_observations: number;
  fit_seconds: number;
}

export interface ForecastResponse {
  run: ForecastRun;
  predictions: { date: string; predicted_kwh: number }[];
  history: { date: string; energy_kwh: number }[];
  warnings: DataWarning[];
}

export interface DateRange {
  start: string | null;
  end: string | null;
}
