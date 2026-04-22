import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Search,
  Plus,
  Download,
  Upload,
  Filter,
  FileText,
  AlertTriangle,
  Clock,
  DollarSign,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Scale,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Trash2,
  Pencil,
  Phone,
  Mail,
  Calendar,
  RefreshCw,
  ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────
type InvoiceStatus = "unpaid" | "partial" | "paid" | "closed";

interface Invoice {
  id: string;
  invoice_number: string;
  lessee_name: string;
  vendor_name: string | null;
  amount: number | null;
  amount_paid: number | null;
  invoice_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  status: InvoiceStatus;
  is_disputed: boolean;
  repair_description: string | null;
  notes: string | null;
  last_communication_date: string | null;
  last_communication_notes: string | null;
  next_followup_date: string | null;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

interface DisputeLog {
  id: string;
  invoice_id: string;
  log_date: string;
  logged_by: string | null;
  description: string;
  outcome: string | null;
  created_at: string;
}

interface CommLog {
  id: string;
  invoice_id: string;
  comm_date: string;
  comm_type: string;
  contact_name: string | null;
  notes: string;
  logged_by: string | null;
  created_at: string;
}

interface InvoiceDetail extends Invoice {
  dispute_logs: DisputeLog[];
  communications: CommLog[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmt$ = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
}

function agingBucket(daysOvd: number): "current" | "30" | "60" | "90+" {
  if (daysOvd === 0) return "current";
  if (daysOvd <= 30) return "30";
  if (daysOvd <= 60) return "60";
  return "90+";
}

const STATUS_META: Record<InvoiceStatus, { label: string; color: string }> = {
  unpaid: { label: "Unpaid", color: "bg-error/10 text-error border-error/30" },
  partial: { label: "Partial", color: "bg-warning/10 text-warning border-warning/30" },
  paid: { label: "Paid", color: "bg-success/10 text-success border-success/30" },
  closed: { label: "Closed", color: "bg-muted/40 text-muted-foreground border-muted/40" },
};

function StatusBadge({ status, disputed }: { status: InvoiceStatus; disputed: boolean }) {
  const m = STATUS_META[status] ?? STATUS_META.unpaid;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", m.color)}>
        {m.label}
      </span>
      {disputed && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
          <Scale className="h-3 w-3" />Disputed
        </span>
      )}
    </div>
  );
}

// ─── KPI tiles ────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, icon: Icon, accent = "neutral", onClick,
}: {
  label: string; value: string; sub?: string;
  icon: React.FC<{ className?: string }>;
  accent?: "neutral" | "error" | "warning" | "success" | "primary";
  onClick?: () => void;
}) {
  const accentMap = {
    neutral: "text-muted-foreground",
    error: "text-error",
    warning: "text-warning",
    success: "text-success",
    primary: "text-primary",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border border-card-border bg-card p-4 text-left transition-colors",
        onClick ? "cursor-pointer hover:bg-muted/20" : "cursor-default"
      )}
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-4 w-4 shrink-0", accentMap[accent])} />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </button>
  );
}

// ─── Invoice form ──────────────────────────────────────────────────────────
const EMPTY_FORM = {
  invoice_number: "", lessee_name: "", vendor_name: "", amount: "",
  amount_paid: "", invoice_date: "", due_date: "", paid_date: "",
  status: "unpaid" as InvoiceStatus, repair_description: "", notes: "",
  last_communication_date: "", next_followup_date: "",
};

