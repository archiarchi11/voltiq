import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import type { DateRange } from "../types/api";
import { shiftDays } from "../utils/format";
import { cx } from "./ui";

type Preset = "all" | "365" | "90" | "30" | "custom";

const PRESETS: { key: Preset; label: string; days?: number }[] = [
  { key: "all", label: "All" },
  { key: "365", label: "12M", days: 365 },
  { key: "90", label: "90D", days: 90 },
  { key: "30", label: "30D", days: 30 },
  { key: "custom", label: "Custom" },
];

/**
 * Date range selector. Relative presets are anchored to the last date in the dataset
 * (not today), so "Last 90 days" always shows the most recent 90 days of data.
 */
export function DateRangePicker({
  value,
  onChange,
  min,
  max,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  min?: string;
  max?: string;
}) {
  const [preset, setPreset] = useState<Preset>("all");
  const [draft, setDraft] = useState<DateRange>(value);

  useEffect(() => setDraft(value), [value]);

  const choose = (p: (typeof PRESETS)[number]) => {
    setPreset(p.key);
    if (p.key === "all") onChange({ start: null, end: null });
    else if (p.days && max) onChange({ start: shiftDays(max, -(p.days - 1)), end: max });
    else if (p.key === "custom") setDraft({ start: value.start ?? min ?? null, end: value.end ?? max ?? null });
  };

  const apply = (next: DateRange) => {
    setDraft(next);
    if (next.start && next.end && next.start > next.end) return;
    onChange(next);
  };

  const invalid = !!(draft.start && draft.end && draft.start > draft.end);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-line-2 bg-surface-2 p-0.5" role="radiogroup" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            role="radio"
            aria-checked={preset === p.key}
            disabled={!max && !!p.days}
            onClick={() => choose(p)}
            className={cx(
              "h-8 rounded-md px-2.5 text-xs font-medium transition disabled:opacity-40",
              preset === p.key ? "bg-accent/15 text-ink ring-1 ring-accent/40" : "text-ink-2 hover:text-ink",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <Calendar className="hidden size-4 text-ink-3 sm:block" />
          <input
            type="date"
            className={cx("input w-[8.75rem] text-xs", invalid && "border-bad")}
            value={draft.start ?? ""}
            min={min}
            max={max}
            onChange={(e) => apply({ ...draft, start: e.target.value || null })}
            aria-label="Start date"
          />
          <span className="text-xs text-ink-3">to</span>
          <input
            type="date"
            className={cx("input w-[8.75rem] text-xs", invalid && "border-bad")}
            value={draft.end ?? ""}
            min={min}
            max={max}
            onChange={(e) => apply({ ...draft, end: e.target.value || null })}
            aria-label="End date"
          />
        </div>
      )}
    </div>
  );
}
