import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  FolderOpen, Plus, Upload, Trash2, FileText, Image, File,
  Search, ChevronRight, Link2, X, ExternalLink, Pencil,
  CheckCircle2, Archive, FileEdit, Car, MoreHorizontal,
  Paperclip, Download
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Program {
  id: number;
  name: string;
  description: string | null;
  status: "active" | "draft" | "archived";
  created_at: string;
  updated_at: string;
  doc_count: number;
  car_count: number;
}

interface ProgramDoc {
  id: number;
  program_id: number;
  file_name: string;
  file_url: string;
  storage_path: string;
  doc_type: string;
  file_size_bytes: number | null;
  uploaded_at: string;
}

interface ProgramCar {
  id: number;
  notes: string | null;
  added_at: string;
  railcar: {
    id: number;
    car_number: string;
    reporting_marks: string | null;
    car_type: string | null;
    status: string | null;
    entity: string | null;
    fleet_name: string | null;
  };
}

interface Railcar {
  id: number;
  car_number: string;
  reporting_marks: string | null;
  car_type: string | null;
  status: string | null;
  entity: string | null;
  fleet_name: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DOC_TYPES = ["SOW", "Car List", "Inspection Report", "Photo", "Other"] as const;
type DocType = typeof DOC_TYPES[number];

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline"; icon: any }> = {
  active:   { label: "Active",   variant: "default",   icon: CheckCircle2 },
  draft:    { label: "Draft",    variant: "secondary", icon: FileEdit },
  archived: { label: "Archived", variant: "outline",   icon: Archive },
};

const DOC_TYPE_COLORS: Record<string, string> = {
  "SOW":               "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Car List":          "bg-violet-500/10 text-violet-400 border-violet-500/20",
  "Inspection Report": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Photo":             "bg-green-500/10 text-green-400 border-green-500/20",
  "Other":             "bg-muted text-muted-foreground border-border",
};

function fmtBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext ?? "")) return <Image className="h-4 w-4 text-green-400" />;
  if (ext === "pdf") return <FileText className="h-4 w-4 text-red-400" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProgramsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editProgram, setEditProgram] = useState<Program | null>(null);
  const [linkCarsOpen, setLinkCarsOpen] = useState(false);

  // ── Data queries ─────────────────────────────────────────────────────────────

  const { data: programs = [], isLoading } = useQuery<Program[]>({
    queryKey: ["/api/programs"],
  });

  const { data: docs = [] } = useQuery<ProgramDoc[]>({
    queryKey: ["/api/programs", selectedProgram?.id, "documents"],
    queryFn: () => selectedProgram
      ? apiRequest("GET", `/api/programs/${selectedProgram.id}/documents`).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!selectedProgram,
  });

  const { data: linkedCars = [] } = useQuery<ProgramCar[]>({
    queryKey: ["/api/programs", selectedProgram?.id, "cars"],
    queryFn: () => selectedProgram
      ? apiRequest("GET", `/api/programs/${selectedProgram.id}/cars`).then(r => r.json())
      : Promise.resolve([]),
    enabled: !!selectedProgram,
  });

  const { data: allCars = [] } = useQuery<Railcar[]>({
    queryKey: ["/api/railcars"],
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const deleteProgramMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/programs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/programs"] });
      setSelectedProgram(null);
      toast({ title: "Program deleted" });
    },
  });

  const deleteDocMut = useMutation({
    mutationFn: ({ programId, docId }: { programId: number; docId: number }) =>
      apiRequest("DELETE", `/api/programs/${programId}/documents/${docId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/programs", selectedProgram?.id, "documents"] });
      qc.invalidateQueries({ queryKey: ["/api/programs"] });
      toast({ title: "Document removed" });
    },
  });

  const unlinkCarMut = useMutation({
    mutationFn: ({ programId, linkId }: { programId: number; linkId: number }) =>
      apiRequest("DELETE", `/api/programs/${programId}/cars/${linkId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/programs", selectedProgram?.id, "cars"] });
      qc.invalidateQueries({ queryKey: ["/api/programs"] });
      toast({ title: "Car unlinked" });
    },
  });

  // ── Filtering ─────────────────────────────────────────────────────────────────

  const filtered = programs.filter(p => {
    const matchSearch = !search.trim() ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Keep selectedProgram in sync with fresh data
  const freshSelected = selectedProgram
    ? programs.find(p => p.id === selectedProgram.id) ?? selectedProgram
    : null;

  return (
    <div className="px-4 md:px-8 py-5 md:py-8 max-w-[1600px]">
      {/* Header */}
      <header className="mb-5 md:mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg md:text-xl font-semibold tracking-tight">Programs</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            Scopes of work, car lists, inspection reports and supporting documents
          </p>
        </div>
        <Button size="sm" className="gap-1.5 self-start sm:self-auto" onClick={() => setCreateOpen(true)}
          data-testid="button-create-program">
          <Plus className="h-4 w-4" /> New Program
        </Button>
      </header>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Search programs…" value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-36 text-sm">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-6">
        {/* Left: Program list */}
        <div className="space-y-2">
          {isLoading ? (
            <div className="text-sm text-muted-foreground p-4">Loading…</div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <FolderOpen className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground italic">
                  {programs.length === 0 ? "No programs yet — create one to get started." : "No programs match your filter."}
                </p>
              </CardContent>
            </Card>
          ) : (
            filtered.map(p => {
              const cfg = STATUS_CONFIG[p.status];
              const active = freshSelected?.id === p.id;
              return (
                <Card
                  key={p.id}
                  className={`cursor-pointer transition-all hover:border-primary/40 ${active ? "border-primary/60 bg-accent/40" : ""}`}
                  onClick={() => setSelectedProgram(p)}
                  data-testid={`card-program-${p.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{p.name}</span>
                          <Badge variant={cfg.variant} className="text-[10px] h-4 px-1.5">{cfg.label}</Badge>
                        </div>
                        {p.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Paperclip className="h-3 w-3" />{p.doc_count} doc{p.doc_count !== 1 ? "s" : ""}
                          </span>
                          <span className="flex items-center gap-1">
                            <Car className="h-3 w-3" />{p.car_count} car{p.car_count !== 1 ? "s" : ""}
                          </span>
                          <span>{fmtDate(p.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-none" onClick={e => e.stopPropagation()}>
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${active ? "rotate-90 text-primary" : ""}`} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-menu-${p.id}`}>
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditProgram(p)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => { if (confirm(`Delete "${p.name}" and all its documents?`)) deleteProgramMut.mutate(p.id); }}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Right: Program detail */}
        <div>
          {freshSelected ? (
            <ProgramDetail
              program={freshSelected}
              docs={docs}
              linkedCars={linkedCars}
              allCars={allCars}
              onDeleteDoc={(docId) => deleteDocMut.mutate({ programId: freshSelected.id, docId })}
              onUnlinkCar={(linkId) => unlinkCarMut.mutate({ programId: freshSelected.id, linkId })}
              onUploadDone={() => {
                qc.invalidateQueries({ queryKey: ["/api/programs", freshSelected.id, "documents"] });
                qc.invalidateQueries({ queryKey: ["/api/programs"] });
              }}
              onCarLinked={() => {
                qc.invalidateQueries({ queryKey: ["/api/programs", freshSelected.id, "cars"] });
                qc.invalidateQueries({ queryKey: ["/api/programs"] });
              }}
            />
          ) : (
            <Card>
              <CardContent className="p-10 text-center">
                <FolderOpen className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground italic">Select a program to view its documents and linked cars.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Create Program Dialog */}
      <ProgramFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(p) => {
          qc.invalidateQueries({ queryKey: ["/api/programs"] });
          setCreateOpen(false);
          setSelectedProgram(p);
          toast({ title: "Program created" });
        }}
      />

      {/* Edit Program Dialog */}
      {editProgram && (
        <ProgramFormDialog
          open={!!editProgram}
          initial={editProgram}
          onClose={() => setEditProgram(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["/api/programs"] });
            setEditProgram(null);
            toast({ title: "Program updated" });
          }}
        />
      )}
    </div>
  );
}

// ─── Program Detail Panel ────────────────────────────────────────────────────

function ProgramDetail({
  program, docs, linkedCars, allCars,
  onDeleteDoc, onUnlinkCar, onUploadDone, onCarLinked,
}: {
  program: Program;
  docs: ProgramDoc[];
  linkedCars: ProgramCar[];
  allCars: Railcar[];
  onDeleteDoc: (docId: number) => void;
  onUnlinkCar: (linkId: number) => void;
  onUploadDone: () => void;
  onCarLinked: () => void;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkCarsOpen, setLinkCarsOpen] = useState(false);
  const cfg = STATUS_CONFIG[program.status];

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-base truncate">{program.name}</h2>
            <Badge variant={cfg.variant} className="text-[10px]">{cfg.label}</Badge>
          </div>
          {program.description && (
            <p className="text-xs text-muted-foreground mt-1">{program.description}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">Created {fmtDate(program.created_at)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap flex-none">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setLinkCarsOpen(true)}>
            <Link2 className="h-3.5 w-3.5" /> Link Cars
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setUploadOpen(true)}>
            <Upload className="h-3.5 w-3.5" /> Upload Document
          </Button>
        </div>
      </div>

      <CardContent className="p-0 divide-y divide-border">
        {/* Documents section */}
        <div className="p-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-3">
            Documents ({docs.length})
          </div>
          {docs.length === 0 ? (
            <div className="text-sm text-muted-foreground italic text-center py-6 border border-dashed border-border rounded-md">
              No documents yet — upload a SOW, car list, or inspection report.
            </div>
          ) : (
            <div className="space-y-2">
              {docs.map(doc => (
                <div key={doc.id} className="flex items-center gap-3 p-2.5 rounded-md border border-border hover:bg-muted/40 transition-colors group"
                  data-testid={`doc-${doc.id}`}>
                  <div className="flex-none">{fileIcon(doc.file_name)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium truncate max-w-[240px]">{doc.file_name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${DOC_TYPE_COLORS[doc.doc_type] ?? DOC_TYPE_COLORS["Other"]}`}>
                        {doc.doc_type}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {fmtDate(doc.uploaded_at)}{doc.file_size_bytes ? ` · ${fmtBytes(doc.file_size_bytes)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-none opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-7 w-7" asChild title="Open">
                      <a href={doc.file_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      title="Remove"
                      onClick={() => { if (confirm(`Remove "${doc.file_name}"?`)) onDeleteDoc(doc.id); }}
                      data-testid={`button-delete-doc-${doc.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Linked Cars section */}
        <div className="p-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-3">
            Linked Railcars ({linkedCars.length})
          </div>
          {linkedCars.length === 0 ? (
            <div className="text-sm text-muted-foreground italic text-center py-6 border border-dashed border-border rounded-md">
              No cars linked — use "Link Cars" to associate railcars with this program.
            </div>
          ) : (
            <div className="-mx-5 px-5 overflow-x-auto">
              <Table className="min-w-[420px]">
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>Car #</TableHead>
                    <TableHead>Marks</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Lessee</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkedCars.map(lc => (
                    <TableRow key={lc.id} className="text-xs" data-testid={`row-linked-car-${lc.id}`}>
                      <TableCell className="font-mono">{lc.railcar.car_number}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{lc.railcar.reporting_marks || "—"}</TableCell>
                      <TableCell>{lc.railcar.car_type || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{lc.railcar.fleet_name || "—"}</TableCell>
                      <TableCell>
                        {lc.railcar.entity === "Main"
                          ? <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-400">Owned</Badge>
                          : lc.railcar.entity === "Rail Partners Select"
                          ? <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-400">RPS</Badge>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => onUnlinkCar(lc.id)} title="Unlink"
                          data-testid={`button-unlink-car-${lc.id}`}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>

      {/* Upload Document Dialog */}
      <UploadDocDialog
        open={uploadOpen}
        program={program}
        onClose={() => setUploadOpen(false)}
        onUploaded={onUploadDone}
      />

      {/* Link Cars Dialog */}
      <LinkCarsDialog
        open={linkCarsOpen}
        program={program}
        allCars={allCars}
        linkedCars={linkedCars}
        onClose={() => setLinkCarsOpen(false)}
        onLinked={onCarLinked}
      />
    </Card>
  );
}

// ─── Program Form Dialog (create + edit) ─────────────────────────────────────

function ProgramFormDialog({
  open, initial, onClose, onSaved,
}: {
  open: boolean;
  initial?: Program;
  onClose: () => void;
  onSaved: (p: Program) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<string>(initial?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const isEdit = !!initial;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const method = isEdit ? "PATCH" : "POST";
      const url = isEdit ? `/api/programs/${initial!.id}` : "/api/programs";
      const result = await apiRequest(method, url, { name, description, status }).then(r => r.json());
      onSaved(result);
    } catch {
      toast({ title: "Failed to save program", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Program" : "New Program"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the program details." : "Create a new program to organize SOW and supporting documents."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Program Name *</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Tank Car Lining Program 2026" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Scope, purpose, timeline…" className="text-sm min-h-[80px] resize-none" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : isEdit ? "Update" : "Create Program"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Upload Document Dialog ───────────────────────────────────────────────────

function UploadDocDialog({ open, program, onClose, onUploaded }: {
  open: boolean;
  program: Program;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [docType, setDocType] = useState<DocType>("SOW");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    setFiles(prev => [...prev, ...selected]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleUpload() {
    if (files.length === 0) return;
    setUploading(true);
    setProgress([]);
    const msgs: string[] = [];
    const base = ("__PORT_5000__").startsWith("__") ? "" : "__PORT_5000__";

    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", docType);
      try {
        const r = await fetch(`${base}/api/programs/${program.id}/documents`, { method: "POST", body: fd });
        if (!r.ok) throw new Error(await r.text());
        msgs.push(`✓ ${file.name}`);
      } catch {
        msgs.push(`✗ ${file.name} — upload failed`);
      }
      setProgress([...msgs]);
    }

    const allOk = msgs.every(m => m.startsWith("✓"));
    if (allOk) {
      toast({ title: `${files.length} document${files.length > 1 ? "s" : ""} uploaded` });
      setFiles([]);
      setProgress([]);
      onUploaded();
      onClose();
    } else {
      toast({ title: "Some files failed to upload", variant: "destructive" });
      onUploaded();
    }
    setUploading(false);
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !uploading) { onClose(); setFiles([]); setProgress([]); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
          <DialogDescription>Add files to <strong>{program.name}</strong></DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Document Type</label>
            <Select value={docType} onValueChange={v => setDocType(v as DocType)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div
            className="border-2 border-dashed border-border rounded-md p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Click to select files</p>
            <p className="text-[11px] text-muted-foreground mt-1">PDF, images, or any document type</p>
            <input ref={inputRef} type="file" multiple className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx,.csv"
              onChange={handleFiles} />
          </div>

          {files.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">{files.length} file{files.length > 1 ? "s" : ""} selected:</p>
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {fileIcon(f.name)}
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-muted-foreground">{fmtBytes(f.size)}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6"
                    onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {progress.length > 0 && (
            <div className="space-y-1 text-xs font-mono">
              {progress.map((m, i) => (
                <p key={i} className={m.startsWith("✓") ? "text-green-400" : "text-destructive"}>{m}</p>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={uploading}>Cancel</Button>
            <Button size="sm" disabled={files.length === 0 || uploading} onClick={handleUpload}>
              {uploading ? "Uploading…" : `Upload ${files.length > 0 ? files.length : ""} File${files.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Link Cars Dialog ─────────────────────────────────────────────────────────

function LinkCarsDialog({ open, program, allCars, linkedCars, onClose, onLinked }: {
  open: boolean;
  program: Program;
  allCars: Railcar[];
  linkedCars: ProgramCar[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const linkedIds = new Set(linkedCars.map(lc => lc.railcar.id));

  const filteredCars = allCars.filter(c => {
    if (linkedIds.has(c.id)) return false;
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return c.car_number.toLowerCase().includes(s) ||
      (c.reporting_marks ?? "").toLowerCase().includes(s) ||
      (c.fleet_name ?? "").toLowerCase().includes(s);
  });

  function toggle(id: number) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function handleLink() {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await apiRequest("POST", `/api/programs/${program.id}/cars`, { railcar_ids: Array.from(selected) });
      toast({ title: `${selected.size} car${selected.size > 1 ? "s" : ""} linked` });
      setSelected(new Set());
      setSearch("");
      onLinked();
      onClose();
    } catch {
      toast({ title: "Failed to link cars", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { onClose(); setSelected(new Set()); setSearch(""); } }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle>Link Railcars</DialogTitle>
          <DialogDescription>Associate cars from the fleet with <strong>{program.name}</strong></DialogDescription>
        </DialogHeader>
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 h-9 text-sm" placeholder="Filter by car number, marks, lessee…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {selected.size > 0 && (
            <p className="text-xs text-primary mt-2">{selected.size} car{selected.size > 1 ? "s" : ""} selected</p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {filteredCars.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center italic p-6">
              {allCars.length === 0 ? "No railcars in the fleet yet." : "All cars are already linked, or no matches."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Car #</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Lessee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCars.map(c => {
                  const checked = selected.has(c.id);
                  return (
                    <TableRow key={c.id}
                      className={`cursor-pointer text-xs ${checked ? "bg-accent/40" : ""}`}
                      onClick={() => toggle(c.id)}
                      data-testid={`row-car-select-${c.id}`}
                    >
                      <TableCell>
                        <input type="checkbox" checked={checked} onChange={() => toggle(c.id)}
                          className="h-3.5 w-3.5 accent-primary" onClick={e => e.stopPropagation()} />
                      </TableCell>
                      <TableCell className="font-mono">{c.car_number}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{c.reporting_marks || "—"}</TableCell>
                      <TableCell>{c.car_type || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.fleet_name || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={selected.size === 0 || saving} onClick={handleLink}>
            {saving ? "Linking…" : `Link ${selected.size > 0 ? selected.size : ""} Car${selected.size !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
