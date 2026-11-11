import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  ChartColumnBig,
  Database,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  MapPin,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { useDataset } from "../hooks/useDataset";
import { cx } from "../components/ui";
import { fmtDate, fmtRelative } from "../utils/format";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/forecasting", label: "Demand Forecasting", icon: TrendingUp },
  { to: "/models", label: "Model Performance", icon: Gauge },
  { to: "/stations", label: "Station Analytics", icon: MapPin },
  { to: "/timeseries", label: "Time-Series Analysis", icon: Activity },
  { to: "/dataset", label: "Dataset Management", icon: Database },
];

function readCollapsed(): boolean {
  try {
    return localStorage.getItem("voltiq.sidebar") === "collapsed";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem("voltiq.sidebar", collapsed ? "collapsed" : "expanded");
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  const current = NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));

  return (
    <div className="flex h-full">
      {/* Mobile backdrop */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-[#080d18]/95 backdrop-blur transition-[width,transform] duration-200",
          collapsed ? "lg:w-[68px]" : "lg:w-60",
          "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className={cx("flex h-14 items-center gap-2.5 border-b border-line px-4", collapsed && "lg:justify-center lg:px-0")}>
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent to-cyan shadow-[0_0_20px_-4px_rgba(34,211,238,0.6)]">
            <Zap className="size-4 text-[#06101f]" strokeWidth={2.5} />
          </div>
          <div className={cx("min-w-0", collapsed && "lg:hidden")}>
            <p className="text-[15px] font-semibold leading-tight tracking-tight text-ink">VoltIQ</p>
            <p className="truncate text-[10.5px] leading-tight text-ink-3">Predict. Analyse. Optimise.</p>
          </div>
          <button className="ml-auto rounded-md p-1 text-ink-3 hover:text-ink lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cx(
                  "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition",
                  collapsed && "lg:justify-center lg:px-0",
                  isActive ? "bg-accent/10 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-cyan" />}
                  <Icon className={cx("size-[17px] shrink-0", isActive ? "text-cyan" : "text-ink-3 group-hover:text-ink-2")} />
                  <span className={cx("truncate", collapsed && "lg:hidden")}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <SidebarFooter collapsed={collapsed} />

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="hidden h-11 items-center justify-center gap-2 border-t border-line text-xs text-ink-3 hover:text-ink lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
        </button>
      </aside>

      {/* Main column */}
      <div className={cx("flex min-w-0 flex-1 flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[68px]" : "lg:pl-60")}>
        <TopBar title={current?.label ?? "VoltIQ"} onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const { summary } = useDataset();
  const active = summary?.active;
  if (collapsed) return null;
  return (
    <div className="m-3 rounded-lg border border-line bg-surface/60 p-3 text-xs lg:block">
      <p className="mb-1 font-medium uppercase tracking-wider text-[10px] text-ink-3">Active dataset</p>
      {active ? (
        <>
          <p className="truncate text-ink" title={active.dataset.filename}>{active.dataset.filename}</p>
          <p className="mt-0.5 text-ink-3">
            {fmtDate(active.cleaning?.cleaned_date_min)} – {fmtDate(active.cleaning?.cleaned_date_max)}
          </p>
        </>
      ) : (
        <p className="text-ink-3">None loaded</p>
      )}
    </div>
  );
}

function TopBar({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { summary, apiOnline, loading } = useDataset();
  const ev = summary?.evaluation;
  const active = summary?.active;

  let status: { label: string; tone: string; dot: string };
  if (!apiOnline) status = { label: "API offline", tone: "text-[#f87171]", dot: "bg-bad" };
  else if (loading && !summary) status = { label: "Connecting…", tone: "text-ink-2", dot: "bg-ink-3" };
  else if (!summary?.has_active_dataset) status = { label: "No dataset", tone: "text-warn", dot: "bg-warn" };
  else status = { label: "Dataset ready", tone: "text-good", dot: "bg-good" };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <button className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu className="size-5" />
      </button>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <ChartColumnBig className="hidden size-4 text-ink-3 sm:block" />
        <span className="hidden text-ink-3 sm:inline">VoltIQ</span>
        <span className="hidden text-ink-3 sm:inline">/</span>
        <span className="truncate font-medium text-ink">{title}</span>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {ev?.status === "running" && (
          <div className="hidden items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-ink-2 md:flex" title={ev.message ?? ""}>
            <LoaderCircle className="size-3.5 animate-spin text-accent" />
            Evaluating models
            <span className="tabular text-ink">{ev.progress}/{ev.total_steps}</span>
          </div>
        )}
        {active?.dataset.processed_at && (
          <span className="hidden text-xs text-ink-3 xl:inline" title="Dataset last processed">
            Updated {fmtRelative(ev?.finished_at && ev.status === "completed" ? ev.finished_at : active.dataset.processed_at)}
          </span>
        )}
        <span className={cx("flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs", status.tone)}>
          <span className={cx("size-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
      </div>
    </header>
  );
}
