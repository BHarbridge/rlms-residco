import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function HistoryPage() {
  const [search, setSearch] = useState("");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["/api/history"],
  });

  const rows = useMemo(() => {
    let r = data ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((h: any) => h.railcar?.car_number?.toLowerCase().includes(q));
    }
    r = [...r].sort((a: any, b: any) => {
      const av = new Date(a.moved_at).getTime();
      const bv = new Date(b.moved_at).getTime();
      return dir === "desc" ? bv - av : av - bv;
    });
    return r;
  }, [data, search, dir]);

  return (
    <div>
      <PageHeader
        title="Assignment History"
        subtitle="Full audit trail of every railcar move across the fleet"
      />

      <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search car number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-history"
            />
          </div>
          <div className="text-xs text-muted-foreground ml-auto font-mono-num">
            {rows.length} records
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-card overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground bg-muted/40">
                <tr className="text-left">
                  <th
                    className={cn(
                      "px-4 py-3 font-medium text-[11px] uppercase tracking-wider cursor-pointer select-none",
                      "text-foreground"
                    )}
                    onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
                  >
                    <span className="inline-flex items-center gap-1">
                      Date <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">
                    Car
                  </th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">
                    From
                  </th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">
                    To
                  </th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">
                    Lessee
                  </th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="px-4 py-3 font-medium text-[11px] uppercase tracking-wider">
                    By
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-16 text-center text-muted-foreground"
                    >
                      No moves on record yet. Use Move Cars to reassign railcars.
                    </td>
                  </tr>
                ) : (
                  rows.map((h: any) => (
                    <tr
                      key={h.id}
                      className="border-t border-border hover-elevate"
                      data-testid={`history-row-${h.id}`}
                    >
                      <td className="px-4 py-3 font-mono-num text-muted-foreground whitespace-nowrap">
                        {new Date(h.moved_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono-num">
                        {h.railcar?.car_number ?? `#${h.railcar_id}`}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          {h.from_rider?.rider_name ?? "—"}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono-num">
                          {h.from_rider?.master_lease?.lease_number ?? ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          {h.to_rider?.rider_name ?? "—"}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono-num">
                          {h.to_rider?.master_lease?.lease_number ?? ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {h.from_fleet_name ?? "—"} → {h.to_fleet_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 italic text-muted-foreground">
                        {h.reason ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs font-mono-num">
                        {h.moved_by ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
