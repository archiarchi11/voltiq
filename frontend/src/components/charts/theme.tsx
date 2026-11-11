import type { ReactNode } from "react";
import { fmtAxisKwh } from "../../utils/format";

/** Chart colour roles (dark surface). Categorical order is fixed; never cycled. */
export const C = {
  history: "#3987e5", // observed demand
  forecast: "#22d3ee", // predictions (always dashed + shaded region)
  baseline: "#8b97a8", // baseline / reference series
  rolling: "#d95926", // secondary overlay (moving average)
  grid: "#1a2539",
  axis: "#6b7a93",
  cursor: "#3a4a68",
  selected: "#22d3ee",
  muted: "#2f4466",
};

/** Validated dark-mode categorical order (blue, orange, aqua, yellow, magenta, green, violet, red). */
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export const axisProps = {
  stroke: C.axis,
  tick: { fill: C.axis, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: C.grid },
} as const;

export const yAxisKwh = {
  ...axisProps,
  axisLine: false,
  width: 48,
  tickFormatter: (v: number) => fmtAxisKwh(v),
} as const;

export const gridProps = { stroke: C.grid, strokeDasharray: "0", vertical: false } as const;

/* ------------------------------------------------------------------ tooltip */

interface TooltipRow {
  label: string;
  value: string;
  color?: string;
  dashed?: boolean;
}

export function TooltipBox({ title, rows }: { title: ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="min-w-44 rounded-lg border border-line-2 bg-[#0b1220]/95 px-3 py-2.5 text-xs shadow-xl shadow-black/50 backdrop-blur">
      <p className="mb-1.5 font-medium text-ink">{title}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              {r.color && (
                <span
                  className="inline-block h-0.5 w-3 rounded"
                  style={{
                    background: r.dashed ? `repeating-linear-gradient(90deg, ${r.color} 0 3px, transparent 3px 5px)` : r.color,
                  }}
                />
              )}
              {r.label}
            </span>
            <span className="tabular font-medium text-ink">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Generic tooltip content for Recharts: maps payload entries through a formatter. */
export function makeTooltip(opts: {
  title: (label: string | number) => ReactNode;
  format: (v: number, key: string) => string;
  names?: Record<string, string>;
  dashed?: string[];
}) {
  return function ChartTooltip(props: {
    active?: boolean;
    label?: string | number;
    payload?: readonly { dataKey?: unknown; value?: unknown; color?: string; stroke?: string; fill?: string }[];
  }) {
    const { active, payload, label } = props;
    if (!active || !payload?.length) return null;
    const rows: TooltipRow[] = payload
      .filter((p) => typeof p.value === "number" && Number.isFinite(p.value))
      .map((p) => {
        const key = String(p.dataKey);
        return {
          label: opts.names?.[key] ?? key,
          value: opts.format(p.value as number, key),
          color: p.stroke && p.stroke !== "none" ? p.stroke : (p.fill ?? p.color),
          dashed: opts.dashed?.includes(key),
        };
      });
    if (!rows.length) return null;
    return <TooltipBox title={opts.title(label ?? "")} rows={rows} />;
  };
}

/* ------------------------------------------------------------------ legend */

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; area?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.area ? (
            <span className="inline-block size-2.5 rounded-sm" style={{ background: i.color }} />
          ) : (
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{
                background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color,
              }}
            />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}
