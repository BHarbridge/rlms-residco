import { useMemo, useState, useCallback, useEffect } from "react";
import { useCanEdit } from "@/lib/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, Trash2, Pencil, ArrowUpDown, ChevronRight, Wrench, Hash, CheckSquare, Square, X as XIcon, ChevronDown, Download, Columns3 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RailcarWithAssignment } from "@shared/schema";
import AttachmentsPanel from "@/components/AttachmentsPanel";

type Row = RailcarWithAssignment;

const TRANSIT_STATUSES = [
  { value: "repair", label: "At Repair Shop", color: "bg-orange-500/15 text-orange-400 border-orange-500/25" },
  { value: "transit", label: "In Transit", color: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  { value: "cleaning", label: "Cleaning / Prep", color: "bg-purple-500/15 text-purple-400 border-purple-500/25" },
  { value: "bad_order", label: "Bad Order", color: "bg-red-500/15 text-red-400 border-red-500/25" },
] as const;

// Entity ownership badge
const ENTITY_STYLES: Record<string, { label: string; cls: string }> = {
  "Rail Partners Select": { label: "RPS",   cls: "bg-violet-500/15 text-violet-300 border-violet-500/30 font-semibold" },
  "Main":                 { label: "Owned", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30 font-semibold" },
};

// Fixed status options for the filter dropdown
const STATUS_OPTIONS = [
  { value: "Active/In-Service", label: "Active / In-Service" },
  { value: "Storage",           label: "Storage" },
  { value: "Bad Order",         label: "Bad Order" },
  { value: "Off-Lease",         label: "Off-Lease" },
  { value: "Retired",           label: "Retired" },
  { value: "Scrapped",          label: "Scrapped" },
];

function EntityBadge({ entity, size = "sm" }: { entity: string | null | undefined; size?: "sm" | "lg" }) {
  if (!entity) return null;
  const style = ENTITY_STYLES[entity] ?? { label: entity, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 tracking-wide uppercase",
      size === "lg" ? "text-[11px] px-2 py-1" : "text-[10px]",
      style.cls
    )}>
      {style.label}
    </span>
  );
}

function TransitBadge({ status, label }: { status: string | null; label: string | null }) {
  if (!status) return null;
  const ts = TRANSIT_STATUSES.find((t) => t.value === status);
  const color = ts?.color ?? "bg-muted text-muted-foreground border-border";
  const text = ts?.label ?? status;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium", color)}>
      <Wrench className="h-2.5 w-2.5" />
      {text}{label ? ` · ${label}` : ""}
    </span>
  );
}

type SortKey =
  | "car_number"
  | "status"
  | "fleet"
  | "rider"
  | "lease"
  | "expiration";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

const STATUS_BADGE_MAP: Record<string, string> = {
  "Active/In-Service": "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  "Storage":           "bg-amber-500/15 text-amber-400 border-amber-500/25",
  "Bad Order":         "bg-red-500/15 text-red-400 border-red-500/25",
  "Off-Lease":         "bg-sky-500/15 text-sky-400 border-sky-500/25",
  "Retired":           "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
  "Scrapped":          "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const cls = STATUS_BADGE_MAP[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        cls
      )}
    >
      {status}
    </span>
  );
}

