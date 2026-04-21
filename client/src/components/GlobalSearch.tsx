import {
  useState,
  useRef,
  useEffect,
  useCallback,
  KeyboardEvent,
} from "react";
import { useLocation } from "wouter";
import {
  Search,
  Train,
  BookOpen,
  FileText,
  ArrowRight,
  Loader2,
  X,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

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
  assignment: {
    fleet_name: string | null;
    rider: {
      id: number;
      rider_name: string;
      master_lease: {
        id: number;
        lease_number: string;
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
const ENTITY_STYLES: Record<string, { label: string; cls: string }> = {
  "Rail Partners Select": { label: "RPS",   cls: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  "Main":                 { label: "OWN",   cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
};

function EntityPip({ entity }: { entity: string | null | undefined }) {
  if (!entity) return null;
  const s = ENTITY_STYLES[entity] ?? { label: entity.slice(0, 3).toUpperCase(), cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn("text-[9px] uppercase tracking-widest font-bold px-1 py-0.5 rounded border leading-none", s.cls)}>
      {s.label}
    </span>
  );
}

function StatusDot({ status }: { status: string | null }) {
  const s = status ?? "unknown";
  const cls =
    s === "active"   ? "bg-emerald-400" :
    s === "stored"   ? "bg-amber-400" :
    s === "retired"  ? "bg-red-400" :
    s === "bad order"? "bg-orange-400" : "bg-muted-foreground";
  return <span className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-0.5", cls)} />;
}

// Highlight matched terms inside a string
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-primary/20 text-primary rounded-sm px-0.5 not-italic">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

// ── Flat item list for keyboard nav ──────────────────────────────────────────
type NavItem =
  | { type: "car";   data: RailcarResult }
  | { type: "rider"; data: Rider }
  | { type: "lease"; data: MasterLease }
  | { type: "viewall" };

function buildNavItems(results: SearchResults | null): NavItem[] {
  if (!results) return [];
  const items: NavItem[] = [];
  for (const c of results.railcars.slice(0, 8))  items.push({ type: "car",   data: c });
  for (const r of results.riders.slice(0, 5))    items.push({ type: "rider", data: r });
  for (const l of results.leases.slice(0, 5))    items.push({ type: "lease", data: l });
  if (results.counts.total > 0) items.push({ type: "viewall" });
  return items;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GlobalSearch() {
  const [, navigate] = useLocation();
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<SearchResults | null>(null);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef    = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navItems = buildNavItems(results);

  // ── Search ──────────────────────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults(null); setOpen(false); return; }
    setLoading(true);
    try {
      const data = await apiRequest("GET", `/api/search?q=${encodeURIComponent(trimmed)}`);
      const json: SearchResults = await data.json();
      setResults(json);
      setOpen(true);
      setActiveIdx(-1);
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChange(val: string) {
    setQuery(val);
    if (!val.trim()) { setResults(null); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 280);
  }

  // ── Navigate to a result ────────────────────────────────────────────────────
  function navigateTo(item: NavItem) {
    setOpen(false);
    setQuery("");
    setResults(null);
    inputRef.current?.blur();

    if (item.type === "viewall") {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      return;
    }
    if (item.type === "car") {
      // Navigate to all-cars with filter pre-filled
      navigate(`/all-cars?highlight=${encodeURIComponent(item.data.car_number)}`);
      return;
    }
    if (item.type === "rider") {
      navigate(`/leases?rider=${item.data.id}`);
      return;
    }
    if (item.type === "lease") {
      navigate(`/leases?mla=${item.data.id}`);
      return;
    }
  }

  // ── Keyboard navigation ──────────────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "Enter") { runSearch(query); return; }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, navItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < navItems.length) {
        navigateTo(navItems[activeIdx]);
      } else {
        // Commit to full search page
        setOpen(false);
        navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  // ── ⌘K / Ctrl+K global shortcut ────────────────────────────────────────────
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ── Click-outside to dismiss ─────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────
  const terms = results?.terms ?? [];

  // Count lessees uniquely from railcar results
  const lesseeSet = new Map<string, { lessee: string; cars: RailcarResult[] }>();
  for (const car of results?.railcars ?? []) {
    const l = car.assignment?.rider?.master_lease?.lessee ?? car.assignment?.fleet_name;
    if (l) {
      if (!lesseeSet.has(l)) lesseeSet.set(l, { lessee: l, cars: [] });
      lesseeSet.get(l)!.cars.push(car);
    }
  }
  // Also add lessees from matched lease records
  for (const lease of results?.leases ?? []) {
    if (lease.lessee && !lesseeSet.has(lease.lessee)) {
      lesseeSet.set(lease.lessee, { lessee: lease.lessee, cars: [] });
    }
  }

  const totalCount = results?.counts.total ?? 0;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-xl" data-testid="global-search">
      {/* Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
          if (query.trim()) {
            if (results) setOpen(true);
            else runSearch(query);
          }
        }}
          placeholder="Search cars, lessees, lease numbers…"
          autoComplete="off"
          data-testid="input-global-search"
          className="w-full bg-sidebar-accent/40 border border-sidebar-border rounded-md pl-8 pr-20 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {query && !loading && (
            <button
              onMouseDown={(e) => { e.preventDefault(); setQuery(""); setResults(null); setOpen(false); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-search-clear"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {!query && (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-sidebar-border bg-muted/30 px-1 py-0.5 text-[10px] text-muted-foreground font-sans pointer-events-none">
              <span className="text-[11px]">⌘</span>K
            </kbd>
          )}
        </div>
      </div>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute top-[calc(100%+6px)] left-0 w-[640px] max-w-[calc(100vw-32px)] bg-card border border-border rounded-xl shadow-2xl shadow-black/40 z-50 overflow-hidden"
          data-testid="search-results-panel"
        >
          {/* No results */}
          {!loading && results && totalCount === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results for{" "}
              <span className="text-foreground font-medium">"{query}"</span>
              <div className="text-xs mt-1">Try a partial car number, lessee name, or MLA number.</div>
            </div>
          )}

          {/* Results */}
          {results && totalCount > 0 && (
            <div className="max-h-[480px] overflow-y-auto overscroll-contain">

              {/* ── Railcars ─────────────────────────────────────────── */}
              {results.railcars.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1.5 sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border/40 z-10">
                    <Train className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Railcars
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                      {results.railcars.length}{results.railcars.length === 8 ? "+" : ""} found
                    </span>
                  </div>
                  <div className="py-1">
                    {results.railcars.slice(0, 8).map((car, i) => {
                      const idx = i;
                      const isActive = activeIdx === idx;
                      const rider = car.assignment?.rider;
                      const lease = rider?.master_lease;
                      return (
                        <button
                          key={car.id}
                          onMouseDown={() => navigateTo({ type: "car", data: car })}
                          onMouseEnter={() => setActiveIdx(idx)}
                          data-testid={`search-result-car-${car.id}`}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                            isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
                          )}
                        >
                          {/* Car number + entity */}
                          <div className="w-[130px] shrink-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <StatusDot status={car.status} />
                              <span className="font-mono text-xs font-semibold text-foreground tracking-wide">
                                <Highlight text={car.car_number} terms={terms} />
                              </span>
                            </div>
                            <div className="flex items-center gap-1 pl-3">
                              <EntityPip entity={car.entity} />
                              <span className="text-[10px] text-muted-foreground truncate">{car.car_type ?? ""}</span>
                            </div>
                          </div>
                          {/* Lessee */}
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-muted-foreground leading-none mb-0.5">Lessee</div>
                            <div className="text-xs text-foreground truncate">
                              <Highlight
                                text={car.assignment?.fleet_name ?? lease?.lessee ?? "—"}
                                terms={terms}
                              />
                            </div>
                          </div>
                          {/* Rider */}
                          <div className="w-[120px] shrink-0 hidden sm:block">
                            <div className="text-[10px] text-muted-foreground leading-none mb-0.5">Rider</div>
                            <div className="text-xs text-foreground truncate">
                              <Highlight text={rider?.rider_name ?? "—"} terms={terms} />
                            </div>
                          </div>
                          {/* MLA */}
                          <div className="w-[90px] shrink-0 hidden md:block">
                            <div className="text-[10px] text-muted-foreground leading-none mb-0.5">MLA</div>
                            <div className="text-xs font-mono text-foreground truncate">
                              <Highlight text={lease?.lease_number ?? "—"} terms={terms} />
                            </div>
                          </div>
                          <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── Lessees ──────────────────────────────────────────── */}
              {lesseeSet.size > 0 && results.leases.length > 0 && (() => {
                // Only show lessees section when the query matched lessees/leases
                const lesseesFromLeases = [...new Set(results.leases.map(l => l.lessee).filter(Boolean))] as string[];
                if (!lesseesFromLeases.length) return null;

                const offset = Math.min(results.railcars.length, 8);
                return (
                  <section className="border-t border-border/40">
                    <div className="flex items-center gap-2 px-4 pt-3 pb-1.5 sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border/40 z-10">
                      <Building2 className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Lessees
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                        {lesseesFromLeases.length} found
                      </span>
                    </div>
                    <div className="py-1">
                      {lesseesFromLeases.slice(0, 5).map((lessee, i) => {
                        const idx = offset + i;
                        const isActive = activeIdx === idx;
                        // Find their MLA
                        const leaseForLessee = results.leases.find(l => l.lessee === lessee);
                        const carCount = (results.railcars.filter(
                          c => c.assignment?.fleet_name === lessee ||
                               c.assignment?.rider?.master_lease?.lessee === lessee
                        )).length;
                        return (
                          <button
                            key={lessee}
                            onMouseDown={() => {
                              if (leaseForLessee) navigateTo({ type: "lease", data: leaseForLessee });
                              else { setOpen(false); navigate(`/search?q=${encodeURIComponent(query.trim())}`); }
                            }}
                            onMouseEnter={() => setActiveIdx(idx)}
                            data-testid={`search-result-lessee-${i}`}
                            className={cn(
                              "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                              isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-foreground truncate">
                                <Highlight text={lessee} terms={terms} />
                              </div>
                              {leaseForLessee && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  MLA{" "}
                                  <span className="font-mono">
                                    <Highlight text={leaseForLessee.lease_number} terms={terms} />
                                  </span>
                                  {leaseForLessee.lease_type && ` · ${leaseForLessee.lease_type}`}
                                </div>
                              )}
                            </div>
                            {carCount > 0 && (
                              <div className="shrink-0 text-right">
                                <div className="text-xs font-semibold text-foreground tabular-nums">{carCount}</div>
                                <div className="text-[10px] text-muted-foreground">cars</div>
                              </div>
                            )}
                            <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })()}

              {/* ── Master Leases ─────────────────────────────────────── */}
              {results.leases.length > 0 && (
                <section className="border-t border-border/40">
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1.5 sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border/40 z-10">
                    <BookOpen className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Master Leases
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                      {results.leases.length} found
                    </span>
                  </div>
                  <div className="py-1">
                    {results.leases.slice(0, 5).map((lease, i) => {
                      const offset = Math.min(results.railcars.length, 8) +
                        Math.min([...new Set(results.leases.map(l=>l.lessee).filter(Boolean))].length, 5);
                      const idx = offset + i;
                      const isActive = activeIdx === idx;
                      return (
                        <button
                          key={lease.id}
                          onMouseDown={() => navigateTo({ type: "lease", data: lease })}
                          onMouseEnter={() => setActiveIdx(idx)}
                          data-testid={`search-result-lease-${lease.id}`}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                            isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
                          )}
                        >
                          <div className="w-[110px] shrink-0">
                            <div className="font-mono text-xs font-semibold text-foreground">
                              <Highlight text={lease.lease_number} terms={terms} />
                            </div>
                            {lease.agreement_number && (
                              <div className="text-[10px] text-muted-foreground font-mono">
                                <Highlight text={lease.agreement_number} terms={terms} />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-foreground truncate">
                              <Highlight text={lease.lessee ?? "—"} terms={terms} />
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {lease.lessor ?? ""}{lease.lease_type ? ` · ${lease.lease_type}` : ""}
                            </div>
                          </div>
                          {lease.effective_date && (
                            <div className="shrink-0 text-right hidden sm:block">
                              <div className="text-[10px] text-muted-foreground">Effective</div>
                              <div className="text-xs text-foreground">
                                {new Date(lease.effective_date).toLocaleDateString("en-US", { year: "numeric", month: "short" })}
                              </div>
                            </div>
                          )}
                          <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── Riders ───────────────────────────────────────────── */}
              {results.riders.length > 0 && (
                <section className="border-t border-border/40">
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1.5 sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border/40 z-10">
                    <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Riders / Schedules
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                      {results.riders.length} found
                    </span>
                  </div>
                  <div className="py-1">
                    {results.riders.slice(0, 4).map((rider, i) => {
                      const offset =
                        Math.min(results.railcars.length, 8) +
                        Math.min([...new Set(results.leases.map(l=>l.lessee).filter(Boolean))].length, 5) +
                        results.leases.slice(0,5).length;
                      const idx = offset + i;
                      const isActive = activeIdx === idx;
                      return (
                        <button
                          key={rider.id}
                          onMouseDown={() => navigateTo({ type: "rider", data: rider })}
                          onMouseEnter={() => setActiveIdx(idx)}
                          data-testid={`search-result-rider-${rider.id}`}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                            isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-foreground truncate">
                              <Highlight text={rider.rider_name} terms={terms} />
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {rider.master_lease?.lease_number && (
                                <span className="font-mono mr-1.5">
                                  <Highlight text={rider.master_lease.lease_number} terms={terms} />
                                </span>
                              )}
                              {rider.master_lease?.lessee && (
                                <Highlight text={rider.master_lease.lessee} terms={terms} />
                              )}
                            </div>
                          </div>
                          {rider.car_count > 0 && (
                            <div className="shrink-0 text-right">
                              <div className="text-xs font-semibold tabular-nums text-foreground">{rider.car_count}</div>
                              <div className="text-[10px] text-muted-foreground">cars</div>
                            </div>
                          )}
                          <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Footer: view all + result count */}
          {results && totalCount > 0 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border/60 bg-muted/10">
              <span className="text-[11px] text-muted-foreground">
                {totalCount} result{totalCount !== 1 ? "s" : ""}
                {results.terms.length > 1 && (
                  <span>
                    {" "}· matching{" "}
                    {results.terms.map((t) => (
                      <span key={t} className="font-mono text-primary bg-primary/10 rounded px-1 mx-0.5">{t}</span>
                    ))}
                  </span>
                )}
              </span>
              <button
                onMouseDown={() => { setOpen(false); navigate(`/search?q=${encodeURIComponent(query.trim())}`); }}
                className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
                data-testid="button-search-view-all"
              >
                View all results
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Keyboard hint footer */}
          {results && totalCount > 0 && (
            <div className="hidden sm:flex items-center gap-3 px-4 py-1.5 border-t border-border/40 bg-muted/5">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <kbd className="rounded border border-border/50 bg-muted/30 px-1 font-sans text-[10px]">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <kbd className="rounded border border-border/50 bg-muted/30 px-1 font-sans text-[10px]">↵</kbd>
                Open
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <kbd className="rounded border border-border/50 bg-muted/30 px-1 font-sans text-[10px]">Esc</kbd>
                Close
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
