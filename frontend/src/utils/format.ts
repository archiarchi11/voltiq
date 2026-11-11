const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function fmtInt(v: number | null | undefined): string {
  return isNum(v) ? nf0.format(v) : "—";
}

export function fmtKwh(v: number | null | undefined, digits: 0 | 1 | 2 = 0): string {
  if (!isNum(v)) return "—";
  const f = digits === 0 ? nf0 : digits === 1 ? nf1 : nf2;
  return `${f.format(v)} kWh`;
}

/** Compact energy: 5.78 GWh, 444.7 MWh, 3,100 kWh */
export function fmtEnergyCompact(v: number | null | undefined): { value: string; unit: string } {
  if (!isNum(v)) return { value: "—", unit: "" };
  const a = Math.abs(v);
  if (a >= 1e6) return { value: nf2.format(v / 1e6), unit: "GWh" };
  if (a >= 1e4) return { value: nf1.format(v / 1e3), unit: "MWh" };
  return { value: nf0.format(v), unit: "kWh" };
}

export function fmtAxisKwh(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

export function fmtPct(v: number | null | undefined, digits = 1, signed = false): string {
  if (!isNum(v)) return "—";
  // Avoid misleading "-0.0%": show more precision for tiny non-zero values.
  const d = v !== 0 && Math.abs(v) < 0.5 * 10 ** -digits ? digits + 2 : digits;
  const s = `${v.toFixed(d)}%`;
  return signed && v > 0 ? `+${s}` : s;
}

export function fmtPValue(p: number | null | undefined): string {
  if (!isNum(p)) return "—";
  if (p < 1e-4) return p.toExponential(2);
  return p.toFixed(4);
}

/** Backend datetimes from SQLite are naive UTC; treat them as UTC. */
export function parseApiDate(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
}

export function fmtDate(s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!s) return "—";
  return parseApiDate(s).toLocaleDateString("en-GB", opts);
}

export function fmtDateShort(s: string): string {
  return parseApiDate(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function fmtMonth(s: string): string {
  const [y, m] = s.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  return parseApiDate(s).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function fmtRelative(s: string | null | undefined): string {
  if (!s) return "—";
  const diff = (Date.now() - parseApiDate(s).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return fmtDateTime(s);
}

export function fmtBytes(b: number): string {
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shiftDays(iso: string, days: number): string {
  const d = parseApiDate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}