function downloadRailcarsCsv(rows: RailcarWithAssignment[]) {
  const headers = [
    "Entity", "Car Number", "Reporting Marks", "Car Type", "Mechanical Designation",
    "General Description", "Status", "Lease Type", "Managed Category",
    "Transit Status", "Transit Label",
    "Lessee", "Rider Name", "Schedule #", "MLA Lease #", "Lessor",
    "Expiration Date", "Monthly Rent",
    "NBV", "OAC", "OEC",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows_data = rows.map((r) => [
    r.entity ?? "",
    r.car_number,
    r.reporting_marks ?? "",
    r.car_type ?? "",
    r.mechanical_designation ?? "",
    r.general_description ?? "",
    r.status ?? "",
    r.lease_type ?? "",
    r.managed_category ?? "",
    r.transit_status ?? "",
    r.transit_label ?? "",
    r.assignment?.fleet_name ?? "",
    r.assignment?.rider?.rider_name ?? "",
    r.assignment?.rider?.schedule_number ?? "",
    r.assignment?.rider?.master_lease?.lease_number ?? "",
    r.assignment?.rider?.master_lease?.lessor ?? "",
    r.assignment?.rider?.expiration_date ?? "",
    r.assignment?.rider?.monthly_rent != null ? String(r.assignment.rider.monthly_rent) : "",
    (r as any).nbv != null ? String((r as any).nbv) : "",
    (r as any).oac != null ? String((r as any).oac) : "",
    (r as any).oec != null ? String((r as any).oec) : "",
  ].map(escape).join(","));
  const csv = [headers.map(escape).join(","), ...rows_data].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `railcars-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FleetRegistry() {
  const canEdit = useCanEdit();
  // Deep-link: ?filter=unassigned | assigned | offrent | all
  const initAssigned = typeof window !== "undefined"
    ? (() => { const f = new URLSearchParams(window.location.search).get("filter"); return f === "unassigned" ? "unassigned" : f === "assigned" ? "assigned" : f === "offrent" ? "offrent" : "all"; })()
    : "all";

  const [search, setSearch] = useState("");
  const [assignedFilter, setAssignedFilter] = useState<string>(initAssigned);
  const [riderFilter, setRiderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "car_number",
    dir: "asc",
  });
  const [openCarId, setOpenCarId] = useState<number | null>(null);
  const [editCar, setEditCar] = useState<Row | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [transitFilter, setTransitFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatusPending, setBulkStatusPending] = useState(false);
  const [bulkRiderPending, setBulkRiderPending] = useState(false);
  const [bulkTransitPending, setBulkTransitPending] = useState(false);
  const [bulkValuesOpen, setBulkValuesOpen] = useState(false);
  const [bulkNbv, setBulkNbv] = useState("");
  const [bulkOac, setBulkOac] = useState("");
  const [bulkOec, setBulkOec] = useState("");
  const [bulkValuesPending, setBulkValuesPending] = useState(false);
  const { toast } = useToast();

  // ── Optional column visibility ─────────────────────────────────────────────
  type OptCol = "nbv" | "oac" | "oec" | "capacity_cf" | "lining" | "build_year" | "description" | "mech_designation";
  const OPT_COLS: { key: OptCol; label: string }[] = [
    { key: "nbv",           label: "NBV" },
    { key: "oac",           label: "OAC" },
    { key: "oec",           label: "OEC" },
    { key: "capacity_cf",   label: "Capacity (cf)" },
    { key: "lining",        label: "Lining" },
    { key: "build_year",    label: "Build Year" },
    { key: "description",   label: "Description" },
    { key: "mech_designation", label: "Mech Desig." },
  ];
  const [visibleCols, setVisibleCols] = useState<Set<OptCol>>(new Set());
  const toggleCol = (k: OptCol) =>
    setVisibleCols((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  const { data: railcars, isLoading } = useQuery<Row[]>({
    queryKey: ["/api/railcars"],
  });
  const { data: riders } = useQuery<any[]>({ queryKey: ["/api/riders"] });
  const { data: rentEvents } = useQuery<any[]>({ queryKey: ["/api/rent-events"] });
  // Derive set of car IDs currently off-rent (most recent event per car is off_rent)
  const offRentCarIds = useMemo(() => {
    const seen = new Map<number, string>();
    for (const ev of (rentEvents ?? []).slice().sort((a: any, b: any) => b.event_date.localeCompare(a.event_date))) {
      if (!seen.has(ev.car_id)) seen.set(ev.car_id, ev.event_type);
    }
    return new Set<number>(Array.from(seen.entries()).filter(([, t]) => t === "off_rent").map(([id]) => id));
  }, [rentEvents]);

  const filtered = useMemo(() => {
    let rows = railcars ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.car_number.toLowerCase().includes(q) ||
          r.reporting_marks?.toLowerCase().includes(q) ||
          r.assignment?.fleet_name?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (transitFilter === "in_transit") rows = rows.filter((r) => !!r.transit_status);
    if (transitFilter === "normal") rows = rows.filter((r) => !r.transit_status);
    if (entityFilter !== "all") rows = rows.filter((r) => (r as any).entity === entityFilter);
    if (assignedFilter === "unassigned") rows = rows.filter((r) => !r.assignment);
    if (assignedFilter === "assigned") rows = rows.filter((r) => !!r.assignment);
    if (assignedFilter === "offrent") rows = rows.filter((r) => offRentCarIds.has(r.id));
    if (riderFilter !== "all")
      rows = rows.filter((r) => String(r.assignment?.rider_id ?? "") === riderFilter);

    const getKey = (r: Row): string => {
      switch (sort.key) {
        case "car_number":
          return r.car_number;
        case "status":
          return r.status ?? "";
        case "fleet":
          return r.assignment?.fleet_name ?? "";
        case "rider":
          return r.assignment?.rider?.rider_name ?? "";
        case "lease":
          return r.assignment?.rider?.master_lease?.lease_number ?? "";
        case "expiration":
          return r.assignment?.rider?.expiration_date ?? "";
      }
    };
    rows = [...rows].sort((a, b) => {
      const av = getKey(a);
      const bv = getKey(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });

    return rows;
  }, [railcars, search, statusFilter, riderFilter, transitFilter, entityFilter, sort]);

  // ── Multi-select helpers ──────────────────────────────────────────────────
  const allFilteredIds = filtered.map((r) => r.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
  const someSelected = allFilteredIds.some((id) => selectedIds.has(id)) && !allSelected;

  const toggleOne = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allChecked = allFilteredIds.every((id) => prev.has(id));
      if (allChecked) {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.delete(id));
        return next;
      } else {
        return new Set([...prev, ...allFilteredIds]);
      }
    });
  }, [allFilteredIds]);

  const clearSelection = () => setSelectedIds(new Set());

  const bulkUpdateStatus = async (newStatus: string) => {
    setBulkStatusPending(true);
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(
        ids.map((id) => apiRequest("PATCH", `/api/railcars/${id}`, { status: newStatus }))
      );
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `${ids.length} car${ids.length !== 1 ? "s" : ""} updated to "${newStatus}"` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Bulk update failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkStatusPending(false);
    }
  };

  const bulkUpdateTransit = async (transitStatus: string, label: string) => {
    setBulkTransitPending(true);
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(
        ids.map((id) =>
          apiRequest("PATCH", `/api/railcars/${id}`, {
            transit_status: transitStatus === "none" ? null : transitStatus,
            transit_label: transitStatus === "none" ? null : undefined,
          })
        )
      );
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      toast({ title: `${ids.length} car${ids.length !== 1 ? "s" : ""} ${transitStatus === "none" ? "cleared" : `flagged as "${label}"`}` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Bulk transit update failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkTransitPending(false);
    }
  };

  const bulkUpdateValues = async () => {
    if (!bulkNbv.trim() && !bulkOac.trim() && !bulkOec.trim()) return;
    setBulkValuesPending(true);
    const ids = Array.from(selectedIds);
    const payload: Record<string, number> = {};
    if (bulkNbv.trim()) payload.nbv = parseFloat(bulkNbv);
    if (bulkOac.trim()) payload.oac = parseFloat(bulkOac);
    if (bulkOec.trim()) payload.oec = parseFloat(bulkOec);
    try {
      await Promise.all(ids.map((id) => apiRequest("PATCH", `/api/railcars/${id}`, payload)));
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      toast({ title: "Values updated", description: `NBV/OAC updated for ${ids.length} car${ids.length !== 1 ? "s" : ""}.` });
      setBulkValuesOpen(false);
      setBulkNbv("");
      setBulkOac("");
      setBulkOec("");
      clearSelection();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkValuesPending(false);
    }
  };

  const bulkAssignRider = async (riderId: number, riderName: string) => {
    setBulkRiderPending(true);
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(
        ids.map((id) =>
          apiRequest("POST", "/api/move", {
            car_ids: [id],
            to_rider_id: riderId,
            moved_by: "bulk-action",
            reason: "Bulk assignment from Fleet Registry",
          })
        )
      );
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/history"] });
      toast({ title: `${ids.length} car${ids.length !== 1 ? "s" : ""} moved to "${riderName}"` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Bulk move failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkRiderPending(false);
    }
  };

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );

  const openCar = filtered.find((r) => r.id === openCarId) ?? null;

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/railcars/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Railcar deleted" });
      setOpenCarId(null);
    },
    onError: (e: Error) =>
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <PageHeader
        title="Fleet Registry"
        subtitle="All railcars under management, current assignments, and lease status"
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadRailcarsCsv(filtered)}
              disabled={!railcars || filtered.length === 0}
              data-testid="button-export-railcars"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            {canEdit && (
              <Button
                size="sm"
                onClick={() => setAddOpen(true)}
                data-testid="button-add-railcar"
              >
                <Plus className="h-4 w-4" />
                Add Railcar
              </Button>
            )}
          </div>
        }
      />

      <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-4">
        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-search-railcars"
              placeholder="Search car number, marks, lessee…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="filter-status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={riderFilter} onValueChange={setRiderFilter}>
            <SelectTrigger className="w-[200px]" data-testid="filter-rider">
              <SelectValue placeholder="Rider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All riders</SelectItem>
              {(riders ?? []).map((r: any) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.rider_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Ownership" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ownership</SelectItem>
              <SelectItem value="Main">Owned</SelectItem>
              <SelectItem value="Rail Partners Select">RPS</SelectItem>
            </SelectContent>
          </Select>
          <Select value={transitFilter} onValueChange={setTransitFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Transit Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cars</SelectItem>
              <SelectItem value="in_transit">In transit / repair</SelectItem>
              <SelectItem value="normal">Normal service</SelectItem>
            </SelectContent>
          </Select>
          <Select value={assignedFilter} onValueChange={setAssignedFilter}>
            <SelectTrigger className="w-[170px]" data-testid="filter-assigned">
              <SelectValue placeholder="Assignment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cars</SelectItem>
              <SelectItem value="assigned">Assigned only</SelectItem>
              <SelectItem value="unassigned">Unassigned only</SelectItem>
              <SelectItem value="offrent">Off Rent</SelectItem>
            </SelectContent>
          </Select>
          {/* Column visibility picker */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Columns3 className="h-3.5 w-3.5" />
                Columns
                {visibleCols.size > 0 && (
                  <span className="ml-0.5 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                    {visibleCols.size}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Optional columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {OPT_COLS.map(({ key, label }) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={visibleCols.has(key)}
                  onCheckedChange={() => toggleCol(key)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
              {visibleCols.size > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs text-muted-foreground"
                    onClick={() => setVisibleCols(new Set())}
                  >
                    Reset to default
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="text-xs text-muted-foreground font-mono-num">
            {filtered.length} / {railcars?.length ?? 0} cars
          </div>
        </div>

        {/* Bulk action toolbar — visible when 1+ cars are selected, admin only */}
        {canEdit && selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-primary/30 bg-primary/5">
            <span className="text-sm font-medium text-foreground">
              {selectedIds.size} car{selectedIds.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex items-center gap-2 ml-2">
              {/* Bulk status change */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={bulkStatusPending} data-testid="bulk-status-dropdown">
                    Set Status
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Change status for selected cars</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {STATUS_OPTIONS.map((s) => (
                    <DropdownMenuItem key={s.value} onSelect={() => bulkUpdateStatus(s.value)}>
                      {s.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Bulk transit/repair status */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={bulkTransitPending} data-testid="bulk-transit-dropdown">
                    Set Transit Flag
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Set transit / repair flag</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => bulkUpdateTransit("none", "Clear")}>
                    — Clear flag (normal service)
                  </DropdownMenuItem>
                  {TRANSIT_STATUSES.map((t) => (
                    <DropdownMenuItem key={t.value} onSelect={() => bulkUpdateTransit(t.value, t.label)}>
                      {t.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Bulk rider assignment */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={bulkRiderPending} data-testid="bulk-assign-dropdown">
                    Assign to Rider
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Move selected cars to rider</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(riders ?? []).length === 0 && (
                    <DropdownMenuItem disabled>No riders available</DropdownMenuItem>
                  )}
                  {(riders ?? []).map((r: any) => (
                    <DropdownMenuItem key={r.id} onSelect={() => bulkAssignRider(r.id, r.rider_name)}>
                      {r.rider_name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Bulk NBV / OAC */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setBulkNbv(""); setBulkOac(""); setBulkOec(""); setBulkValuesOpen(true); }}
                data-testid="bulk-values-btn"
              >
                Edit NBV / OAC / OEC
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              onClick={clearSelection}
              data-testid="bulk-clear"
            >
              <XIcon className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>
        )}

        {/* Table */}
        <div className="rounded-lg border border-card-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="text-left">
                  <th className="pl-4 pr-2 py-3 w-10">
                    <Checkbox
                      checked={allSelected}
                      data-state={someSelected ? "indeterminate" : allSelected ? "checked" : "unchecked"}
                      onCheckedChange={toggleAll}
                      aria-label="Select all visible cars"
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">Entity</th>
                  <Th label="Car Number" k="car_number" sort={sort} onClick={toggleSort} />
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider hidden sm:table-cell">
                    Marks
                  </th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider hidden sm:table-cell">
                    Type
                  </th>
                  <Th label="Status" k="status" sort={sort} onClick={toggleSort} />
                  <Th label="Lessee" k="fleet" sort={sort} onClick={toggleSort} />
                  <Th label="Rider" k="rider" sort={sort} onClick={toggleSort} />
                  <Th label="Lease" k="lease" sort={sort} onClick={toggleSort} />
                  <Th label="Expires" k="expiration" sort={sort} onClick={toggleSort} />
                  {OPT_COLS.filter(c => visibleCols.has(c.key)).map(c => (
                    <th key={c.key} className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">{c.label}</th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      {Array.from({ length: 10 + visibleCols.size }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10 + visibleCols.size} className="px-4 py-16 text-center text-muted-foreground">
                      No railcars match these filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-t border-border hover-elevate cursor-pointer",
                        selectedIds.has(r.id) && "bg-primary/5"
                      )}
                      onClick={() => setOpenCarId(r.id)}
                      data-testid={`row-railcar-${r.id}`}
                    >
                      <td className="pl-4 pr-2 py-3" onClick={(e) => toggleOne(r.id, e)}>
                        <Checkbox
                          checked={selectedIds.has(r.id)}
                          onCheckedChange={() => {/* handled by td onClick */}}
                          aria-label={`Select car ${r.car_number}`}
                          data-testid={`checkbox-car-${r.id}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <EntityBadge entity={(r as any).entity} />
                      </td>
                      <td className="px-4 py-3 font-mono-num font-medium">
                        {r.car_number}
                      </td>
                      <td className="px-4 py-3 font-mono-num text-muted-foreground hidden sm:table-cell">
                        {r.reporting_marks ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                        {r.car_type ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={r.status} />
                          {(r as any).sold_to && (
                            <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30 w-fit">
                              SOLD
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <div>{r.assignment?.fleet_name ?? <span className="text-muted-foreground">Unassigned</span>}</div>
                          {r.transit_status && (
                            <TransitBadge status={r.transit_status} label={r.transit_label} />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.assignment?.rider?.rider_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono-num text-muted-foreground">
                        {r.assignment?.rider?.master_lease?.lease_number ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono-num text-muted-foreground">
                        {fmtDate(r.assignment?.rider?.expiration_date)}
                      </td>
                      {/* Optional columns */}
                      {visibleCols.has("nbv") && (
                        <td className="px-4 py-3 font-mono-num text-muted-foreground whitespace-nowrap">
                          {(r as any).nbv != null ? `$${Number((r as any).nbv).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      )}
                      {visibleCols.has("oac") && (
                        <td className="px-4 py-3 font-mono-num text-muted-foreground whitespace-nowrap">
                          {(r as any).oac != null ? `$${Number((r as any).oac).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      )}
                      {visibleCols.has("oec") && (
                        <td className="px-4 py-3 font-mono-num text-muted-foreground whitespace-nowrap">
                          {(r as any).oec != null ? `$${Number((r as any).oec).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      )}
                      {visibleCols.has("capacity_cf") && (
                        <td className="px-4 py-3 font-mono-num text-muted-foreground">
                          {(r as any).capacity_cf != null ? Number((r as any).capacity_cf).toLocaleString() : "—"}
                        </td>
                      )}
                      {visibleCols.has("lining") && (
                        <td className="px-4 py-3 text-muted-foreground">
                          {(r as any).lining_material || (r as any).lining || (r as any).coating || "—"}
                        </td>
                      )}
                      {visibleCols.has("build_year") && (
                        <td className="px-4 py-3 font-mono-num text-muted-foreground">
                          {(r as any).build_year ?? "—"}
                        </td>
                      )}
                      {visibleCols.has("description") && (
                        <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">
                          {(r as any).general_description || (r as any).description || "—"}
                        </td>
                      )}
                      {visibleCols.has("mech_designation") && (
                        <td className="px-4 py-3 text-muted-foreground">
                          {(r as any).mechanical_designation || (r as any).mech_designation || "—"}
                        </td>
                      )}
                      <td className="px-4 py-3 text-muted-foreground">
                        <ChevronRight className="h-4 w-4" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Slide-over */}
      {/* Bulk NBV / OAC dialog */}
      <Dialog open={bulkValuesOpen} onOpenChange={setBulkValuesOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit NBV / OAC / OEC</DialogTitle>
            <DialogDescription>
              Updating {selectedIds.size} car{selectedIds.size !== 1 ? "s" : ""}. Leave any field blank to keep existing values.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>NBV — Net Book Value</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 42500.00 — leave blank to keep existing"
                value={bulkNbv}
                onChange={(e) => setBulkNbv(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label>OAC — Original Acquired Cost</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 55000.00 — leave blank to keep existing"
                value={bulkOac}
                onChange={(e) => setBulkOac(e.target.value)}
              />
            </div>
            <div>
              <Label>OEC — Original Est. Build Cost</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 48000.00 — leave blank to keep existing"
                value={bulkOec}
                onChange={(e) => setBulkOec(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkValuesOpen(false)}>Cancel</Button>
            <Button
              disabled={(!bulkNbv.trim() && !bulkOac.trim() && !bulkOec.trim()) || bulkValuesPending}
              onClick={bulkUpdateValues}
            >
              {bulkValuesPending ? `Saving…` : `Save to ${selectedIds.size} car${selectedIds.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!openCarId} onOpenChange={(o) => !o && setOpenCarId(null)}>
        <SheetContent side="right" className="w-full sm:w-[480px] sm:max-w-[480px] overflow-y-auto">
          {openCar && <CarDetail carId={openCar.id} onEdit={() => setEditCar(openCar)} onDelete={() => deleteMutation.mutate(openCar.id)} canEdit={canEdit} />}
        </SheetContent>
      </Sheet>

      {/* Edit dialog */}
      <RailcarFormDialog
        open={!!editCar}
        onClose={() => setEditCar(null)}
        car={editCar}
      />
      <RailcarFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        car={null}
      />
    </div>
  );
}

function Th({
  label,
  k,
  sort,
  onClick,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onClick: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onClick(k)}
      className={cn(
        "px-4 py-3 font-medium text-[11px] uppercase tracking-wider cursor-pointer select-none hover:text-foreground",
        active && "text-foreground"
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn("h-3 w-3", active ? "opacity-100" : "opacity-40")} />
      </span>
    </th>
  );
}

function downloadRentEventsCsv(events: any[], carNumber: string) {
  const headers = ["Car Number", "Entity", "Event Type", "Event Date", "Reason", "Logged By", "Logged At"];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = events.map((e) => [
    carNumber,
    e.railcar?.entity ?? "",
    e.event_type === "off_rent" ? "Off Rent" : "On Rent",
    e.event_date,
    e.reason,
    e.created_by,
    new Date(e.created_at).toLocaleString(),
  ].map(escape).join(","));
  const csv = [headers.map(escape).join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rent-events-${carNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function CarDetail({
  carId,
  onEdit,
  onDelete,
  canEdit,
}: {
  carId: number;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [rentFormOpen, setRentFormOpen] = useState(false);
  const [rentEventType, setRentEventType] = useState<"off_rent" | "on_rent">("off_rent");
  const [rentEventDate, setRentEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [rentReason, setRentReason] = useState("");
  // Assign / reassign state
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRiderId, setAssignRiderId] = useState("");
  const [assignFleet, setAssignFleet] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const { data, isLoading } = useQuery<{
    railcar: RailcarWithAssignment;
    history: any[];
    number_history: any[];
  }>({
    queryKey: ["/api/railcars", carId],
  });

  // Riders list for the assign dropdown (cached from parent's query)
  const { data: ridersData } = useQuery<any[]>({ queryKey: ["/api/riders"] });
  const allRiders: any[] = ridersData ?? [];

  // Rent events for this car
  const { data: rentEventsData, isLoading: rentLoading } = useQuery<any[]>({
    queryKey: ["/api/rent-events/car", carId],
    queryFn: () => apiRequest("GET", `/api/rent-events/car/${carId}`).then((r) => r.json()),
  });
  const rentEvents: any[] = rentEventsData ?? [];
  const currentRentStatus: "off_rent" | "on_rent" | null =
    rentEvents.length > 0 ? rentEvents[0].event_type : null;

  const rentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/rent-events", {
        car_id: carId,
        event_type: rentEventType,
        event_date: rentEventDate,
        reason: rentReason.trim(),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rent-events/car", carId] });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Rent event logged", description: "Rental status updated successfully." });
      setRentFormOpen(false);
      setRentReason("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to log event", description: err.message, variant: "destructive" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/move", {
        car_ids: [carId],
        to_rider_id: Number(assignRiderId),
        new_fleet_name: assignFleet.trim() || null,
        reason: assignReason.trim() || null,
        moved_by: "user",
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Car assigned", description: "Assignment saved successfully." });
      setAssignOpen(false);
      setAssignRiderId("");
      setAssignFleet("");
      setAssignReason("");
    },
    onError: (err: any) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3 pt-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  const r = data.railcar;

  return (
    <div>
      <SheetHeader>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Railcar Detail</span>
          <EntityBadge entity={(r as any).entity} size="lg" />
        </div>
        <SheetTitle className="font-mono-num">{r.car_number}</SheetTitle>
        <SheetDescription>
          {r.reporting_marks} · {r.car_type ?? "—"}{(r as any).mechanical_designation ? ` · ${(r as any).mechanical_designation}` : ""}
        </SheetDescription>
      </SheetHeader>

      {/* Sold banner */}
      {(r as any).sold_to && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            SOLD / TRANSFERRED
          </div>
          <p className="mt-1 text-xs text-amber-300/90">Sold to: {(r as any).sold_to}</p>
        </div>
      )}

      {/* Transit / repair banner */}
      {r.transit_status && (
        <div className="mt-4 rounded-md border border-orange-500/30 bg-orange-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-orange-400">
            <Wrench className="h-3.5 w-3.5" />
            <TransitBadge status={r.transit_status} label={null} />
          </div>
          {r.transit_label && (
            <p className="mt-1 text-xs text-orange-300/80">{r.transit_label}</p>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-4">
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={onEdit} data-testid="button-edit-car">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setRemarkOpen(true)}>
            <Hash className="h-3.5 w-3.5" />
            Change Number
          </Button>
        )}
        {canEdit && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" data-testid="button-delete-car">
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this railcar?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. Cars with active assignments cannot be deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Entity ownership — prominent section */}
      <div className="mt-5 rounded-md border border-border bg-muted/20 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Ownership Entity</div>
          <div className="font-medium text-sm">{(r as any).entity ?? "—"}</div>
        </div>
        <EntityBadge entity={(r as any).entity} size="lg" />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-5 text-sm">
        <DetailRow label="Status" value={r.status ?? "—"} />
        <DetailRow label="Car Type" value={r.car_type ?? "—"} />
        <DetailRow label="Mech. Designation" value={(r as any).mechanical_designation ?? "—"} />
        <DetailRow label="General Desc." value={(r as any).general_description ?? "—"} />
        <DetailRow label="AAR" value={r.aar_designation ?? "—"} />
        <DetailRow label="DOT" value={r.dot_specification ?? "—"} />
        <DetailRow label="Capacity (cf)" value={r.capacity_cf ?? "—"} />
        <DetailRow label="Tare (lbs)" value={r.tare_weight_lbs ?? "—"} />
        <DetailRow label="Load Limit" value={r.load_limit_lbs ?? "—"} />
        <DetailRow label="Built" value={r.built_year ?? "—"} />
        <DetailRow label="Lining" value={(r as any).lining_material || (r as any).coating || "—"} />
        <DetailRow label="Lease Type" value={(r as any).lease_type ?? "—"} />
        <DetailRow label="Managed By" value={(r as any).managed ?? "—"} />
        <DetailRow label="Managed Category" value={(r as any).managed_category ?? "—"} />
        <DetailRow label="NBV" value={(r as any).nbv != null ? `$${Number((r as any).nbv).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
        <DetailRow label="OAC" value={(r as any).oac != null ? `$${Number((r as any).oac).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
        <DetailRow label="OEC" value={(r as any).oec != null ? `$${Number((r as any).oec).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
      </dl>

      {/* Prior reporting marks */}
      {((r as any).old_car_initial || (r as any).old_car_number) && (
        <div className="mt-4 rounded-md bg-muted/30 border border-border px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Prior Reporting Marks</div>
          <div className="font-mono text-sm">{(r as any).old_car_initial ?? ""} {(r as any).old_car_number ?? ""}</div>
        </div>
      )}

      <div className="mt-6 border-t border-border pt-5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
          Current Assignment
        </div>
        {r.assignment ? (
          <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Lessee</span>
              <span className="font-medium">{r.assignment.fleet_name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rider</span>
              <span>{r.assignment.rider?.rider_name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Lease</span>
              <span className="font-mono-num">
                {r.assignment.rider?.master_lease?.lease_number ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expires</span>
              <span className="font-mono-num">
                {fmtDate(r.assignment.rider?.expiration_date)}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground italic">Unassigned</div>
        )}
      </div>

      {/* Assign / Reassign panel */}
      {canEdit && (
        <div className="mt-4">
          {!assignOpen ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setAssignFleet(r.assignment?.fleet_name ?? "");
                setAssignRiderId(r.assignment?.rider_id ? String(r.assignment.rider_id) : "");
                setAssignOpen(true);
              }}
              data-testid="btn-open-assign"
            >
              {r.assignment ? "Reassign to Different Rider" : "Assign to Rider"}
            </Button>
          ) : (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-primary mb-1">
                {r.assignment ? "Reassign Car" : "Assign Car to Rider"}
              </div>

              {/* Rider picker grouped by lease */}
              <div>
                <Label className="text-xs">Rider</Label>
                <Select value={assignRiderId} onValueChange={setAssignRiderId}>
                  <SelectTrigger data-testid="select-assign-rider">
                    <SelectValue placeholder="Select a rider…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allRiders.length === 0 && (
                      <SelectItem value="__none" disabled>No riders found</SelectItem>
                    )}
                    {allRiders.map((rd: any) => (
                      <SelectItem key={rd.id} value={String(rd.id)}>
                        {rd.rider_name}
                        {rd.master_lease?.lease_number ? ` · ${rd.master_lease.lease_number}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Lessee */}
              <div>
                <Label className="text-xs">Lessee</Label>
                <Input
                  value={assignFleet}
                  onChange={(e) => setAssignFleet(e.target.value)}
                  placeholder="e.g. COVIA, Preferred Sands"
                  data-testid="input-assign-fleet"
                />
              </div>

              {/* Reason */}
              <div>
                <Label className="text-xs">Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  value={assignReason}
                  onChange={(e) => setAssignReason(e.target.value)}
                  placeholder="New Assignment"
                  data-testid="input-assign-reason"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={!assignRiderId || assignMutation.isPending}
                  onClick={() => assignMutation.mutate()}
                  data-testid="btn-save-assign"
                >
                  {assignMutation.isPending ? "Saving…" : "Save Assignment"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAssignOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 border-t border-border pt-5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
          Assignment History
        </div>
        {data.history.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No moves recorded.</div>
        ) : (
          <div className="space-y-3">
            {data.history.map((h: any) => (
              <div key={h.id} className="text-xs border-l-2 border-primary/50 pl-3 py-1">
                <div className="font-mono-num text-muted-foreground">
                  {new Date(h.moved_at).toLocaleString()}
                </div>
                <div className="mt-0.5">
                  <span className="text-muted-foreground">
                    {h.from_rider?.rider_name ?? "—"}
                  </span>
                  <span className="mx-1.5 text-primary">→</span>
                  <span>{h.to_rider?.rider_name ?? "—"}</span>
                </div>
                {(h.from_fleet_name || h.to_fleet_name) && (
                  <div className="text-muted-foreground mt-0.5">
                    {h.from_fleet_name ?? "—"} → {h.to_fleet_name ?? "—"}
                  </div>
                )}
                {h.reason && (
                  <div className="text-muted-foreground italic mt-0.5">{h.reason}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Car number history */}
      {(data.number_history ?? []).length > 0 && (
        <div className="mt-6 border-t border-border pt-5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-1.5">
            <Hash className="h-3 w-3" /> Reporting Mark History
          </div>
          <div className="space-y-2">
            {data.number_history.map((h: any) => (
              <div key={h.id} className="text-xs border-l-2 border-amber-500/50 pl-3 py-1">
                <div className="font-mono-num text-muted-foreground">{new Date(h.changed_at).toLocaleString()}</div>
                <div className="mt-0.5 font-mono font-medium">
                  <span className="text-muted-foreground">{h.old_car_number}</span>
                  <span className="mx-1.5 text-amber-400">→</span>
                  <span>{h.new_car_number}</span>
                </div>
                {h.reason && <div className="text-muted-foreground italic mt-0.5">{h.reason}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Rental Abatement / Rent Status ── */}
      <div className="mt-6 border-t border-border pt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Rental Status
          </div>
          <div className="flex items-center gap-2">
            {rentEvents.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => downloadRentEventsCsv(rentEvents, r.car_number)}
              >
                <Download className="h-3 w-3 mr-1" />Export
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setRentEventDate(new Date().toISOString().slice(0, 10));
                  setRentEventType(currentRentStatus === "off_rent" ? "on_rent" : "off_rent");
                  setRentReason("");
                  setRentFormOpen(true);
                }}
              >
                Log Event
              </Button>
            )}
          </div>
        </div>

        {/* Current status badge */}
        <div className="flex items-center gap-2 mb-3">
          {currentRentStatus === null && (
            <span className="text-sm text-muted-foreground italic">No rent events recorded</span>
          )}
          {currentRentStatus === "on_rent" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border border-[hsl(var(--success))]/30">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))]" />
              On Rent — as of {rentEvents[0]?.event_date}
            </span>
          )}
          {currentRentStatus === "off_rent" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[hsl(var(--error))]/15 text-[hsl(var(--error))] border border-[hsl(var(--error))]/30">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--error))]" />
              Off Rent — since {rentEvents[0]?.event_date}
            </span>
          )}
        </div>

        {/* Log event form */}
        {rentFormOpen && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3 mb-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-primary">Log Rent Event</div>
            <div>
              <Label className="text-xs">Event Type</Label>
              <Select value={rentEventType} onValueChange={(v) => setRentEventType(v as any)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off_rent">Off Rent (abatement begins)</SelectItem>
                  <SelectItem value="on_rent">On Rent (abatement ends)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Effective Date</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={rentEventDate}
                onChange={(e) => setRentEventDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Reason <span className="text-[hsl(var(--error))] text-xs">*</span></Label>
              <Input
                className="h-8 text-xs"
                value={rentReason}
                onChange={(e) => setRentReason(e.target.value)}
                placeholder="e.g. Bad order — sent to shop 4/21/26"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!rentReason.trim() || !rentEventDate || rentMutation.isPending}
                onClick={() => rentMutation.mutate()}
              >
                {rentMutation.isPending ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRentFormOpen(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* History table */}
        {rentLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : rentEvents.length > 0 ? (
          <div className="space-y-2">
            {rentEvents.map((ev: any) => (
              <div
                key={ev.id}
                className={`text-xs border-l-2 pl-3 py-1 ${
                  ev.event_type === "off_rent"
                    ? "border-[hsl(var(--error))]/60"
                    : "border-[hsl(var(--success))]/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${
                    ev.event_type === "off_rent"
                      ? "text-[hsl(var(--error))]"
                      : "text-[hsl(var(--success))]"
                  }`}>
                    {ev.event_type === "off_rent" ? "Off Rent" : "On Rent"}
                  </span>
                  <span className="text-muted-foreground font-mono-num">{ev.event_date}</span>
                </div>
                <div className="mt-0.5 text-muted-foreground italic">{ev.reason}</div>
                <div className="mt-0.5 text-muted-foreground/60">{ev.created_by}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {r.notes && (
        <div className="mt-6 border-t border-border pt-5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Notes
          </div>
          <p className="text-sm whitespace-pre-wrap">{r.notes}</p>
        </div>
      )}

      {/* Railcar-level attachments */}
      <div className="mt-6 border-t border-border pt-5">
        <AttachmentsPanel entityType="railcar" entityId={carId} compact />
      </div>

      <RemarkChangeDialog
        open={remarkOpen}
        onClose={() => setRemarkOpen(false)}
        carId={carId}
        currentNumber={r.car_number}
      />
    </div>
  );
}

function RemarkChangeDialog({
  open, onClose, carId, currentNumber,
}: {
  open: boolean;
  onClose: () => void;
  carId: number;
  currentNumber: string;
}) {
  const { toast } = useToast();
  const [newNumber, setNewNumber] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => { if (open) { setNewNumber(""); setReason(""); } }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/railcars/${carId}/change-number`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_car_number: newNumber.trim().toUpperCase(), reason: reason || null }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      toast({ title: `Car number changed: ${d.old_car_number} → ${d.new_car_number}` });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Change failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Reporting Mark / Car Number</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-muted/40 px-4 py-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Current number</div>
            <div className="font-mono font-semibold">{currentNumber}</div>
          </div>
          <p className="text-xs text-muted-foreground">All car attributes (type, lining, capacity, history) are retained. Only the car number / reporting mark changes.</p>
          <div>
            <Label>New Car Number <span className="text-destructive">*</span></Label>
            <Input
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value.toUpperCase())}
              placeholder="e.g. TEUX10823"
              className="font-mono"
            />
          </div>
          <div>
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reporting mark change per lessee request" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!newNumber.trim() || save.isPending}>
            {save.isPending ? "Saving…" : "Change Number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono-num mt-0.5">{value}</dd>
    </div>
  );
}

function RailcarFormDialog({
  open,
  onClose,
  car,
}: {
  open: boolean;
  onClose: () => void;
  car: Row | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(() => ({
    car_number: car?.car_number ?? "",
    reporting_marks: car?.reporting_marks ?? "HWCX",
    car_type: car?.car_type ?? "Hopper",
    status: car?.status ?? "Active/In-Service",
    entity: (car as any)?.entity ?? "",
    transit_status: (car as any)?.transit_status ?? "",
    transit_label: (car as any)?.transit_label ?? "",
    mechanical_designation: (car as any)?.mechanical_designation ?? "",
    general_description: (car as any)?.general_description ?? "",
    lease_type: (car as any)?.lease_type ?? "",
    managed: (car as any)?.managed ?? "",
    managed_category: (car as any)?.managed_category ?? "",
    // Merge coating into lining_material — prefer lining_material, fall back to coating
    lining_material: (car as any)?.lining_material || (car as any)?.coating || "",
    old_car_initial: (car as any)?.old_car_initial ?? "",
    old_car_number: (car as any)?.old_car_number ?? "",
    notes: car?.notes ?? "",
    nbv: (car as any)?.nbv != null ? String((car as any).nbv) : "",
    oac: (car as any)?.oac != null ? String((car as any).oac) : "",
    oec: (car as any)?.oec != null ? String((car as any).oec) : "",
  }));

  // Assignment fields — only used when car is null (new car mode)
  // Kept separate from `form` since they go to /api/move, not /api/railcars
  const [assignRiderId, setAssignRiderId] = useState("");
  const [assignFleetName, setAssignFleetName] = useState("");
  const [assignReason, setAssignReason] = useState("");

  // reset when opening
  useMemoReset(open, car, setForm);
  useEffect(() => {
    if (open) {
      setAssignRiderId("");
      setAssignFleetName("");
      setAssignReason("");
    }
  }, [open]);

  const { data: ridersData } = useQuery<any[]>({ queryKey: ["/api/riders"] });
  const allRiders: any[] = ridersData ?? [];

  const save = useMutation({
    mutationFn: async () => {
      if (car) {
        // apiRequest throws on non-OK automatically
        await apiRequest("PATCH", `/api/railcars/${car.id}`, form);
      } else {
        const res = await apiRequest("POST", `/api/railcars`, form);
        // If a rider was selected, assign the new car to it immediately
        if (assignRiderId) {
          const newCar = await res.json();
          await apiRequest("POST", "/api/move", {
            car_ids: [newCar.id],
            to_rider_id: Number(assignRiderId),
            new_fleet_name: assignFleetName.trim() || null,
            reason: assignReason.trim() || "New Assignment",
            moved_by: "user",
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      if (!car && assignRiderId) {
        queryClient.invalidateQueries({ queryKey: ["/api/history"] });
        const riderName = allRiders.find((r: any) => String(r.id) === assignRiderId)?.rider_name ?? "rider";
        toast({ title: "Railcar created & assigned", description: `Assigned to ${riderName}` });
      } else {
        toast({ title: car ? "Railcar updated" : "Railcar created" });
      }
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{car ? "Edit Railcar" : "Add Railcar"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: 'calc(80vh - 120px)' }}>
          {/* ── Car ID block with live preview ─────────────────────────────── */}
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Car Identification</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Initial <span className="text-[10px] text-muted-foreground font-normal">(alpha prefix)</span></Label>
                <Input
                  value={form.reporting_marks}
                  onChange={(e) => setForm({ ...form, reporting_marks: e.target.value.toUpperCase() })}
                  placeholder="e.g. HWCX"
                  className="font-mono uppercase"
                  disabled={!!car}
                  data-testid="input-reporting-marks"
                />
              </div>
              <div>
                <Label className="text-xs">Number <span className="text-[10px] text-muted-foreground font-normal">(digits)</span></Label>
                <Input
                  value={form.car_number}
                  onChange={(e) => setForm({ ...form, car_number: e.target.value })}
                  placeholder="e.g. 123456"
                  className="font-mono"
                  disabled={!!car}
                  data-testid="input-car-number"
                />
              </div>
            </div>
            {/* Live preview */}
            <div className="flex items-center gap-2 rounded border border-dashed border-border/60 bg-background/60 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">Full Reporting Mark:</span>
              <span className={"font-mono font-semibold text-sm tracking-wide " + (form.reporting_marks || form.car_number ? "text-foreground" : "text-muted-foreground")}>
                {form.reporting_marks || form.car_number
                  ? `${form.reporting_marks ?? ""}${form.car_number ?? ""}`
                  : "HWCX123456"}
              </span>
              {!form.reporting_marks && !form.car_number && (
                <span className="text-[10px] text-muted-foreground italic">(example)</span>
              )}
            </div>
          </div>
          <div>
            <Label>Car Type</Label>
            <Input
              value={form.car_type}
              onChange={(e) => setForm({ ...form, car_type: e.target.value })}
            />
          </div>
          <div>
            <Label>Ownership Entity</Label>
            <Select
              value={form.entity || "none"}
              onValueChange={(v) => setForm({ ...form, entity: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Not set —</SelectItem>
                <SelectItem value="Main">Owned</SelectItem>
                <SelectItem value="Rail Partners Select">RPS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Mech. Designation</Label>
              <Input value={form.mechanical_designation} onChange={(e) => setForm({ ...form, mechanical_designation: e.target.value })} placeholder="e.g. LO, GT, HTS" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lining <span className="text-[10px] text-muted-foreground font-normal">(coating / lining material)</span></Label>
              <Input value={form.lining_material} onChange={(e) => setForm({ ...form, lining_material: e.target.value })} placeholder="e.g. Epoxy, 26, Bare steel" />
            </div>
          </div>
          <div>
            <Label>General Description</Label>
            <Input value={form.general_description} onChange={(e) => setForm({ ...form, general_description: e.target.value })} placeholder="e.g. Covered Hopper" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lease Type</Label>
              <Input value={form.lease_type} onChange={(e) => setForm({ ...form, lease_type: e.target.value })} placeholder="e.g. Net Lease, Full Service" />
            </div>
            <div>
              <Label>Managed By</Label>
              <Input value={form.managed} onChange={(e) => setForm({ ...form, managed: e.target.value })} placeholder="e.g. Trinity, Greenbrier" />
            </div>
          </div>
          <div>
            <Label>Managed Category</Label>
            <Input value={form.managed_category} onChange={(e) => setForm({ ...form, managed_category: e.target.value })} placeholder="e.g. Net Lease, ALF Marks" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>NBV <span className="text-muted-foreground font-normal text-xs">(Net Book Value)</span></Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.nbv}
                onChange={(e) => setForm({ ...form, nbv: e.target.value })}
                placeholder="e.g. 42500.00"
              />
            </div>
            <div>
              <Label>OAC <span className="text-muted-foreground font-normal text-xs">(Original Acquired Cost)</span></Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.oac}
                onChange={(e) => setForm({ ...form, oac: e.target.value })}
                placeholder="e.g. 55000.00"
              />
            </div>
            <div>
              <Label>OEC <span className="text-muted-foreground font-normal text-xs">(Original Est. Build Cost)</span></Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.oec}
                onChange={(e) => setForm({ ...form, oec: e.target.value })}
                placeholder="e.g. 48000.00"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prior Car Initial</Label>
              <Input value={form.old_car_initial} onChange={(e) => setForm({ ...form, old_car_initial: e.target.value })} placeholder="e.g. ADMX" className="font-mono" />
            </div>
            <div>
              <Label>Prior Car Number</Label>
              <Input value={form.old_car_number} onChange={(e) => setForm({ ...form, old_car_number: e.target.value })} placeholder="e.g. 000006" className="font-mono" />
            </div>
          </div>
          <div>
            <Label>Transit / Repair Status</Label>
            <Select
              value={form.transit_status || "none"}
              onValueChange={(v) => setForm({ ...form, transit_status: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Normal service (no flag)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Normal service (no flag)</SelectItem>
                {TRANSIT_STATUSES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.transit_status && form.transit_status !== "none" && (
            <div>
              <Label>Transit Identifier</Label>
              <Input
                value={form.transit_label}
                onChange={(e) => setForm({ ...form, transit_label: e.target.value })}
                placeholder="e.g. COVIA Return, being newly assigned to Total Energies"
              />
            </div>
          )}
          <div>
            <Label>Sold / Transferred To</Label>
            <Input
              value={form.sold_to ?? ""}
              onChange={(e) => setForm({ ...form, sold_to: e.target.value })}
              placeholder="Buyer / transferee company name (leave blank if not sold)"
            />
            {form.sold_to?.trim() && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                This car will be marked as SOLD
              </p>
            )}
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
            />
          </div>

          {/* ── Assign to Rider (new cars only) ──────────────────────────── */}
          {!car && (
            <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Assign to Rider <span className="normal-case tracking-normal font-normal text-muted-foreground/70">(optional)</span>
              </div>
              <div>
                <Label className="text-xs">Rider</Label>
                <Select value={assignRiderId || "__none"} onValueChange={(v) => setAssignRiderId(v === "__none" ? "" : v)}>
                  <SelectTrigger data-testid="select-new-car-rider">
                    <SelectValue placeholder="— Skip assignment —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Skip assignment —</SelectItem>
                    {allRiders.map((r: any) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.rider_name}{r.master_lease?.lease_number ? ` · ${r.master_lease.lease_number}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {assignRiderId && (
                <>
                  <div>
                    <Label className="text-xs">Lessee Name</Label>
                    <Input
                      value={assignFleetName}
                      onChange={(e) => setAssignFleetName(e.target.value)}
                      placeholder="e.g. COVIA, Preferred Sands"
                      data-testid="input-new-car-fleet"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      value={assignReason}
                      onChange={(e) => setAssignReason(e.target.value)}
                      placeholder="New Assignment"
                      data-testid="input-new-car-reason"
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : car ? "Save" : (assignRiderId ? "Create & Assign" : "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect } from "react";
function useMemoReset(
  open: boolean,
  car: Row | null,
  setForm: (v: any) => void
) {
  useEffect(() => {
    if (open) {
      setForm({
        car_number: car?.car_number ?? "",
        reporting_marks: car?.reporting_marks ?? "HWCX",
        car_type: car?.car_type ?? "Hopper",
        status: car?.status ?? "Active/In-Service",
        transit_status: (car as any)?.transit_status ?? "",
        transit_label: (car as any)?.transit_label ?? "",
        notes: car?.notes ?? "",
        entity: (car as any)?.entity ?? "",
        mechanical_designation: (car as any)?.mechanical_designation ?? "",
        general_description: (car as any)?.general_description ?? "",
        lease_type: (car as any)?.lease_type ?? "",
        managed: (car as any)?.managed ?? "",
        managed_category: (car as any)?.managed_category ?? "",
        // Merge coating into lining_material
        lining_material: (car as any)?.lining_material || (car as any)?.coating || "",
        old_car_initial: (car as any)?.old_car_initial ?? "",
        old_car_number: (car as any)?.old_car_number ?? "",
        sold_to: (car as any)?.sold_to ?? "",
        active: (car as any)?.active ?? true,
        nbv: (car as any)?.nbv != null ? String((car as any).nbv) : "",
        oac: (car as any)?.oac != null ? String((car as any).oac) : "",
        oec: (car as any)?.oec != null ? String((car as any).oec) : "",
      });
    }
  }, [open, car, setForm]);
}
