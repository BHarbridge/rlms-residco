export function fmtUsd(n: number | null | undefined, opts?: { showZero?: boolean }): string {
  if (n == null || (!opts?.showZero && n === 0)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtPct(n: number | null | undefined, places = 2): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(places)}%`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function quarterLabel(qc: number | null | undefined): string {
  if (qc == null) return "—";
  const yr = Math.floor(qc / 10);
  const q = qc % 10;
  return `${yr} Q${q}`;
}
