/**
 * All Railcars — comprehensive read-only view of every car in the registry.
 * Shows all key fields, supports filtering/sorting, and provides a quick-glance
 * count breakdown by entity and status.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Search, ArrowUpDown, ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RailcarWithAssignment } from "@shared/schema";

type Row = RailcarWithAssignment;

// ── Shared constants (mirrored from FleetRegistry) ────────────────────────────
const ENTITY_STYLES: Record<string, { label: string; cls: string }> = {
  "Rail Partners Select": { label: "RPS",   cls: "bg-violet-500/15 text-violet-300 border-violet-500/30 font-semibold" },
  "Main":                 { label: "OWNED", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30 font-semibold" },
  "Coal":                 { label: "COAL",  cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30 font-semibold" },
};

const STATUS_BADGE: Record<string, string> = {
  "Active/In-Service": "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  "Storage":           "bg-amber-500/15 text-amber-400 border-amber-500/25",
  "Bad Order":         "bg-red-500/15 text-red-400 border-red-500/25",
  "Off-Lease":         "bg-sky-500/15 text-sky-400 border-sky-500/25",
  "Retired":           "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
  "Scrapped":          "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
};

const STATUS_OPTIONS = [
  "Active/In-Service",
  "Storage",
  "Bad Order",
  "Off-Lease",
  "Retired",
  "Scrapped",
];

function EntityBadge({ entity }: { entity: string | null | undefined }) {
  if (!entity) return null;
  const s = ENTITY_STYLES[entity] ?? { label: entity, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide", s.cls)}>
      {s.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const cls = STATUS_BADGE[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", cls)}>
      {status}
    </span>
  );
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

// ── Sort ──────────────────────────────────────────────────────────────────────
type SortKey = "car_number" | "entity" | "status" | "car_type" | "fleet" | "rider" | "lease" | "expiration";

function Th({ label, k, sort, onClick }: {
  label: string; k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onClick: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onClick(k)}
      className={cn("px-3 py-3 font-medium text-[10px] uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:text-foreground", active && "text-foreground")}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn("h-3 w-3", active ? "opacity-100" : "opacity-30")} />
      </span>
    </th>
  );
}

// ── Detail slide-over (read-only quick view) ──────────────────────────────────
function CarQuickView({ car, onClose }: { car: Row | null; onClose: () => void }) {
  if (!car) return null;
  const r = car as any;

  function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
      <div className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
        <span className="text-[11px] text-muted-foreground w-36 shrink-0 pt-0.5">{label}</span>
        <span className="text-sm text-foreground">{value || "—"}</span>
      </div>
    );
  }

  return (
    <Sheet open={!!car} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Railcar</span>
            <EntityBadge entity={r.entity} />
          </div>
          <SheetTitle className="font-mono">{car.car_number}</SheetTitle>
          <SheetDescription>
            {car.reporting_marks ?? "—"} · {car.car_type ?? "—"}
            {r.mechanical_designation ? ` · ${r.mechanical_designation}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-0">
          {/* Identity */}
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 mt-4">Identity</p>
          <DetailRow label="Car Number"         value={<span className="font-mono">{car.car_number}</span>} />
          <DetailRow label="Reporting Marks"    value={<span className="font-mono">{car.reporting_marks}</span>} />
          <DetailRow label="Car Initial"        value={<span className="font-mono">{r.car_initial}</span>} />
          <DetailRow label="Car Type"           value={car.car_type} />
          <DetailRow label="Mech. Designation"  value={r.mechanical_designation} />
          <DetailRow label="General Desc."      value={r.general_description} />

          {/* Ownership */}
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 mt-4">Ownership</p>
          <DetailRow label="Entity"    value={<EntityBadge entity={r.entity} />} />
          <DetailRow label="Status"    value={<StatusBadge status={car.status} />} />
          <DetailRow label="Lease Type"       value={r.lease_type} />
          <DetailRow label="Managed By"       value={r.managed} />
          <DetailRow label="Managed Category" value={r.managed_category} />
          <DetailRow label="Lining Material"  value={r.lining_material} />

          {/* Assignment */}
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 mt-4">Assignment</p>
          <DetailRow label="Lessee"   value={car.assignment?.fleet_name} />
          <DetailRow label="Rider"   value={car.assignment?.rider?.rider_name} />
          <DetailRow label="Lease"   value={car.assignment?.rider?.master_lease?.lease_number} />
          <DetailRow label="Expires" value={fmtDate(car.assignment?.rider?.expiration_date)} />

          {/* Prior marks */}
          {(r.old_car_initial || r.old_car_number) && (
            <>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 mt-4">Prior Reporting Marks</p>
              <DetailRow label="Prior Initial" value={<span className="font-mono">{r.old_car_initial}</span>} />
              <DetailRow label="Prior Number"  value={<span className="font-mono">{r.old_car_number}</span>} />
            </>
          )}

          {/* Notes */}
          {car.notes && (
            <>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 mt-4">Notes</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{car.notes}</p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Summary strip ─────────────────────────────────────────────────────────────
function SummaryStrip({ rows }: { rows: Row[] }) {
  const byEntity = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const e = (r as any).entity ?? "Unknown";
      m.set(e, (m.get(e) ?? 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const s = r.status ?? "Unknown";
      m.set(s, (m.get(s) ?? 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div className="flex flex-wrap gap-4 px-6 py-3 rounded-lg border border-card-border bg-card text-xs">
      <div className="flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-semibold tabular-nums text-foreground">{rows.length}</span>
        <span className="text-muted-foreground">cars shown</span>
      </div>
      <div className="w-px bg-border" />
      {byEntity.map(([e, n]) => {
        const s = ENTITY_STYLES[e];
        return (
          <div key={e} className="flex items-center gap-1.5">
            {s ? (
              <span className={cn("text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border", s.cls)}>{s.label}</span>
            ) : (
              <span className="text-muted-foreground">{e}</span>
            )}
            <span className="tabular-nums font-semibold text-foreground">{n}</span>
          </div>
        );
      })}
      <div className="w-px bg-border" />
      {byStatus.map(([s, n]) => {
        const cls = STATUS_BADGE[s] ?? "bg-muted text-muted-foreground border-border";
        return (
          <div key={s} className="flex items-center gap-1.5">
            <span className={cn("text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border", cls)}>{s}</span>
            <span className="tabular-nums font-semibold text-foreground">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AllCars() {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [assignFilter, setAssignFilter] = useState("all"); // all | assigned | unassigned
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "car_number", dir: "asc" });
  const [openCar, setOpenCar] = useState<Row | null>(null);

  const { data: railcars, isLoading } = useQuery<Row[]>({ queryKey: ["/api/railcars"] });

  const filtered = useMemo(() => {
    let rows = railcars ?? [];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.car_number.toLowerCase().includes(q) ||
        r.reporting_marks?.toLowerCase().includes(q) ||
        (r as any).car_initial?.toLowerCase().includes(q) ||
        r.car_type?.toLowerCase().includes(q) ||
        (r as any).mechanical_designation?.toLowerCase().includes(q) ||
        (r as any).general_description?.toLowerCase().includes(q) ||
        (r as any).entity?.toLowerCase().includes(q) ||
        (r as any).managed?.toLowerCase().includes(q) ||
        (r as any).lining_material?.toLowerCase().includes(q) ||
        r.assignment?.fleet_name?.toLowerCase().includes(q) ||
        r.assignment?.rider?.rider_name?.toLowerCase().includes(q) ||
        r.assignment?.rider?.master_lease?.lease_number?.toLowerCase().includes(q)
      );
    }
    if (entityFilter !== "all") rows = rows.filter((r) => (r as any).entity === entityFilter);
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (assignFilter === "assigned")   rows = rows.filter((r) => !!r.assignment);
    if (assignFilter === "unassigned") rows = rows.filter((r) => !r.assignment);

    const getKey = (r: Row): string => {
      switch (sort.key) {
        case "car_number":  return r.car_number;
        case "entity":      return (r as any).entity ?? "";
        case "status":      return r.status ?? "";
        case "car_type":    return r.car_type ?? "";
        case "fleet":       return r.assignment?.fleet_name ?? "";
        case "rider":       return r.assignment?.rider?.rider_name ?? "";
        case "lease":       return r.assignment?.rider?.master_lease?.lease_number ?? "";
        case "expiration":  return r.assignment?.rider?.expiration_date ?? "";
      }
    };
    return [...rows].sort((a, b) => {
      const av = getKey(a), bv = getKey(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [railcars, search, entityFilter, statusFilter, assignFilter, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });

  return (
    <div>
      <PageHeader
        title="All Railcars"
        subtitle="Complete registry — every car, every field, every assignment"
      />

      <div className="px-8 py-6 space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search car #, marks, type, lessee, entity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-all-cars"
            />
          </div>

          {/* Entity */}
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All ownership" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ownership</SelectItem>
              <SelectItem value="Main">RESIDCO Owned</SelectItem>
              <SelectItem value="Rail Partners Select">Rail Partners Select (RPS)</SelectItem>
              <SelectItem value="Coal">Coal</SelectItem>
            </SelectContent>
          </Select>

          {/* Status */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Assignment */}
          <Select value={assignFilter} onValueChange={setAssignFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All cars" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cars</SelectItem>
              <SelectItem value="assigned">Assigned only</SelectItem>
              <SelectItem value="unassigned">Unassigned only</SelectItem>
            </SelectContent>
          </Select>

          <div className="text-xs text-muted-foreground ml-auto font-mono">
            {filtered.length} / {railcars?.length ?? 0} cars
          </div>
        </div>

        {/* Summary strip */}
        {!isLoading && filtered.length > 0 && <SummaryStrip rows={filtered} />}

        {/* Table */}
        <div className="rounded-lg border border-card-border bg-card overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
                <tr className="text-left">
                  <Th label="Entity"    k="entity"     sort={sort} onClick={toggleSort} />
                  <Th label="Car #"     k="car_number" sort={sort} onClick={toggleSort} />
                  <th className="px-3 py-3 font-medium text-[10px] uppercase tracking-wider whitespace-nowrap">Initial</th>
                  <th className="px-3 py-3 font-medium text-[10px] uppercase tracking-wider whitespace-nowrap">Marks</th>
                  <Th label="Type"      k="car_type"   sort={sort} onClick={toggleSort} />
                  <th className="px-3 py-3 font-medium text-[10px] uppercase tracking-wider whitespace-nowrap">Mech.</th>
                  <th className="px-3 py-3 font-medium text-[10px] uppercase tracking-wider whitespace-nowrap">Description</th>
                  <Th label="Status"    k="status"     sort={sort} onClick={toggleSort} />
                  <th className="px-3 py-3 font-medium text-[10px] uppercase tracking-wider whitespace-nowrap">Lease Type</th>
                  <th className="px-3 py-3 font-medium text-[10px] uppercase tracking-wider whitespace-nowrap">Managed</th>
                  <Th label="Lessee"     k="fleet"      sort={sort} onClick={toggleSort} />
                  <Th label="Rider"     k="rider"      sort={sort} onClick={toggleSort} />
                  <Th label="Lease #"   k="lease"      sort={sort} onClick={toggleSort} />
                  <Th label="Expires"   k="expiration" sort={sort} onClick={toggleSort} />
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 12 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      {Array.from({ length: 15 }).map((__, j) => (
                        <td key={j} className="px-3 py-2.5">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="px-4 py-16 text-center text-muted-foreground">
                      No railcars match these filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const ra = r as any;
                    return (
                      <tr
                        key={r.id}
                        className="border-t border-border hover:bg-muted/20 cursor-pointer"
                        onClick={() => setOpenCar(r)}
                        data-testid={`all-cars-row-${r.id}`}
                      >
                        <td className="px-3 py-2.5">
                          <EntityBadge entity={ra.entity} />
                        </td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-foreground whitespace-nowrap">
                          {r.car_number}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground text-xs">
                          {ra.car_initial ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground text-xs">
                          {r.reporting_marks ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {r.car_type ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs">
                          {ra.mechanical_designation ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-[180px] truncate">
                          {ra.general_description ?? "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-1">
                            <StatusBadge status={r.status} />
                            {(r as any).sold_to && (
                              <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30 w-fit">
                                SOLD
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                          {ra.lease_type ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                          {ra.managed ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {r.assignment?.fleet_name ?? <span className="text-muted-foreground italic text-xs">Unassigned</span>}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs">
                          {r.assignment?.rider?.rider_name ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground text-xs">
                          {r.assignment?.rider?.master_lease?.lease_number ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground text-xs whitespace-nowrap">
                          {fmtDate(r.assignment?.rider?.expiration_date)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          <ChevronRight className="h-3.5 w-3.5" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Quick-view slide-over */}
      <CarQuickView car={openCar} onClose={() => setOpenCar(null)} />
    </div>
  );
}