function InvoiceForm({
  initial, onSave, onCancel, loading,
}: {
  initial?: Partial<typeof EMPTY_FORM>;
  onSave: (d: Record<string, any>) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [f, setF] = useState({ ...EMPTY_FORM, ...initial });
  const set = (k: keyof typeof EMPTY_FORM, v: string) => setF(prev => ({ ...prev, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.invoice_number.trim()) return;
    if (!f.lessee_name.trim()) return;
    const payload: Record<string, any> = { ...f };
    ["amount", "amount_paid"].forEach(k => {
      payload[k] = f[k as keyof typeof EMPTY_FORM] === "" ? null : parseFloat(f[k as keyof typeof EMPTY_FORM] as string);
    });
    ["invoice_date", "due_date", "paid_date", "last_communication_date", "next_followup_date"].forEach(k => {
      payload[k] = f[k as keyof typeof EMPTY_FORM] === "" ? null : f[k as keyof typeof EMPTY_FORM];
    });
    ["vendor_name", "repair_description", "notes"].forEach(k => {
      payload[k] = f[k as keyof typeof EMPTY_FORM] === "" ? null : f[k as keyof typeof EMPTY_FORM];
    });
    onSave(payload);
  }

  const field = (label: string, k: keyof typeof EMPTY_FORM, type = "text", placeholder = "") => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        type={type} value={f[k] as string} placeholder={placeholder}
        onChange={e => set(k, e.target.value)}
        className="h-9 text-sm"
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field("Invoice Number *", "invoice_number", "text", "INV-2025-0001")}
        {field("Lessee Name *", "lessee_name", "text", "Lessee company name")}
        {field("Vendor / Repair Shop", "vendor_name", "text", "RailServ LLC")}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select value={f.status} onValueChange={v => set("status", v as InvoiceStatus)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {field("Total Amount ($)", "amount", "number", "0.00")}
        {field("Amount Paid ($)", "amount_paid", "number", "0.00")}
        {field("Invoice Date", "invoice_date", "date")}
        {field("Due Date", "due_date", "date")}
        {field("Paid Date", "paid_date", "date")}
        {field("Last Communication", "last_communication_date", "date")}
        {field("Next Follow-up", "next_followup_date", "date")}
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Repair Description</label>
        <Textarea
          value={f.repair_description}
          onChange={e => set("repair_description", e.target.value)}
          placeholder="Describe the repair work covered by this invoice..."
          className="text-sm min-h-[72px] resize-none"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Notes</label>
        <Textarea
          value={f.notes}
          onChange={e => set("notes", e.target.value)}
          placeholder="Internal notes, escalation status, collection history..."
          className="text-sm min-h-[72px] resize-none"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? "Saving…" : "Save Invoice"}
        </Button>
      </div>
    </form>
  );
}

