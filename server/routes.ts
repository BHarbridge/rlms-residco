import type { Express, Request, Response } from "express";
import type { Server } from "http";
import multer from "multer";
import { supabase, supabaseAdmin } from "./supabase";
import {
  insertMasterLeaseSchema,
  insertRiderSchema,
  insertRailcarSchema,
  insertRiderContactSchema,
  changeCarNumberSchema,
  moveCarsSchema,
} from "@shared/schema";

// Multer: store uploads in memory (files go straight to Supabase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 52 * 1024 * 1024 }, // 50 MB
});

const STORAGE_BUCKET = "rlms-attachments";

function errHandler(res: Response, err: unknown) {
  // Handle Supabase StorageError and PostgrestError objects (have .message but aren't Error instances)
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
  } else if (err && typeof err === 'object' && 'message' in err) {
    msg = String((err as any).message);
  } else {
    msg = String(err);
  }
  console.error("[api]", msg, err);
  return res.status(500).json({ message: msg });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ---------- Batch Lease Setup (wizard) ----------
  // Creates MLA + riders + new railcars + assignments in one atomic-ish call.
  // Each rider may carry an optional `cars` array of car objects to create & assign.
  app.post("/api/setup-lease", async (req, res) => {
    try {
      const { mla, riders: riderPayloads } = req.body as {
        mla: Record<string, any>;
        riders: Array<{
          rider: Record<string, any>;
          cars: Array<Record<string, any>>; // new car objects to create
          existing_car_ids: number[];        // already-in-DB cars to assign
          fleet_name?: string;
        }>;
      };

      // 1. Create MLA
      const { data: newMla, error: mlaErr } = await supabase
        .from("master_leases")
        .insert(mla)
        .select()
        .single();
      if (mlaErr) throw mlaErr;

      const now = new Date().toISOString();
      const riderResults: any[] = [];

      for (const rp of riderPayloads ?? []) {
        // 2. Create rider under this MLA
        const { data: newRider, error: rErr } = await supabase
          .from("riders")
          .insert({ ...rp.rider, master_lease_id: newMla.id })
          .select()
          .single();
        if (rErr) throw rErr;

        const carIds: number[] = [...(rp.existing_car_ids ?? [])];

        // 3. Create new railcars
        for (const carObj of rp.cars ?? []) {
          const { data: newCar, error: cErr } = await supabase
            .from("railcars")
            .insert({
              ...carObj,
              status: carObj.status ?? "Active/In-Service",
            })
            .select()
            .single();
          if (cErr) throw cErr;
          carIds.push(newCar.id);
        }

        // 4. Assign all cars to this rider
        if (carIds.length > 0) {
          // Fetch existing assignments so we can upsert
          const { data: existingAssigns } = await supabase
            .from("railcar_assignments")
            .select("id, railcar_id")
            .in("railcar_id", carIds);
          const alreadyAssigned = new Map<number, number>(
            (existingAssigns ?? []).map((a: any) => [a.railcar_id, a.id])
          );

          for (const carId of carIds) {
            const existingId = alreadyAssigned.get(carId);
            if (existingId) {
              await supabase
                .from("railcar_assignments")
                .update({ rider_id: newRider.id, fleet_name: rp.fleet_name ?? null, assigned_at: now })
                .eq("id", existingId);
            } else {
              await supabase
                .from("railcar_assignments")
                .insert({ railcar_id: carId, rider_id: newRider.id, fleet_name: rp.fleet_name ?? null, assigned_at: now });
            }
          }
        }

        riderResults.push({ rider: newRider, car_count: carIds.length });
      }

      res.json({ ok: true, mla: newMla, riders: riderResults });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Dashboard ----------
  app.get("/api/dashboard", async (_req, res) => {
    try {
      const [railcarsRes, assignmentsRes, ridersRes, leasesRes] =
        await Promise.all([
          supabase.from("railcars").select(
            `id, car_number, reporting_marks, car_type, status, entity,
             assignment:railcar_assignments(
               id, fleet_name, rider_id,
               rider:riders(id, rider_name, schedule_number, expiration_date,
                 master_lease:master_leases(id, lease_number, lessee)
               )
             )`
          ),
          supabase
            .from("railcar_assignments")
            .select("id, railcar_id, rider_id, fleet_name", { count: "exact" }),
          supabase.from("riders").select(
            "id, rider_name, schedule_number, expiration_date, master_lease_id"
          ),
          supabase.from("master_leases").select("id, lease_number, lessor, lessee"),
        ]);

      if (railcarsRes.error) throw railcarsRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;
      if (ridersRes.error) throw ridersRes.error;
      if (leasesRes.error) throw leasesRes.error;

      // Normalise the nested assignment (Supabase returns array for 1-to-many)
      const railcars = (railcarsRes.data ?? []).map((r: any) => ({
        ...r,
        assignment: Array.isArray(r.assignment) ? r.assignment[0] ?? null : r.assignment,
      }));
      const assignments = assignmentsRes.data ?? [];
      const riders = ridersRes.data ?? [];
      const leases = leasesRes.data ?? [];

      const assignedCarIds = new Set(assignments.map((a) => a.railcar_id));
      const activeAssignments = assignments.length;

      // Unassigned = in registry but no active assignment
      const unassignedCarList = railcars.filter((r: any) => !assignedCarIds.has(r.id));
      const unassignedCars = unassignedCarList.length;

      // Utilization = assigned / total * 100 (round to 1 decimal)
      const utilization = railcars.length > 0
        ? Math.round((activeAssignments / railcars.length) * 1000) / 10
        : 0;

      // RPS vs Owned entity bucketing
      const rpsCars     = railcars.filter((r: any) => r.entity === "Rail Partners Select");
      const ownedCars   = railcars.filter((r: any) => r.entity === "Main");
      const rpsAssigned = rpsCars.filter((r: any) => assignedCarIds.has(r.id)).length;
      const ownedAssigned = ownedCars.filter((r: any) => assignedCarIds.has(r.id)).length;
      const rpsUtil   = rpsCars.length   > 0 ? Math.round((rpsAssigned   / rpsCars.length)   * 1000) / 10 : 0;
      const ownedUtil = ownedCars.length > 0 ? Math.round((ownedAssigned / ownedCars.length) * 1000) / 10 : 0;

      const now = new Date();
      const twelveMo = new Date(now);
      twelveMo.setMonth(twelveMo.getMonth() + 12);

      const sixMo = new Date(now);
      sixMo.setMonth(sixMo.getMonth() + 6);

      const expiringRiders = riders.filter((r) => {
        if (!r.expiration_date) return false;
        const d = new Date(r.expiration_date);
        return d <= twelveMo && d >= now;
      });
      const expiring12mo = expiringRiders.length;
      const expiring6mo = riders.filter((r) => {
        if (!r.expiration_date) return false;
        const d = new Date(r.expiration_date);
        return d <= sixMo && d >= now;
      }).length;

      // Assigned car detail list for KPI drill-down
      const assignedCarList = railcars.filter((r: any) => assignedCarIds.has(r.id));

      // cars by fleet — enriched with MLA + rider context + car list
      // Build a map of rider_id → rider + lease info
      const riderDetailMap = new Map<number, { rider_name: string; schedule_number: string | null; expiration_date: string | null; lease_number: string | null; lessor: string | null; lessee: string | null; master_lease_id: number }>();
      for (const r of riders as any[]) {
        const lease = leases.find((l: any) => l.id === r.master_lease_id) as any;
        riderDetailMap.set(r.id, {
          rider_name: r.rider_name,
          schedule_number: r.schedule_number ?? null,
          expiration_date: r.expiration_date ?? null,
          lease_number: lease?.lease_number ?? null,
          lessor: lease?.lessor ?? null,
          lessee: lease?.lessee ?? null,
          master_lease_id: r.master_lease_id,
        });
      }
      // Build a map of railcar id → full detail
      const railcarDetailMap = new Map<number, any>();
      for (const r of railcars) {
        railcarDetailMap.set(r.id, r);
      }
      // Group assignments by fleet
      type FleetEntry = {
        fleet_name: string;
        count: number;
        lease_number: string | null;
        lessor: string | null;
        lessee: string | null;
        rider_name: string | null;
        schedule_number: string | null;
        expiration_date: string | null;
        cars: { id: number; car_number: string; reporting_marks: string | null; car_type: string | null; status: string | null; entity: string | null }[];
      };
      const fleetMap = new Map<string, { count: number; rider_id: number | null; car_ids: number[] }>();
      for (const a of assignments as any[]) {
        const key = a.fleet_name ?? "Unassigned";
        if (!fleetMap.has(key)) fleetMap.set(key, { count: 0, rider_id: a.rider_id ?? null, car_ids: [] });
        const entry = fleetMap.get(key)!;
        entry.count++;
        entry.car_ids.push(a.railcar_id);
      }
      const carsByFleet: FleetEntry[] = Array.from(fleetMap.entries())
        .map(([fleet_name, entry]) => {
          const rd = entry.rider_id ? riderDetailMap.get(entry.rider_id) : null;
          return {
            fleet_name,
            count: entry.count,
            lease_number: rd?.lease_number ?? null,
            lessor: rd?.lessor ?? null,
            lessee: rd?.lessee ?? null,
            rider_name: rd?.rider_name ?? null,
            schedule_number: rd?.schedule_number ?? null,
            expiration_date: rd?.expiration_date ?? null,
            cars: entry.car_ids.map((cid) => {
              const c = railcarDetailMap.get(cid);
              return { id: cid, car_number: c?.car_number ?? "?", reporting_marks: c?.reporting_marks ?? null, car_type: c?.car_type ?? null, status: c?.status ?? null, entity: c?.entity ?? null };
            }).sort((a, b) => a.car_number.localeCompare(b.car_number)),
          };
        })
        .sort((a, b) => b.count - a.count);

      // lease expiration timeline: riders with expiry + car count + lease number
      const leaseMap = new Map<number, string>(
        leases.map((l: any) => [l.id, l.lease_number])
      );
      const ridersCarCount = new Map<number, number>();
      for (const a of assignments) {
        ridersCarCount.set(a.rider_id, (ridersCarCount.get(a.rider_id) ?? 0) + 1);
      }
      const expirationTimeline = riders
        .map((r) => ({
          rider_id: r.id,
          rider_name: r.rider_name,
          schedule_number: r.schedule_number,
          expiration_date: r.expiration_date,
          lease_number: leaseMap.get(r.master_lease_id) ?? null,
          car_count: ridersCarCount.get(r.id) ?? 0,
        }))
        .sort((a, b) => {
          if (!a.expiration_date) return 1;
          if (!b.expiration_date) return -1;
          return a.expiration_date.localeCompare(b.expiration_date);
        });

      res.json({
        kpis: {
          total_fleet: railcars.length,
          active_assignments: activeAssignments,
          unassigned_cars: unassignedCars,
          expiring_12mo: expiring12mo,
          expiring_6mo: expiring6mo,
          riders_count: riders.length,
          utilization_pct: utilization,
          rps_total: rpsCars.length,
          rps_assigned: rpsAssigned,
          rps_util_pct: rpsUtil,
          owned_total: ownedCars.length,
          owned_assigned: ownedAssigned,
          owned_util_pct: ownedUtil,
        },
        // KPI drill-down detail lists
        detail: {
          all_cars: railcars.map((r: any) => ({
            id: r.id, car_number: r.car_number, reporting_marks: r.reporting_marks,
            car_type: r.car_type, status: r.status, entity: r.entity,
            fleet_name: r.assignment?.fleet_name ?? null,
            rider_name: r.assignment?.rider?.rider_name ?? null,
            lease_number: r.assignment?.rider?.master_lease?.lease_number ?? null,
            lessee: r.assignment?.rider?.master_lease?.lessee ?? null,
          })),
          assigned_cars: assignedCarList.map((r: any) => ({
            id: r.id, car_number: r.car_number, reporting_marks: r.reporting_marks,
            car_type: r.car_type, status: r.status, entity: r.entity,
            fleet_name: r.assignment?.fleet_name ?? null,
            rider_name: r.assignment?.rider?.rider_name ?? null,
            lease_number: r.assignment?.rider?.master_lease?.lease_number ?? null,
            lessee: r.assignment?.rider?.master_lease?.lessee ?? null,
          })),
          unassigned_cars: unassignedCarList.map((r: any) => ({
            id: r.id, car_number: r.car_number, reporting_marks: r.reporting_marks,
            car_type: r.car_type, status: r.status, entity: r.entity,
            fleet_name: null, rider_name: null, lease_number: null, lessee: null,
          })),
          expiring_riders: expiringRiders.map((r) => ({
            id: r.id, rider_name: r.rider_name, schedule_number: r.schedule_number,
            expiration_date: r.expiration_date,
            lease_number: leaseMap.get(r.master_lease_id) ?? null,
            car_count: ridersCarCount.get(r.id) ?? 0,
          })),
          riders: riders.map((r) => ({
            id: r.id, rider_name: r.rider_name, schedule_number: r.schedule_number,
            expiration_date: r.expiration_date,
            lease_number: leaseMap.get(r.master_lease_id) ?? null,
            car_count: ridersCarCount.get(r.id) ?? 0,
          })),
        },
        cars_by_fleet: carsByFleet,
        expiration_timeline: expirationTimeline,
      });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Railcars ----------
  app.get("/api/railcars", async (req: Request, res: Response) => {
    try {
      const search = (req.query.search as string | undefined)?.trim();
      const status = req.query.status as string | undefined;
      const riderIdFilter = req.query.rider_id
        ? Number(req.query.rider_id)
        : undefined;
      const leaseIdFilter = req.query.lease_id
        ? Number(req.query.lease_id)
        : undefined;

      // Get everything joined; 151 cars is tiny, return all.
      let query = supabase
        .from("railcars")
        .select(
          `*,
          assignment:railcar_assignments(
            id, rider_id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at,
            rider:riders(
              id, rider_name, schedule_number, expiration_date, master_lease_id,
              master_lease:master_leases(id, lease_number)
            )
          )`
        )
        .order("car_number", { ascending: true });

      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw error;

      let rows = (data ?? []).map((r: any) => ({
        ...r,
        assignment: Array.isArray(r.assignment) ? r.assignment[0] ?? null : r.assignment,
      }));

      if (search) {
        const q = search.toLowerCase();
        rows = rows.filter(
          (r: any) =>
            r.car_number?.toLowerCase().includes(q) ||
            r.reporting_marks?.toLowerCase().includes(q) ||
            r.assignment?.fleet_name?.toLowerCase().includes(q)
        );
      }
      if (riderIdFilter) {
        rows = rows.filter((r: any) => r.assignment?.rider_id === riderIdFilter);
      }
      if (leaseIdFilter) {
        rows = rows.filter(
          (r: any) => r.assignment?.rider?.master_lease_id === leaseIdFilter
        );
      }

      res.json(rows);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.get("/api/railcars/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { data: car, error } = await supabase
        .from("railcars")
        .select(
          `*,
          assignment:railcar_assignments(
            *,
            rider:riders(*, master_lease:master_leases(*))
          )`
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;

      const [histRes, numHistRes] = await Promise.all([
        supabase
          .from("assignment_history")
          .select(
            `*,
            from_rider:riders!assignment_history_from_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number)),
            to_rider:riders!assignment_history_to_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number))`
          )
          .eq("railcar_id", id)
          .order("moved_at", { ascending: false }),
        supabase
          .from("car_number_history")
          .select("*")
          .eq("railcar_id", id)
          .order("changed_at", { ascending: false }),
      ]);
      if (histRes.error) throw histRes.error;
      if (numHistRes.error) throw numHistRes.error;

      if (!car) return res.status(404).json({ message: "Railcar not found" });
      const normalized = {
        ...car,
        assignment: Array.isArray(car.assignment)
          ? car.assignment[0] ?? null
          : car.assignment,
      };
      res.json({ railcar: normalized, history: histRes.data ?? [], number_history: numHistRes.data ?? [] });
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/railcars", async (req, res) => {
    try {
      const parsed = insertRailcarSchema.parse(req.body);
      const { data, error } = await supabase
        .from("railcars")
        .insert(parsed)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/railcars/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = insertRailcarSchema.partial().parse(req.body);
      const { data, error } = await supabase
        .from("railcars")
        .update(parsed)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  // Change car number (remark change) — retains all attributes, logs history
  app.post("/api/railcars/:id/change-number", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { new_car_number, reason, changed_by } = changeCarNumberSchema.parse(req.body);

      // Get current car
      const { data: car, error: cErr } = await supabase
        .from("railcars").select("id, car_number").eq("id", id).single();
      if (cErr) throw cErr;
      if (!car) return res.status(404).json({ message: "Railcar not found" });

      // Check new number not already in use
      const { data: conflict } = await supabase
        .from("railcars").select("id").eq("car_number", new_car_number).maybeSingle();
      if (conflict) return res.status(400).json({ message: `Car number ${new_car_number} is already in use` });

      const changedAt = new Date().toISOString();

      // Update the car number
      const { error: uErr } = await supabase
        .from("railcars").update({ car_number: new_car_number }).eq("id", id);
      if (uErr) throw uErr;

      // Log to history
      const { error: hErr } = await supabase.from("car_number_history").insert({
        railcar_id: id,
        old_car_number: car.car_number,
        new_car_number,
        changed_at: changedAt,
        changed_by: changed_by ?? "system",
        reason: reason ?? null,
      });
      if (hErr) throw hErr;

      res.json({ ok: true, old_car_number: car.car_number, new_car_number });
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/railcars/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { data: assignments, error: aErr } = await supabase
        .from("railcar_assignments")
        .select("id")
        .eq("railcar_id", id);
      if (aErr) throw aErr;
      if ((assignments ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot delete: railcar has an active assignment" });
      }
      const { error } = await supabase.from("railcars").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Leases (Master + nested riders) ----------
  app.get("/api/leases", async (_req, res) => {
    try {
      const [leasesRes, ridersRes, assignmentsRes] = await Promise.all([
        supabase.from("master_leases").select("*").order("lease_number"),
        supabase.from("riders").select("*").order("rider_name"),
        supabase.from("railcar_assignments").select("rider_id"),
      ]);
      if (leasesRes.error) throw leasesRes.error;
      if (ridersRes.error) throw ridersRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      const countByRider = new Map<number, number>();
      for (const a of assignmentsRes.data ?? []) {
        countByRider.set(a.rider_id, (countByRider.get(a.rider_id) ?? 0) + 1);
      }

      const riders = (ridersRes.data ?? []).map((r) => ({
        ...r,
        car_count: countByRider.get(r.id) ?? 0,
      }));

      const result = (leasesRes.data ?? []).map((l) => {
        const leaseRiders = riders.filter((r) => r.master_lease_id === l.id);
        const car_count = leaseRiders.reduce(
          (acc, r) => acc + (r.car_count ?? 0),
          0
        );
        return { ...l, riders: leaseRiders, car_count };
      });

      res.json(result);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/leases", async (req, res) => {
    try {
      const parsed = insertMasterLeaseSchema.parse(req.body);
      const { data, error } = await supabase
        .from("master_leases")
        .insert(parsed)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/leases/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = insertMasterLeaseSchema.partial().parse(req.body);
      const { data, error } = await supabase
        .from("master_leases")
        .update(parsed)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.delete("/api/leases/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { data: riders } = await supabase
        .from("riders")
        .select("id")
        .eq("master_lease_id", id);
      if ((riders ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot delete: master lease has riders" });
      }
      const { error } = await supabase
        .from("master_leases")
        .delete()
        .eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Riders ----------
  app.get("/api/riders", async (_req, res) => {
    try {
      const [ridersRes, assignmentsRes] = await Promise.all([
        supabase
          .from("riders")
          .select("*, master_lease:master_leases(id, lease_number)")
          .order("rider_name"),
        supabase.from("railcar_assignments").select("rider_id"),
      ]);
      if (ridersRes.error) throw ridersRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;
      const countByRider = new Map<number, number>();
      for (const a of assignmentsRes.data ?? []) {
        countByRider.set(a.rider_id, (countByRider.get(a.rider_id) ?? 0) + 1);
      }
      const out = (ridersRes.data ?? []).map((r: any) => ({
        ...r,
        car_count: countByRider.get(r.id) ?? 0,
      }));
      res.json(out);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.post("/api/riders", async (req, res) => {
    try {
      const parsed = insertRiderSchema.parse(req.body);
      const { data, error } = await supabase
        .from("riders")
        .insert(parsed)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.patch("/api/riders/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = insertRiderSchema.partial().parse(req.body);
      const { data, error } = await supabase
        .from("riders")
        .update(parsed)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) {
      errHandler(res, err);
    }
  });

  app.delete("/api/riders/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { data: assigns } = await supabase
        .from("railcar_assignments")
        .select("id")
        .eq("rider_id", id);
      if ((assigns ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot delete: rider has cars assigned" });
      }
      const { error } = await supabase.from("riders").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Assignments ----------
  app.get("/api/assignments", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("railcar_assignments")
        .select(
          `*, railcar:railcars(id, car_number, reporting_marks, status),
           rider:riders(id, rider_name, schedule_number, master_lease:master_leases(id, lease_number))`
        )
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Move cars ----------
  app.post("/api/move", async (req, res) => {
    try {
      const input = moveCarsSchema.parse(req.body);
      const { car_ids, to_rider_id, new_fleet_name, reason, moved_by } = input;

      // verify destination rider exists
      const { data: toRider, error: rErr } = await supabase
        .from("riders")
        .select("id, rider_name")
        .eq("id", to_rider_id)
        .single();
      if (rErr) throw rErr;
      if (!toRider)
        return res.status(400).json({ message: "Destination rider not found" });

      // fetch current assignments for each car
      const { data: currentAssigns, error: caErr } = await supabase
        .from("railcar_assignments")
        .select("id, railcar_id, rider_id, fleet_name")
        .in("railcar_id", car_ids);
      if (caErr) throw caErr;
      const currentByCar = new Map<number, any>();
      for (const a of currentAssigns ?? []) currentByCar.set(a.railcar_id, a);

      const historyRows: any[] = [];
      const movedAt = new Date().toISOString();

      for (const carId of car_ids) {
        const prev = currentByCar.get(carId);
        const fromRiderId = prev?.rider_id ?? null;
        const fromFleet = prev?.fleet_name ?? null;
        const targetFleet = new_fleet_name ?? fromFleet;

        if (prev) {
          const { error: uErr } = await supabase
            .from("railcar_assignments")
            .update({
              rider_id: to_rider_id,
              fleet_name: targetFleet,
              assigned_at: movedAt,
            })
            .eq("id", prev.id);
          if (uErr) throw uErr;
        } else {
          const { error: iErr } = await supabase
            .from("railcar_assignments")
            .insert({
              railcar_id: carId,
              rider_id: to_rider_id,
              fleet_name: targetFleet,
              assigned_at: movedAt,
            });
          if (iErr) throw iErr;
        }

        historyRows.push({
          railcar_id: carId,
          from_rider_id: fromRiderId,
          to_rider_id: to_rider_id,
          from_fleet_name: fromFleet,
          to_fleet_name: targetFleet,
          moved_at: movedAt,
          moved_by: moved_by ?? "system",
          reason: reason ?? null,
        });
      }

      if (historyRows.length) {
        const { error: hErr } = await supabase
          .from("assignment_history")
          .insert(historyRows);
        if (hErr) throw hErr;
      }

      res.json({ ok: true, moved: car_ids.length });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- Rider Contacts ----------
  app.get("/api/riders/:id/contacts", async (req, res) => {
    try {
      const riderId = Number(req.params.id);
      const { data, error } = await supabase
        .from("rider_contacts")
        .select("*")
        .eq("rider_id", riderId)
        .order("name");
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/riders/:id/contacts", async (req, res) => {
    try {
      const riderId = Number(req.params.id);
      const parsed = insertRiderContactSchema.parse({ ...req.body, rider_id: riderId });
      const { data, error } = await supabase
        .from("rider_contacts").insert(parsed).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.patch("/api/contacts/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = insertRiderContactSchema.partial().parse(req.body);
      const { data, error } = await supabase
        .from("rider_contacts").update(parsed).eq("id", id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  app.delete("/api/contacts/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { error } = await supabase.from("rider_contacts").delete().eq("id", id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Bulk Import ----------
  app.post("/api/import/preview", async (req: Request, res: Response) => {
    try {
      const { rows } = req.body as { rows: any[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "No rows provided" });

      // Fetch existing car numbers for dupe detection
      const { data: existing } = await supabase
        .from("railcars").select("car_number");
      const existingNums = new Set((existing ?? []).map((r: any) => r.car_number?.trim().toUpperCase()));

      // Fetch riders for name matching
      const { data: riders } = await supabase.from("riders").select("id, rider_name");
      const riderMap = new Map<string, number>();
      for (const r of riders ?? []) riderMap.set(r.rider_name.trim().toUpperCase(), r.id);

      const preview = rows.map((row, idx) => {
        const carNum = String(row.car_number ?? row["Car Number"] ?? "").trim().toUpperCase();
        const marks = String(row.reporting_marks ?? row["Reporting Marks"] ?? "").trim() || null;
        const carType = String(row.car_type ?? row["Car Type"] ?? "").trim() || null;
        const status = String(row.status ?? row["Status"] ?? "").trim() || "Active/In-Service";
        const fleetName = String(row.fleet_name ?? row["Fleet"] ?? row["Fleet Name"] ?? "").trim() || null;
        const riderName = String(row.rider_name ?? row["Rider"] ?? row["Rider Name"] ?? "").trim() || null;
        const notes = String(row.notes ?? row["Notes"] ?? "").trim() || null;

        const isDupe = existingNums.has(carNum);
        const riderId = riderName ? (riderMap.get(riderName.toUpperCase()) ?? null) : null;
        const riderUnknown = !!riderName && riderId === null;

        const warnings: string[] = [];
        if (!carNum) warnings.push("Missing car number");
        if (isDupe) warnings.push("Car number already exists — will be skipped");
        if (riderUnknown) warnings.push(`Rider "${riderName}" not found — car will be unassigned`);

        return {
          _row: idx + 1,
          car_number: carNum,
          reporting_marks: marks,
          car_type: carType,
          status,
          fleet_name: fleetName,
          rider_name: riderName,
          rider_id: riderId,
          notes,
          is_dupe: isDupe,
          warnings,
          valid: !!carNum && !isDupe,
        };
      });

      res.json({
        total: rows.length,
        valid: preview.filter((r) => r.valid).length,
        dupes: preview.filter((r) => r.is_dupe).length,
        errors: preview.filter((r) => !r.car_number).length,
        preview,
      });
    } catch (err) { errHandler(res, err); }
  });

  app.post("/api/import/commit", async (req: Request, res: Response) => {
    try {
      const { rows } = req.body as { rows: any[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "No rows" });

      const validRows = rows.filter((r) => r.valid && r.car_number);
      if (validRows.length === 0)
        return res.status(400).json({ message: "No valid rows to import" });

      // Insert railcars in batches of 100
      const carInserts = validRows.map((r) => ({
        car_number: r.car_number,
        reporting_marks: r.reporting_marks,
        car_type: r.car_type,
        status: r.status,
        notes: r.notes,
      }));

      const { data: inserted, error: insErr } = await supabase
        .from("railcars").insert(carInserts).select("id, car_number");
      if (insErr) throw insErr;

      // Build assignments for rows that have a rider_id + fleet_name
      const carNumToId = new Map<string, number>();
      for (const c of inserted ?? []) carNumToId.set(c.car_number, c.id);

      const assignments = validRows
        .filter((r) => r.rider_id)
        .map((r) => ({
          railcar_id: carNumToId.get(r.car_number),
          rider_id: r.rider_id,
          fleet_name: r.fleet_name ?? null,
          assigned_at: new Date().toISOString(),
        }))
        .filter((a) => a.railcar_id);

      if (assignments.length > 0) {
        const { error: aErr } = await supabase.from("railcar_assignments").insert(assignments);
        if (aErr) throw aErr;
      }

      res.json({
        ok: true,
        imported: inserted?.length ?? 0,
        assigned: assignments.length,
      });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Global Search ----------
  app.get("/api/search", async (req: Request, res: Response) => {
    try {
      const raw = (req.query.q as string | undefined)?.trim() ?? "";
      if (!raw) return res.json({ railcars: [], riders: [], leases: [] });

      // Split on commas or whitespace for multi-car-number queries
      const terms = raw
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);

      // --- Railcars: match car_number, reporting_marks, or fleet_name ---
      const carQuery = supabase
        .from("railcars")
        .select(
          `id, car_number, reporting_marks, car_type, status, entity, mechanical_designation,
           assignment:railcar_assignments(
             id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at,
             rider:riders(
               id, rider_name, schedule_number, expiration_date,
               master_lease:master_leases(id, lease_number, lessor, lessee)
             )
           )`
        )
        .order("car_number");

      const { data: allCars, error: cErr } = await carQuery;
      if (cErr) throw cErr;

      const cars = (allCars ?? []).map((r: any) => ({
        ...r,
        assignment: Array.isArray(r.assignment)
          ? r.assignment[0] ?? null
          : r.assignment,
      }));

      const matchedCars = cars.filter((c: any) => {
        return terms.some(
          (t) =>
            c.car_number?.toLowerCase().includes(t.toLowerCase()) ||
            c.reporting_marks?.toLowerCase().includes(t.toLowerCase()) ||
            c.assignment?.fleet_name?.toLowerCase().includes(t.toLowerCase()) ||
            c.assignment?.rider?.rider_name?.toLowerCase().includes(t.toLowerCase()) ||
            c.assignment?.rider?.master_lease?.lessee?.toLowerCase().includes(t.toLowerCase()) ||
            c.assignment?.rider?.master_lease?.lease_number?.toLowerCase().includes(t.toLowerCase()) ||
            c.assignment?.sub_lease_number?.toLowerCase().includes(t.toLowerCase())
        );
      });

      // --- Riders: match rider_name, schedule_number, lessee ---
      const { data: allRiders, error: rErr } = await supabase
        .from("riders")
        .select(`*, master_lease:master_leases(id, lease_number, lessor, lessee)`)
        .order("rider_name");
      if (rErr) throw rErr;

      const countByRider = new Map<number, number>();
      for (const c of cars) {
        const rid = (c as any).assignment?.rider?.id;
        if (rid) countByRider.set(rid, (countByRider.get(rid) ?? 0) + 1);
      }

      const matchedRiders = (allRiders ?? []).filter((r: any) =>
        terms.some(
          (t) =>
            r.rider_name?.toLowerCase().includes(t.toLowerCase()) ||
            r.schedule_number?.toLowerCase().includes(t.toLowerCase()) ||
            r.master_lease?.lessee?.toLowerCase().includes(t.toLowerCase()) ||
            r.master_lease?.lease_number?.toLowerCase().includes(t.toLowerCase())
        )
      ).map((r: any) => ({ ...r, car_count: countByRider.get(r.id) ?? 0 }));

      // --- Master Leases: match lease_number, lessor, lessee, agreement_number ---
      const { data: allLeases, error: lErr } = await supabase
        .from("master_leases")
        .select("*")
        .order("lease_number");
      if (lErr) throw lErr;

      const matchedLeases = (allLeases ?? []).filter((l: any) =>
        terms.some(
          (t) =>
            l.lease_number?.toLowerCase().includes(t.toLowerCase()) ||
            l.lessee?.toLowerCase().includes(t.toLowerCase()) ||
            l.lessor?.toLowerCase().includes(t.toLowerCase()) ||
            l.agreement_number?.toLowerCase().includes(t.toLowerCase())
        )
      );

      res.json({
        query: raw,
        terms,
        railcars: matchedCars,
        riders: matchedRiders,
        leases: matchedLeases,
        counts: {
          railcars: matchedCars.length,
          riders: matchedRiders.length,
          leases: matchedLeases.length,
          total: matchedCars.length + matchedRiders.length + matchedLeases.length,
        },
      });
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ---------- History ----------
  app.get("/api/history", async (req, res) => {
    try {
      const search = (req.query.search as string | undefined)?.trim();
      const { data, error } = await supabase
        .from("assignment_history")
        .select(
          `*,
          railcar:railcars(id, car_number, reporting_marks),
          from_rider:riders!assignment_history_from_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number)),
          to_rider:riders!assignment_history_to_rider_id_fkey(id, rider_name, master_lease:master_leases(id, lease_number))`
        )
        .order("moved_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      let rows = data ?? [];
      if (search) {
        const q = search.toLowerCase();
        rows = rows.filter((r: any) =>
          r.railcar?.car_number?.toLowerCase().includes(q)
        );
      }
      res.json(rows);
    } catch (err) {
      errHandler(res, err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // AUTH ROUTES
  // ─────────────────────────────────────────────────────────────

  // Helper: validate Bearer JWT and return user
  async function getAuthUser(req: Request): Promise<{ id: string; email: string } | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return { id: user.id, email: user.email ?? "" };
  }

  // Helper: require admin role
  async function requireAdmin(req: Request, res: Response): Promise<string | null> {
    const user = await getAuthUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return null; }
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
    if (data?.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return null; }
    return user.id;
  }

  // GET /api/auth/me — returns current user's role
  app.get("/api/auth/me", async (req, res) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
      res.json({ id: user.id, email: user.email, role: data?.role ?? null });
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/admin/users — list all users with roles (admin only)
  app.get("/api/admin/users", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      // Join user_roles with auth.users email via a view-friendly RPC approach
      // We store email in user_roles at invite time so we can query it directly
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role, email, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      res.json((data ?? []).map((r: any) => ({
        id: r.user_id,
        email: r.email ?? "unknown",
        role: r.role,
        created_at: r.created_at,
      })));
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/admin/users/invite — invite a new user OR resend invite to existing (admin only)
  app.post("/api/admin/users/invite", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { email, role } = req.body as { email: string; role: "admin" | "viewer" };
      if (!email || !role) return res.status(400).json({ error: "email and role required" });
      const appUrl = process.env.VITE_API_BASE ?? "https://rlms-residco.onrender.com";

      // Try the standard invite first
      const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: appUrl,
      });

      // If user already exists in auth, fall back to generateLink (resend)
      if (inviteErr) {
        const isAlreadyRegistered =
          inviteErr.message.toLowerCase().includes("already registered") ||
          inviteErr.message.toLowerCase().includes("already been invited") ||
          inviteErr.message.toLowerCase().includes("user already exists") ||
          inviteErr.status === 422;

        if (!isAlreadyRegistered) {
          return res.status(400).json({ error: `Invite failed: ${inviteErr.message}` });
        }

        // User already exists — generate a fresh magic link and email it
        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo: appUrl },
        });
        if (linkErr) {
          return res.status(400).json({ error: `Resend failed: ${linkErr.message}` });
        }
        // Make sure they have a role record (they may have been invited before the role was saved)
        const { data: existingRole } = await supabase
          .from("user_roles").select("user_id").eq("email", email).maybeSingle();
        if (!existingRole) {
          const userId = linkData.user?.id;
          if (userId) {
            await supabase.from("user_roles")
              .upsert({ user_id: userId, role, email }, { onConflict: "user_id" });
          }
        }
        return res.json({ id: linkData.user?.id, email, role, resent: true });
      }

      const userId = inviteData.user?.id;
      if (!userId) return res.status(500).json({ error: "User ID missing after invite" });
      // Upsert role + store email for display
      const { error: roleErr } = await supabase.from("user_roles")
        .upsert({ user_id: userId, role, email }, { onConflict: "user_id" });
      if (roleErr) throw roleErr;
      res.json({ id: userId, email, role, resent: false });
    } catch (err) { errHandler(res, err); }
  });

  // PATCH /api/admin/users/:userId/role — change a user's role (admin only)
  app.patch("/api/admin/users/:userId/role", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { userId } = req.params;
      const { role } = req.body as { role: "admin" | "viewer" };
      if (!role) return res.status(400).json({ error: "role required" });
      const { error } = await supabase.from("user_roles").update({ role }).eq("user_id", userId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // DELETE /api/admin/users/:userId — remove a user's access (admin only)
  // Removes from user_roles (revokes app access). Auth account remains in Supabase.
  app.delete("/api/admin/users/:userId", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { userId } = req.params;
      if (userId === adminId) return res.status(400).json({ error: "Cannot remove yourself" });
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // ── Attachments ────────────────────────────────────────────────────────────
  // Files are stored in Supabase Storage bucket "rlms-attachments".
  // Metadata is stored in the `attachments` table.
  // entity_type: 'master_lease' | 'rider' | 'railcar'
  // entity_id: the primary key of the linked record

  // GET /api/attachments/:id/download — stream file directly (must be BEFORE /:entityType/:entityId to avoid route conflict)
  app.get("/api/attachments/:id/download", async (req, res) => {
    try {
      const user = await getAuthUser(req, res);
      if (!user) return;
      const { id } = req.params;
      const { data: att, error: fetchErr } = await supabase
        .from("attachments")
        .select("storage_path, file_name")
        .eq("id", id)
        .single();
      if (fetchErr || !att) return res.status(404).json({ error: "Attachment not found" });
      // Stream file directly through the backend
      const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(att.storage_path);
      if (dlErr || !fileBlob) throw dlErr ?? new Error("Could not download file from storage");
      const arrayBuffer = await fileBlob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const isPdf = att.file_name.toLowerCase().endsWith('.pdf');
      res.setHeader('Content-Type', isPdf ? 'application/pdf' : (fileBlob.type || 'application/octet-stream'));
      res.setHeader('Content-Disposition', isPdf ? `inline; filename="${att.file_name}"` : `attachment; filename="${att.file_name}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/attachments/:entityType/:entityId — list attachments for an entity
  app.get("/api/attachments/:entityType/:entityId", async (req, res) => {
    try {
      const user = await getAuthUser(req, res);
      if (!user) return;
      const { entityType, entityId } = req.params;
      const { data, error } = await supabase
        .from("attachments")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/attachments/:entityType/:entityId — upload a file
  app.post("/api/attachments/:entityType/:entityId",
    upload.single("file"),
    async (req: Request & { file?: Express.Multer.File }, res: Response) => {
      try {
        const user = await getAuthUser(req, res);
        if (!user) return;
        if (!req.file) return res.status(400).json({ error: "No file provided" });
        const { entityType, entityId } = req.params;
        const validTypes = ["master_lease", "rider", "railcar"];
        if (!validTypes.includes(entityType)) {
          return res.status(400).json({ error: "Invalid entity type" });
        }
        const notes = (req.body as { notes?: string }).notes ?? null;
        // Build a unique storage path: entityType/entityId/timestamp-filename
        const ts = Date.now();
        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${entityType}/${entityId}/${ts}-${safeName}`;
        // Upload to Supabase Storage using admin client
        const { error: uploadError } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        // Save metadata to attachments table
        const { data, error: dbError } = await supabase
          .from("attachments")
          .insert({
            entity_type: entityType,
            entity_id: parseInt(entityId, 10),
            file_name: req.file.originalname,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            storage_path: storagePath,
            uploaded_by: user.email ?? user.id,
            notes,
          })
          .select()
          .single();
        if (dbError) {
          // Clean up orphaned file if DB insert fails
          await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
          throw dbError;
        }
        res.status(201).json(data);
      } catch (err) { errHandler(res, err); }
    }
  );

  // DELETE /api/attachments/:id — delete an attachment (admin only)
  app.delete("/api/attachments/:id", async (req, res) => {
    try {
      const adminId = await requireAdmin(req, res);
      if (!adminId) return;
      const { id } = req.params;
      const { data: att, error: fetchErr } = await supabase
        .from("attachments")
        .select("storage_path")
        .eq("id", id)
        .single();
      if (fetchErr || !att) return res.status(404).json({ error: "Attachment not found" });
      // Remove from storage first
      const { error: storageErr } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .remove([att.storage_path]);
      if (storageErr) throw storageErr;
      // Remove metadata
      const { error: dbErr } = await supabase.from("attachments").delete().eq("id", id);
      if (dbErr) throw dbErr;
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  return httpServer;
}
