import { useRef, useState } from "react";
import { useCanEdit } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PreviewRow {
  _row: number;
  car_number: string;
  reporting_marks: string | null;
  car_type: string | null;
  status: string;
  fleet_name: string | null;
  rider_name: string | null;
  rider_id: number | null;
  notes: string | null;
  is_dupe: boolean;
  warnings: string[];
  valid: boolean;
}

interface PreviewResult {
  total: number;
  valid: number;
  dupes: number;
  errors: number;
  preview: PreviewRow[];
}

interface CommitResult {
  ok: boolean;
  imported: number;
  assigned: number;
}

// ── CSV parser (client-side, no library needed for simple cases) ───────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    // Simple CSV split — handles basic quoted fields
    const values: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { values.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    values.push(cur.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (values[i] ?? "").replace(/^"|"$/g, ""); });
    return obj;
  });
}

// ── XLSX parser via SheetJS (loaded from CDN lazily) ─────────────────────────
declare const XLSX: any;

async function loadXLSX(): Promise<void> {
  if (typeof XLSX !== "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function parseXLSX(file: File): Promise<Record<string, string>[]> {
  await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, string>[];
}

// ── Status badge ──────────────────────────────────────────────────────────────
function RowStatus({ row }: { row: PreviewRow }) {
  if (!row.car_number)
    return <span className="text-[10px] text-red-400 font-medium uppercase">Error</span>;
  if (row.is_dupe)
    return <span className="text-[10px] text-amber-400 font-medium uppercase">Duplicate</span>;
  if (row.warnings.length > 0)
    return <span className="text-[10px] text-yellow-400 font-medium uppercase">Warning</span>;
  return <span className="text-[10px] text-emerald-400 font-medium uppercase">Ready</span>;
}

// ── Template download ─────────────────────────────────────────────────────────
function downloadTemplate() {
  const header = "car_number,reporting_marks,car_type,status,fleet_name,rider_name,notes";
  const example = "HWCX99001,HWCX,Hopper,Active/In-Service,COVIA,SCH 5,";
  const blob = new Blob([header + "\n" + example], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "rlms-import-template.csv";
  a.click();
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BulkImportPage() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committed, setCommitted] = useState<CommitResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [rawRows, setRawRows] = useState<PreviewRow[]>([]);

  const { data: riders } = useQuery<any[]>({ queryKey: ["/api/riders"] });

  async function handleFile(file: File) {
    setPreview(null);
    setCommitted(null);
    setFileName(file.name);
    setLoading(true);
    try {
      let rows: Record<string, string>[];
      if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        const text = await file.text();
        rows = parseCSV(text);
      } else {
        rows = await parseXLSX(file);
      }
      if (rows.length === 0) throw new Error("No data rows found in file.");

      const res = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result: PreviewResult = await res.json();
      setPreview(result);
      setRawRows(result.preview);
    } catch (e: any) {
      toast({ title: "Parse error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!rawRows.length) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rawRows }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result: CommitResult = await res.json();
      setCommitted(result);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `Imported ${result.imported} railcars successfully` });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const displayRows = showAll ? rawRows : rawRows.slice(0, 50);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Bulk Import"
        subtitle="Upload a CSV or Excel file to add railcars to the fleet registry"
      />

      {/* Success state */}
      {committed && (
        <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
          <div className="text-lg font-semibold text-foreground">{committed.imported} railcars imported</div>
          <div className="text-sm text-muted-foreground mt-1">{committed.assigned} cars assigned to riders</div>
          <Button className="mt-4" variant="secondary" onClick={() => { setCommitted(null); setFileName(null); setRawRows([]); }}>
            Import another file
          </Button>
        </div>
      )}

      {!committed && (
        <>
          {/* Drop zone */}
          <div
            className={cn(
              "mt-6 rounded-lg border-2 border-dashed border-border bg-card hover:border-primary/50 transition-colors cursor-pointer text-center p-10",
              loading && "opacity-60 pointer-events-none"
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <div className="text-sm font-medium text-foreground">
              {fileName ? fileName : "Drop a CSV or Excel file here"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              or click to browse · .csv, .xlsx, .xls supported
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
          </div>

          {/* Template download + column guide */}
          <div className="mt-4 flex items-start gap-3 p-4 rounded-lg border border-border bg-card/60">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-foreground">Expected columns</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                {[
                  ["car_number", "Required · e.g. HWCX010823"],
                  ["reporting_marks", "Optional · e.g. HWCX"],
                  ["car_type", "Optional · e.g. Hopper"],
                  ["status", "Optional · defaults to Active/In-Service"],
                  ["fleet_name", "Optional · e.g. COVIA"],
                  ["rider_name", `Optional · must match exactly: ${(riders ?? []).map((r: any) => r.rider_name).join(", ") || "loading\u2026"}`],
                  ["notes", "Optional"],
                ].map(([col, desc]) => (
                  <div key={col}>
                    <span className="font-mono text-foreground">{col}</span>
                    <span className="text-muted-foreground"> — {desc}</span>
                  </div>
                ))}
              </div>
              <button onClick={downloadTemplate} className="mt-2 text-primary underline-offset-2 hover:underline">
                Download template CSV
              </button>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="mt-6 space-y-2">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}

          {/* Preview */}
          {preview && !loading && (
            <div className="mt-6 space-y-4">
              {/* Summary badges */}
              <div className="flex items-center gap-3 flex-wrap">
                <StatChip icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="Total" value={preview.total} />
                <StatChip icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />} label="Ready to import" value={preview.valid} color="emerald" />
                {preview.dupes > 0 && <StatChip icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />} label="Duplicates (skip)" value={preview.dupes} color="amber" />}
                {preview.errors > 0 && <StatChip icon={<XCircle className="h-3.5 w-3.5 text-red-400" />} label="Errors" value={preview.errors} color="red" />}
              </div>

              {/* Row table */}
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="overflow-auto max-h-[480px]">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">#</th>
                        <th className="px-3 py-2 text-left font-medium">Car Number</th>
                        <th className="px-3 py-2 text-left font-medium">Marks</th>
                        <th className="px-3 py-2 text-left font-medium">Type</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-left font-medium">Lessee</th>
                        <th className="px-3 py-2 text-left font-medium">Rider</th>
                        <th className="px-3 py-2 text-left font-medium">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row) => (
                        <tr
                          key={row._row}
                          className={cn(
                            "border-t border-border",
                            !row.valid && "bg-red-500/5",
                            row.is_dupe && "bg-amber-500/5",
                            row.warnings.length > 0 && row.valid && "bg-yellow-500/5"
                          )}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{row._row}</td>
                          <td className="px-3 py-2 font-mono font-medium">{row.car_number || <span className="text-red-400 italic">missing</span>}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.reporting_marks ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.car_type ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.status}</td>
                          <td className="px-3 py-2">{row.fleet_name ?? "—"}</td>
                          <td className="px-3 py-2">{row.rider_name ?? "—"}</td>
                          <td className="px-3 py-2">
                            <div className="space-y-0.5">
                              <RowStatus row={row} />
                              {row.warnings.map((w, i) => (
                                <div key={i} className="text-[10px] text-amber-400">{w}</div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rawRows.length > 50 && (
                  <div className="border-t border-border px-4 py-2 text-center">
                    <button
                      onClick={() => setShowAll((s) => !s)}
                      className="text-xs text-primary flex items-center gap-1 mx-auto hover:underline"
                    >
                      {showAll ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {showAll ? "Show less" : `Show all ${rawRows.length} rows`}
                    </button>
                  </div>
                )}
              </div>

              {/* Commit */}
              <div className="flex items-center gap-3 justify-end">
                <span className="text-xs text-muted-foreground">
                  {preview.valid} of {preview.total} rows will be imported
                </span>
                <Button variant="secondary" onClick={() => { setPreview(null); setFileName(null); setRawRows([]); }}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCommit}
                  disabled={preview.valid === 0 || loading || !canEdit}
                >
                  {!canEdit ? "View only" : loading ? "Importing…" : `Import ${preview.valid} railcars`}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatChip({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: "emerald" | "amber" | "red";
}) {
  const colorCls = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    red: "border-red-500/20 bg-red-500/10 text-red-400",
  }[color ?? ""] ?? "border-border bg-card text-muted-foreground";

  return (
    <div className={cn("flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium", colorCls)}>
      {icon}
      <span className="tabular-nums font-semibold">{value}</span>
      <span className="text-[11px] opacity-80">{label}</span>
    </div>
  );
}
