import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search, Phone, Mail, User, StickyNote, Building2, FileText,
  Zap, ArrowRightLeft, ExternalLink, Plus, Pencil, Trash2, MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type Contact = {
  id: number;
  rider_id: number;
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  rider: {
    id: number;
    rider_name: string;
    schedule_number: string | null;
    master_lease: {
      id: number;
      lease_number: string;
      lessee: string | null;
    } | null;
  } | null;
};

type MasterLease = {
  id: number;
  lease_number: string;
  lessee: string | null;
  riders: Rider[];
};

type Rider = {
  id: number;
  rider_name: string;
  schedule_number: string | null;
  master_lease_id: number | null;
};

// ─── Contact Form Dialog ──────────────────────────────────────────────────────

const EMPTY_FORM = { name: "", title: "", phone: "", email: "", notes: "" };

function ContactFormDialog({
  open,
  initial,
  initialRiderId,
  leases,
  riders,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: Contact;
  initialRiderId?: number;
  leases: MasterLease[];
  riders: Rider[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!initial;

  // Pre-select MLA from existing contact or passed-in rider
  const getInitialLeaseId = () => {
    // From an existing contact: the rider's MLA id is on contact.rider.master_lease.id
    if (initial?.rider?.master_lease?.id) return String(initial.rider.master_lease.id);
    // From a rider id passed directly: find which MLA that rider belongs to
    const lookupId = initialRiderId ?? (initial ? initial.rider_id : undefined);
    if (lookupId) {
      const r = riders.find(r => r.id === lookupId);
      return r?.master_lease_id ? String(r.master_lease_id) : "";
    }
    return "";
  };

  const [selectedLeaseId, setSelectedLeaseId] = useState<string>(getInitialLeaseId);
  const [selectedRiderId, setSelectedRiderId] = useState<string>(
    initial ? String(initial.rider_id) : initialRiderId ? String(initialRiderId) : ""
  );
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    title: initial?.title ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    notes: initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  // Riders filtered by selected MLA
  const ridersForLease = useMemo(() =>
    selectedLeaseId
      ? riders.filter(r => r.master_lease_id === Number(selectedLeaseId))
      : riders,
    [riders, selectedLeaseId]
  );

  // When MLA changes, reset rider selection if it no longer belongs to this MLA
  function handleLeaseChange(leaseId: string) {
    setSelectedLeaseId(leaseId);
    const stillValid = riders.find(
      r => r.id === Number(selectedRiderId) && r.master_lease_id === Number(leaseId)
    );
    if (!stillValid) setSelectedRiderId("");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!selectedRiderId) return;
    setSaving(true);
    try {
      const payload = {
        rider_id: Number(selectedRiderId),
        name: form.name.trim(),
        title: form.title || null,
        phone: form.phone || null,
        email: form.email || null,
        notes: form.notes || null,
      };
      if (isEdit) {
        await apiRequest("PATCH", `/api/contacts/${initial!.id}`, payload);
      } else {
        await apiRequest("POST", "/api/contacts", payload);
      }
      onSaved();
      onClose();
      toast({ title: isEdit ? "Contact updated" : "Contact created" });
    } catch {
      toast({ title: "Failed to save contact", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, key: keyof typeof EMPTY_FORM, type = "text", placeholder = "") => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input type={type} value={form[key]} placeholder={placeholder}
        onChange={e => set(key, e.target.value)} className="h-9 text-sm" />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Contact" : "New Contact"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update contact details. You can also reassign to a different rider."
              : "Add a contact and link them to an MLA and Rider."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 pt-1">
          {/* MLA selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Master Lease Agreement <span className="text-muted-foreground/60">(filters riders below)</span>
            </label>
            <Select value={selectedLeaseId} onValueChange={handleLeaseChange}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select an MLA…" />
              </SelectTrigger>
              <SelectContent>
                {leases.map(l => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    <span className="font-mono text-xs">{l.lease_number}</span>
                    {l.lessee && <span className="ml-2 text-muted-foreground">{l.lessee}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Rider selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Rider <span className="text-destructive">*</span>
            </label>
            <Select
              value={selectedRiderId}
              onValueChange={setSelectedRiderId}
              disabled={ridersForLease.length === 0}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={
                  ridersForLease.length === 0
                    ? (selectedLeaseId ? "No riders under this MLA" : "Select a rider…")
                    : "Select a rider…"
                } />
              </SelectTrigger>
              <SelectContent>
                {ridersForLease.map(r => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.rider_name}
                    {r.schedule_number && (
                      <span className="ml-2 text-muted-foreground font-mono text-xs">#{r.schedule_number}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!selectedRiderId && (
              <p className="text-[11px] text-muted-foreground">
                Every contact must be linked to a rider. Select an MLA above to filter the list.
              </p>
            )}
          </div>

          <div className="border-t border-border pt-3 space-y-3">
            {field("Full Name *", "name", "text", "Jane Smith")}
            <div className="grid grid-cols-2 gap-3">
              {field("Title / Role", "title", "text", "Operations Manager")}
              {field("Phone", "phone", "tel", "+1 (555) 000-0000")}
            </div>
            {field("Email", "email", "email", "jane@example.com")}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea value={form.notes} onChange={e => set("notes", e.target.value)}
                placeholder="Any additional context about this contact…"
                className="text-sm min-h-[72px] resize-none" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm"
              disabled={saving || !form.name.trim() || !selectedRiderId}>
              {saving ? "Saving…" : isEdit ? "Update Contact" : "Create Contact"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Contact Card ─────────────────────────────────────────────────────────────

function ContactCard({
  contact,
  onNavigate,
  onEdit,
  onDelete,
}: {
  contact: Contact;
  onNavigate: (path: string) => void;
  onEdit: (c: Contact) => void;
  onDelete: (c: Contact) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lessee = contact.rider?.master_lease?.lessee ?? null;
  const leaseNumber = contact.rider?.master_lease?.lease_number ?? null;
  const riderName = contact.rider?.rider_name ?? null;

  return (
    <div
      className="rounded-lg border border-card-border bg-card px-4 py-3 hover:border-primary/30 transition-colors cursor-pointer"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
          <User className="h-4 w-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Action buttons — top right */}
          <div className="float-right ml-2 flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {/* Quick Actions */}
            {contact.rider && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground">
                    <Zap className="h-3 w-3" />
                    Quick Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={() => onNavigate(`/leases?rider=${contact.rider_id}`)} className="gap-2">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Lease Detail
                    {leaseNumber && <span className="ml-auto text-xs text-muted-foreground font-mono">{leaseNumber}</span>}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onNavigate(`/move?rider=${contact.rider_id}`)} className="gap-2">
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    Move Cars
                    {riderName && <span className="ml-auto text-xs text-muted-foreground truncate max-w-[80px]">{riderName}</span>}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Edit / Delete */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-6 w-6"
                  data-testid={`button-contact-menu-${contact.id}`}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(contact)} className="gap-2">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive gap-2"
                  onSelect={() => onDelete(contact)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{contact.name}</span>
            {contact.title && <span className="text-xs text-muted-foreground">{contact.title}</span>}
          </div>

          {/* Lease / rider context */}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {lessee && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Building2 className="h-3 w-3" />{lessee}
              </span>
            )}
            {leaseNumber && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <FileText className="h-3 w-3" />{leaseNumber}
              </span>
            )}
            {riderName && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{riderName}</Badge>
            )}
          </div>

          {/* Contact details */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {contact.phone && (
              <a href={`tel:${contact.phone}`} onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Phone className="h-3 w-3" />{contact.phone}
              </a>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Mail className="h-3 w-3" />{contact.email}
              </a>
            )}
          </div>

          {/* Notes — expandable */}
          {contact.notes && (
            <div className={cn(
              "mt-2 text-xs text-muted-foreground overflow-hidden transition-all",
              expanded ? "max-h-96" : "max-h-8"
            )}>
              <div className="flex items-start gap-1">
                <StickyNote className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" />
                <span className={cn(!expanded && "line-clamp-1")}>{contact.notes}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Contacts() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  // Fetch MLAs (with nested riders) for the create/edit form dropdowns
  // /api/leases returns a flat array of MLAs, each with a nested riders[] array
  const { data: leasesData = [] } = useQuery<MasterLease[]>({
    queryKey: ["/api/leases"],
  });
  const leases: MasterLease[] = leasesData;
  // Flatten all riders out of the MLA array, injecting master_lease_id
  const riders: Rider[] = leases.flatMap(l =>
    (l.riders ?? []).map(r => ({ ...r, master_lease_id: l.id }))
  );

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact deleted" });
    },
    onError: () => toast({ title: "Failed to delete contact", variant: "destructive" }),
  });

  function handleDelete(c: Contact) {
    if (confirm(`Delete contact "${c.name}"?`)) deleteMut.mutate(c.id);
  }

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ["/api/contacts"] });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c =>
      [c.name, c.title, c.phone, c.email, c.notes,
        c.rider?.rider_name, c.rider?.master_lease?.lessee, c.rider?.master_lease?.lease_number]
        .filter(Boolean)
        .some(v => v!.toLowerCase().includes(q))
    );
  }, [contacts, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      const letter = c.name.charAt(0).toUpperCase();
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="All rider contacts across every lease — searchable in one place"
      />

      <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-5">
        {/* Search + New Contact */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, lessee, phone, email…"
              value={search} onChange={e => setSearch(e.target.value)}
              data-testid="contacts-search" />
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}
            data-testid="button-new-contact">
            <Plus className="h-4 w-4" /> New Contact
          </Button>
        </div>

        {/* Count */}
        {!isLoading && (
          <div className="text-xs text-muted-foreground font-mono-num">
            {filtered.length} / {contacts.length} contacts
          </div>
        )}

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="text-sm text-muted-foreground italic py-8 text-center">
            {search ? "No contacts match that search." : "No contacts yet — create one with the button above."}
          </div>
        )}

        {!isLoading && grouped.map(([letter, items]) => (
          <div key={letter}>
            <div className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2 pb-1 border-b border-border">
              {letter}
            </div>
            <div className="space-y-2">
              {items.map(c => (
                <ContactCard
                  key={c.id}
                  contact={c}
                  onNavigate={navigate}
                  onEdit={setEditContact}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Create dialog */}
      <ContactFormDialog
        open={createOpen}
        leases={leases}
        riders={riders}
        onClose={() => setCreateOpen(false)}
        onSaved={handleSaved}
      />

      {/* Edit dialog */}
      {editContact && (
        <ContactFormDialog
          open={!!editContact}
          initial={editContact}
          leases={leases}
          riders={riders}
          onClose={() => setEditContact(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
