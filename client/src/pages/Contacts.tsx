import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Phone, Mail, User, StickyNote, Building2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

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

function ContactCard({ contact }: { contact: Contact }) {
  const [expanded, setExpanded] = useState(false);
  const lessee = contact.rider?.master_lease?.lessee ?? null;
  const leaseNumber = contact.rider?.master_lease?.lease_number ?? null;
  const riderName = contact.rider?.rider_name ?? null;

  return (
    <div
      className="rounded-lg border border-card-border bg-card px-4 py-3 hover:border-primary/30 transition-colors cursor-pointer"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
          <User className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{contact.name}</span>
            {contact.title && (
              <span className="text-xs text-muted-foreground">{contact.title}</span>
            )}
          </div>

          {/* Lease / rider context */}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {lessee && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Building2 className="h-3 w-3" />
                {lessee}
              </span>
            )}
            {leaseNumber && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <FileText className="h-3 w-3" />
                {leaseNumber}
              </span>
            )}
            {riderName && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                {riderName}
              </Badge>
            )}
          </div>

          {/* Contact details — always visible */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {contact.phone && (
              <a
                href={`tel:${contact.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Phone className="h-3 w-3" />
                {contact.phone}
              </a>
            )}
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Mail className="h-3 w-3" />
                {contact.email}
              </a>
            )}
          </div>

          {/* Notes — expandable */}
          {contact.notes && (
            <div
              className={cn(
                "mt-2 text-xs text-muted-foreground overflow-hidden transition-all",
                expanded ? "max-h-96" : "max-h-8"
              )}
            >
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

export default function Contacts() {
  const [search, setSearch] = useState("");

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [
        c.name,
        c.title,
        c.phone,
        c.email,
        c.notes,
        c.rider?.rider_name,
        c.rider?.master_lease?.lessee,
        c.rider?.master_lease?.lease_number,
      ]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    );
  }, [contacts, search]);

  // Group alphabetically by first letter of name
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

      <div className="px-8 py-6 space-y-5">
        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, lessee, phone, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="contacts-search"
          />
        </div>

        {/* Count */}
        {!isLoading && contacts && (
          <div className="text-xs text-muted-foreground font-mono-num">
            {filtered.length} / {contacts.length} contacts
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] rounded-lg" />
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && filtered.length === 0 && (
          <div className="text-sm text-muted-foreground italic py-8 text-center">
            {search ? "No contacts match that search." : "No contacts have been added yet."}
          </div>
        )}

        {/* Grouped list */}
        {!isLoading && grouped.map(([letter, items]) => (
          <div key={letter}>
            <div className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-medium mb-2 pb-1 border-b border-border">
              {letter}
            </div>
            <div className="space-y-2">
              {items.map((c) => (
                <ContactCard key={c.id} contact={c} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
