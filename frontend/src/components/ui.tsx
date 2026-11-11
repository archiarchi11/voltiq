import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { CircleX, Database, LoaderCircle, RefreshCw, TriangleAlert, Upload } from "lucide-react";

type IconType = ComponentType<{ className?: string }>;

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("card min-w-0", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ KPI */

export function KpiCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  loading,
  accent = false,
  trend,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  icon?: IconType;
  loading?: boolean;
  accent?: boolean;
  trend?: { value: string; direction: "up" | "down" | "flat" };
}) {
  return (
    <div
      className={cx(
        "card relative overflow-hidden px-5 py-4",
        accent && "border-accent/30 bg-gradient-to-br from-accent/[0.09] to-surface/80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</p>
        {Icon && <Icon className={cx("size-4", accent ? "text-cyan" : "text-ink-3")} />}
      </div>
      {loading ? (
        <>
          <div className="skeleton mt-3 h-7 w-28" />
          <div className="skeleton mt-2 h-3 w-20" />
        </>
      ) : (
        <>
          <p className="tabular mt-2 flex items-baseline gap-1.5 text-2xl font-semibold tracking-tight text-ink">
            <span className="truncate">{value}</span>
            {unit && <span className="text-sm font-medium text-ink-3">{unit}</span>}
          </p>
          <div className="mt-1 flex min-h-4 items-center gap-2 text-xs text-ink-3">
            {trend && (
              <span
                className={cx(
                  "tabular font-medium",
                  trend.direction === "up" && "text-good",
                  trend.direction === "down" && "text-bad",
                  trend.direction === "flat" && "text-ink-2",
                )}
              >
                {trend.value}
              </span>
            )}
            {hint && <span className="truncate">{hint}</span>}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ controls */

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon: Icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: IconType;
}) {
  const styles: Record<Variant, string> = {
    primary:
      "bg-accent text-white hover:bg-accent-2 shadow-[0_0_0_1px_rgba(59,130,246,0.5),0_6px_20px_-6px_rgba(59,130,246,0.6)]",
    secondary: "border border-line-2 bg-surface-2 text-ink hover:bg-surface-3 hover:border-ink-3/40",
    ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
    danger: "border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20",
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        styles[variant],
        className,
      )}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "accent" | "good" | "warn" | "bad" | "cyan";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "border-line-2 bg-surface-3 text-ink-2",
    accent: "border-accent/40 bg-accent/10 text-[#8db8ff]",
    cyan: "border-cyan/30 bg-cyan/10 text-cyan",
    good: "border-good/30 bg-good/10 text-good",
    warn: "border-warn/30 bg-warn/10 text-warn",
    bad: "border-bad/30 bg-bad/10 text-[#f87171]",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg border border-line-2 bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-8 rounded-md px-3 text-xs font-medium transition",
            o.value === value ? "bg-accent/15 text-ink ring-1 ring-accent/40" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="flex flex-col gap-3" style={{ height }} aria-busy="true" aria-label="Loading chart">
      <div className="flex flex-1 items-end gap-1.5">
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} className="skeleton flex-1" style={{ height: `${30 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

export function EmptyState({
  icon: Icon = Database,
  title,
  description,
  action,
  compact,
}: {
  icon?: IconType;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center text-center", compact ? "py-8" : "py-14")}>
      <div className="mb-3 grid size-11 place-items-center rounded-xl border border-line-2 bg-surface-2">
        <Icon className="size-5 text-ink-3" />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs leading-relaxed text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, compact }: { message: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      icon={CircleX}
      title="Could not load data"
      description={message}
      action={
        onRetry && (
          <Button size="sm" icon={RefreshCw} onClick={onRetry}>
            Retry
          </Button>
        )
      }
    />
  );
}

export function NoDatasetState() {
  return (
    <div className="card">
      <EmptyState
        icon={Upload}
        title="No dataset loaded"
        description={
          <>
            Upload an EV charging-session CSV with the columns <b>Date</b>, <b>Station Name</b>,{" "}
            <b>Energy Provided (kWh)</b> and <b>Session Status</b>, then run preprocessing. All analytics, models
            and forecasts are generated from that data.
          </>
        }
        action={
          <Link
            to="/dataset"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-2"
          >
            <Upload className="size-4" /> Go to Dataset Management
          </Link>
        }
      />
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  icon,
}: {
  tone?: "info" | "warn" | "bad";
  title?: ReactNode;
  children: ReactNode;
  icon?: IconType;
}) {
  const Icon = icon ?? (tone === "info" ? Database : TriangleAlert);
  const tones = {
    info: "border-accent/25 bg-accent/[0.06] text-ink-2",
    warn: "border-warn/25 bg-warn/[0.06] text-ink-2",
    bad: "border-bad/30 bg-bad/[0.07] text-ink-2",
  };
  const iconTone = { info: "text-accent", warn: "text-warn", bad: "text-bad" };
  return (
    <div className={cx("flex gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone])}>
      <Icon className={cx("mt-0.5 size-4 shrink-0", iconTone[tone])} />
      <div className="min-w-0 leading-relaxed">
        {title && <p className="font-medium text-ink">{title}</p>}
        <div className={cx(!!title && "mt-0.5", "text-xs sm:text-sm")}>{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{label}</p>
      <p className="tabular mt-1 truncate text-base font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-ink-3">{sub}</p>}
    </div>
  );
}
