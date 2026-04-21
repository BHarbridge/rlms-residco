import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Train,
  Link as LinkIcon,
  CircleDashed,
  AlertTriangle,
  FileText,
  Gauge,
  ChevronRight,
  X,
  Building2,
  CalendarClock,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type CarRow = {
  id: number;
  car_number: string;
  reporting_marks: string | null;
  car_type: string | null;
  status: string | null;
  entity: string | null;
  fleet_name: string | null;
  rider_name: string | null;
  lease_number: string | null;
  lessee: string | null;
};

type RiderRow = {
  id: number;
  rider_name: string;
  schedule_number: string | null;
  expiration_date: string | null;
  lease_number: string | null;
  car_count: number;
};

type FleetDetail = {
  fleet_name: string;
  count: number;
  lease_number: string | null;
  lessor: string | null;
  lessee: string | null;
  rider_name: string | null;
  schedule_number: string | null;
  expiration_date: string | null;
  cars: { id: number; car_number: string; reporting_marks: string | null; car_type: string | null; status: string | null; entity: string | null }[];
};

type DashboardData = {
  kpis: {
    total_fleet: number;
    active_assignments: number;
    unassigned_cars: number;
    expiring_12mo: number;
    expiring_6mo: number;
    riders_count: number;
    utilization_pct: number;
    rps_total: number;
    rps_assigned: number;
    rps_util_pct: number;
    owned_total: number;
    owned_assigned: number;
    owned_util_pct: number;
  };
  detail: {
    all_cars: CarRow[];
    assigned_cars: CarRow[];
    unassigned_cars: CarRow[];
    expiring_riders: RiderRow[];
    riders: RiderRow[];
  };
  cars_by_fleet: FleetDetail[];
  expiration_timeline: {
    rider_id: number;
    rider_name: string;
    schedule_number: string | null;
    expiration_date: string | null;
    lease_number: string | null;
    car_count: number;
  }[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function monthsUntil(date: string | null) {
  if (!date) return Infinity;
  const d = new Date(date).getTime();
  const now = Date.now();
  return (d - now) / (1000 * 60 * 60 * 24 * 30.4);
}

function expiryTone(months: number) {
  if (!isFinite(months)) return { label: "—", cls: "text-muted-foreground", dot: "bg-muted-foreground" };
  if (months < 6)  return { label: `${months.toFixed(1)}mo`, cls: "text-[hsl(var(--error))]",   dot: "bg-[hsl(var(--error))]" };
  if (months < 12) return { label: `${months.toFixed(1)}mo`, cls: "text-[hsl(var(--warning))]", dot: "bg-[hsl(var(--warning))]" };
  return              { label: `${months.toFixed(1)}mo`, cls: "text-[hsl(var(--success))]", dot: "bg-[hsl(var(--success))]" };
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

// Entity badge (matches Fleet Registry)
const ENTITY_STYLES: Record<string, { label: string; cls: string }> = {
  "Rail Partners Select": { label: "RPS",   cls: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  "Main":                 { label: "OWNED", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  "Coal":                 { label: "COAL",  cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
};
function EntityBadge({ entity }: { entity: string | null | undefined }) {
  if (!entity) return null;
  const s = ENTITY_STYLES[entity] ?? { label: entity, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn("text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border", s.cls)}>
      {s.label}
    </span>
  );
}

const STATUS_BADGE: Record<string, string> = {
  "Active/In-Service": "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  "Storage":           "bg-amber-500/15 text-amber-400 border-amber-500/25",
  "Bad Order":         "bg-red-500/15 text-red-400 border-red-500/25",
  "Off-Lease":         "bg-sky-500/15 text-sky-400 border-sky-500/25",
  "Retired":           "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
  "Scrapped":          "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
};
function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const cls = STATUS_BADGE[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("text-[9px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded-full border", cls)}>
      {status}
    </span>
  );
}

// ── Fleet drill-down drawer ───────────────────────────────────────────────────
function FleetDrawer({ fleet, onClose }: { fleet: FleetDetail | null; onClose: () => void }) {
  if (!fleet) return null;
  const months = monthsUntil(fleet.expiration_date);
  const tone = expiryTone(months);

  // Download fleet car list as CSV
  const downloadCsv = () => {
    const rows = [
      ["car_number", "reporting_marks", "car_type", "status", "entity", "lessee_name", "rider", "lease", "lessee"],
      ...fleet.cars.map(c => [
        c.car_number, c.reporting_marks ?? "", c.car_type ?? "", c.status ?? "", c.entity ?? "",
        fleet.fleet_name, fleet.rider_name ?? "", fleet.lease_number ?? "", fleet.lessee ?? "",
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `lessee_${fleet.fleet_name.replace(/\s+/g, "_")}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={!!fleet} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[560px] sm:max-w-[560px] flex flex-col overflow-hidden p-0">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <SheetTitle className="text-base">{fleet.fleet_name}</SheetTitle>
          <SheetDescription className="text-xs">{fleet.count} car{fleet.count !== 1 ? "s" : ""} in this lessee</SheetDescription>

          {/* MLA + Rider summary cards */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {/* MLA card */}
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                <FileText className="h-3 w-3" /> Master Lease
              </div>
              <div className="font-mono font-semibold text-sm text-foreground">{fleet.lease_number ?? "—"}</div>
              {fleet.lessor && <div className="text-[11px] text-muted-foreground mt-0.5">{fleet.lessor} <span className="opacity-60">(lessor)</span></div>}
              {fleet.lessee && <div className="text-[11px] text-muted-foreground">{fleet.lessee} <span className="opacity-60">(lessee)</span></div>}
            </div>
            {/* Rider card */}
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                <Building2 className="h-3 w-3" /> Rider
              </div>
              <div className="font-medium text-sm text-foreground truncate">{fleet.rider_name ?? "—"}</div>
              {fleet.schedule_number && <div className="text-[11px] text-muted-foreground mt-0.5">Schedule {fleet.schedule_number}</div>}
              {fleet.expiration_date && (
                <div className={cn("text-[11px] font-mono-num mt-0.5 flex items-center gap-1", tone.cls)}>
                  <CalendarClock className="h-2.5 w-2.5" />
                  {formatDate(fleet.expiration_date)} · {tone.label}
                </div>
              )}
            </div>
          </div>
        </SheetHeader>

        {/* Car list */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border/50 flex items-center justify-between">
            <span><span className="font-mono-num">{fleet.cars.length}</span> cars</span>
            <button
              onClick={downloadCsv}
              className="text-primary hover:underline text-[10px] uppercase tracking-wider font-medium"
            >
              ↓ Download CSV
            </button>
          </div>
          {fleet.cars.length === 0 ? (
            <div className="px-6 py-16 text-center text-muted-foreground text-sm">No cars.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Car #</th>
                  <th className="px-4 py-2 text-left font-medium">Marks</th>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-left font-medium">Entity</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {fleet.cars.map((c) => (
                  <tr key={c.id} className="border-t border-border/40 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono font-semibold text-foreground">{c.car_number}</td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono">{c.reporting_marks ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.car_type ?? "—"}</td>
                    <td className="px-4 py-2.5"><EntityBadge entity={c.entity} /></td>
                    <td className="px-4 py-2.5"><StatusPill status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── KPI drill-down drawer ─────────────────────────────────────────────────────
type DrillKey = "total_fleet" | "active_assignments" | "unassigned_cars" | "expiring_12mo" | "riders_count" | "utilization_pct" | null;

function DrillDownDrawer({
  drillKey,
  data,
  onClose,
}: {
  drillKey: DrillKey;
  data: DashboardData | undefined;
  onClose: () => void;
}) {
  const open = !!drillKey && !!data;

  const config: Record<NonNullable<DrillKey>, { title: string; description: string }> = {
    total_fleet:        { title: "Total Fleet",          description: "All railcars currently in the RESIDCO registry" },
    active_assignments: { title: "Active Assignments",   description: "Cars currently assigned to a rider / lessee" },
    unassigned_cars:    { title: "Unassigned Cars",      description: "Cars in the registry with no active assignment — available for new leases" },
    expiring_12mo:      { title: "Expiring Riders (<12 months)", description: "Riders whose lease term ends within the next 12 months" },
    riders_count:       { title: "All Riders",           description: "Every rider currently in the system" },
    utilization_pct:    { title: "Fleet Utilization",    description: "Cars on active assignment vs. total fleet" },
  };

  const info = drillKey ? config[drillKey] : null;

  // Determine what list to render
  const isCars   = drillKey === "total_fleet" || drillKey === "active_assignments" || drillKey === "unassigned_cars" || drillKey === "utilization_pct";
  const isRiders = drillKey === "expiring_12mo" || drillKey === "riders_count";

  const cars: CarRow[] = (() => {
    if (!data) return [];
    if (drillKey === "total_fleet")        return data.detail.all_cars;
    if (drillKey === "active_assignments") return data.detail.assigned_cars;
    if (drillKey === "unassigned_cars")    return data.detail.unassigned_cars;
    if (drillKey === "utilization_pct")    return data.detail.unassigned_cars; // show what's NOT utilized
    return [];
  })();

  const riders: RiderRow[] = (() => {
    if (!data) return [];
    if (drillKey === "expiring_12mo") return data.detail.expiring_riders;
    if (drillKey === "riders_count")  return data.detail.riders;
    return [];
  })();

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[520px] sm:max-w-[520px] flex flex-col overflow-hidden p-0">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <SheetTitle className="text-base">{info?.title}</SheetTitle>
          <SheetDescription className="text-xs">{info?.description}</SheetDescription>
          {/* Utilization summary bar */}
          {drillKey === "utilization_pct" && data && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{data.kpis.active_assignments} assigned</span>
                <span className="font-semibold text-foreground">{data.kpis.utilization_pct}%</span>
                <span>{data.kpis.unassigned_cars} off-lease</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${data.kpis.utilization_pct}%` }}
                />
              </div>
            </div>
          )}
        </SheetHeader>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto">
          {isCars && (
            <>
              <div className="px-6 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border/50 flex items-center gap-2">
                <span className="font-mono-num">{cars.length}</span> cars
                {drillKey === "utilization_pct" && <span className="ml-1 text-muted-foreground">— showing unassigned (off-lease)</span>}
              </div>
              {cars.length === 0 ? (
                <div className="px-6 py-16 text-center text-muted-foreground text-sm">No cars in this group.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Car #</th>
                      <th className="px-4 py-2 text-left font-medium">Marks</th>
                      <th className="px-4 py-2 text-left font-medium">Entity</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-left font-medium">Lessee / Rider</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cars.map((c) => (
                      <tr key={c.id} className="border-t border-border/40 hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-mono font-semibold text-foreground">{c.car_number}</td>
                        <td className="px-4 py-2.5 text-muted-foreground font-mono">{c.reporting_marks ?? "—"}</td>
                        <td className="px-4 py-2.5"><EntityBadge entity={c.entity} /></td>
                        <td className="px-4 py-2.5"><StatusPill status={c.status} /></td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-foreground">{c.fleet_name ?? <span className="text-muted-foreground italic">Unassigned</span>}</div>
                          {c.rider_name && <div className="text-[10px] text-muted-foreground">{c.rider_name}</div>}
                          {c.lessee && <div className="text-[10px] text-muted-foreground truncate">{c.lessee}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {isRiders && (
            <>
              <div className="px-6 py-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border/50">
                <span className="font-mono-num">{riders.length}</span> riders
              </div>
              {riders.length === 0 ? (
                <div className="px-6 py-16 text-center text-muted-foreground text-sm">No riders in this group.</div>
              ) : (
                <div className="divide-y divide-border/40">
                  {riders.map((r) => {
                    const months = monthsUntil(r.expiration_date);
                    const tone = expiryTone(months);
                    return (
                      <div key={r.id} className="px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-muted/20">
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-foreground truncate">{r.rider_name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono-num mt-0.5">
                            {r.lease_number ?? "—"} · {r.car_count} car{r.car_count !== 1 ? "s" : ""}
                            {r.schedule_number && ` · Sch ${r.schedule_number}`}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-mono-num">{formatDate(r.expiration_date)}</div>
                          <div className={cn("text-[11px] font-mono-num", tone.cls)}>{tone.label}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
  testId,
  onClick,
  subtext,
}: {
  label: string;
  value: number | string;
  icon: any;
  accent?: "primary" | "warning" | "error" | "success" | "muted";
  testId: string;
  onClick?: () => void;
  subtext?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-lg border border-card-border bg-card p-5 flex flex-col gap-3 text-left w-full transition-all",
        onClick && "cursor-pointer hover:border-primary/40 hover:bg-card/80 hover:shadow-sm group"
      )}
      onClick={onClick}
      data-testid={testId}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <Icon
            className={cn(
              "h-4 w-4",
              accent === "primary" && "text-primary",
              accent === "warning" && "text-[hsl(var(--warning))]",
              accent === "error" && "text-[hsl(var(--error))]",
              accent === "success" && "text-[hsl(var(--success))]",
              (!accent || accent === "muted") && "text-muted-foreground"
            )}
          />
          {onClick && (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </div>
      <div className="text-3xl font-semibold tabular-nums font-mono-num">
        {value}
      </div>
      {subtext && (
        <div className="text-[11px] text-muted-foreground -mt-1">{subtext}</div>
      )}
    </button>
  );
}

// ── Utilization Ring ──────────────────────────────────────────────────────────
function UtilRing({ pct }: { pct: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const stroke = circ * (1 - pct / 100);
  const color = pct >= 90 ? "hsl(var(--success))" : pct >= 70 ? "hsl(var(--warning))" : "hsl(var(--error))";
  return (
    <svg width="48" height="48" viewBox="0 0 44 44" className="shrink-0">
      <circle cx="22" cy="22" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
      <circle
        cx="22" cy="22" r={r} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={stroke}
        strokeLinecap="round"
        transform="rotate(-90 22 22)"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text x="22" y="22" textAnchor="middle" dominantBaseline="central" fontSize="9" fill="currentColor" className="font-semibold">
        {pct}%
      </text>
    </svg>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
  });

  const [drillKey, setDrillKey] = useState<DrillKey>(null);
  const [selectedFleet, setSelectedFleet] = useState<FleetDetail | null>(null);

  const maxFleet = Math.max(1, ...(data?.cars_by_fleet.map((f) => f.count) ?? [0]));
  const utilPct = data?.kpis.utilization_pct ?? 0;
  const [, navigate] = useLocation();

  return (
    <div>
      <PageHeader
        title="Operations Dashboard"
        subtitle="Real-time view of the RESIDCO railcar fleet and active leases"
      />

      <div className="px-8 py-7 space-y-7">
        {/* KPIs */}
<div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[110px] rounded-lg" />
            ))
          ) : data ? (
            <>
              <KpiCard
                testId="kpi-total-fleet"
                label="Total Fleet"
                value={data.kpis.total_fleet}
                icon={Train}
                accent="primary"
                onClick={() => navigate("/fleet?filter=all")}
              />
              <KpiCard
                testId="kpi-active-assignments"
                label="Active Assignments"
                value={data.kpis.active_assignments}
                icon={LinkIcon}
                onClick={() => navigate("/fleet?filter=assigned")}
              />
              <KpiCard
                testId="kpi-unassigned"
                label="Unassigned Cars"
                value={data.kpis.unassigned_cars}
                icon={CircleDashed}
                onClick={() => navigate("/fleet?filter=unassigned")}
              />
              {/* Utilization — special card with ring */}
              <button
                type="button"
                className="rounded-lg border border-card-border bg-card p-5 flex flex-col gap-2 text-left w-full cursor-pointer hover:border-primary/40 hover:bg-card/80 hover:shadow-sm group transition-all"
                onClick={() => setDrillKey("utilization_pct")}
                data-testid="kpi-utilization"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Fleet Utilization</span>
                  <div className="flex items-center gap-1.5">
                    <Gauge className={cn("h-4 w-4", utilPct >= 90 ? "text-[hsl(var(--success))]" : utilPct >= 70 ? "text-[hsl(var(--warning))]" : "text-[hsl(var(--error))]")} />
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <UtilRing pct={utilPct} />
                  <div>
                    <div className="text-3xl font-semibold tabular-nums font-mono-num">{utilPct}%</div>
                    <div className="text-[11px] text-muted-foreground">{data.kpis.active_assignments} of {data.kpis.total_fleet} cars</div>
                  </div>
                </div>
              </button>
              <KpiCard
                testId="kpi-expiring6"
                label="Expiring <6mo"
                value={data.kpis.expiring_6mo}
                icon={AlertTriangle}
                accent="error"
                onClick={() => navigate("/leases?filter=expiring6")}
              />
              <KpiCard
                testId="kpi-expiring"
                label="Expiring <12mo"
                value={data.kpis.expiring_12mo}
                icon={AlertTriangle}
                accent="warning"
                onClick={() => navigate("/leases?filter=expiring")}
              />
              <KpiCard
                testId="kpi-riders"
                label="Active Riders"
                value={data.kpis.riders_count}
                icon={FileText}
                onClick={() => navigate("/leases?filter=riders")}
              />
            </>
          ) : null}
        </div>

        {/* Entity Utilization: RPS vs Owned */}
        {data && (
          <section className="rounded-lg border border-card-border bg-card">
            <header className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Fleet Utilization by Entity</h2>
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">RPS vs Owned</span>
            </header>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* RPS */}
              <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border bg-violet-500/15 text-violet-300 border-violet-500/30">RPS</span>
                    <span className="text-xs text-muted-foreground ml-2">Rail Partners Select</span>
                  </div>
                  <span className="text-xl font-semibold tabular-nums font-mono-num text-violet-300">{data.kpis.rps_util_pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
                  <div className="h-full bg-violet-500 transition-all" style={{ width: `${data.kpis.rps_util_pct}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{data.kpis.rps_assigned} assigned</span>
                  <span>{data.kpis.rps_total - data.kpis.rps_assigned} off-lease</span>
                  <span className="font-mono-num">{data.kpis.rps_total} total</span>
                </div>
              </div>
              {/* Owned */}
              <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border bg-sky-500/15 text-sky-300 border-sky-500/30">OWNED</span>
                    <span className="text-xs text-muted-foreground ml-2">RESIDCO Fleet</span>
                  </div>
                  <span className="text-xl font-semibold tabular-nums font-mono-num text-sky-300">{data.kpis.owned_util_pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
                  <div className="h-full bg-sky-500 transition-all" style={{ width: `${data.kpis.owned_util_pct}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{data.kpis.owned_assigned} assigned</span>
                  <span>{data.kpis.owned_total - data.kpis.owned_assigned} off-lease</span>
                  <span className="font-mono-num">{data.kpis.owned_total} total</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Two panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Cars by Fleet */}
          <section className="rounded-lg border border-card-border bg-card">
            <header className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Cars by Lessee</h2>
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {data?.cars_by_fleet.length ?? 0} lessees
              </span>
            </header>
            <div className="p-5 space-y-2.5 max-h-[480px] overflow-auto">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 rounded" />
                ))
              ) : data && data.cars_by_fleet.length > 0 ? (
                data.cars_by_fleet.map((f) => (
                  <button
                    key={f.fleet_name}
                    className="w-full text-left space-y-1 group cursor-pointer"
                    onClick={() => setSelectedFleet(f)}
                    data-testid={`fleet-name-${f.fleet_name}`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate font-medium group-hover:text-primary transition-colors flex items-center gap-1">
                        {f.fleet_name}
                        <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </span>
                      <span className="font-mono-num text-muted-foreground">{f.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary group-hover:bg-primary/80 transition-colors" style={{ width: `${(f.count / maxFleet) * 100}%` }} />
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-sm text-muted-foreground py-10 text-center">No lessee assignments yet.</div>
              )}
            </div>
          </section>

          {/* Lease Expiration Timeline */}
          <section className="rounded-lg border border-card-border bg-card">
            <header className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">Lease Expiration Timeline</h2>
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--error))]" />&lt;6mo</span>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--warning))]" />&lt;12mo</span>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))]" />&gt;12mo</span>
              </div>
            </header>
            <div className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="px-5 py-4"><Skeleton className="h-10 rounded" /></div>
                ))
              ) : (
                data?.expiration_timeline.map((r) => {
                  const months = monthsUntil(r.expiration_date);
                  const tone = expiryTone(months);
                  return (
                    <a
                      key={r.rider_id}
                      href={`/leases?rider=${r.rider_id}`}
                      className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-muted/40 transition-colors cursor-pointer group"
                      data-testid={`rider-timeline-${r.rider_id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", tone.dot)} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{r.rider_name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono-num">
                            {r.lease_number ?? "—"} · {r.car_count} cars
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono-num">{formatDate(r.expiration_date)}</div>
                        <div className={cn("text-[11px] font-mono-num", tone.cls)}>{tone.label}</div>
                      </div>
                    </a>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>

      {/* KPI drill-down drawer */}
      <DrillDownDrawer drillKey={drillKey} data={data} onClose={() => setDrillKey(null)} />

      {/* Fleet drill-down drawer */}
      <FleetDrawer fleet={selectedFleet} onClose={() => setSelectedFleet(null)} />
    </div>
  );
}
