import { useMemo, useState } from "react";
import { useCanEdit } from "@/lib/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RailcarWithAssignment } from "@shared/schema";

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-card-border bg-card p-5">
      <div className="flex items-center gap-3 mb-4">
        <span
          className={cn(
            "h-6 w-6 rounded-full border flex items-center justify-center text-xs font-mono-num",
            done
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground"
          )}
        >
          {n}
        </span>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export default function MoveCars() {
  const canEdit = useCanEdit();
  const [fromRiderId, setFromRiderId] = useState<string>("");
  const [toRiderId, setToRiderId] = useState<string>("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newFleetName, setNewFleetName] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const { data: riders } = useQuery<any[]>({ queryKey: ["/api/riders"] });
  const { data: railcars, isLoading } = useQuery<RailcarWithAssignment[]>({
    queryKey: ["/api/railcars"],
  });
  const { data: history } = useQuery<any[]>({ queryKey: ["/api/history"] });

  const fromRider = riders?.find((r) => String(r.id) === fromRiderId);
  const toRider = riders?.find((r) => String(r.id) === toRiderId);

  const sourceCars = useMemo(() => {
    if (!fromRiderId || !railcars) return [];
    const list = railcars.filter(
      (c) => String(c.assignment?.rider_id ?? "") === fromRiderId
    );
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (c) =>
        c.car_number.toLowerCase().includes(q) ||
        c.assignment?.fleet_name?.toLowerCase().includes(q)
    );
  }, [railcars, fromRiderId, search]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const selectAll = () => {
    if (selected.size === sourceCars.length) setSelected(new Set());
    else setSelected(new Set(sourceCars.map((c) => c.id)));
  };

  const move = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/move", {
        car_ids: Array.from(selected),
        to_rider_id: Number(toRiderId),
        new_fleet_name: newFleetName.trim() || null,
        reason: reason.trim() || null,
        moved_by: "rlms-ui",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({
        title: "Move complete",
        description: `${selected.size} car${selected.size > 1 ? "s" : ""} reassigned.`,
      });
      setSelected(new Set());
      setFromRiderId("");
      setToRiderId("");
      setNewFleetName("");
      setReason("");
    },
    onError: (e: Error) =>
      toast({ title: "Move failed", description: e.message, variant: "destructive" }),
  });

  const canConfirm =
    fromRiderId && toRiderId && selected.size > 0 && fromRiderId !== toRiderId;

  return (
    <div>
      <PageHeader
        title="Move Cars"
        subtitle="Reassign one or more railcars from one rider to another. Every move is logged."
      />

      <div className="px-8 py-6 grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-4">
          <Step n={1} title="Select source rider" done={!!fromRiderId}>
            <Select
              value={fromRiderId}
              onValueChange={(v) => {
                setFromRiderId(v);
                setSelected(new Set());
              }}
            >
              <SelectTrigger data-testid="select-from-rider">
                <SelectValue placeholder="Choose a rider…" />
              </SelectTrigger>
              <SelectContent>
                {(riders ?? []).map((r: any) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.rider_name} —{" "}
                    {r.master_lease?.lease_number ?? "—"} · {r.car_count ?? 0} cars
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Step>

          <Step
            n={2}
            title={`Select cars${fromRiderId ? ` (${selected.size}/${sourceCars.length})` : ""}`}
            done={selected.size > 0}
          >
            {!fromRiderId ? (
              <div className="py-6 text-center text-sm text-muted-foreground italic">
                Pick a source rider first.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter by car # or lessee…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                      data-testid="input-filter-source-cars"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={selectAll}
                    data-testid="button-select-all"
                  >
                    {selected.size === sourceCars.length && sourceCars.length > 0
                      ? "Clear"
                      : "Select all"}
                  </Button>
                </div>

                <div className="rounded-md border border-border max-h-[360px] overflow-auto">
                  {isLoading ? (
                    <Skeleton className="h-40" />
                  ) : sourceCars.length === 0 ? (
                    <div className="py-10 text-sm text-muted-foreground italic text-center">
                      No cars on this rider.
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground bg-muted/30 sticky top-0">
                        <tr className="text-left">
                          <th className="w-10 px-3 py-2" />
                          <th className="px-3 py-2 font-medium">Car Number</th>
                          <th className="px-3 py-2 font-medium">Lessee</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourceCars.map((c) => (
                          <tr
                            key={c.id}
                            className={cn(
                              "border-t border-border cursor-pointer hover-elevate",
                              selected.has(c.id) && "bg-primary/5"
                            )}
                            onClick={() => toggle(c.id)}
                            data-testid={`source-car-${c.id}`}
                          >
                            <td className="px-3 py-1.5">
                              <Checkbox
                                checked={selected.has(c.id)}
                                onCheckedChange={() => toggle(c.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-3 py-1.5 font-mono-num">{c.car_number}</td>
                            <td className="px-3 py-1.5">
                              {c.assignment?.fleet_name ?? "—"}
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground">
                              {c.status ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </Step>

          <Step n={3} title="Destination rider" done={!!toRiderId}>
            <Select value={toRiderId} onValueChange={setToRiderId}>
              <SelectTrigger data-testid="select-to-rider">
                <SelectValue placeholder="Choose destination…" />
              </SelectTrigger>
              <SelectContent>
                {(riders ?? [])
                  .filter((r: any) => String(r.id) !== fromRiderId)
                  .map((r: any) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.rider_name} —{" "}
                      {r.master_lease?.lease_number ?? "—"} · {r.car_count ?? 0} cars
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Step>

          <Step n={4} title="New lessee name & reason (optional)">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>New lessee name</Label>
                <Input
                  value={newFleetName}
                  onChange={(e) => setNewFleetName(e.target.value)}
                  placeholder="Leave blank to keep existing"
                  data-testid="input-new-lessee"
                />
              </div>
              <div>
                <Label>Reason</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. New Assignment"
                  data-testid="input-reason"
                />
              </div>
            </div>
          </Step>
        </div>

        {/* Preview */}
        <aside className="xl:sticky xl:top-4 self-start rounded-lg border border-card-border bg-card p-5 h-fit">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Move Preview
          </div>
          {canConfirm ? (
            <div className="space-y-4">
              <div className="text-sm">
                <div className="text-muted-foreground text-xs mb-1">Moving</div>
                <div className="text-2xl font-semibold font-mono-num">
                  {selected.size}{" "}
                  <span className="text-base font-normal text-muted-foreground">
                    car{selected.size > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0 rounded-md border border-border p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    From
                  </div>
                  <div className="font-medium truncate">{fromRider?.rider_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {fromRider?.master_lease?.lease_number}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0 rounded-md border border-primary/40 bg-primary/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    To
                  </div>
                  <div className="font-medium truncate">{toRider?.rider_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {toRider?.master_lease?.lease_number}
                  </div>
                </div>
              </div>
              {newFleetName && (
                <div className="text-xs">
                  <span className="text-muted-foreground">New lessee name: </span>
                  <span className="font-mono-num">{newFleetName}</span>
                </div>
              )}
              {reason && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Reason: </span>
                  <span className="italic">{reason}</span>
                </div>
              )}
              <Button
                className="w-full"
                onClick={() => move.mutate()}
                disabled={move.isPending || !canEdit}
                data-testid="button-confirm-move"
              >
                {!canEdit ? "View only" : move.isPending ? "Moving…" : "Confirm move"}
              </Button>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              Select source, cars, and destination rider to preview.
            </div>
          )}
        </aside>
      </div>

      {/* Recent moves */}
      <div className="px-8 pb-10">
        <div className="rounded-lg border border-card-border bg-card overflow-hidden">
          <header className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent Moves</h2>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {(history ?? []).length} records
            </span>
          </header>
          <div className="overflow-auto max-h-[300px]">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground bg-muted/40 sticky top-0">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Car</th>
                  <th className="px-4 py-2 font-medium">From → To</th>
                  <th className="px-4 py-2 font-medium">Lessee</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(history ?? []).slice(0, 50).map((h: any) => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="px-4 py-2 font-mono-num text-muted-foreground">
                      {new Date(h.moved_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-mono-num">
                      {h.railcar?.car_number ?? `#${h.railcar_id}`}
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-muted-foreground">
                        {h.from_rider?.rider_name ?? "—"}
                      </span>
                      <span className="mx-1.5 text-primary">→</span>
                      {h.to_rider?.rider_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {h.from_fleet_name ?? "—"} → {h.to_fleet_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground italic">
                      {h.reason ?? "—"}
                    </td>
                  </tr>
                ))}
                {(history ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      No moves recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
