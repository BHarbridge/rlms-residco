import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import DvSubNav from "./DvSubNav";
import type { AbCodeRow, CarDepRateRow, CostFactorRow, SalvageQuarterRow } from "@/lib/dv/types";
import { fmtUsd, fmtPct, quarterLabel } from "@/lib/dv/format";

export default function ReferencePage() {
  return (
    <>
    <DvSubNav />
    <div className="px-4 md:px-8 py-5 md:py-8 max-w-[1600px]">
      <header className="mb-5 md:mb-6">
        <h1 className="text-lg md:text-xl font-semibold tracking-tight">Reference Data</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
          AAR-published rates and factors. Add new quarterly rows here — historical values are preserved.
        </p>
      </header>

      <Tabs defaultValue="cost" className="w-full">
        <div className="mb-4 -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto no-scrollbar">
          <TabsList className="w-max">
            <TabsTrigger value="cost" data-testid="tab-cost">Cost Factors</TabsTrigger>
            <TabsTrigger value="salvage" data-testid="tab-salvage">Salvage Rates</TabsTrigger>
            <TabsTrigger value="ab" data-testid="tab-ab">A&B Codes</TabsTrigger>
            <TabsTrigger value="car" data-testid="tab-car">Car Rates</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="cost"><CostFactors /></TabsContent>
        <TabsContent value="salvage"><Salvage /></TabsContent>
        <TabsContent value="ab"><AbCodes /></TabsContent>
        <TabsContent value="car"><CarRates /></TabsContent>
      </Tabs>
    </div>
    </>
  );
}

/* ---------------------------------------------------------------- utils */
function useMut<T>(url: string, onDone?: () => void) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (body: T) => {
      const res = await apiRequest("POST", url, body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [url] });
      onDone?.();
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });
}

