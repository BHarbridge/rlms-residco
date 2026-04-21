import { useEffect, useState } from "react";
import { useCanEdit } from "@/lib/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { useLocation } from "wouter";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Users,
  Phone,
  Mail,
  StickyNote,
  Wand2,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import type {
  MasterLeaseWithRiders,
  RailcarWithAssignment,
  RiderContact,
} from "@shared/schema";

// ── CSV export ────────────────────────────────────────────────────────────────
function toCsvRow(cells: (string | number | null | undefined)[]) {
  return cells.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

function downloadLeasesCsv(leases: MasterLeaseWithRiders[]) {
  const rows: string[] = [];

  // MLA sheet header
  rows.push("=== MASTER LEASE AGREEMENTS ===");
  rows.push(toCsvRow(["Lease Number","Agreement Number","Lessor","Lessee","Type","Effective Date","Rider Count","Car Count","Notes"]));
  for (const l of leases) {
    rows.push(toCsvRow([l.lease_number, l.agreement_number, l.lessor, l.lessee, l.lease_type, l.effective_date, l.riders.length, (l as any).car_count, l.notes]));
  }

  rows.push("");
  rows.push("=== RIDERS ===");
  rows.push(toCsvRow(["Lease Number","Rider Name","Schedule Number","Effective Date","Expiration Date","Commodity","Monthly Rate %","Lessor Cost","Base Term (mo)","Monthly Rent/Car","Sold To","Car Count","Notes"]));
  for (const l of leases) {
    for (const r of l.riders) {
      rows.push(toCsvRow([l.lease_number, r.rider_name, r.schedule_number, r.effective_date, r.expiration_date, r.permissible_commodity, r.monthly_rate_pct, r.lessors_cost, r.base_term_months, (r as any).monthly_rent_per_car, (r as any).sold_to, (r as any).car_count, r.notes]));
    }
  }

  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `RLMS_Leases_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}
function fmtPct(n: number | null) {
  return n == null ? "—" : `${Number(n).toFixed(3)}%`;
}
function fmtMoney(n: number | null) {
  if (n == null) return "—";
  return Number(n).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function LeaseManagement() {
  const canEdit = useCanEdit();
  const [, navigate] = useLocation();
  const [expandedLeases, setExpandedLeases] = useState<Set<number>>(new Set());
  const [expandedRiders, setExpandedRiders] = useState<Set<number>>(new Set());
  const [addLeaseOpen, setAddLeaseOpen] = useState(false);
  const [editLease, setEditLease] = useState<any | null>(null);
  const [addRiderFor, setAddRiderFor] = useState<number | null>(null);
  const [editRider, setEditRider] = useState<any | null>(null);
  const { toast } = useToast();

  // Parse deep-link params
  const targetRiderId = typeof window !== "undefined"
    ? Number(new URLSearchParams(window.location.search).get("rider")) || null
    : null;
  const filterRiders = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("filter") === "riders"
    : false;

  const { data: leases, isLoading } = useQuery<MasterLeaseWithRiders[]>({
    queryKey: ["/api/leases"],
  });

  // Auto-expand: deep-link rider > ?filter=riders (all) > default first lease
  useEffect(() => {
    if (!leases || !leases.length) return;
    if (targetRiderId) {
      // Find the MLA that contains this rider
      const parentLease = leases.find((l) =>
        l.riders?.some((r: any) => r.id === targetRiderId)
      );
      if (parentLease) {
        setExpandedLeases(new Set([parentLease.id]));
        setExpandedRiders(new Set([targetRiderId]));
        setTimeout(() => {
          const el = document.getElementById(`rider-row-${targetRiderId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
      }
    } else if (filterRiders) {
      // Expand all leases and all riders so every active rider is visible
      setExpandedLeases(new Set(leases.map((l) => l.id)));
      setExpandedRiders(new Set(leases.flatMap((l) => (l.riders ?? []).map((r: any) => r.id))));
    } else if (expandedLeases.size === 0) {
      setExpandedLeases(new Set([leases[0].id]));
    }
  }, [leases, targetRiderId, filterRiders]);

  const toggleLease = (id: number) =>
    setExpandedLeases((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleRider = (id: number) =>
    setExpandedRiders((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const deleteLease = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/leases/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      toast({ title: "Master lease deleted" });
    },
    onError: (e: Error) =>
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });
  const deleteRider = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/riders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      toast({ title: "Rider deleted" });
    },
    onError: (e: Error) =>
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <PageHeader
        title="Lease Management"
        subtitle="Master lease agreements, rider schedules, and assigned cars"
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadLeasesCsv(leases ?? [])}
              data-testid="button-download-leases"
              disabled={!leases || leases.length === 0}
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddLeaseOpen(true)}
                data-testid="button-add-mla"
              >
                <Plus className="h-4 w-4" />
                Add MLA
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                onClick={() => navigate("/lease-wizard")}
                data-testid="button-new-lease-wizard"
              >
                <Wand2 className="h-4 w-4" />
                New Lease Setup
              </Button>
            )}
          </div>
        }
      />

      <div className="px-8 py-6 space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))
        ) : (
          leases?.map((lease) => {
            const open = expandedLeases.has(lease.id);
            return (
              <div
                key={lease.id}
                className="rounded-lg border border-card-border bg-card overflow-hidden"
              >
                <div
                  className="px-5 py-4 flex items-center gap-4 cursor-pointer hover-elevate"
                  onClick={() => toggleLease(lease.id)}
                  data-testid={`lease-row-${lease.id}`}
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono-num text-base font-semibold">
                        {lease.lease_number}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {lease.agreement_number ?? "—"}
                      </span>
                      {(lease as any).sold_to && (
                        <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30">
                          SOLD
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {lease.lessor ?? "—"} <span className="opacity-50">lessor</span>
                      <span className="mx-2 opacity-30">·</span>
                      {lease.lessee ?? "—"} <span className="opacity-50">lessee</span>
                      {(lease as any).sold_to && (
                        <span className="ml-2 text-amber-400">→ {(lease as any).sold_to}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Cars / Riders
                    </div>
                    <div className="font-mono-num text-sm">
                      {lease.car_count} <span className="text-muted-foreground">/</span>{" "}
                      {lease.riders.length}
                    </div>
                  </div>
                  <div
                    className="flex gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit && <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditLease(lease)}
                      data-testid={`button-edit-lease-${lease.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>}
                    {canEdit && <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete master lease?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Cannot delete a lease that has riders. Remove the riders
                            first.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteLease.mutate(lease.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>}
                  </div>
                </div>

                {open && (
                  <div className="border-t border-border bg-background/40">
                    <div className="px-5 py-3 flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        Riders
                      </div>
                      {canEdit && <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAddRiderFor(lease.id)}
                        data-testid={`button-add-rider-${lease.id}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Rider
                      </Button>}
                    </div>
                    <div className="divide-y divide-border">
                      {lease.riders.length === 0 && (
                        <div className="px-5 py-8 text-sm text-muted-foreground italic text-center">
                          No riders under this master lease.
                        </div>
                      )}
                      {lease.riders.map((rider) => {
                        const open = expandedRiders.has(rider.id);
                        return (
                          <div key={rider.id}>
                            <div
                              id={`rider-row-${rider.id}`}
                              className={cn(
                                "px-5 py-3 flex items-center gap-4 cursor-pointer hover-elevate transition-colors",
                                targetRiderId === rider.id && "ring-1 ring-primary/40 bg-primary/5 rounded"
                              )}
                              onClick={() => toggleRider(rider.id)}
                              data-testid={`rider-row-${rider.id}`}
                            >
                              {open ? (
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-3">
                                  <span className="text-sm font-medium">
                                    {rider.rider_name}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {rider.schedule_number ?? "—"}
                                  </span>
                                  {(rider as any).sold_to && (
                                    <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30">
                                      SOLD
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5 font-mono-num">
                                  {fmtDate(rider.effective_date)} →{" "}
                                  {fmtDate(rider.expiration_date)} · rate{" "}
                                  {fmtPct(rider.monthly_rate_pct)} · cost{" "}
                                  {fmtMoney(rider.lessors_cost)}
                                  {(rider as any).monthly_rent_per_car != null && (
                                    <> · <span className="text-foreground">{fmtMoney((rider as any).monthly_rent_per_car)}/car</span></>
                                  )}
                                  {(rider as any).sold_to && (
                                    <> · <span className="text-amber-400">→ {(rider as any).sold_to}</span></>
                                  )}
                                </div>
                              </div>
                              <div className="text-right text-sm font-mono-num">
                                {rider.car_count}
                                <span className="text-muted-foreground text-xs ml-1">
                                  cars
                                </span>
                              </div>
                              <div
                                className="flex gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {canEdit && <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setEditRider(rider)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>}
                                {canEdit && <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button size="icon" variant="ghost">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete rider?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Cannot delete a rider with cars assigned. Move
                                        cars first.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deleteRider.mutate(rider.id)}
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>}
                              </div>
                            </div>
                            {open && (
                              <>
                                <RiderCars riderId={rider.id} />
                                <RiderContactsPanel riderId={rider.id} />
                                <div className="px-5 py-4 border-t border-border/50">
                                  <AttachmentsPanel entityType="rider" entityId={rider.id} compact />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* MLA-level attachments */}
                    <div className="px-5 py-4 border-t border-border/50 bg-background/20">
                      <AttachmentsPanel entityType="master_lease" entityId={lease.id} compact />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <MasterLeaseForm
        open={addLeaseOpen || !!editLease}
        onClose={() => {
          setAddLeaseOpen(false);
          setEditLease(null);
        }}
        lease={editLease}
      />
      <RiderForm
        open={!!addRiderFor || !!editRider}
        onClose={() => {
          setAddRiderFor(null);
          setEditRider(null);
        }}
        masterLeaseId={addRiderFor}
        rider={editRider}
      />
    </div>
  );
}

function RiderCars({ riderId }: { riderId: number }) {
  const { data: cars, isLoading } = useQuery<RailcarWithAssignment[]>({
    queryKey: ["/api/railcars"],
  });
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const filtered = (cars ?? []).filter((c) => c.assignment?.rider_id === riderId);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const slice = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="px-5 pb-5 bg-muted/20 border-t border-border/60">
      {isLoading ? (
        <Skeleton className="h-10 mt-3 rounded" />
      ) : total === 0 ? (
        <div className="py-6 text-xs text-muted-foreground italic text-center">
          No cars assigned to this rider.
        </div>
      ) : (
        <>
          <div className="pt-3 text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2">
            Assigned cars · {total}
          </div>
          <div className="rounded-md border border-border bg-card">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Car Number</th>
                  <th className="text-left px-3 py-2 font-medium">Lessee</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-3 py-1.5 font-mono-num">{c.car_number}</td>
                    <td className="px-3 py-1.5">
                      {c.assignment?.fleet_name ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {c.status ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-xs">
              <Button
                size="sm"
                variant="ghost"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </Button>
              <span className="font-mono-num text-muted-foreground">
                {page + 1} / {pages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Rider Contacts Panel ----

function RiderContactsPanel({ riderId }: { riderId: number }) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editContact, setEditContact] = useState<RiderContact | null>(null);

  const { data: contacts, isLoading } = useQuery<RiderContact[]>({
    queryKey: ["/api/riders", riderId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/riders/${riderId}/contacts`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const deleteContact = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/contacts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/riders", riderId, "contacts"] });
      toast({ title: "Contact removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="px-5 pb-5 bg-muted/10 border-t border-border/60">
      <div className="pt-3 flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Lessee Contacts
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)} className="h-7 text-xs gap-1">
          <Plus className="h-3.5 w-3.5" /> Add Contact
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-12 rounded" />
      ) : (contacts ?? []).length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-4 text-center">
          No contacts added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {(contacts ?? []).map((c) => (
            <div key={c.id} className="rounded-md border border-border bg-card px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{c.name}</span>
                  {c.title && <span className="text-xs text-muted-foreground">· {c.title}</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <Mail className="h-3 w-3" />{c.email}
                    </a>
                  )}
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <Phone className="h-3 w-3" />{c.phone}
                    </a>
                  )}
                </div>
                {c.notes && <div className="text-xs text-muted-foreground mt-1 italic">{c.notes}</div>}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditContact(c)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove contact?</AlertDialogTitle>
                      <AlertDialogDescription>This will permanently delete {c.name}.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteContact.mutate(c.id)}>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      <ContactForm
        open={addOpen || !!editContact}
        onClose={() => { setAddOpen(false); setEditContact(null); }}
        riderId={riderId}
        contact={editContact}
      />
    </div>
  );
}

function ContactForm({
  open, onClose, riderId, contact,
}: {
  open: boolean;
  onClose: () => void;
  riderId: number;
  contact: RiderContact | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (open) {
      setForm({
        name: contact?.name ?? "",
        title: contact?.title ?? "",
        email: contact?.email ?? "",
        phone: contact?.phone ?? "",
        notes: contact?.notes ?? "",
      });
    }
  }, [open, contact]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        title: form.title || null,
        email: form.email || null,
        phone: form.phone || null,
        notes: form.notes || null,
      };
      if (contact) {
        await apiRequest("PATCH", `/api/contacts/${contact.id}`, body);
      } else {
        await apiRequest("POST", `/api/riders/${riderId}/contacts`, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/riders", riderId, "contacts"] });
      toast({ title: contact ? "Contact updated" : "Contact added" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Lessee Contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" />
          </div>
          <div>
            <Label>Title / Role</Label>
            <Input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Fleet Manager" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input type="tel" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (555) 000-0000" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Preferred contact for billing disputes…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name?.trim()}>
            {save.isPending ? "Saving…" : contact ? "Save" : "Add Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Forms ----

function MasterLeaseForm({
  open,
  onClose,
  lease,
}: {
  open: boolean;
  onClose: () => void;
  lease: any | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (open) {
      setForm({
        lease_number: lease?.lease_number ?? "",
        agreement_number: lease?.agreement_number ?? "",
        lessor: lease?.lessor ?? "",
        lessee: lease?.lessee ?? "",
        lease_type: lease?.lease_type ?? "Railcar Lease",
        effective_date: lease?.effective_date ?? "",
        sold_to: lease?.sold_to ?? "",
        notes: lease?.notes ?? "",
      });
    }
  }, [open, lease]);

  const save = useMutation({
    mutationFn: async () => {
      if (lease) await apiRequest("PATCH", `/api/leases/${lease.id}`, form);
      else await apiRequest("POST", `/api/leases`, form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      toast({ title: lease ? "Lease updated" : "Lease created" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {lease ? "Edit Master Lease" : "Add Master Lease"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lease Number</Label>
              <Input
                value={form.lease_number ?? ""}
                onChange={(e) => setForm({ ...form, lease_number: e.target.value })}
              />
            </div>
            <div>
              <Label>Agreement Number</Label>
              <Input
                value={form.agreement_number ?? ""}
                onChange={(e) =>
                  setForm({ ...form, agreement_number: e.target.value })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lessor</Label>
              <Input
                value={form.lessor ?? ""}
                onChange={(e) => setForm({ ...form, lessor: e.target.value })}
              />
            </div>
            <div>
              <Label>Lessee</Label>
              <Input
                value={form.lessee ?? ""}
                onChange={(e) => setForm({ ...form, lessee: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Input
                value={form.lease_type ?? ""}
                onChange={(e) => setForm({ ...form, lease_type: e.target.value })}
              />
            </div>
            <div>
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={form.effective_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, effective_date: e.target.value })
                }
              />
            </div>
          </div>
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
                This MLA will be marked as SOLD
              </p>
            )}
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : lease ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RiderForm({
  open,
  onClose,
  masterLeaseId,
  rider,
}: {
  open: boolean;
  onClose: () => void;
  masterLeaseId: number | null;
  rider: any | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (open) {
      setForm({
        master_lease_id: rider?.master_lease_id ?? masterLeaseId,
        rider_name: rider?.rider_name ?? "",
        schedule_number: rider?.schedule_number ?? "",
        effective_date: rider?.effective_date ?? "",
        expiration_date: rider?.expiration_date ?? "",
        permissible_commodity: rider?.permissible_commodity ?? "",
        monthly_rate_pct: rider?.monthly_rate_pct ?? "",
        lessors_cost: rider?.lessors_cost ?? "",
        base_term_months: rider?.base_term_months ?? "",
        monthly_rent_per_car: rider?.monthly_rent_per_car ?? "",
        sold_to: rider?.sold_to ?? "",
        notes: rider?.notes ?? "",
      });
    }
  }, [open, rider, masterLeaseId]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        monthly_rate_pct: form.monthly_rate_pct === "" ? null : Number(form.monthly_rate_pct),
        lessors_cost: form.lessors_cost === "" ? null : Number(form.lessors_cost),
        base_term_months: form.base_term_months === "" ? null : Number(form.base_term_months),
        monthly_rent_per_car: form.monthly_rent_per_car === "" ? null : Number(form.monthly_rent_per_car),
        sold_to: form.sold_to?.trim() || null,
      };
      if (rider) await apiRequest("PATCH", `/api/riders/${rider.id}`, body);
      else await apiRequest("POST", `/api/riders`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      toast({ title: rider ? "Rider updated" : "Rider created" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rider ? "Edit Rider" : "Add Rider"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Rider Name</Label>
              <Input
                value={form.rider_name ?? ""}
                onChange={(e) => setForm({ ...form, rider_name: e.target.value })}
              />
            </div>
            <div>
              <Label>Schedule Number</Label>
              <Input
                value={form.schedule_number ?? ""}
                onChange={(e) =>
                  setForm({ ...form, schedule_number: e.target.value })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={form.effective_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, effective_date: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Expiration Date</Label>
              <Input
                type="date"
                value={form.expiration_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, expiration_date: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <Label>Permissible Commodity</Label>
            <Input
              value={form.permissible_commodity ?? ""}
              onChange={(e) =>
                setForm({ ...form, permissible_commodity: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Monthly Rate %</Label>
              <Input
                type="number"
                step="0.001"
                value={form.monthly_rate_pct ?? ""}
                onChange={(e) =>
                  setForm({ ...form, monthly_rate_pct: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Lessor's Cost</Label>
              <Input
                type="number"
                step="0.01"
                value={form.lessors_cost ?? ""}
                onChange={(e) => setForm({ ...form, lessors_cost: e.target.value })}
              />
            </div>
            <div>
              <Label>Base Term (mo)</Label>
              <Input
                type="number"
                value={form.base_term_months ?? ""}
                onChange={(e) =>
                  setForm({ ...form, base_term_months: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <Label>Monthly Rent per Car ($)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 450.00"
              value={form.monthly_rent_per_car ?? ""}
              onChange={(e) => setForm({ ...form, monthly_rent_per_car: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">Typical range: $100 – $850 per car / month</p>
          </div>
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
                This rider will be marked as SOLD
              </p>
            )}
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : rider ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
