import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Search, Download, FileText, Share2 } from "lucide-react";
import DvSubNav from "./DvSubNav";
import { useToast } from "@/hooks/use-toast";
import { useRoute } from "wouter";
import type { DvCalculation } from "@/lib/dv/types";
import { fmtUsd, fmtDate, fmtPct, quarterLabel } from "@/lib/dv/format";
import { shareCalculationPdf, canNativeShareFiles } from "@/lib/dv/pdf";

export default function HistoryPage() {
  const [, params] = useRoute("/dv/history/:id");
  const selectedId = params?.id ? Number(params.id) : null;
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: items = [], isLoading } = useQuery<DvCalculation[]>({
    queryKey: ["/api/calculations"],
  });

  const filtered = items.filter((it) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return [it.car_initial, it.car_number, it.railroad, it.ddct_incident_no, it.incident_location, it.notes]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(s));
  });

  const selected = selectedId ? items.find((i) => i.id === selectedId) : null;

  const del = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/calculations/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/calculations"] });
      toast({ title: "Deleted" });
    },
  });

  return (
    <>
    <DvSubNav />
    <div className="px-4 md:px-8 py-5 md:py-8 max-w-[1600px]">
      <header className="mb-5 md:mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl font-semibold tracking-tight">History</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            {items.length} saved calculation{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:min-w-[300px]">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Filter by car, railroad, DDCT…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="input-search-history"
            />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6">
        {/* List */}
        <Card>
          <CardContent className="p-0 max-h-[60vh] lg:max-h-[80vh] overflow-auto">
            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-sm text-muted-foreground text-center italic">
                {items.length === 0 ? "No calculations saved yet." : "No matches."}
              </div>
            ) : (
              <Table className="min-w-[520px]">
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>Car</TableHead>
                    <TableHead>Incident</TableHead>
                    <TableHead>DDCT</TableHead>
                    <TableHead className="text-right">DV</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((it) => {
                    const active = selectedId === it.id;
                    return (
                      <TableRow
                        key={it.id}
                        className={`cursor-pointer hover-elevate text-xs ${active ? "bg-accent" : ""}`}
                        onClick={() => history.replaceState(null, "", `#/history/${it.id}`)}
                        data-testid={`row-calc-${it.id}`}
                      >
                        <TableCell className="font-mono">{it.car_initial} {it.car_number}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(it.incident_date)}</TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">{it.ddct_incident_no || "—"}</TableCell>
                        <TableCell className="text-right font-mono font-medium">{fmtUsd(it.total_dv, { showZero: true })}</TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); if (confirm("Delete this calculation?")) del.mutate(it.id); }}
                            data-testid={`button-delete-${it.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Detail */}
        <div>
          {selected ? <Detail calc={selected} /> : (
            <Card>
              <CardContent className="p-10 text-sm text-muted-foreground text-center italic">
                <FileText className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
                Select a calculation to view details.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function Detail({ calc }: { calc: DvCalculation }) {
  const r = calc.result_json;
  const [canShareNative, setCanShareNative] = useState(false);
  const [sharing, setSharing] = useState(false);
  useEffect(() => { setCanShareNative(canNativeShareFiles()); }, []);
  const handleShare = async () => {
    setSharing(true);
    try {
      await shareCalculationPdf(r, {
        carInitial: calc.car_initial,
        carNumber: calc.car_number,
        railroad: calc.railroad,
        ddctIncidentNo: calc.ddct_incident_no,
        incidentDate: calc.incident_date,
        incidentLocation: calc.incident_location,
        calcId: calc.id,
        tareWeightLb: calc.tare_weight_lb,
      });
    } finally {
      setSharing(false);
    }
  };
  const print = () => {
    const prev = document.title;
    const car = `${calc.car_initial || ""}${calc.car_number || ""}`.trim() || `calc-${calc.id}`;
    document.title = `Rule107-DV_${car}_DDCT-${calc.ddct_incident_no || calc.id}`;
    window.print();
    setTimeout(() => { document.title = prev; }, 1000);
  };

  return (
    <Card className="overflow-hidden print-root">
      {/* Print-only header (hidden on screen) */}
      <div className="print-header print-only">
        <div>
          <div className="brand">AAR Rule 107 · Depreciated Value Calculation</div>
          <div className="brand-sub">Office Manual Rule 107.E · Settlement Worksheet</div>
        </div>
        <div className="meta">
          <div><strong>Calc #{calc.id}</strong> · {calc.car_initial} {calc.car_number}</div>
          <div>{calc.railroad || "—"} · DDCT {calc.ddct_incident_no || "—"}</div>
          <div>Incident: {fmtDate(calc.incident_date)}{calc.incident_location ? ` · ${calc.incident_location}` : ""}</div>
          <div>Generated: {new Date().toLocaleString()}</div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 md:py-5 border-b border-card-border flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between no-print">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Calculation #{calc.id}</div>
          <div className="font-mono text-lg font-semibold mt-1">{calc.car_initial} {calc.car_number}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {calc.railroad || "—"} · DDCT {calc.ddct_incident_no || "—"} · {fmtDate(calc.incident_date)}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {calc.over_age_cutoff ? (
            <Badge variant="destructive" className="text-[10px]">Over Age Cutoff</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">Within Cutoff</Badge>
          )}
          {canShareNative && (
            <Button variant="default" size="sm" disabled={sharing} onClick={handleShare} data-testid="button-share">
              <Share2 className="h-3.5 w-3.5 mr-1.5" />{sharing ? "Preparing…" : "Share"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={print} data-testid="button-print">
            <Download className="h-3.5 w-3.5 mr-1.5" />Print / PDF
          </Button>
        </div>
      </div>

      <CardContent className="p-0 divide-y divide-card-border">
        <div className="p-5 grid grid-cols-2 gap-4 sm:gap-5">
          <Kpi label="Depreciated Value" value={fmtUsd(calc.total_dv, { showZero: true })} big accent />
          <Kpi label="Salvage + 20%" value={fmtUsd(calc.salvage_plus_20, { showZero: true })} big />
          <Kpi label="Total Reproduction" value={fmtUsd(calc.total_reproduction, { showZero: true })} />
          <Kpi label="Salvage" value={fmtUsd(calc.total_salvage, { showZero: true })} />
        </div>

        <div className="px-5 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Row l="Build Date" r={fmtDate(calc.build_date)} />
          <Row l="Incident Location" r={calc.incident_location || "—"} />
          <Row l="Equipment Type" r={calc.equipment_type} />
          <Row l="Age Cutoff" r={`${r.ageCutoffYears}y`} />
          <Row l="Age" r={`${r.ageYears}y ${r.ageMonths}m`} />
          <Row l="Salvage Quarter" r={quarterLabel(r.quarterCode)} />
          <Row l="Original Cost" r={fmtUsd(calc.original_cost)} />
          <Row l="Tare" r={`${calc.tare_weight_lb.toLocaleString()} lb`} />
        </div>

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
                <LineRow line={r.base} />
                {r.abItems.map((ab, i) => <LineRow key={i} line={ab} />)}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium">Rule 108 · Dismantled Car</div>
            <Badge variant="outline" className="text-[10px]">For comparison</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 pt-1">
            <Kpi label="Salvage Value" value={fmtUsd(calc.total_salvage, { showZero: true })} />
            <Kpi label="Dismantling Allowance" value={fmtUsd(calc.dismantling_allow, { showZero: true })} />
            <Kpi label="Owner Entitled (SV − Dismantling)" value={fmtUsd(calc.total_salvage - calc.dismantling_allow, { showZero: true })} accent />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <Row l="Tare (gross tons)" r={`${(calc.tare_weight_lb / 2240).toFixed(2)} GT`} />
            <Row l="Dismantling rate" r={`JC 4489 · ${quarterLabel(r.quarterCode)}`} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
            Under a Rule 108 event, the owner is entitled to Salvage Value less the Dismantling Allowance (the handling line retains the dismantling cost).
          </p>
        </div>

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
                <MatrixRow label="A · Handling Line Possession" row={r.settlementMatrix.handlingLine} />
                <MatrixRow label="B · Owner, Repaired (offered)" row={r.settlementMatrix.ownerRepairedOffered} />
                <MatrixRow label="B · Owner, Repaired (not offered)" row={r.settlementMatrix.ownerRepairedNotOffered} muted />
                <MatrixRow label="C · Owner, Dismantled (offered)" row={r.settlementMatrix.ownerDismantledOffered} />
                <MatrixRow label="C · Owner, Dismantled (not offered)" row={r.settlementMatrix.ownerDismantledNotOffered} muted />
              </TableBody>
            </Table>
          </div>
        </div>

        {calc.notes && (
          <div className="p-5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-2">Notes</div>
            <p className="text-sm whitespace-pre-wrap">{calc.notes}</p>
          </div>
        )}

        {r.warnings.length > 0 && (
          <div className="p-5 bg-destructive/5 space-y-1">
            <div className="text-[11px] uppercase tracking-[0.12em] font-medium text-destructive mb-1">Warnings</div>
            {r.warnings.map((w, i) => <div key={i} className="text-xs text-muted-foreground">• {w}</div>)}
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
      <div className={`font-mono ${big ? "text-xl" : "text-sm"} ${accent ? "text-accent-foreground" : ""}`}>{value}</div>
    </div>
  );
}
function Row({ l, r }: { l: string; r: string }) {
  return <div className="flex justify-between tabular-nums"><span className="text-muted-foreground">{l}</span><span className="font-mono">{r}</span></div>;
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