/* ---------------------------------------------------------- cost factors */
function CostFactors() {
  const { data = [] } = useQuery<CostFactorRow[]>({ queryKey: ["/api/reference/cost-factors"] });
  const [year, setYear] = useState("");
  const [factor, setFactor] = useState("");
  const [pub, setPub] = useState("0");
  const mut = useMut<any>("/api/reference/cost-factors", () => { setYear(""); setFactor(""); });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 md:p-5 border-b border-card-border bg-muted/30 flex flex-col sm:flex-row sm:items-end gap-3 sm:flex-wrap">
          <FormField label="Year"><Input inputMode="numeric" className="sm:w-28" value={year} onChange={(e) => setYear(e.target.value)} data-testid="input-cf-year" /></FormField>
          <FormField label="Factor"><Input inputMode="numeric" className="sm:w-28" value={factor} onChange={(e) => setFactor(e.target.value)} data-testid="input-cf-factor" /></FormField>
          <FormField label="Publication Q (code, e.g. 20261)" hint="0 = current"><Input inputMode="numeric" className="sm:w-36" value={pub} onChange={(e) => setPub(e.target.value)} data-testid="input-cf-pub" /></FormField>
          <Button
            size="sm"
            disabled={!year || !factor || mut.isPending}
            onClick={() => mut.mutate({ year: Number(year), factor: Number(factor), publication_q: Number(pub) || 0, source: "Manual entry" })}
            data-testid="button-add-cf"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />Add / Update
          </Button>
        </div>
        <div className="max-h-[65vh] overflow-auto">
          <Table className="min-w-[480px]">
            <TableHeader><TableRow className="text-[11px]"><TableHead>Year</TableHead><TableHead>Factor</TableHead><TableHead>Pub Q</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id} className="text-xs">
                  <TableCell className="font-mono">{r.year}</TableCell>
                  <TableCell className="font-mono">{r.factor}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{r.publication_q || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.source || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- salvage */
function Salvage() {
  const { data = [] } = useQuery<SalvageQuarterRow[]>({ queryKey: ["/api/reference/salvage"] });
  const [f, setF] = useState({ quarter_code: "", steel_per_lb: "", aluminum_per_lb: "", stainless_per_lb: "", dismantling_per_gt: "" });
  const mut = useMut<any>("/api/reference/salvage", () => setF({ quarter_code: "", steel_per_lb: "", aluminum_per_lb: "", stainless_per_lb: "", dismantling_per_gt: "" }));

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 md:p-5 border-b border-card-border bg-muted/30 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <FormField label="Quarter Code" hint="YYYYQ e.g. 20262"><Input value={f.quarter_code} onChange={(e) => setF({ ...f, quarter_code: e.target.value })} data-testid="input-sv-qc" /></FormField>
          <FormField label="Steel $/lb (JC 4244)"><Input value={f.steel_per_lb} onChange={(e) => setF({ ...f, steel_per_lb: e.target.value })} data-testid="input-sv-steel" /></FormField>
          <FormField label="Aluminum $/lb (JC 4236)"><Input value={f.aluminum_per_lb} onChange={(e) => setF({ ...f, aluminum_per_lb: e.target.value })} data-testid="input-sv-al" /></FormField>
          <FormField label="Stainless $/lb (JC 4246)"><Input value={f.stainless_per_lb} onChange={(e) => setF({ ...f, stainless_per_lb: e.target.value })} data-testid="input-sv-ss" /></FormField>
          <FormField label="Dismantling $/GT (JC 4489)"><Input value={f.dismantling_per_gt} onChange={(e) => setF({ ...f, dismantling_per_gt: e.target.value })} data-testid="input-sv-dm" /></FormField>
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!f.quarter_code || !f.dismantling_per_gt || mut.isPending}
              onClick={() => mut.mutate({
                quarter_code: Number(f.quarter_code),
                steel_per_lb: Number(f.steel_per_lb) || 0,
                aluminum_per_lb: Number(f.aluminum_per_lb) || 0,
                stainless_per_lb: f.stainless_per_lb ? Number(f.stainless_per_lb) : null,
                dismantling_per_gt: Number(f.dismantling_per_gt) || 0,
                source: "Manual entry",
              })}
              data-testid="button-add-sv"
            ><Plus className="h-3.5 w-3.5 mr-1" />Add / Update</Button>
          </div>
        </div>
        <div className="max-h-[65vh] overflow-auto">
          <Table className="min-w-[720px]">
            <TableHeader><TableRow className="text-[11px]">
              <TableHead>Quarter</TableHead>
              <TableHead className="text-right">Steel $/lb</TableHead>
              <TableHead className="text-right">Aluminum $/lb</TableHead>
              <TableHead className="text-right">Stainless $/lb</TableHead>
              <TableHead className="text-right">Dismantling $/GT</TableHead>
              <TableHead>Source</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id} className="text-xs">
                  <TableCell className="font-mono">{quarterLabel(r.quarter_code)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtUsd(r.steel_per_lb, { showZero: true })}</TableCell>
                  <TableCell className="text-right font-mono">{fmtUsd(r.aluminum_per_lb, { showZero: true })}</TableCell>
                  <TableCell className="text-right font-mono">{r.stainless_per_lb == null ? "—" : fmtUsd(r.stainless_per_lb)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtUsd(r.dismantling_per_gt, { showZero: true })}</TableCell>
                  <TableCell className="text-muted-foreground truncate max-w-[280px]">{r.source || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- A&B codes */
function AbCodes() {
  const { data = [] } = useQuery<AbCodeRow[]>({ queryKey: ["/api/reference/ab-codes"] });
  const [f, setF] = useState({ code: "", description: "", rate_basis: "ANNUAL", rate: "", max_depreciation: "0.90" });
  const mut = useMut<any>("/api/reference/ab-codes", () => setF({ code: "", description: "", rate_basis: "ANNUAL", rate: "", max_depreciation: "0.90" }));

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 md:p-5 border-b border-card-border bg-muted/30 grid grid-cols-12 gap-3 items-end">
          <FormField label="Code" className="col-span-6 sm:col-span-2"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} data-testid="input-ab-code" /></FormField>
          <FormField label="Description" className="col-span-12 sm:col-span-5"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="input-ab-desc" /></FormField>
          <FormField label="Rate Basis" className="col-span-6 sm:col-span-2">
            <Select value={f.rate_basis} onValueChange={(v) => setF({ ...f, rate_basis: v })}>
              <SelectTrigger data-testid="select-ab-basis"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ANNUAL">ANNUAL</SelectItem>
                <SelectItem value="MONTHLY">MONTHLY</SelectItem>
                <SelectItem value="SAME_AS_CAR">SAME_AS_CAR</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Rate (decimal)" className="col-span-4 sm:col-span-1"><Input value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} data-testid="input-ab-rate" /></FormField>
          <FormField label="Max Dep" className="col-span-4 sm:col-span-1"><Input value={f.max_depreciation} onChange={(e) => setF({ ...f, max_depreciation: e.target.value })} data-testid="input-ab-max" /></FormField>
          <div className="col-span-4 sm:col-span-1">
            <Button size="sm" className="w-full" disabled={!f.code || !f.rate || mut.isPending} onClick={() => mut.mutate({
              code: f.code,
              description: f.description,
              rate_basis: f.rate_basis,
              rate: Number(f.rate),
              max_depreciation: Number(f.max_depreciation),
            })} data-testid="button-add-ab-code">
              <Plus className="h-3.5 w-3.5 mr-1" />Add
            </Button>
          </div>
        </div>
        <div className="max-h-[65vh] overflow-auto">
          <Table className="min-w-[640px]">
            <TableHeader><TableRow className="text-[11px]">
              <TableHead>Code</TableHead>
              <TableHead>Basis</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Max Dep</TableHead>
              <TableHead>Description</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id} className="text-xs">
                  <TableCell className="font-mono font-semibold">{r.code}</TableCell>
                  <TableCell className="font-mono text-[11px]">{r.rate_basis}</TableCell>
                  <TableCell className="text-right font-mono">{r.rate_basis === "MONTHLY" ? `${fmtPct(r.rate)}/mo` : r.rate_basis === "ANNUAL" ? `${fmtPct(r.rate)}/yr` : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmtPct(r.max_depreciation)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{r.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------- car rates */
function CarRates() {
  const { data = [] } = useQuery<CarDepRateRow[]>({ queryKey: ["/api/reference/car-rates"] });
  return (
    <Card>
      <CardContent className="p-0 max-h-[75vh] overflow-auto">
        <Table className="min-w-[640px]">
          <TableHeader><TableRow className="text-[11px]">
            <TableHead>Equipment Type</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Annual Rate</TableHead>
            <TableHead className="text-right">Max Dep</TableHead>
            <TableHead className="text-right">Age Cutoff</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.equipment_type} className="text-xs">
                <TableCell className="font-mono font-semibold">{r.equipment_type}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{r.display_name}</TableCell>
                <TableCell className="text-right font-mono">{fmtPct(r.annual_rate, 3)}</TableCell>
                <TableCell className="text-right font-mono">{fmtPct(r.max_depreciation)}</TableCell>
                <TableCell className="text-right font-mono">{r.age_cutoff_years}y</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- small */
function FormField({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
        {label}
        {hint && <span className="text-[10px] text-muted-foreground/60 normal-case">· {hint}</span>}
      </Label>
      {children}
    </div>
  );
}
