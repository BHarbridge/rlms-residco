import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Search as SearchIcon, Train, FileText, BookOpen, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// ── Types ─────────────────────────────────────────────────────────────────────
interface MasterLease {
  id: number;
  lease_number: string;
  agreement_number: string | null;
  lessor: string | null;
  lessee: string | null;
  lease_type: string | null;
  effective_date: string | null;
}

interface Rider {
  id: number;
  rider_name: string;
  schedule_number: string | null;
  expiration_date: string | null;
  car_count: number;
  master_lease: { id: number; lease_number: string; lessee: string | null } | null;
}

interface RailcarResult {
  id: number;
  car_number: string;
  reporting_marks: string | null;
  car_type: string | null;
  status: string | null;
  entity: string | null;
  mechanical_designation: string | null;
  assignment: {
    id: number;
    fleet_name: string | null;
    sub_lease_number: string | null;
    sublease_expiration_date: string | null;
    assigned_at: string | null;
    rider: {
      id: number;
      rider_name: string;
      schedule_number: string | null;
      expiration_date: string | null;
      master_lease: {
        id: number;
        lease_number: string;
        lessor: string | null;
        lessee: string | null;
      } | null;
    } | null;
  } | null;
}

interface SearchResults {
  query: string;
  terms: string[];
  railcars: RailcarResult[];
  riders: Rider[];
  leases: MasterLease[];
  counts: { railcars: number; riders: number; leases: number; total: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(date: string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? "unknown";
  const cls =
    s === "active"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
      : s === "stored"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
      : s === "retired"
      ? "bg-red-500/15 text-red-400 border-red-500/20"
      : "bg-muted text-muted-foreground";
  return (
    <span className={cn("text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded border", cls)}>
      {s}
    </span>
  );
}

// ── Entity badge (mirrors FleetRegistry) ─────────────────────────────────────
const ENTITY_STYLES: Record<string, { label: string; cls: string }> = {
  "Rail Partners Select": { label: "RPS",   cls: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  "Main":                 { label: "OWNED", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  "Coal":                 { label: "COAL",  cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  "Main-Coal":            { label: "COAL",  cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
};
function EntityBadge({ entity }: { entity: string | null | undefined }) {
  if (!entity) return null;
  const style = ENTITY_STYLES[entity] ?? { label: entity, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn("text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border", style.cls)}>
      {style.label}
    </span>
  );
}

function SectionHeader({ icon: Icon, label, count }: { icon: any; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">{label}</h2>
      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count} result{count !== 1 ? "s" : ""}</span>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function RailcarRow({ car }: { car: RailcarResult }) {
  const rider = car.assignment?.rider;
  const lease = rider?.master_lease;
  return (
    <div className="flex items-start gap-4 py-3 border-b border-border/40 last:border-0">
      <div className="min-w-[140px]">
        <div className="flex items-center gap-1.5 mb-0.5">
          <EntityBadge entity={car.entity} />
        </div>
        <div className="font-mono text-sm font-semibold text-foreground">{car.car_number}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{car.car_type ?? "—"}{car.mechanical_designation ? ` · ${car.mechanical_designation}` : ""}</div>
      </div>
      <div className="flex-1 grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-muted-foreground mb-0.5">Fleet / Lessee</div>
          <div className="text-foreground font-medium">{car.assignment?.fleet_name ?? <span className="text-muted-foreground italic">Unassigned</span>}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Rider</div>
          <div className="text-foreground">{rider?.rider_name ?? "—"}</div>
          {rider?.schedule_number && (
            <div className="text-muted-foreground text-[11px]">Sch {rider.schedule_number}</div>
          )}
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Master Lease</div>
          <div className="text-foreground">{lease?.lease_number ?? "—"}</div>
          {lease?.lessee && (
            <div className="text-muted-foreground text-[11px] truncate">{lease.lessee}</div>
          )}
        </div>
      </div>
      <div className="shrink-0">
        <StatusBadge status={car.status} />
      </div>
    </div>
  );
}

function RiderRow({ rider }: { rider: Rider }) {
  const expired = rider.expiration_date && new Date(rider.expiration_date) < new Date();
  return (
    <div className="flex items-center gap-4 py-3 border-b border-border/40 last:border-0 text-xs">
      <div className="min-w-[120px]">
        <div className="text-sm font-semibold text-foreground">{rider.rider_name}</div>
        {rider.schedule_number && (
          <div className="text-muted-foreground mt-0.5">Sch {rider.schedule_number}</div>
        )}
      </div>
      <div className="flex-1 grid grid-cols-3 gap-3">
        <div>
          <div className="text-muted-foreground mb-0.5">Master Lease</div>
          <div className="text-foreground">{rider.master_lease?.lease_number ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Lessee</div>
          <div className="text-foreground">{rider.master_lease?.lessee ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Expiration</div>
          <div className={cn("font-medium", expired ? "text-red-400" : "text-foreground")}>
            {fmt(rider.expiration_date)}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-muted-foreground text-[11px]">Cars</div>
        <div className="font-semibold text-foreground">{rider.car_count}</div>
      </div>
    </div>
  );
}

function LeaseRow({ lease }: { lease: MasterLease }) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-border/40 last:border-0 text-xs">
      <div className="min-w-[120px]">
        <div className="text-sm font-semibold text-foreground">{lease.lease_number}</div>
        {lease.agreement_number && (
          <div className="text-muted-foreground mt-0.5">Agmt {lease.agreement_number}</div>
        )}
      </div>
      <div className="flex-1 grid grid-cols-3 gap-3">
        <div>
          <div className="text-muted-foreground mb-0.5">Lessor</div>
          <div className="text-foreground">{lease.lessor ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Lessee</div>
          <div className="text-foreground">{lease.lessee ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Type</div>
          <div className="text-foreground capitalize">{lease.lease_type ?? "—"}</div>
        </div>
      </div>
      <div className="shrink-0">
        <div className="text-muted-foreground text-[11px]">Effective</div>
        <div className="text-foreground">{fmt(lease.effective_date)}</div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SearchPage() {
  const [location] = useLocation();
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Read ?q= from hash URL (e.g. /#/search?q=HWCX10823)
  useEffect(() => {
    const hash = window.location.hash; // e.g. #/search?q=foo
    const qIndex = hash.indexOf("?");
    if (qIndex !== -1) {
      const params = new URLSearchParams(hash.slice(qIndex + 1));
      const q = params.get("q");
      if (q && q !== query) {
        setQuery(q);
        runSearch(q);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) { setResults(null); setCommitted(""); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(await res.text());
      const data: SearchResults = await res.json();
      setResults(data);
      setCommitted(trimmed);
    } catch (e: any) {
      setError(e.message ?? "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function handleInput(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 350);
  }

  function clear() {
    setQuery("");
    setResults(null);
    setCommitted("");
    setError(null);
    inputRef.current?.focus();
  }

  const hasResults = results && results.counts.total > 0;
  const noResults = results && results.counts.total === 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">RLMS</div>
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search by car number(s), lessee name, rider, or lease number. Separate multiple car numbers with commas or spaces.
        </p>
      </div>

      {/* Search bar */}
      <div className="relative mb-2">
        <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { if (debounceRef.current) clearTimeout(debounceRef.current); runSearch(query); } }}
          placeholder="e.g. HWCX10823, 10841  ·  COVIA  ·  SCH 5  ·  H07-099  ·  Exxon Mobile"
          className="w-full bg-card border border-border rounded-lg pl-10 pr-10 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
        />
        {query && (
          <button
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search tips */}
      {!results && !loading && (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Car number(s)", example: "HWCX10823", sub: "or HWCX10823, HWCX10841" },
            { label: "Lessee name", example: "Exxon Mobile", sub: "partial match works" },
            { label: "Rider name", example: "SCH 5", sub: "or schedule number" },
            { label: "Lease number", example: "H07-099", sub: "or agreement number" },
          ].map((tip) => (
            <button
              key={tip.example}
              onClick={() => { setQuery(tip.example); handleInput(tip.example); }}
              className="text-left p-3 rounded-lg border border-border bg-card hover:bg-card/80 hover:border-primary/30 transition-all group"
            >
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{tip.label}</div>
              <div className="text-sm font-mono font-medium text-foreground group-hover:text-primary transition-colors">{tip.example}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{tip.sub}</div>
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* No results */}
      {noResults && !loading && (
        <div className="mt-8 text-center text-muted-foreground text-sm">
          No results for <span className="text-foreground font-medium">"{committed}"</span>.
          <div className="mt-1 text-xs">Try a partial car number, lessee name, or rider.</div>
        </div>
      )}

      {/* Results */}
      {hasResults && !loading && (
        <div className="mt-6 space-y-8">
          <div className="text-xs text-muted-foreground">
            {results.counts.total} result{results.counts.total !== 1 ? "s" : ""} for{" "}
            <span className="text-foreground font-medium">"{committed}"</span>
            {results.terms.length > 1 && (
              <span> — matching any of: {results.terms.map((t) => (
                <span key={t} className="inline-block mx-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[11px] font-mono">{t}</span>
              ))}</span>
            )}
          </div>

          {/* Railcars section */}
          {results.railcars.length > 0 && (
            <section>
              <SectionHeader icon={Train} label="Railcars" count={results.railcars.length} />
              <div className="rounded-lg border border-border bg-card px-4">
                {/* Column headers */}
                <div className="flex items-center gap-4 py-2 text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border/60">
                  <div className="min-w-[120px]">Car / Type</div>
                  <div className="flex-1 grid grid-cols-3 gap-3">
                    <div>Fleet / Lessee</div>
                    <div>Rider</div>
                    <div>Master Lease</div>
                  </div>
                  <div className="w-16 text-right">Status</div>
                </div>
                {results.railcars.map((car) => (
                  <RailcarRow key={car.id} car={car} />
                ))}
              </div>
            </section>
          )}

          {/* Riders section */}
          {results.riders.length > 0 && (
            <section>
              <SectionHeader icon={FileText} label="Riders / Schedules" count={results.riders.length} />
              <div className="rounded-lg border border-border bg-card px-4">
                <div className="flex items-center gap-4 py-2 text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border/60">
                  <div className="min-w-[120px]">Rider / Schedule</div>
                  <div className="flex-1 grid grid-cols-3 gap-3">
                    <div>Master Lease</div>
                    <div>Lessee</div>
                    <div>Expiration</div>
                  </div>
                  <div className="w-10 text-right">Cars</div>
                </div>
                {results.riders.map((rider) => (
                  <RiderRow key={rider.id} rider={rider} />
                ))}
              </div>
            </section>
          )}

          {/* Master Leases section */}
          {results.leases.length > 0 && (
            <section>
              <SectionHeader icon={BookOpen} label="Master Leases" count={results.leases.length} />
              <div className="rounded-lg border border-border bg-card px-4">
                <div className="flex items-center gap-4 py-2 text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border/60">
                  <div className="min-w-[120px]">Lease / Agmt #</div>
                  <div className="flex-1 grid grid-cols-3 gap-3">
                    <div>Lessor</div>
                    <div>Lessee</div>
                    <div>Type</div>
                  </div>
                  <div className="w-20 text-right">Effective</div>
                </div>
                {results.leases.map((lease) => (
                  <LeaseRow key={lease.id} lease={lease} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
