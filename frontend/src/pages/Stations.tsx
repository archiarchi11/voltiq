import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, Info, MapPin, Search, X } from "lucide-react";
import { DateRangePicker } from "../components/DateRangePicker";
import { DailyDemandChart, MonthlyChart, StationBarChart, WeeklyChart } from "../components/charts/Charts";
import { C, axisProps, gridProps, makeTooltip } from "../components/charts/theme";
import {
  Button,
  Callout,
  Card,
  ChartSkeleton,
  EmptyState,
  ErrorState,
  NoDatasetState,
  PageHeader,
  Skeleton,
  Stat,
  cx,
} from "../components/ui";
import { useApi } from "../hooks/useApi";
import { useDataset } from "../hooks/useDataset";
import { api } from "../services/api";
import type { DateRange } from "../types/api";
import { fmtDate, fmtEnergyCompact, fmtInt, fmtKwh, fmtPct } from "../utils/format";

const PAGE = 20;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function Stations() {
  const { hasDataset, loading: dsLoading, version, summary } = useDataset();
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [sort, setSort] = useState("energy");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const q = useDebounced(search.trim());

  useEffect(() => setPage(0), [q, location, sort, range.start, range.end]);

  const top = useApi(() => api.stations({ ...range, limit: 15 }), [range.start, range.end, version], hasDataset);
  const list = useApi(
    () => api.stations({ ...range, search: q, location, sort, limit: PAGE, offset: page * PAGE }),
    [range.start, range.end, q, location, sort, page, version],
    hasDataset,
  );
  const detail = useApi(() => api.stationDetail(selected!, range), [selected, range.start, range.end, version], hasDataset && !!selected);

  useEffect(() => {
    if (!selected && top.data?.items[0]) setSelected(top.data.items[0].station);
  }, [top.data, selected]);

  if (!dsLoading && !hasDataset) {
    return (
      <>
        <PageHeader title="Station Analytics" description="Historical energy demand per charging station." />
        <NoDatasetState />
      </>
    );
  }

  const meta = summary?.active?.cleaning;
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE)) : 1;
  const s = detail.data?.station;

  return (
    <>
      <PageHeader
        title="Station Analytics"
        description="Historical energy consumption and session activity for each charging station."
        actions={<DateRangePicker value={range} onChange={setRange} min={meta?.cleaned_date_min ?? undefined} max={meta?.cleaned_date_max ?? undefined} />}
      />

      <Callout tone="info" icon={Info} title="Historical analysis only">
        VoltIQ forecasts <b>aggregate</b> daily demand across all stations. Station-level forecasts are not produced; this page
        describes observed station history.
      </Callout>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2" title="Top 15 stations by energy" subtitle="Click a bar to view station details.">
          {top.loading ? (
            <div className="space-y-2">{Array.from({ length: 15 }).map((_, i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : top.error ? (
            <ErrorState message={top.error} onRetry={top.reload} compact />
          ) : top.data?.items.length ? (
            <StationBarChart items={top.data.items} selected={selected} onSelect={setSelected} />
          ) : (
            <EmptyState compact title="No stations in this range" />
          )}
        </Card>

        <Card
          className="xl:col-span-3"
          title="All stations"
          subtitle={list.data ? `${fmtInt(list.data.total)} of ${fmtInt(list.data.total_stations)} stations match` : undefined}
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap gap-2 border-b border-line/70 p-4">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input className="input w-full pl-9 pr-8" placeholder="Search station or location…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search stations" />
              {search && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:text-ink" onClick={() => setSearch("")} aria-label="Clear search">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <select className="input max-w-full sm:max-w-64" value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Filter by location">
              <option value="">All locations</option>
              {(list.data?.locations ?? top.data?.locations ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort stations">
              <option value="energy">Sort: energy</option>
              <option value="sessions">Sort: sessions</option>
              <option value="avg">Sort: kWh / session</option>
              <option value="name">Sort: name</option>
            </select>
          </div>
          {list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} compact />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-surface-2/60 text-xs text-ink-3">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">#</th>
                    <th className="px-3 py-2.5 text-left font-medium">Station</th>
                    <th className="px-3 py-2.5 text-right font-medium">Energy</th>
                    <th className="px-3 py-2.5 text-right font-medium">Sessions</th>
                    <th className="px-3 py-2.5 text-right font-medium">kWh / session</th>
                    <th className="px-4 py-2.5 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody className={cx("tabular", list.loading && "opacity-50")}>
                  {list.loading && !list.data
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-t border-line/60"><td colSpan={6} className="px-4 py-2.5"><Skeleton className="h-4" /></td></tr>
                      ))
                    : list.data?.items.map((st) => (
                        <tr
                          key={st.station}
                          onClick={() => setSelected(st.station)}
                          className={cx("cursor-pointer border-t border-line/60", selected === st.station ? "bg-cyan/[0.07]" : "hover:bg-surface-2/40")}
                        >
                          <td className="px-4 py-2 text-ink-3">{st.rank}</td>
                          <td className="px-3 py-2">
                            <p className={cx("font-medium", selected === st.station ? "text-cyan" : "text-ink")}>{st.station}</p>
                            <p className="max-w-[260px] truncate text-xs text-ink-3">{st.location ?? "—"}</p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-ink">{fmtKwh(st.energy_kwh)}</td>
                          <td className="px-3 py-2 text-right text-ink-2">{fmtInt(st.sessions)}</td>
                          <td className="px-3 py-2 text-right text-ink-2">{st.avg_kwh_per_session.toFixed(1)}</td>
                          <td className="px-4 py-2 text-right text-ink-2">{fmtPct(st.share_pct, 2)}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
              {list.data && list.data.total === 0 && <EmptyState compact icon={Search} title="No stations match your filters" />}
            </div>
          )}
          <div className="flex items-center justify-between border-t border-line/70 px-4 py-2.5 text-xs text-ink-3">
            <span>Page {page + 1} of {totalPages}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" />
              <Button size="sm" variant="ghost" icon={ChevronRight} disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page" />
            </div>
          </div>
        </Card>
      </div>

      {/* Detail */}
      {selected && (
        <div className="mt-6">
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 place-items-center rounded-lg border border-cyan/30 bg-cyan/10">
                  <MapPin className="size-5 text-cyan" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-ink-3">Station details</p>
                  <h2 className="text-lg font-semibold text-ink">{selected}</h2>
                  <p className="text-sm text-ink-2">{detail.data?.location_name ?? (detail.loading ? "…" : "Unknown location")}</p>
                </div>
              </div>
              {s && <span className="rounded-lg border border-line-2 bg-surface-2 px-2.5 py-1 text-xs text-ink-2">Rank #{s.rank} of {detail.data?.stations_ranked}</span>}
            </div>
            {detail.error ? (
              <div className="mt-4"><Callout tone="warn">{detail.error}</Callout></div>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
                {detail.loading || !s ? (
                  Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)
                ) : (
                  <>
                    <Stat label="Total energy" value={`${fmtEnergyCompact(s.energy_kwh).value} ${fmtEnergyCompact(s.energy_kwh).unit}`} sub={fmtKwh(s.energy_kwh)} />
                    <Stat label="Sessions" value={fmtInt(s.sessions)} />
                    <Stat label="Avg energy / session" value={fmtKwh(s.avg_kwh_per_session, 1)} />
                    <Stat label="Share of total" value={fmtPct(s.share_pct, 2)} />
                    <Stat label="Active days" value={fmtInt(s.active_days)} />
                    <Stat label="First – last session" value={fmtDate(s.first_date, { month: "short", year: "numeric" })} sub={`to ${fmtDate(s.last_date)}`} />
                  </>
                )}
              </div>
            )}
          </div>

          {!detail.error && (
            <>
              <Card className="mt-6" title="Historical station demand" subtitle="Daily energy delivered by this station (kWh).">
                {detail.loading || !detail.data ? <ChartSkeleton /> : <DailyDemandChart points={detail.data.daily} height={260} />}
              </Card>
              <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
                <Card title="Monthly energy" subtitle="kWh per month">
                  {detail.loading || !detail.data ? <ChartSkeleton height={240} /> : (
                    <MonthlyChart points={detail.data.monthly.map((m) => ({ ...m, days: 0, avg_daily_kwh: null }))} height={240} />
                  )}
                </Card>
                <Card title="Weekday profile" subtitle="Average daily kWh by weekday">
                  {detail.loading || !detail.data ? <ChartSkeleton height={240} /> : <WeeklyChart points={detail.data.weekly} height={240} />}
                </Card>
                <Card title="Energy per session" subtitle="Distribution of session energy (kWh), up to the 99th percentile">
                  {detail.loading || !detail.data ? <ChartSkeleton height={240} /> : <SessionHistogram data={detail.data.energy_distribution} />}
                </Card>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

const HistTip = makeTooltip({ title: (l) => `${l} kWh`, format: (v) => `${fmtInt(v)} sessions`, names: { count: "Sessions" } });

function SessionHistogram({ data }: { data: { range: string; count: number }[] }) {
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap={2}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="range" {...axisProps} tick={{ fill: C.axis, fontSize: 10 }} interval="preserveStartEnd" minTickGap={10} />
          <YAxis {...axisProps} axisLine={false} width={44} label={{ value: "Sessions", angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 6, dy: 24 }} />
          <Tooltip content={<HistTip />} cursor={{ fill: "rgba(59,130,246,0.06)" }} />
          <Bar dataKey="count" fill={C.history} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
