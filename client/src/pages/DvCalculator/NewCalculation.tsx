import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Save, Calculator, AlertCircle, Check, Search, Download, Share2 } from "lucide-react";
import DvSubNav from "./DvSubNav";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import type { AbCodeRow, CarDepRateRow, DvResult, EquipmentType, RailcarRow, CalculationPayload } from "@/lib/dv/types";
import { fmtUsd, fmtPct, fmtDate, quarterLabel, fmtInt } from "@/lib/dv/format";
import { shareCalculationPdf, canNativeShareFiles } from "@/lib/dv/pdf";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/* --------------------------------------------------------- state factory */

interface AbRowState {
  code: string;
  value: string;
  installDate: string;
}

interface FormState {
  railroad: string;
  ddctNumber: string;
  incidentDate: string;
  incidentLocation: string;
  carInitial: string;
  carNumber: string;
  tareWeightLb: string;
  steelWeightLb: string;
  aluminumWeightLb: string;
  stainlessWeightLb: string;
  nonMetallicWeightLb: string;
  originalCost: string;
  buildDate: string;
  equipmentType: EquipmentType;
  notes: string;
  railcarId: number | null;
  abItems: AbRowState[];
}

const TODAY = new Date().toISOString().slice(0, 10);

const INITIAL: FormState = {
  railroad: "",
  ddctNumber: "",
  incidentDate: TODAY,
  incidentLocation: "",
  carInitial: "",
  carNumber: "",
  tareWeightLb: "",
  steelWeightLb: "",
  aluminumWeightLb: "",
  stainlessWeightLb: "0",
  nonMetallicWeightLb: "0",
  originalCost: "",
  buildDate: "",
  equipmentType: "MODERN_OR_ILS",
  notes: "",
  railcarId: null,
  abItems: [],
};

/* ---------------------------------------------------------------- page */