// ─── Invoice Detail Sheet ──────────────────────────────────────────────────
function InvoiceDetailSheet({
  invoiceId,
  onClose,
  onEdit,
  canEdit,
}: {
  invoiceId: string | null;
  onClose: () => void;
  onEdit: (inv: Invoice) => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [commOpen, setCommOpen] = useState(false);
  const [disputeForm, setDisputeForm] = useState({ log_date: "", description: "", outcome: "" });
  const [commForm, setCommForm] = useState({ comm_date: "", comm_type: "email", contact_name: "", notes: "" });
  const [deleteDisputeId, setDeleteDisputeId] = useState<string | null>(null);
  const [deleteCommId, setDeleteCommId] = useState<string | null>(null);

  const { data: inv, isLoading } = useQuery<InvoiceDetail>({
    queryKey: ["/api/invoices", invoiceId],
    queryFn: () => apiRequest("GET", `/api/invoices/${invoiceId}`).then(r => r.json()),
    enabled: !!invoiceId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] });
    qc.invalidateQueries({ queryKey: ["/api/invoices"] });
  };

  const addDisputeMut = useMutation({
    mutationFn: (d: typeof disputeForm) =>
      apiRequest("POST", `/api/invoices/${invoiceId}/dispute-logs`, d).then(r => r.json()),
    onSuccess: () => { invalidate(); setDisputeOpen(false); setDisputeForm({ log_date: "", description: "", outcome: "" }); toast({ title: "Dispute entry added" }); },
    onError: () => toast({ title: "Failed to add dispute entry", variant: "destructive" }),
  });

  const delDisputeMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/dispute-logs/${id}`).then(r => r.json()),
    onSuccess: () => { invalidate(); setDeleteDisputeId(null); toast({ title: "Dispute entry removed" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const addCommMut = useMutation({
    mutationFn: (d: typeof commForm) =>
      apiRequest("POST", `/api/invoices/${invoiceId}/communications`, d).then(r => r.json()),
    onSuccess: () => { invalidate(); setCommOpen(false); setCommForm({ comm_date: "", comm_type: "email", contact_name: "", notes: "" }); toast({ title: "Communication logged" }); },
    onError: () => toast({ title: "Failed to log communication", variant: "destructive" }),
  });

  const delCommMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/communications/${id}`).then(r => r.json()),
    onSuccess: () => { invalidate(); setDeleteCommId(null); toast({ title: "Communication removed" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const uploadPdfMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/__PORT_5000__/api/invoices/${invoiceId}/upload-pdf`, { method: "POST", body: fd });
      if (!r.ok) throw new Error("Upload failed");
      return r.json();
    },
    onSuccess: () => { invalidate(); toast({ title: "PDF uploaded" }); },
    onError: () => toast({ title: "Upload failed", variant: "destructive" }),
  });

  if (!invoiceId) return null;

  const balance = inv ? ((inv.amount ?? 0) - (inv.amount_paid ?? 0)) : 0;
  const ovd = inv ? daysOverdue(inv.due_date) : 0;

  return (
    <>
      <Sheet open={!!invoiceId} onOpenChange={o => !o && onClose()}>
        <SheetContent side="right" className="w-full sm:w-[560px] sm:max-w-[560px] flex flex-col overflow-hidden p-0">
          {isLoading || !inv ? (
            <div className="flex-1 p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 rounded" />)}
            </div>
          ) : (
            <>
              {/* Header */}
              <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SheetTitle className="text-base font-semibold">{inv.invoice_number}</SheetTitle>
                    <SheetDescription className="text-xs mt-0.5">{inv.lessee_name} · {inv.vendor_name ?? "No vendor"}</SheetDescription>
                  </div>
                  {canEdit && (
                    <Button variant="outline" size="sm" onClick={() => onEdit(inv)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                    </Button>
                  )}
                </div>
                <StatusBadge status={inv.status} disputed={inv.is_disputed} />
              </SheetHeader>

              <div className="flex-1 overflow-y-auto">
                {/* Financial summary */}
                <div className="px-6 py-4 border-b border-border grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Total</div>
                    <div className="text-sm font-semibold">{fmt$(inv.amount)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Paid</div>
                    <div className="text-sm font-semibold text-success">{fmt$(inv.amount_paid)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Balance</div>
                    <div className={cn("text-sm font-semibold", balance > 0 ? "text-error" : "text-muted-foreground")}>{fmt$(balance)}</div>
                  </div>
                </div>

                {/* Dates */}
                <div className="px-6 py-4 border-b border-border grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground text-xs">Invoice date: </span>{fmtDate(inv.invoice_date)}</div>
                  <div>
                    <span className="text-muted-foreground text-xs">Due date: </span>
                    <span className={cn(ovd > 0 && inv.status !== "paid" && inv.status !== "closed" ? "text-error font-medium" : "")}>
                      {fmtDate(inv.due_date)}
                      {ovd > 0 && inv.status !== "paid" && inv.status !== "closed" && (
                        <span className="ml-1 text-[11px]">({ovd}d overdue)</span>
                      )}
                    </span>
                  </div>
                  {inv.paid_date && <div><span className="text-muted-foreground text-xs">Paid: </span>{fmtDate(inv.paid_date)}</div>}
                  {inv.next_followup_date && (
                    <div><span className="text-muted-foreground text-xs">Follow-up: </span>
                      <span className="text-warning">{fmtDate(inv.next_followup_date)}</span>
                    </div>
                  )}
                </div>

                {/* Repair description */}
                {inv.repair_description && (
                  <div className="px-6 py-4 border-b border-border">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Repair Description</div>
                    <p className="text-sm text-foreground">{inv.repair_description}</p>
                  </div>
                )}

                {/* Notes */}
                {inv.notes && (
                  <div className="px-6 py-4 border-b border-border">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Notes</div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{inv.notes}</p>
                  </div>
                )}

                {/* PDF attachment */}
                <div className="px-6 py-4 border-b border-border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Invoice PDF</div>
                    {canEdit && (
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploadPdfMut.isPending}
                        className="h-7 text-xs"
                      >
                        <Paperclip className="h-3.5 w-3.5 mr-1" />
                        {uploadPdfMut.isPending ? "Uploading…" : inv.pdf_url ? "Replace" : "Upload PDF"}
                      </Button>
                    )}
                  </div>
                  <input
                    ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadPdfMut.mutate(f); e.target.value = ""; }}
                  />
                  {inv.pdf_url ? (
                    <a
                      href={inv.pdf_url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      View cover sheet
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <p className="text-sm text-muted-foreground">No PDF attached</p>
                  )}
                </div>

                {/* Communication Log */}
                <div className="px-6 py-4 border-b border-border">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Communication Log</span>
                      <span className="text-[11px] text-muted-foreground">({inv.communications.length})</span>
                    </div>
                    {canEdit && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCommOpen(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" />Log
                      </Button>
                    )}
                  </div>
                  {inv.communications.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No communications logged yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {inv.communications.map(c => (
                        <div key={c.id} className="rounded-lg border border-border bg-muted/20 p-3 text-sm group relative">
                          <div className="flex items-center gap-2 mb-1 pr-6">
                            {c.comm_type === "phone" ? <Phone className="h-3.5 w-3.5 text-muted-foreground" /> : <Mail className="h-3.5 w-3.5 text-muted-foreground" />}
                            <span className="text-muted-foreground text-xs capitalize">{c.comm_type}</span>
                            <span className="text-muted-foreground text-xs">·</span>
                            <span className="text-muted-foreground text-xs">{fmtDate(c.comm_date)}</span>
                            {c.contact_name && <span className="text-xs">· {c.contact_name}</span>}
                          </div>
                          <p className="text-foreground leading-snug">{c.notes}</p>
                          {c.logged_by && <p className="text-[11px] text-muted-foreground mt-1">Logged by {c.logged_by}</p>}
                          {canEdit && (
                            <button
                              onClick={() => setDeleteCommId(c.id)}
                              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-error"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Dispute Log */}
                <div className="px-6 py-4 pb-8">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Scale className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Dispute Log</span>
                      <span className="text-[11px] text-muted-foreground">({inv.dispute_logs.length})</span>
                    </div>
                    {canEdit && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDisputeOpen(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" />Add Entry
                      </Button>
                    )}
                  </div>
                  {inv.dispute_logs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No dispute entries. {!inv.is_disputed && "Invoice is not currently disputed."}</p>
                  ) : (
                    <div className="space-y-2">
                      {inv.dispute_logs.map(d => (
                        <div key={d.id} className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm group relative">
                          <div className="flex items-center gap-2 mb-1 pr-6">
                            <Calendar className="h-3.5 w-3.5 text-amber-400" />
                            <span className="text-xs text-muted-foreground">{fmtDate(d.log_date)}</span>
                            {d.logged_by && <span className="text-xs text-muted-foreground">· {d.logged_by}</span>}
                          </div>
                          <p className="text-foreground leading-snug">{d.description}</p>
                          {d.outcome && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <span className="text-[10px] uppercase tracking-wider text-amber-400">Outcome:</span>
                              <span className="text-xs text-foreground">{d.outcome}</span>
                            </div>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => setDeleteDisputeId(d.id)}
                              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-error"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Log Communication Dialog */}
      <Dialog open={commOpen} onOpenChange={setCommOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log Communication</DialogTitle>
            <DialogDescription>Record a call, email, or other outreach for this invoice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Date</label>
                <Input type="date" value={commForm.comm_date} onChange={e => setCommForm(f => ({ ...f, comm_date: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <Select value={commForm.comm_type} onValueChange={v => setCommForm(f => ({ ...f, comm_type: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Phone</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="letter">Letter</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Contact Name</label>
              <Input value={commForm.contact_name} onChange={e => setCommForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="Name of person contacted" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Notes *</label>
              <Textarea value={commForm.notes} onChange={e => setCommForm(f => ({ ...f, notes: e.target.value }))} placeholder="What was discussed or communicated..." className="text-sm min-h-[80px] resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCommOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!commForm.notes.trim() || addCommMut.isPending} onClick={() => addCommMut.mutate(commForm)}>
              {addCommMut.isPending ? "Saving…" : "Log Communication"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Dispute Entry Dialog */}
      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Dispute Entry</DialogTitle>
            <DialogDescription>Document a dispute event, response, or resolution update.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Date</label>
              <Input type="date" value={disputeForm.log_date} onChange={e => setDisputeForm(f => ({ ...f, log_date: e.target.value }))} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Description *</label>
              <Textarea value={disputeForm.description} onChange={e => setDisputeForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the dispute, claim, or update..." className="text-sm min-h-[80px] resize-none" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Outcome / Next Step</label>
              <Input value={disputeForm.outcome} onChange={e => setDisputeForm(f => ({ ...f, outcome: e.target.value }))} placeholder="e.g. Pending review, Counter-evidence sent" className="h-9 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDisputeOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!disputeForm.description.trim() || addDisputeMut.isPending} onClick={() => addDisputeMut.mutate(disputeForm)}>
              {addDisputeMut.isPending ? "Saving…" : "Add Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dispute confirm */}
      <AlertDialog open={!!deleteDisputeId} onOpenChange={o => !o && setDeleteDisputeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove dispute entry?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteDisputeId && delDisputeMut.mutate(deleteDisputeId)} className="bg-error hover:bg-error/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete comm confirm */}
      <AlertDialog open={!!deleteCommId} onOpenChange={o => !o && setDeleteCommId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove communication entry?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteCommId && delCommMut.mutate(deleteCommId)} className="bg-error hover:bg-error/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Lessee Stats Sidebar ─────────────────────────────────────────────────
function LesseeStats({ invoices }: { invoices: Invoice[] }) {
  const stats = useMemo(() => {
    const map: Record<string, { name: string; total: number; balance: number; count: number; disputes: number; overdueCount: number; totalDaysOverdue: number }> = {};
    invoices.forEach(inv => {
      const n = inv.lessee_name;
      if (!map[n]) map[n] = { name: n, total: 0, balance: 0, count: 0, disputes: 0, overdueCount: 0, totalDaysOverdue: 0 };
      const s = map[n];
      s.count++;
      s.total += inv.amount ?? 0;
      s.balance += (inv.amount ?? 0) - (inv.amount_paid ?? 0);
      if (inv.is_disputed) s.disputes++;
      const ovd = daysOverdue(inv.due_date);
      if (ovd > 0 && inv.status !== "paid" && inv.status !== "closed") { s.overdueCount++; s.totalDaysOverdue += ovd; }
    });
    return Object.values(map).sort((a, b) => b.balance - a.balance);
  }, [invoices]);

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Lessee Summary</h3>
        <p className="text-[11px] text-muted-foreground">Sorted by outstanding balance</p>
      </div>
      <div className="divide-y divide-border">
        {stats.map(s => (
          <div key={s.name} className="px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium truncate">{s.name}</span>
              <span className={cn("text-sm font-semibold tabular-nums", s.balance > 0 ? "text-error" : "text-muted-foreground")}>
                {fmt$(s.balance)}
              </span>
            </div>
            <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap">
              <span>{s.count} invoice{s.count !== 1 ? "s" : ""}</span>
              {s.disputes > 0 && <span className="text-amber-400">{s.disputes} disputed</span>}
              {s.overdueCount > 0 && (
                <span className="text-error">
                  {s.overdueCount} overdue · avg {Math.round(s.totalDaysOverdue / s.overdueCount)}d
                </span>
              )}
            </div>
          </div>
        ))}
        {stats.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No data</p>}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function APTracker() {
  const { role } = useAuth();
  const canEdit = role === "admin";
  const qc = useQueryClient();
  const { toast } = useToast();
  const importRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [disputedFilter, setDisputedFilter] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [showLesseeStats, setShowLesseeStats] = useState(false);

  // Build query params
  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (disputedFilter) params.set("disputed", "true");
  if (search) params.set("search", search);

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", statusFilter, disputedFilter, search],
    queryFn: () => apiRequest("GET", `/api/invoices?${params}`).then(r => r.json()),
  });

  // All invoices (unfiltered) for KPIs and lessee stats — separate key to avoid collision
  const { data: allInvoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices-all"],
    queryFn: () => apiRequest("GET", "/api/invoices").then(r => r.json()),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/invoices"] });
    qc.invalidateQueries({ queryKey: ["/api/invoices-all"] });
  };

  const createMut = useMutation({
    mutationFn: (d: Record<string, any>) => apiRequest("POST", "/api/invoices", d).then(r => r.json()),
    onSuccess: () => { invalidate(); setAddOpen(false); toast({ title: "Invoice created" }); },
    onError: () => toast({ title: "Failed to create invoice", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...d }: Record<string, any>) => apiRequest("PATCH", `/api/invoices/${id}`, d).then(r => r.json()),
    onSuccess: () => { invalidate(); setEditInvoice(null); toast({ title: "Invoice updated" }); },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/invoices/${id}`).then(r => r.json()),
    onSuccess: () => { invalidate(); setDeleteId(null); toast({ title: "Invoice deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  async function handleImport(file: File) {
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/__PORT_5000__/api/invoices/import-csv", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Import failed");
      invalidate();
      toast({ title: `Imported ${j.inserted} invoice${j.inserted !== 1 ? "s" : ""}` });
    } catch (e: any) {
      toast({ title: e.message ?? "Import failed", variant: "destructive" });
    } finally {
      setImportLoading(false);
    }
  }

  function exportCsv() {
    window.open("/__PORT_5000__/api/invoices/export/csv", "_blank");
  }

  // ── KPIs ──
  const kpis = useMemo(() => {
    const open = allInvoices.filter(i => i.status !== "paid" && i.status !== "closed");
    const totalOutstanding = open.reduce((s, i) => s + ((i.amount ?? 0) - (i.amount_paid ?? 0)), 0);
    const disputed = allInvoices.filter(i => i.is_disputed);
    const over30 = open.filter(i => daysOverdue(i.due_date) > 30);
    const over60 = open.filter(i => daysOverdue(i.due_date) > 60);
    const over90 = open.filter(i => daysOverdue(i.due_date) > 90);
    return { totalOutstanding, totalOpen: open.length, disputed: disputed.length, over30: over30.length, over60: over60.length, over90: over90.length };
  }, [allInvoices]);

  const sortedInvoices = useMemo(() => {
    return [...invoices].sort((a, b) => {
      // Unpaid + overdue first, then by due date ascending
      const aOvd = daysOverdue(a.due_date);
      const bOvd = daysOverdue(b.due_date);
      const aOpen = a.status !== "paid" && a.status !== "closed";
      const bOpen = b.status !== "paid" && b.status !== "closed";
      if (aOpen && !bOpen) return -1;
      if (!aOpen && bOpen) return 1;
      return bOvd - aOvd;
    });
  }, [invoices]);

  return (
    <div className="flex flex-col min-h-0">
      <PageHeader
        title="AP Tracker"
        subtitle="Track outstanding repair invoices, disputes, and collection activity"
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <>
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <Download className="h-4 w-4 mr-1.5" />Export
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => importRef.current?.click()}
                  disabled={importLoading}
                >
                  <Upload className="h-4 w-4 mr-1.5" />
                  {importLoading ? "Importing…" : "Import CSV"}
                </Button>
                <input
                  ref={importRef} type="file" accept=".csv"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ""; }}
                />
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />Add Invoice
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-5">
        {/* KPI bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiTile label="Total Outstanding" value={fmt$(kpis.totalOutstanding)} sub={`${kpis.totalOpen} open invoices`} icon={DollarSign} accent="error"
            onClick={() => { setStatusFilter("unpaid"); setDisputedFilter(false); setSearch(""); }} />
          <KpiTile label="Disputed" value={String(kpis.disputed)} sub="invoices" icon={Scale} accent="warning"
            onClick={() => { setStatusFilter("all"); setDisputedFilter(true); setSearch(""); }} />
          <KpiTile label="30+ Days Overdue" value={String(kpis.over30)} sub="open invoices" icon={Clock} accent="warning"
            onClick={() => { setStatusFilter("unpaid"); setDisputedFilter(false); }} />
          <KpiTile label="60+ Days Overdue" value={String(kpis.over60)} sub="open invoices" icon={AlertTriangle} accent="error" />
          <KpiTile label="90+ Days Overdue" value={String(kpis.over90)} sub="critical" icon={XCircle} accent="error" />
          <KpiTile label="Partial Payments" value={String(allInvoices.filter(i => i.status === "partial").length)} sub="invoices" icon={RefreshCw} accent="primary"
            onClick={() => { setStatusFilter("partial"); setDisputedFilter(false); }} />
        </div>

        {/* Lessee stats toggle */}
        <button
          onClick={() => setShowLesseeStats(s => !s)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {showLesseeStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {showLesseeStats ? "Hide" : "Show"} lessee breakdown
        </button>
        {showLesseeStats && <LesseeStats invoices={allInvoices} />}

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search invoice #, lessee, vendor…"
              className="pl-9 h-9 text-sm"
              data-testid="input-search-invoices"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9 text-sm" data-testid="select-status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={disputedFilter ? "default" : "outline"}
            size="sm"
            className="h-9"
            onClick={() => setDisputedFilter(f => !f)}
            data-testid="button-filter-disputed"
          >
            <Scale className="h-4 w-4 mr-1.5" />Disputed only
          </Button>
          {(statusFilter !== "all" || disputedFilter || search) && (
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => { setStatusFilter("all"); setDisputedFilter(false); setSearch(""); }}>
              <XCircle className="h-4 w-4 mr-1" />Clear
            </Button>
          )}
        </div>

        {/* Invoice table */}
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              {isLoading ? "Loading…" : `${sortedInvoices.length} invoice${sortedInvoices.length !== 1 ? "s" : ""}`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">Invoice #</th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">Lessee</th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider hidden sm:table-cell">Vendor</th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider hidden md:table-cell">Balance</th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">Due Date</th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider hidden lg:table-cell">Last Contact</th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider hidden lg:table-cell">Follow-up</th>
                  {canEdit && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: canEdit ? 9 : 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : sortedInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 10 : 9} className="px-4 py-10 text-center text-muted-foreground text-sm">
                      No invoices found
                    </td>
                  </tr>
                ) : (
                  sortedInvoices.map(inv => {
                    const ovd = daysOverdue(inv.due_date);
                    const isOpen = inv.status !== "paid" && inv.status !== "closed";
                    const balance = (inv.amount ?? 0) - (inv.amount_paid ?? 0);
                    return (
                      <tr
                        key={inv.id}
                        className="hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setOpenInvoiceId(inv.id)}
                        data-testid={`row-invoice-${inv.id}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="font-mono text-xs font-medium">{inv.invoice_number}</span>
                            {inv.pdf_url && <Paperclip className="h-3 w-3 text-muted-foreground" />}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium">{inv.lessee_name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{inv.vendor_name ?? "—"}</td>
                        <td className="px-4 py-3 font-mono-num">{fmt$(inv.amount)}</td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className={cn("font-mono-num font-medium", balance > 0 && isOpen ? "text-error" : "text-muted-foreground")}>
                            {fmt$(balance)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <span className={cn("text-sm", ovd > 0 && isOpen ? "text-error font-medium" : "")}>{fmtDate(inv.due_date)}</span>
                            {ovd > 0 && isOpen && (
                              <div className="text-[11px] text-error">{ovd}d overdue</div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={inv.status} disputed={inv.is_disputed} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">
                          {fmtDate(inv.last_communication_date)}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {inv.next_followup_date ? (
                            <span className={cn("text-xs", new Date(inv.next_followup_date + "T00:00:00") <= new Date() ? "text-warning font-medium" : "text-muted-foreground")}>
                              {fmtDate(inv.next_followup_date)}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditInvoice(inv)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-error" onClick={() => setDeleteId(inv.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Invoice Detail Sheet */}
      <InvoiceDetailSheet
        invoiceId={openInvoiceId}
        onClose={() => setOpenInvoiceId(null)}
        onEdit={inv => { setEditInvoice(inv); setOpenInvoiceId(null); }}
        canEdit={canEdit}
      />

      {/* Add Invoice Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Invoice</DialogTitle>
            <DialogDescription>Log a new repair invoice for collection tracking.</DialogDescription>
          </DialogHeader>
          <InvoiceForm onSave={createMut.mutate} onCancel={() => setAddOpen(false)} loading={createMut.isPending} />
        </DialogContent>
      </Dialog>

      {/* Edit Invoice Dialog */}
      <Dialog open={!!editInvoice} onOpenChange={o => !o && setEditInvoice(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Invoice</DialogTitle>
            <DialogDescription>{editInvoice?.invoice_number}</DialogDescription>
          </DialogHeader>
          {editInvoice && (
            <InvoiceForm
              initial={{
                invoice_number: editInvoice.invoice_number,
                lessee_name: editInvoice.lessee_name,
                vendor_name: editInvoice.vendor_name ?? "",
                amount: editInvoice.amount?.toString() ?? "",
                amount_paid: editInvoice.amount_paid?.toString() ?? "",
                invoice_date: editInvoice.invoice_date ?? "",
                due_date: editInvoice.due_date ?? "",
                paid_date: editInvoice.paid_date ?? "",
                status: editInvoice.status,
                repair_description: editInvoice.repair_description ?? "",
                notes: editInvoice.notes ?? "",
                last_communication_date: editInvoice.last_communication_date ?? "",
                next_followup_date: editInvoice.next_followup_date ?? "",
              }}
              onSave={d => updateMut.mutate({ id: editInvoice.id, ...d })}
              onCancel={() => setEditInvoice(null)}
              loading={updateMut.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the invoice and all its dispute and communication history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMut.mutate(deleteId)}
              className="bg-error hover:bg-error/90"
            >
              Delete Invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
