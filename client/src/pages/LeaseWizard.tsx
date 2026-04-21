/**
 * New Lease Setup Wizard
 * Step 1 — Master Lease Agreement details
 * Step 2 — Add one or more Riders (rolling up under the MLA)
 * Step 3 — For each rider: add cars (enter car numbers + attributes) or pick existing unassigned cars
 * Step 4 — Review summary → submit everything in one shot
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FileText, Plus, Trash2, ChevronRight, ChevronLeft,
  CheckCircle2, AlertCircle, Car, Users, Search, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCanEdit } from "@/lib/AuthContext";
import type { RailcarWithAssignment } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
type MlaForm = {
  lease_number: string;
  agreement_number: string;
  lessor: string;
  lessee: string;
  lease_type: string;
  effective_date: string;
  notes: string;
};

type NewCar = {
  _key: string; // local only
  car_number: string;
  reporting_marks: string;
  car_type: string;
  entity: string;
  status: string;
  notes: string;
};

type RiderForm = {
  _key: string;
  rider_name: string;
  schedule_number: string;
  effective_date: string;
  expiration_date: string;
  permissible_commodity: string;
  monthly_rate_pct: string;
  lessors_cost: string;
  base_term_months: string;
  monthly_rent_per_car: string;
  sold_to: string;
  notes: string;
  fleet_name: string;
  new_cars: NewCar[];
  existing_car_ids: number[];
};

const ENTITY_OPTIONS = ["Main", "Rail Partners Select"];
const STATUS_OPTIONS = ["Active/In-Service", "Storage", "Bad Order", "Off-Lease", "Retired", "Scrapped"];

// ── Helpers ────────────────────────────────────────────────────────────────────
function blankRider(): RiderForm {
  return {
    _key: crypto.randomUUID(),
    rider_name: "",
    schedule_number: "",
    effective_date: "",
    expiration_date: "",
    permissible_commodity: "",
    monthly_rate_pct: "",
    lessors_cost: "",
    base_term_months: "",
    monthly_rent_per_car: "",
    sold_to: "",
    notes: "",
    fleet_name: "",
    new_cars: [],
    existing_car_ids: [],
  };
}

function blankCar(): NewCar {
  return {
    _key: crypto.randomUUID(),
    car_number: "",
    reporting_marks: "",
    car_type: "",
    entity: "Main",
    status: "Active/In-Service",
    notes: "",
  };
}

const ENTITY_BADGE: Record<string, string> = {
  "Rail Partners Select": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "Main":                 "bg-sky-500/15 text-sky-300 border-sky-500/30",
};
const ENTITY_LABEL: Record<string, string> = {
  "Rail Partners Select": "RPS",
  "Main": "Owned",
};

function EntityBadge({ entity }: { entity: string }) {
  const cls = ENTITY_BADGE[entity] ?? "bg-muted text-muted-foreground border-border";
  const lbl = ENTITY_LABEL[entity] ?? entity;
  return (
    <span className={cn("text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border", cls)}>
      {lbl}
    </span>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ current, total }: { current: number; total: number }) {
  const steps = ["Master Lease", "Riders", "Cars", "Review"];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <div key={label} className="flex items-center gap-0 flex-1">
            <div className="flex flex-col items-center gap-1 w-full">
              <div className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 shrink-0 transition-all",
                done  && "bg-primary border-primary text-primary-foreground",
                active && "bg-primary/15 border-primary text-primary",
                !done && !active && "bg-muted border-border text-muted-foreground"
              )}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : idx}
              </div>
              <span className={cn(
                "text-[10px] uppercase tracking-wide font-medium whitespace-nowrap",
                active ? "text-foreground" : "text-muted-foreground"
              )}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-0.5 flex-1 mx-2 mb-4 transition-all", done ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Existing car picker dialog ────────────────────────────────────────────────
function ExistingCarPicker({
  open, onClose, currentIds, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  currentIds: number[];
  onConfirm: (ids: number[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set(currentIds));

  useEffect(() => {
    if (open) setSelected(new Set(currentIds));
  }, [open]);

  const { data: allCars, isLoading } = useQuery<RailcarWithAssignment[]>({
    queryKey: ["/api/railcars"],
    enabled: open,
  });

  // Only show unassigned cars
  const unassigned = (allCars ?? []).filter((c) => !c.assignment);

  const visible = unassigned.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.car_number.toLowerCase().includes(q) ||
      c.reporting_marks?.toLowerCase().includes(q) ||
      c.car_type?.toLowerCase().includes(q) ||
      (c as any).entity?.toLowerCase().includes(q)
    );
  });

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Existing Unassigned Cars</DialogTitle>
          <p className="text-sm text-muted-foreground">Select cars from the registry that have no current assignment.</p>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search car #, marks, type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto border border-border rounded-lg">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              {unassigned.length === 0 ? "No unassigned cars available." : "No cars match your search."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                <tr>
                  <th className="w-10 pl-4 py-2" />
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-medium">Car #</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-medium">Marks</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-medium">Type</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-medium">Entity</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr
                    key={c.id}
                    className={cn("border-t border-border/40 cursor-pointer hover:bg-muted/20", selected.has(c.id) && "bg-primary/5")}
                    onClick={() => toggle(c.id)}
                  >
                    <td className="pl-4 py-2.5">
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold">{c.car_number}</td>
                    <td className="px-3 py-2.5 font-mono text-muted-foreground text-xs">{c.reporting_marks ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{c.car_type ?? "—"}</td>
                    <td className="px-3 py-2.5"><EntityBadge entity={(c as any).entity ?? "Main"} /></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{c.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">{selected.size} car{selected.size !== 1 ? "s" : ""} selected</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => { onConfirm(Array.from(selected)); onClose(); }}>
              Confirm Selection
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── New Car row editor ────────────────────────────────────────────────────────
function NewCarRow({ car, onChange, onRemove }: {
  car: NewCar;
  onChange: (c: NewCar) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-start border border-border/60 rounded-lg p-3 bg-muted/10">
      <div className="col-span-2">
        <Label className="text-[10px] text-muted-foreground mb-1 block">Car Number <span className="text-destructive">*</span></Label>
        <Input
          className="h-8 text-xs font-mono"
          placeholder="123456"
          value={car.car_number}
          onChange={(e) => onChange({ ...car, car_number: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="col-span-2">
        <Label className="text-[10px] text-muted-foreground mb-1 block">Reporting Marks</Label>
        <Input
          className="h-8 text-xs font-mono"
          placeholder="OFOX"
          value={car.reporting_marks}
          onChange={(e) => onChange({ ...car, reporting_marks: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="col-span-2">
        <Label className="text-[10px] text-muted-foreground mb-1 block">Car Type</Label>
        <Input
          className="h-8 text-xs"
          placeholder="Hopper"
          value={car.car_type}
          onChange={(e) => onChange({ ...car, car_type: e.target.value })}
        />
      </div>
      <div className="col-span-2">
        <Label className="text-[10px] text-muted-foreground mb-1 block">Entity</Label>
        <Select value={car.entity} onValueChange={(v) => onChange({ ...car, entity: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ENTITY_OPTIONS.map((e) => <SelectItem key={e} value={e}>{ENTITY_LABEL[e] ?? e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2">
        <Label className="text-[10px] text-muted-foreground mb-1 block">Status</Label>
        <Select value={car.status} onValueChange={(v) => onChange({ ...car, status: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-1">
        <Label className="text-[10px] text-muted-foreground mb-1 block">Notes</Label>
        <Input className="h-8 text-xs" placeholder="Optional" value={car.notes} onChange={(e) => onChange({ ...car, notes: e.target.value })} />
      </div>
      <div className="col-span-1 flex items-end justify-end pb-0.5">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onRemove}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Bulk car number paste parser ──────────────────────────────────────────────
function BulkPasteDialog({ open, onClose, onAdd }: {
  open: boolean;
  onClose: () => void;
  onAdd: (cars: NewCar[]) => void;
}) {
  const [text, setText] = useState("");
  const [entity, setEntity] = useState("Main");
  const [carType, setCarType] = useState("");

  const lines = text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Add Car Numbers</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Paste a list of car numbers (one per line, or comma/semicolon separated). You can edit individual car details afterward.
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Car Numbers</Label>
            <Textarea
              rows={8}
              className="font-mono text-xs"
              placeholder={"123456\n123457\n123458\n…"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">{lines.length} car number{lines.length !== 1 ? "s" : ""} detected</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Default Entity</Label>
              <Select value={entity} onValueChange={setEntity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_OPTIONS.map((e) => <SelectItem key={e} value={e}>{ENTITY_LABEL[e] ?? e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Default Car Type</Label>
              <Input placeholder="Hopper" value={carType} onChange={(e) => setCarType(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={lines.length === 0}
            onClick={() => {
              const cars = lines.map((num) => ({
                ...blankCar(),
                car_number: num.toUpperCase(),
                entity,
                car_type: carType,
              }));
              onAdd(cars);
              onClose();
              setText("");
            }}
          >
            Add {lines.length} Car{lines.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────
export default function LeaseWizard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const canEdit = useCanEdit();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — MLA
  const [mla, setMla] = useState<MlaForm>({
    lease_number: "", agreement_number: "", lessor: "",
    lessee: "", lease_type: "Railcar Lease", effective_date: "", notes: "",
  });

  // Step 2 — Riders
  const [riders, setRiders] = useState<RiderForm[]>([blankRider()]);
  const [activeRiderIdx, setActiveRiderIdx] = useState(0);

  // Step 3 — Cars (per rider, tracked in riders[].new_cars + riders[].existing_car_ids)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);

  // Derived
  const { data: allCars } = useQuery<RailcarWithAssignment[]>({ queryKey: ["/api/railcars"] });
  const carById = new Map((allCars ?? []).map((c) => [c.id, c]));

  const activeRider = riders[activeRiderIdx];
  const totalNewCars = riders.reduce((s, r) => s + r.new_cars.length + r.existing_car_ids.length, 0);

  function updateRider(idx: number, patch: Partial<RiderForm>) {
    setRiders((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function addRider() {
    const newRiders = [...riders, blankRider()];
    setRiders(newRiders);
    setActiveRiderIdx(newRiders.length - 1);
  }

  function removeRider(idx: number) {
    if (riders.length === 1) return;
    const next = riders.filter((_, i) => i !== idx);
    setRiders(next);
    setActiveRiderIdx(Math.min(activeRiderIdx, next.length - 1));
  }

  function updateCar(riderIdx: number, carKey: string, patch: Partial<NewCar>) {
    setRiders((prev) => prev.map((r, i) => i !== riderIdx ? r : {
      ...r,
      new_cars: r.new_cars.map((c) => c._key === carKey ? { ...c, ...patch } : c),
    }));
  }

  function removeCar(riderIdx: number, carKey: string) {
    setRiders((prev) => prev.map((r, i) => i !== riderIdx ? r : {
      ...r,
      new_cars: r.new_cars.filter((c) => c._key !== carKey),
    }));
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const step1Valid = mla.lease_number.trim().length > 0 && mla.lessee.trim().length > 0;
  const step2Valid = riders.every((r) => r.rider_name.trim().length > 0);
  const step3Valid = riders.every((r) =>
    r.new_cars.every((c) => c.car_number.trim().length > 0)
  );

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true);
    try {
      const payload = {
        mla: {
          lease_number: mla.lease_number,
          agreement_number: mla.agreement_number || null,
          lessor: mla.lessor || null,
          lessee: mla.lessee,
          lease_type: mla.lease_type || null,
          effective_date: mla.effective_date || null,
          notes: mla.notes || null,
        },
        riders: riders.map((r) => ({
          rider: {
            rider_name: r.rider_name,
            schedule_number: r.schedule_number || null,
            effective_date: r.effective_date || null,
            expiration_date: r.expiration_date || null,
            permissible_commodity: r.permissible_commodity || null,
            monthly_rate_pct: r.monthly_rate_pct ? parseFloat(r.monthly_rate_pct) : null,
            lessors_cost: r.lessors_cost ? parseFloat(r.lessors_cost.replace(/[^0-9.]/g, "")) : null,
            base_term_months: r.base_term_months ? parseInt(r.base_term_months) : null,
            monthly_rent_per_car: r.monthly_rent_per_car ? parseFloat(r.monthly_rent_per_car) : null,
            sold_to: r.sold_to?.trim() || null,
            notes: r.notes || null,
          },
          fleet_name: r.fleet_name || null,
          existing_car_ids: r.existing_car_ids,
          cars: r.new_cars.map((c) => ({
            car_number: c.car_number,
            reporting_marks: c.reporting_marks || null,
            car_type: c.car_type || null,
            entity: c.entity || null,
            status: c.status || "Active/In-Service",
            notes: c.notes || null,
          })),
        })),
      };

      await apiRequest("POST", "/api/setup-lease", payload);
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });

      const totalCars = riders.reduce((s, r) => s + r.new_cars.length + r.existing_car_ids.length, 0);
      toast({
        title: "Lease setup complete",
        description: `MLA "${mla.lease_number}" created with ${riders.length} rider${riders.length !== 1 ? "s" : ""} and ${totalCars} car${totalCars !== 1 ? "s" : ""} assigned.`,
      });
      navigate("/leases");
    } catch (e: any) {
      toast({ title: "Setup failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="New Lease Setup"
        subtitle="Create a master lease, add riders, and assign cars — all in one flow"
        actions={
          <Button variant="secondary" onClick={() => navigate("/leases")}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
        }
      />

      <div className="px-8 py-6 max-w-4xl mx-auto">
        <StepBar current={step} total={4} />

        {/* ── STEP 1: MLA ─────────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="rounded-lg border border-card-border bg-card p-6 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Master Lease Agreement</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Lease Number <span className="text-destructive">*</span></Label>
                  <Input placeholder="H07-200" value={mla.lease_number} onChange={(e) => setMla({ ...mla, lease_number: e.target.value })} />
                </div>
                <div>
                  <Label>Agreement Number</Label>
                  <Input placeholder="Optional internal reference" value={mla.agreement_number} onChange={(e) => setMla({ ...mla, agreement_number: e.target.value })} />
                </div>
                <div>
                  <Label>Lessor</Label>
                  <Input placeholder="e.g. RESIDCO" value={mla.lessor} onChange={(e) => setMla({ ...mla, lessor: e.target.value })} />
                </div>
                <div>
                  <Label>Lessee <span className="text-destructive">*</span></Label>
                  <Input placeholder="Company name" value={mla.lessee} onChange={(e) => setMla({ ...mla, lessee: e.target.value })} />
                </div>
                <div>
                  <Label>Lease Type</Label>
                  <Select value={mla.lease_type} onValueChange={(v) => setMla({ ...mla, lease_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Railcar Lease">Railcar Lease</SelectItem>
                      <SelectItem value="Net Lease">Net Lease</SelectItem>
                      <SelectItem value="Full Service Lease">Full Service Lease</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Effective Date</Label>
                  <Input type="date" value={mla.effective_date} onChange={(e) => setMla({ ...mla, effective_date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea rows={3} placeholder="Any relevant context about this master lease…" value={mla.notes} onChange={(e) => setMla({ ...mla, notes: e.target.value })} />
              </div>
            </div>

            {!step1Valid && (
              <div className="flex items-center gap-2 text-sm text-[hsl(var(--warning))]">
                <AlertCircle className="h-4 w-4" />
                Lease Number and Lessee are required to continue.
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Riders ───────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Rider tab bar */}
            <div className="flex items-center gap-2 flex-wrap">
              {riders.map((r, i) => (
                <button
                  key={r._key}
                  onClick={() => setActiveRiderIdx(i)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-medium border transition-all",
                    i === activeRiderIdx
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:border-primary/40"
                  )}
                >
                  {r.rider_name.trim() || `Rider ${i + 1}`}
                </button>
              ))}
              <button
                onClick={addRider}
                className="px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-all flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> Add Rider
              </button>
            </div>

            {/* Active rider form */}
            <div className="rounded-lg border border-card-border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Rider {activeRiderIdx + 1} of {riders.length}</h2>
                </div>
                {riders.length > 1 && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => removeRider(activeRiderIdx)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove this rider
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Rider Name <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="e.g. Schedule 001 — Exxon Mobile"
                    value={activeRider.rider_name}
                    onChange={(e) => updateRider(activeRiderIdx, { rider_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Schedule Number</Label>
                  <Input placeholder="001" value={activeRider.schedule_number} onChange={(e) => updateRider(activeRiderIdx, { schedule_number: e.target.value })} />
                </div>
                <div>
                  <Label>Effective Date</Label>
                  <Input type="date" value={activeRider.effective_date} onChange={(e) => updateRider(activeRiderIdx, { effective_date: e.target.value })} />
                </div>
                <div>
                  <Label>Expiration Date</Label>
                  <Input type="date" value={activeRider.expiration_date} onChange={(e) => updateRider(activeRiderIdx, { expiration_date: e.target.value })} />
                </div>
                <div>
                  <Label>Permissible Commodity</Label>
                  <Input placeholder="e.g. Chemical, Grain" value={activeRider.permissible_commodity} onChange={(e) => updateRider(activeRiderIdx, { permissible_commodity: e.target.value })} />
                </div>
                <div>
                  <Label>Lessee Name</Label>
                  <Input placeholder="Used to group cars by lessee" value={activeRider.fleet_name} onChange={(e) => updateRider(activeRiderIdx, { fleet_name: e.target.value })} />
                </div>
                <div>
                  <Label>Monthly Rate %</Label>
                  <Input type="number" step="0.001" placeholder="1.500" value={activeRider.monthly_rate_pct} onChange={(e) => updateRider(activeRiderIdx, { monthly_rate_pct: e.target.value })} />
                </div>
                <div>
                  <Label>Lessor's Cost ($)</Label>
                  <Input placeholder="$0" value={activeRider.lessors_cost} onChange={(e) => updateRider(activeRiderIdx, { lessors_cost: e.target.value })} />
                </div>
                <div>
                  <Label>Base Term (months)</Label>
                  <Input type="number" placeholder="120" value={activeRider.base_term_months} onChange={(e) => updateRider(activeRiderIdx, { base_term_months: e.target.value })} />
                </div>
                <div>
                  <Label>Monthly Rent per Car ($)</Label>
                  <Input type="number" step="0.01" min="0" placeholder="e.g. 450.00" value={activeRider.monthly_rent_per_car} onChange={(e) => updateRider(activeRiderIdx, { monthly_rent_per_car: e.target.value })} />
                  <p className="text-xs text-muted-foreground mt-1">Typical range: $100 – $850 per car / month</p>
                </div>
                <div>
                  <Label>Sold / Transferred To</Label>
                  <Input placeholder="Buyer company name (leave blank if not sold)" value={activeRider.sold_to} onChange={(e) => updateRider(activeRiderIdx, { sold_to: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea rows={2} placeholder="Any notes about this rider…" value={activeRider.notes} onChange={(e) => updateRider(activeRiderIdx, { notes: e.target.value })} />
              </div>
            </div>

            {!step2Valid && (
              <div className="flex items-center gap-2 text-sm text-[hsl(var(--warning))]">
                <AlertCircle className="h-4 w-4" />
                Every rider needs a name before continuing.
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Cars ─────────────────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Rider tab bar */}
            <div className="flex items-center gap-2 flex-wrap">
              {riders.map((r, i) => (
                <button
                  key={r._key}
                  onClick={() => setActiveRiderIdx(i)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-medium border transition-all",
                    i === activeRiderIdx
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:border-primary/40"
                  )}
                >
                  {r.rider_name || `Rider ${i + 1}`}
                  <span className="ml-1.5 opacity-70">
                    ({r.new_cars.length + r.existing_car_ids.length})
                  </span>
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-card-border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Car className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Cars for: {activeRider.rider_name}</h2>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setBulkPasteOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Bulk Add Numbers
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                    <Search className="h-3.5 w-3.5 mr-1" /> Pick Existing Cars
                  </Button>
                  <Button size="sm" onClick={() => updateRider(activeRiderIdx, { new_cars: [...activeRider.new_cars, blankCar()] })}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
                  </Button>
                </div>
              </div>

              {/* Existing cars picked from registry */}
              {activeRider.existing_car_ids.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    From Registry ({activeRider.existing_car_ids.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {activeRider.existing_car_ids.map((id) => {
                      const c = carById.get(id);
                      return (
                        <div key={id} className="flex items-center gap-1.5 bg-muted rounded-full px-3 py-1 text-xs">
                          <span className="font-mono font-semibold">{c?.car_number ?? id}</span>
                          {c && <EntityBadge entity={(c as any).entity ?? "Main"} />}
                          <button
                            className="text-muted-foreground hover:text-destructive ml-1"
                            onClick={() => updateRider(activeRiderIdx, { existing_car_ids: activeRider.existing_car_ids.filter((x) => x !== id) })}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* New car rows */}
              {activeRider.new_cars.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    New Cars to Create ({activeRider.new_cars.length})
                  </p>
                  {activeRider.new_cars.map((car) => (
                    <NewCarRow
                      key={car._key}
                      car={car}
                      onChange={(c) => updateCar(activeRiderIdx, car._key, c)}
                      onRemove={() => removeCar(activeRiderIdx, car._key)}
                    />
                  ))}
                </div>
              ) : activeRider.existing_car_ids.length === 0 ? (
                <div className="border-2 border-dashed border-border rounded-lg py-12 text-center space-y-3">
                  <Car className="h-8 w-8 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">No cars added yet for this rider.</p>
                  <p className="text-xs text-muted-foreground">Use "Bulk Add Numbers" to paste a list, "Pick Existing Cars" to assign cars already in the registry, or "Add Row" to enter one at a time.</p>
                </div>
              ) : null}
            </div>

            {!step3Valid && (
              <div className="flex items-center gap-2 text-sm text-[hsl(var(--warning))]">
                <AlertCircle className="h-4 w-4" />
                All new car rows require a car number.
              </div>
            )}
          </div>
        )}

        {/* ── STEP 4: Review ───────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-5">
            {/* MLA summary */}
            <div className="rounded-lg border border-card-border bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Master Lease</h2>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Lease #</span>
                  <span className="font-mono font-semibold">{mla.lease_number}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Lessor</span>
                  <span>{mla.lessor}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Lessee</span>
                  <span>{mla.lessee}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Type</span>
                  <span>{mla.lease_type || "—"}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Effective</span>
                  <span>{mla.effective_date || "—"}</span>
                </div>
              </div>
            </div>

            {/* Riders summary */}
            {riders.map((r, i) => (
              <div key={r._key} className="rounded-lg border border-card-border bg-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Users className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">{r.rider_name}</h2>
                    {r.schedule_number && <span className="text-xs text-muted-foreground">Sch {r.schedule_number}</span>}
                    {r.sold_to?.trim() && (
                      <span className="text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30">
                        SOLD → {r.sold_to}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">
                    {r.new_cars.length + r.existing_car_ids.length} car{r.new_cars.length + r.existing_car_ids.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Effective</span>
                    <span>{r.effective_date || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Expires</span>
                    <span>{r.expiration_date || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Lessee</span>
                    <span>{r.fleet_name || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Commodity</span>
                    <span>{r.permissible_commodity || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Monthly Rent / Car</span>
                    <span>{r.monthly_rent_per_car ? `$${parseFloat(r.monthly_rent_per_car).toFixed(2)}` : "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Lessor's Cost</span>
                    <span>{r.lessors_cost ? `$${r.lessors_cost}` : "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Base Term</span>
                    <span>{r.base_term_months ? `${r.base_term_months} mo` : "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Rate %</span>
                    <span>{r.monthly_rate_pct ? `${r.monthly_rate_pct}%` : "—"}</span>
                  </div>
                </div>
                {/* Car list */}
                {(r.new_cars.length > 0 || r.existing_car_ids.length > 0) && (
                  <div className="border-t border-border pt-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Cars</p>
                    <div className="flex flex-wrap gap-1.5">
                      {r.existing_car_ids.map((id) => {
                        const c = carById.get(id);
                        return (
                          <span key={id} className="flex items-center gap-1 bg-muted rounded-full px-2.5 py-0.5 text-xs font-mono">
                            {c?.car_number ?? id}
                            {c && <EntityBadge entity={(c as any).entity ?? "Main"} />}
                          </span>
                        );
                      })}
                      {r.new_cars.map((c) => (
                        <span key={c._key} className="flex items-center gap-1 bg-primary/10 border border-primary/20 rounded-full px-2.5 py-0.5 text-xs font-mono">
                          {c.car_number || "—"}
                          <EntityBadge entity={c.entity} />
                          <span className="text-[9px] text-primary ml-0.5">NEW</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Totals */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-center justify-between">
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Riders </span>
                  <span className="font-semibold">{riders.length}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total cars </span>
                  <span className="font-semibold">{totalNewCars}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">New cars to create </span>
                  <span className="font-semibold">{riders.reduce((s, r) => s + r.new_cars.length, 0)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">From registry </span>
                  <span className="font-semibold">{riders.reduce((s, r) => s + r.existing_car_ids.length, 0)}</span>
                </div>
              </div>
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
          </div>
        )}

        {/* ── Navigation ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
          <Button
            variant="secondary"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 1}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Step {step} of 4
          </div>
          {step < 4 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 1 && !step1Valid) ||
                (step === 2 && !step2Valid) ||
                (step === 3 && !step3Valid)
              }
            >
              Continue <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting || !canEdit} title={!canEdit ? "Viewer accounts cannot create leases" : undefined}>
              {submitting ? "Creating…" : "Create Lease"}
            </Button>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ExistingCarPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentIds={activeRider?.existing_car_ids ?? []}
        onConfirm={(ids) => updateRider(activeRiderIdx, { existing_car_ids: ids })}
      />
      <BulkPasteDialog
        open={bulkPasteOpen}
        onClose={() => setBulkPasteOpen(false)}
        onAdd={(cars) => updateRider(activeRiderIdx, { new_cars: [...activeRider.new_cars, ...cars] })}
      />
    </div>
  );
}
