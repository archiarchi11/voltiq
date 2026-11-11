import { useMemo } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyPoint, MonthlyPoint, StationRecord, WeeklyPoint } from "../../types/api";
import { fmtDate, fmtDateShort, fmtInt, fmtKwh, fmtMonth, fmtPct } from "../../utils/format";
import { C, Legend, axisProps, gridProps, makeTooltip, yAxisKwh } from "./theme";

const kwhTooltipFormat = (v: number) => fmtKwh(v, 1);

/* ---------------------------------------------------------------- forecast */

export interface ForecastChartProps {
  history: { date: string; energy_kwh: number }[];
  predictions: { date: string; predicted_kwh: number }[];
  modelName: string;
  height?: number;
}

/** Historical (solid) vs forecast (dashed, shaded region) daily demand. */
export function ForecastChart({ history, predictions, modelName, height = 320 }: ForecastChartProps) {
  const data = useMemo(() => {
    const rows: { date: string; actual?: number; forecast?: number }[] = history.map((h) => ({
      date: h.date,
      actual: h.energy_kwh,
    }));
    // Join the two lines at the last observed day so the forecast visibly continues the history.
    if (rows.length && predictions.length) rows[rows.length - 1].forecast = rows[rows.length - 1].actual;
    predictions.forEach((p) => rows.push({ date: p.date, forecast: p.predicted_kwh }));
    return rows;
  }, [history, predictions]);

  const first = predictions[0]?.date;
  const last = predictions[predictions.length - 1]?.date;
  const lastHistory = history[history.length - 1]?.date;
  const Tip = makeTooltip({
    title: (l) => fmtDate(String(l), { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    format: kwhTooltipFormat,
    names: { actual: "Observed", forecast: "Forecast" },
    dashed: ["forecast"],
  });

  return (
    <div>
      <div className="mb-3">
        <Legend
          items={[
            { label: "Observed daily demand", color: C.history },
            { label: `Forecast · ${modelName}`, color: C.forecast, dashed: true },
            { label: "Forecast window", color: "rgba(34,211,238,0.12)", area: true },
          ]}
        />
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.history} stopOpacity={0.22} />
                <stop offset="100%" stopColor={C.history} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            {first && last && <ReferenceArea x1={lastHistory ?? first} x2={last} fill="rgba(34,211,238,0.06)" ifOverflow="extendDomain" />}
            {lastHistory && (
              <ReferenceLine
                x={lastHistory}
                stroke={C.cursor}
                strokeDasharray="3 3"
                label={{ value: "Last observed", fill: C.axis, fontSize: 10, position: "insideTopLeft" }}
              />
            )}
            <XAxis dataKey="date" {...axisProps} tickFormatter={fmtDateShort} minTickGap={36} />
            <YAxis {...yAxisKwh} label={{ value: "kWh", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 6 }} />
            <Tooltip content={<Tip />} cursor={{ stroke: C.cursor }} />
            <Area type="monotone" dataKey="actual" stroke={C.history} strokeWidth={2} fill="url(#histFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#0c1320" }} connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="forecast" stroke={C.forecast} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2.5, fill: C.forecast, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "#0c1320" }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- daily */