export default function NewCalculationPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [preview, setPreview] = useState<DvResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Reference lookups
  const { data: abCodes = [] } = useQuery<AbCodeRow[]>({ queryKey: ["/api/reference/ab-codes"] });
  const { data: carRates = [] } = useQuery<CarDepRateRow[]>({ queryKey: ["/api/reference/car-rates"] });

  /* ---------- live preview: debounced /api/calculate ---------- */
  useEffect(() => {
    const ready =
      form.buildDate &&
      form.incidentDate &&
      Number(form.originalCost) > 0 &&
      Number(form.tareWeightLb) > 0 &&
      form.equipmentType;
    if (!ready) { setPreview(null); setPreviewError(null); return; }

    const h = setTimeout(async () => {
      try {
        const res = await apiRequest("POST", "/api/calculate", toPayload(form));
        const j = await res.json();
        setPreview(j.result);
        setPreviewError(null);
      } catch (e: any) {
        setPreview(null);
        setPreviewError(e?.message || "Calculation error");
      }
    }, 300);
    return () => clearTimeout(h);
  }, [form]);

  /* ---------- save ---------- */
  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/calculations", toPayload(form));
      return res.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/calculations"] });
      toast({ title: "Calculation saved", description: `#${data.id} — ${form.carInitial || ""} ${form.carNumber || ""}` });
      navigate(`/dv/history/${data.id}`);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  const resetForm = () => { setForm(INITIAL); setPreview(null); setPreviewError(null); };

  const canSave = !!preview && !previewError && !saveMut.isPending;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  /* ---------- A&B row helpers ---------- */
  const addAb = () => setForm((f) => ({ ...f, abItems: [...f.abItems, { code: abCodes[0]?.code || "GNRL", value: "", installDate: TODAY }] }));
  const rmAb = (i: number) => setForm((f) => ({ ...f, abItems: f.abItems.filter((_, k) => k !== i) }));
  const setAb = (i: number, patch: Partial<AbRowState>) =>
    setForm((f) => ({ ...f, abItems: f.abItems.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));

  return (
    <>
    <DvSubNav />
    <div className="px-4 md:px-8 py-5 md:py-8 max-w-[1600px]">
      <header className="mb-5 md:mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl font-semibold tracking-tight">New Calculation</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            AAR Rule 107.E · Depreciated Value, Salvage, and Settlement Matrix
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={resetForm} data-testid="button-reset">Reset</Button>
          <Button size="sm" disabled={!canSave} onClick={() => saveMut.mutate()} data-testid="button-save">
            <Save className="h-4 w-4 mr-1.5" />
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_480px] gap-6">
        {/* ---- FORM ---- */}
        <div className="space-y-6">
          <Section title="Railcar & Incident">
            <div className="grid grid-cols-12 gap-4">
              <Field className="col-span-12 sm:col-span-5" label="Find existing railcar">
                <RailcarFinder
                  value={form.carInitial && form.carNumber ? `${form.carInitial} ${form.carNumber}` : ""}
                  onPick={(r) => setForm((f) => ({
                    ...f,
                    carInitial: r.car_initial,
                    carNumber: r.car_number,
                    tareWeightLb: r.tare_weight_lbs ? String(r.tare_weight_lbs) : f.tareWeightLb,
                    buildDate: r.built_year ? `${r.built_year}-01-01` : f.buildDate,
                    originalCost: r.oec ? String(r.oec) : f.originalCost,
                    railcarId: r.id,
                  }))}
                />
              </Field>
              <Field className="col-span-12 sm:col-span-3" label="Car Initial"><Input data-testid="input-car-initial" value={form.carInitial} onChange={(e) => set("carInitial", e.target.value.toUpperCase())} /></Field>
              <Field className="col-span-12 sm:col-span-4" label="Car Number"><Input data-testid="input-car-number" value={form.carNumber} onChange={(e) => set("carNumber", e.target.value)} /></Field>

              <Field className="col-span-12 sm:col-span-4" label="Railroad"><Input data-testid="input-railroad" placeholder="e.g. BNSF" value={form.railroad} onChange={(e) => set("railroad", e.target.value)} /></Field>
              <Field className="col-span-12 sm:col-span-4" label="DDCT / Incident #"><Input data-testid="input-ddct" value={form.ddctNumber} onChange={(e) => set("ddctNumber", e.target.value)} /></Field>
              <Field className="col-span-12 sm:col-span-4" label="Incident Date*"><Input type="date" data-testid="input-incident-date" value={form.incidentDate} onChange={(e) => set("incidentDate", e.target.value)} /></Field>

              <Field className="col-span-12 sm:col-span-12" label="Incident Location"><Input data-testid="input-incident-location" placeholder="City, State" value={form.incidentLocation} onChange={(e) => set("incidentLocation", e.target.value)} /></Field>
            </div>
          </Section>

          <Section title="Car Specifications">
            <div className="grid grid-cols-12 gap-4">
              <Field className="col-span-12 sm:col-span-6" label="Build / Rebuilt Date*">
                <Input type="date" data-testid="input-build-date" value={form.buildDate} onChange={(e) => set("buildDate", e.target.value)} />
              </Field>
              <Field className="col-span-12 sm:col-span-6" label="Original / Rebuilt / ILS Cost*">
                <Input inputMode="decimal" data-testid="input-original-cost" placeholder="0.00" value={form.originalCost} onChange={(e) => set("originalCost", e.target.value)} />
              </Field>
              <Field className="col-span-12 sm:col-span-12" label="Equipment Type*">
                <Select value={form.equipmentType} onValueChange={(v) => set("equipmentType", v as EquipmentType)}>
                  <SelectTrigger data-testid="select-equipment-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {carRates.map((r) => (
                      <SelectItem key={r.equipment_type} value={r.equipment_type}>
                        {r.display_name}  · {fmtPct(r.annual_rate, 3)}/yr · cutoff {r.age_cutoff_years}y
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field className="col-span-12 sm:col-span-4" label="Tare Weight (lb)*">
                <Input inputMode="numeric" data-testid="input-tare" value={form.tareWeightLb} onChange={(e) => set("tareWeightLb", e.target.value)} />
              </Field>
              <Field className="col-span-12 sm:col-span-4" label="Steel Weight (lb)">
                <Input inputMode="numeric" data-testid="input-steel" value={form.steelWeightLb} onChange={(e) => set("steelWeightLb", e.target.value)} />
              </Field>
              <Field className="col-span-12 sm:col-span-4" label="Aluminum Weight (lb)">
                <Input inputMode="numeric" data-testid="input-aluminum" value={form.aluminumWeightLb} onChange={(e) => set("aluminumWeightLb", e.target.value)} />
              </Field>
              <Field className="col-span-12 sm:col-span-4" label="Stainless Weight (lb)">
                <Input inputMode="numeric" data-testid="input-stainless" value={form.stainlessWeightLb} onChange={(e) => set("stainlessWeightLb", e.target.value)} />
              </Field>
              <Field className="col-span-12 sm:col-span-4" label="Non-Metallic Weight (lb)">
                <Input inputMode="numeric" data-testid="input-non-metallic" value={form.nonMetallicWeightLb} onChange={(e) => set("nonMetallicWeightLb", e.target.value)} />
              </Field>
              <Field className="col-span-12 sm:col-span-4" label="Residual" hint="Auto">
                <Input disabled value={residualWeight(form)} />
              </Field>
            </div>
          </Section>

          <Section
            title="Additions & Betterments"
            right={<Button size="sm" variant="outline" onClick={addAb} data-testid="button-add-ab"><Plus className="h-3.5 w-3.5 mr-1" />Add A&B</Button>}
          >
            {form.abItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 italic">
                No A&B items. Click "Add A&B" to capture improvements such as LOLI, INIT, ABES, etc.
              </p>
            ) : (
              <div className="space-y-3">
                {form.abItems.map((row, i) => {
                  const meta = abCodes.find((c) => c.code === row.code);
                  return (
                    <div key={i} className="grid grid-cols-12 gap-3 items-end p-3 rounded-md border border-card-border bg-card">
                      <Field className="col-span-12 sm:col-span-3" label="Code">
                        <Select value={row.code} onValueChange={(v) => setAb(i, { code: v })}>
                          <SelectTrigger data-testid={`select-ab-code-${i}`}><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            {abCodes.map((c) => (
                              <SelectItem key={c.code} value={c.code}>
                                {c.code} · {c.rate_basis === "MONTHLY" ? `${fmtPct(c.rate)}/mo` : c.rate_basis === "SAME_AS_CAR" ? "same as car" : `${fmtPct(c.rate)}/yr`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field className="col-span-12 sm:col-span-3" label="Value ($)">
                        <Input inputMode="decimal" data-testid={`input-ab-value-${i}`} value={row.value} onChange={(e) => setAb(i, { value: e.target.value })} />
                      </Field>
                      <Field className="col-span-12 sm:col-span-3" label="Install Date">
                        <Input type="date" data-testid={`input-ab-date-${i}`} value={row.installDate} onChange={(e) => setAb(i, { installDate: e.target.value })} />
                      </Field>
                      <div className="col-span-12 sm:col-span-2 text-xs text-muted-foreground leading-tight">
                        {meta?.description?.slice(0, 80) || ""}
                      </div>
                      <div className="col-span-12 sm:col-span-1 flex justify-end">
                        <Button size="icon" variant="ghost" onClick={() => rmAb(i)} data-testid={`button-rm-ab-${i}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Notes">
            <Textarea data-testid="input-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional — reviewer notes, flags, etc." />
          </Section>
        </div>

        {/* ---- LIVE PREVIEW ---- */}
        <div className="xl:sticky xl:top-6 self-start">
          <PreviewCard preview={preview} error={previewError} form={form} />
        </div>
      </div>
    </div>
    </>
  );
}

/* ------------------------------------------------------------- helpers */

function toPayload(f: FormState): CalculationPayload {
  return {
    railcarId: f.railcarId,
    railroad: f.railroad || undefined,
    ddctNumber: f.ddctNumber || undefined,
    incidentLocation: f.incidentLocation || undefined,
    carInitial: f.carInitial || undefined,
    carNumber: f.carNumber || undefined,
    notes: f.notes || undefined,
    incidentDate: f.incidentDate,
    buildDate: f.buildDate,
    originalCost: Number(f.originalCost) || 0,
    tareWeightLb: Number(f.tareWeightLb) || 0,
    steelWeightLb: Number(f.steelWeightLb) || 0,
    aluminumWeightLb: Number(f.aluminumWeightLb) || 0,
    stainlessWeightLb: Number(f.stainlessWeightLb) || 0,
    nonMetallicWeightLb: Number(f.nonMetallicWeightLb) || 0,
    equipmentType: f.equipmentType,
    abItems: f.abItems
      .filter((r) => r.code && Number(r.value) > 0 && r.installDate)
      .map((r) => ({ code: r.code, value: Number(r.value), installDate: r.installDate })),
  };
}

function residualWeight(f: FormState): string {
  const tare = Number(f.tareWeightLb) || 0;
  const known = (Number(f.steelWeightLb) || 0) + (Number(f.aluminumWeightLb) || 0) + (Number(f.stainlessWeightLb) || 0) + (Number(f.nonMetallicWeightLb) || 0);
  if (!tare) return "";
  return fmtInt(tare - known);
}

/* ------------------------------------------------------------- blocks */

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-4 px-5 border-b border-card-border">
        <CardTitle className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</CardTitle>
        {right}
      </CardHeader>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        {label}
        {hint && <span className="text-[10px] uppercase text-muted-foreground/60">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

/* ------------------------------------------------ existing-railcar picker */

function RailcarFinder({ value, onPick }: { value: string; onPick: (r: RailcarRow) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: cars = [], isLoading } = useQuery<RailcarRow[]>({
    queryKey: ["/api/dv/railcars", q],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/dv/railcars${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      return res.json();
    },
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start font-normal" data-testid="button-find-railcar">
          <Search className="h-4 w-4 mr-2 text-muted-foreground" />
          {value || <span className="text-muted-foreground">Search RLMS fleet…</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[380px]">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search by initial or number…" value={q} onValueChange={setQ} />
          <CommandList>
            {isLoading && <div className="py-3 text-center text-xs text-muted-foreground">Searching…</div>}
            <CommandEmpty>No railcars found.</CommandEmpty>
            <CommandGroup>
              {cars.map((c) => (
                <CommandItem key={c.id} value={`${c.car_initial}-${c.car_number}`} onSelect={() => { onPick(c); setOpen(false); }}>
                  <div className="flex w-full justify-between items-center">
                    <span className="font-mono text-sm">{c.car_initial} {c.car_number}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {c.built_year ?? "—"} · {c.tare_weight_lbs ? fmtInt(c.tare_weight_lbs) : "—"}lb
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ----------------------------------------------------------- preview */

function PreviewCard({ preview, error, form }: { preview: DvResult | null; error: string | null; form: FormState }) {
  // Re-evaluate on mount so SSR/hydration never reports the wrong value
  const [canShareNative, setCanShareNative] = useState(false);
  const [sharing, setSharing] = useState(false);
  useEffect(() => { setCanShareNative(canNativeShareFiles()); }, []);
  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-5 flex gap-3 items-start text-sm">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-destructive">Cannot calculate</div>
            <div className="text-muted-foreground mt-1">{error}</div>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!preview) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-2">
          <Calculator className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <div className="text-sm text-muted-foreground">
            Fill in build date, original cost, tare weight, and equipment type to see a live calculation.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden print-root">
      {/* Print-only header (hidden on screen) */}
      <div className="print-header print-only">
        <div>
          <div className="brand">AAR Rule 107 · Depreciated Value Calculation</div>
          <div className="brand-sub">Office Manual Rule 107.E · Settlement Worksheet</div>
        </div>
        <div className="meta">
          <div><strong>{form.carInitial || "—"} {form.carNumber || "—"}</strong></div>
          <div>{form.railroad || "—"} · DDCT {form.ddctNumber || "—"}</div>
          <div>Incident: {form.incidentDate ? fmtDate(form.incidentDate) : "—"}{form.incidentLocation ? ` · ${form.incidentLocation}` : ""}</div>
          <div>Generated: {new Date().toLocaleString()}</div>
        </div>
      </div>

      <CardHeader className="py-4 px-5 border-b border-card-border bg-muted/30 no-print">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Live Preview</CardTitle>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {preview.overAgeCutoff ? (
              <Badge variant="destructive" className="text-[10px]">Over Age Cutoff → SV Only</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]"><Check className="h-3 w-3 mr-1" />Within cutoff</Badge>
            )}
            {canShareNative && (
              <Button
                variant="default"
                size="sm"
                disabled={sharing}
                onClick={async () => {
                  setSharing(true);
                  try {
                    await shareCalculationPdf(preview, {
                      carInitial: form.carInitial,
                      carNumber: form.carNumber,
                      railroad: form.railroad,
                      ddctIncidentNo: form.ddctNumber,
                      incidentDate: form.incidentDate,
                      incidentLocation: form.incidentLocation,
                      tareWeightLb: Number(form.tareWeightLb) || null,
                    });
                  } finally {
                    setSharing(false);
                  }
                }}
                data-testid="button-share-preview"
              >
                <Share2 className="h-3.5 w-3.5 mr-1.5" />{sharing ? "Preparing…" : "Share"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const prev = document.title;
                const car = `${form.carInitial || ""}${form.carNumber || ""}`.trim() || "preview";
                const ddct = form.ddctNumber || "preview";
                document.title = `Rule107-DV_${car}_DDCT-${ddct}`;
                window.print();
                setTimeout(() => { document.title = prev; }, 1000);
              }}
              data-testid="button-print-preview"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />Print / PDF
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 divide-y divide-card-border">
        {/* Totals */}
        <div className="p-5 grid grid-cols-2 gap-4">
          <Kpi label="Depreciated Value" value={fmtUsd(preview.totalDepreciatedValue, { showZero: true })} big accent />
          <Kpi label="Salvage + 20%" value={fmtUsd(preview.salvage.salvagePlus20, { showZero: true })} big />
          <Kpi label="Total Reproduction" value={fmtUsd(preview.totalReproductionCost, { showZero: true })} />
          <Kpi label="Salvage Value" value={fmtUsd(preview.salvage.totalSalvage, { showZero: true })} />
        </div>

        {/* Context */}
        <div className="px-5 py-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Row l="Age" r={`${preview.ageYears}y ${preview.ageMonths}m (${preview.ageTotalYearsDecimal.toFixed(2)})`} />
          <Row l="Salvage Quarter" r={quarterLabel(preview.quarterCode)} />
          <Row l="Cost Factor (build)" r={String(preview.costFactorBuildYear)} />
          <Row l="Cost Factor (prior)" r={`${preview.costFactorPriorToDamageYear} · ${preview.priorYear}`} />
          <Row l="Age Cutoff" r={`${preview.ageCutoffYears} years`} />
          <Row l="Dismantling" r={fmtUsd(preview.salvage.dismantlingAllowance, { showZero: true })} />
        </div>

        {/* Line breakdown */}
        <div className="p-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-2">Reproduction & Depreciation</div>
          <div className="-mx-5 px-5 overflow-x-auto">
            <Table className="min-w-[480px]">
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead>Line</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead className="text-right">Repro</TableHead>
                  <TableHead className="text-right">Dep %</TableHead>
                  <TableHead className="text-right">DV</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <LineRow line={preview.base} />
                {preview.abItems.map((ab, i) => <LineRow key={i} line={ab} />)}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Rule 108 view */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium">Rule 108 · Dismantled Car</div>
            <Badge variant="outline" className="text-[10px]">For comparison</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 pt-1">
            <Kpi label="Salvage Value" value={fmtUsd(preview.salvage.totalSalvage, { showZero: true })} />
            <Kpi label="Dismantling Allowance" value={fmtUsd(preview.salvage.dismantlingAllowance, { showZero: true })} />
            <Kpi label="Owner Entitled (SV − Dismantling)" value={fmtUsd(preview.salvage.totalSalvage - preview.salvage.dismantlingAllowance, { showZero: true })} accent />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <Row l="Tare (gross tons)" r={`${((Number(form.tareWeightLb) || 0) / 2240).toFixed(2)} GT`} />
            <Row l="Dismantling rate" r={`JC 4489 · ${quarterLabel(preview.quarterCode)}`} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
            Under a Rule 108 event, the owner is entitled to Salvage Value less the Dismantling Allowance (the handling line retains the dismantling cost). Shown here for comparison only.
          </p>
        </div>

        {/* Settlement matrix */}
        <div className="p-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-2">Settlement Matrix · Exhibit I</div>
          <div className="-mx-5 px-5 overflow-x-auto">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead>Condition</TableHead>
                  <TableHead className="text-right">DV</TableHead>
                  <TableHead className="text-right">SV</TableHead>
                  <TableHead className="text-right">SV+20%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs">
                <MatrixRow label="A · Handling Line Possession" row={preview.settlementMatrix.handlingLine} />
                <MatrixRow label="B · Owner, Repaired (offered)" row={preview.settlementMatrix.ownerRepairedOffered} />
                <MatrixRow label="B · Owner, Repaired (not offered)" row={preview.settlementMatrix.ownerRepairedNotOffered} muted />
                <MatrixRow label="C · Owner, Dismantled (offered)" row={preview.settlementMatrix.ownerDismantledOffered} />
                <MatrixRow label="C · Owner, Dismantled (not offered)" row={preview.settlementMatrix.ownerDismantledNotOffered} muted />
              </TableBody>
            </Table>
          </div>
        </div>

        {preview.warnings.length > 0 && (
          <div className="p-5 bg-destructive/5 space-y-1.5">
            {preview.warnings.map((w, i) => (
              <div key={i} className="flex gap-2 items-start text-xs">
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <span className="text-muted-foreground">{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Print-only footer */}
        <div className="print-footer print-only">
          Computed per AAR Office Manual Rule 107.E. Cost factors from Exhibit II; salvage factors from Exhibit IV; A&B codes from Exhibit V.
          {" "}This worksheet is provided for settlement discussion; refer to the current AAR Office Manual for authoritative text.
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, big, accent }: { label: string; value: string; big?: boolean; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">{label}</div>
      <div className={`font-mono ${big ? "text-xl" : "text-sm"} ${accent ? "text-accent-foreground" : ""}`} data-testid={`text-kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        {value}
      </div>
    </div>
  );
}
function Row({ l, r }: { l: string; r: string }) {
  return (
    <div className="flex justify-between tabular-nums">
      <span className="text-muted-foreground">{l}</span>
      <span className="font-mono">{r}</span>
    </div>
  );
}
function LineRow({ line }: { line: any }) {
  return (
    <TableRow className="text-xs">
      <TableCell className="font-medium">{line.label}</TableCell>
      <TableCell className="font-mono text-[11px] text-muted-foreground">{line.yearOrMonthBasis}</TableCell>
      <TableCell className="text-right font-mono">{fmtUsd(line.reproductionCost, { showZero: true })}</TableCell>
      <TableCell className="text-right font-mono">{fmtPct(line.depreciationRate)}</TableCell>
      <TableCell className="text-right font-mono font-medium">{fmtUsd(line.depreciatedValue, { showZero: true })}</TableCell>
    </TableRow>
  );
}
function MatrixRow({ label, row, muted }: { label: string; row: { dv: number; sv: number; svPlus20: number }; muted?: boolean }) {
  return (
    <TableRow className={muted ? "opacity-70" : ""}>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right font-mono">{fmtUsd(row.dv, { showZero: true })}</TableCell>
      <TableCell className="text-right font-mono">{fmtUsd(row.sv, { showZero: true })}</TableCell>
      <TableCell className="text-right font-mono">{fmtUsd(row.svPlus20, { showZero: true })}</TableCell>
    </TableRow>
  );
}