export function DailyDemandChart({ points, height = 300 }: { points: DailyPoint[]; height?: number }) {
  const Tip = makeTooltip({
    title: (l) => fmtDate(String(l), { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    format: (v, k) => (k === "sessions" ? fmtInt(v) : kwhTooltipFormat(v)),
    names: { energy_kwh: "Energy" },
  });
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.history} stopOpacity={0.25} />
              <stop offset="100%" stopColor={C.history} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => fmtDate(d, { month: "short", year: "2-digit" })} minTickGap={48} />
          <YAxis {...yAxisKwh} label={{ value: "kWh / day", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 6, dy: 30 }} />
          <Tooltip content={<Tip />} cursor={{ stroke: C.cursor }} />
          <Area type="monotone" dataKey="energy_kwh" stroke={C.history} strokeWidth={1.5} fill="url(#dailyFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- monthly */

export function MonthlyChart({ points, height = 280 }: { points: MonthlyPoint[]; height?: number }) {
  const Tip = makeTooltip({
    title: (l) => fmtMonth(String(l)),
    format: kwhTooltipFormat,
    names: { energy_kwh: "Monthly energy" },
  });
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap={2}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" {...axisProps} tickFormatter={fmtMonth} minTickGap={24} />
          <YAxis {...yAxisKwh} label={{ value: "kWh / month", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 6, dy: 36 }} />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(59,130,246,0.06)" }} />
          <Bar dataKey="energy_kwh" fill={C.history} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- weekday */

export function WeeklyChart({ points, height = 280 }: { points: WeeklyPoint[]; height?: number }) {
  const max = Math.max(...points.map((p) => p.avg_kwh ?? 0));
  const Tip = makeTooltip({
    title: (l) => points.find((p) => p.short === l)?.weekday ?? String(l),
    format: kwhTooltipFormat,
    names: { avg_kwh: "Avg daily energy" },
  });
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="22%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="short" {...axisProps} />
          <YAxis {...yAxisKwh} label={{ value: "Avg kWh / day", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 6, dy: 40 }} />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(59,130,246,0.06)" }} />
          <Bar dataKey="avg_kwh" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}>
            {points.map((p) => (
              <Cell key={p.weekday} fill={p.avg_kwh === max ? C.forecast : C.history} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- stations */

export function StationBarChart({
  items,
  height,
  selected,
  onSelect,
}: {
  items: StationRecord[];
  height?: number;
  selected?: string | null;
  onSelect?: (station: string) => void;
}) {
  const h = height ?? Math.max(220, items.length * 26 + 30);
  const Tip = ({ active, payload }: { active?: boolean; payload?: readonly { payload?: StationRecord }[] }) => {
    const s = active ? payload?.[0]?.payload : undefined;
    if (!s) return null;
    return (
      <div className="min-w-52 rounded-lg border border-line-2 bg-[#0b1220]/95 px-3 py-2.5 text-xs shadow-xl shadow-black/50">
        <p className="font-medium text-ink">Station {s.station}</p>
        {s.location && <p className="mb-1.5 text-ink-3">{s.location}</p>}
        <div className="tabular space-y-0.5 text-ink-2">
          <p className="flex justify-between gap-4"><span>Energy</span><span className="text-ink">{fmtKwh(s.energy_kwh)}</span></p>
          <p className="flex justify-between gap-4"><span>Sessions</span><span className="text-ink">{fmtInt(s.sessions)}</span></p>
          <p className="flex justify-between gap-4"><span>Avg / session</span><span className="text-ink">{fmtKwh(s.avg_kwh_per_session, 1)}</span></p>
          <p className="flex justify-between gap-4"><span>Share of total</span><span className="text-ink">{fmtPct(s.share_pct, 1)}</span></p>
        </div>
      </div>
    );
  };
  return (
    <div style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={items} layout="vertical" margin={{ top: 0, right: 16, bottom: 4, left: 4 }} barCategoryGap={3}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" {...axisProps} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} label={{ value: "Total energy (kWh)", position: "insideBottomRight", fill: C.axis, fontSize: 11, dy: 4 }} height={36} />
          <YAxis type="category" dataKey="station" {...axisProps} axisLine={false} width={76} interval={0} />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(59,130,246,0.06)" }} />
          <Bar
            dataKey="energy_kwh"
            radius={[0, 4, 4, 0]}
            maxBarSize={18}
            isAnimationActive={false}
            onClick={(d: unknown) => {
              const s = (d as { payload?: StationRecord })?.payload?.station;
              if (s) onSelect?.(s);
            }}
            style={{ cursor: onSelect ? "pointer" : "default" }}
          >
            {items.map((s) => (
              <Cell key={s.station} fill={selected === s.station ? C.forecast : C.history} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
