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
import {
  calculateDv,
  type DvInputs,
  type DvReferenceData,
  type EquipmentType,
  type AbRateBasis,
  type AbItemInput,
} from "@shared/rule107";

// Multer: store uploads in memory (files go straight to Supabase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 52 * 1024 * 1024 }, // 50 MB
});

const STORAGE_BUCKET = "rlms-attachments";

/* ==================================================================
 *  DV CALCULATOR (AAR Rule 107) — module helpers
 * ================================================================== */

function dvVisitorId(req: Request): string {
  const hdr = req.header("X-Visitor-Id");
  return hdr && hdr.length > 0 ? hdr : "anon";
}

async function dvLoadReferenceData(): Promise<DvReferenceData> {
  const [cf, sq, cr] = await Promise.all([
    supabase.from("dv_cost_factors").select("year, factor").order("year", { ascending: true }),
    supabase.from("dv_salvage_quarters").select("quarter_code, steel_per_lb, aluminum_per_lb, stainless_per_lb, dismantling_per_gt").order("quarter_code", { ascending: true }),
    supabase.from("dv_car_dep_rates").select("equipment_type, annual_rate, max_depreciation, age_cutoff_years"),
  ]);
  if (cf.error) throw cf.error;
  if (sq.error) throw sq.error;
  if (cr.error) throw cr.error;
  return {
    costFactors: (cf.data || []).map((r: any) => ({ year: r.year, factor: r.factor })),
    salvageQuarters: (sq.data || []).map((r: any) => ({
      quarterCode: r.quarter_code,
      steelPerLb: Number(r.steel_per_lb),
      aluminumPerLb: Number(r.aluminum_per_lb),
      stainlessPerLb: r.stainless_per_lb == null ? null : Number(r.stainless_per_lb),
      dismantlingPerGt: Number(r.dismantling_per_gt),
    })),
    carDepRates: (cr.data || []).map((r: any) => ({
      equipmentType: r.equipment_type as EquipmentType,
      annualRate: Number(r.annual_rate),
      maxDepreciation: Number(r.max_depreciation),
      ageCutoffYears: r.age_cutoff_years,
    })),
  };
}

function dvParseInputs(body: any, abCodes: Map<string, { rate_basis: AbRateBasis; rate: number; max_depreciation: number }>): DvInputs {
  const abItems: AbItemInput[] = (body.abItems || []).map((it: any) => {
    const meta = abCodes.get((it.code || "").toUpperCase());
    const rateBasis: AbRateBasis = (it.rateBasis as AbRateBasis) || meta?.rate_basis || "ANNUAL";
    const rate = it.rate != null ? Number(it.rate) : Number(meta?.rate ?? 0);
    const maxDepreciation = it.maxDepreciation != null ? Number(it.maxDepreciation) : Number(meta?.max_depreciation ?? 0.9);
    return {
      code: String(it.code || "").toUpperCase(),
      value: Number(it.value) || 0,
      installDate: new Date(it.installDate),
      rateBasis,
      rate,
      maxDepreciation,
    };
  });
  return {
    incidentDate:       new Date(body.incidentDate),
    buildDate:          new Date(body.buildDate),
    originalCost:       Number(body.originalCost) || 0,
    tareWeightLb:       Number(body.tareWeightLb) || 0,
    steelWeightLb:      Number(body.steelWeightLb) || 0,
    aluminumWeightLb:   Number(body.aluminumWeightLb) || 0,
    stainlessWeightLb:  body.stainlessWeightLb != null ? Number(body.stainlessWeightLb) : 0,
    nonMetallicWeightLb: Number(body.nonMetallicWeightLb) || 0,
    equipmentType:      body.equipmentType as EquipmentType,
    abItems,
  };
}

// Freshness per AAR Office Manual Rule 107.E:
//   • Cost Factors — Rule 107.E.2 uses the factor for the year PRIOR to the
//     incident year (e.g. a 2026 incident uses the 2025 factor). Stale only if
//     the prior-year row is missing.
//   • Salvage Quarters — quarterly; the current-quarter row must exist.
//   • A&B Codes — reference-only; no fixed quarterly cadence, so not flagged.
async function dvComputeFreshness() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  const quarterCode = year * 10 + q;
  const priorYear = year - 1;
  const [cfRes, sqRes] = await Promise.all([
    supabase.from("dv_cost_factors").select("year", { count: "exact", head: false }).eq("year", priorYear),
    supabase.from("dv_salvage_quarters").select("quarter_code", { count: "exact", head: false }).eq("quarter_code", quarterCode),
  ]);
  const stale: string[] = [];
  if (!cfRes.error && (cfRes.data?.length ?? 0) === 0) stale.push("cost_factors");
  if (!sqRes.error && (sqRes.data?.length ?? 0) === 0) stale.push("salvage_quarters");
  return {
    currentYear: year,
    currentQuarter: q,
    currentQuarterCode: quarterCode,
    currentQuarterLabel: `${year} Q${q}`,
    priorYear,
    staleTables: stale,
    isStale: stale.length > 0,
  };
}

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

      // Off-rent count — cars whose most recent rent_event is 'off_rent'
      const { data: rentEvents } = await supabase
        .from("rent_events")
        .select("car_id, event_type, event_date")
        .order("event_date", { ascending: false });
      const latestRentByCarId = new Map<number, string>();
      for (const ev of (rentEvents ?? []) as any[]) {
        if (!latestRentByCarId.has(ev.car_id)) {
          latestRentByCarId.set(ev.car_id, ev.event_type);
        }
      }
      const offRentCount = Array.from(latestRentByCarId.values()).filter((t) => t === "off_rent").length;

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
          off_rent_count: offRentCount,
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

  // GET /api/contacts — all contacts across all riders, joined with rider + MLA info
  app.get("/api/contacts", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("rider_contacts")
        .select(`
          *,
          rider:riders(
            id, rider_name, schedule_number,
            master_lease:master_leases(id, lease_number, lessee)
          )
        `)
        .order("name");
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
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

  // ── Rent Events ──────────────────────────────────────────────────────────

  // GET /api/rent-events — all events (for dashboard/export)
  app.get("/api/rent-events", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("rent_events")
        .select("*, railcar:railcars(car_number, entity)")
        .order("event_date", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/rent-events/car/:carId — events for one car
  app.get("/api/rent-events/car/:carId", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("rent_events")
        .select("*")
        .eq("car_id", Number(req.params.carId))
        .order("event_date", { ascending: false });
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/rent-events — log a new rent event
  app.post("/api/rent-events", async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const { car_id, event_type, event_date, reason } = req.body;
      if (!car_id || !event_type || !event_date || !reason) {
        return res.status(400).json({ error: "car_id, event_type, event_date, and reason are required" });
      }
      if (!["on_rent", "off_rent"].includes(event_type)) {
        return res.status(400).json({ error: "event_type must be on_rent or off_rent" });
      }
      // Get user email for created_by
      const { data: userRow } = await supabase
        .from("user_roles")
        .select("email")
        .eq("user_id", userId)
        .single();
      const created_by = userRow?.email ?? userId;
      const { data, error } = await supabase
        .from("rent_events")
        .insert({ car_id: Number(car_id), event_type, event_date, reason: reason.trim(), created_by })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  /* =======================================================   *  DV CALCULATOR (AAR Rule 107) — routes
   * ============================================================== */

  // Freshness banner
  app.get("/api/reference/freshness", async (_req, res) => {
    try {
      const result = await dvComputeFreshness();
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (err) { errHandler(res, err); }
  });

  // Reference reads
  app.get("/api/reference/cost-factors", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_cost_factors").select("*")
        .order("year", { ascending: true }).order("publication_q", { ascending: true });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/reference/salvage", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_salvage_quarters").select("*").order("quarter_code", { ascending: false });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/reference/ab-codes", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_ab_codes").select("*").order("code", { ascending: true });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/reference/car-rates", async (_req, res) => {
    try {
      const { data, error } = await supabase.from("dv_car_dep_rates").select("*").order("display_name", { ascending: true });
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // Reference writes
  app.post("/api/reference/cost-factors", async (req, res) => {
    try {
      const { year, factor, publication_q = 0, source = null } = req.body;
      const { data, error } = await supabase.from("dv_cost_factors")
        .upsert({ year, factor, publication_q, source }, { onConflict: "year,publication_q" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/reference/salvage", async (req, res) => {
    try {
      const { data, error } = await supabase.from("dv_salvage_quarters")
        .upsert(req.body, { onConflict: "quarter_code" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/reference/ab-codes", async (req, res) => {
    try {
      const row = { effective_from: "1970-01-01", ...req.body };
      const { data, error } = await supabase.from("dv_ab_codes")
        .upsert(row, { onConflict: "code,effective_from" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/reference/car-rates", async (req, res) => {
    try {
      const { data, error } = await supabase.from("dv_car_dep_rates")
        .upsert(req.body, { onConflict: "equipment_type" }).select().single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // Railcar lookup for DV auto-fill — distinct path so it doesn't collide with other /api/railcars routes.
  app.get("/api/dv/railcars", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      let sel = supabase.from("railcars")
        .select("id, car_initial, car_number, tare_weight_lbs, built_year, oec, oac, nbv")
        .order("car_initial", { ascending: true }).order("car_number", { ascending: true }).limit(50);
      if (q.length) sel = sel.or(`car_initial.ilike.%${q}%,car_number.ilike.%${q}%`);
      const { data, error } = await sel;
      if (error) throw error; res.json(data || []);
    } catch (err) { errHandler(res, err); }
  });

  // Pure-engine calc (no persist)
  app.post("/api/calculate", async (req, res) => {
    try {
      const ref = await dvLoadReferenceData();
      const { data: abData } = await supabase.from("dv_ab_codes").select("code, rate_basis, rate, max_depreciation");
      const abMap = new Map<string, { rate_basis: AbRateBasis; rate: number; max_depreciation: number }>();
      for (const r of abData || []) abMap.set(r.code, { rate_basis: r.rate_basis, rate: Number(r.rate), max_depreciation: Number(r.max_depreciation) });
      const inputs = dvParseInputs(req.body, abMap);
      const result = calculateDv(inputs, ref);
      res.json({ result, inputsEcho: req.body });
    } catch (err) { errHandler(res, err); }
  });

  // Calculations persistence
  app.get("/api/calculations", async (req, res) => {
    try {
      const visitor = dvVisitorId(req);
      const { data, error } = await supabase.from("dv_calculations")
        .select("*, dv_calculation_ab_items(*)").eq("visitor_id", visitor)
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error; res.json(data || []);
    } catch (err) { errHandler(res, err); }
  });
  app.get("/api/calculations/:id", async (req, res) => {
    try {
      const visitor = dvVisitorId(req);
      const { data, error } = await supabase.from("dv_calculations")
        .select("*, dv_calculation_ab_items(*)").eq("id", req.params.id).eq("visitor_id", visitor).single();
      if (error) throw error; res.json(data);
    } catch (err) { errHandler(res, err); }
  });
  app.post("/api/calculations", async (req, res) => {
    try {
      const visitor = dvVisitorId(req);
      const ref = await dvLoadReferenceData();
      const { data: abData } = await supabase.from("dv_ab_codes").select("code, rate_basis, rate, max_depreciation");
      const abMap = new Map<string, { rate_basis: AbRateBasis; rate: number; max_depreciation: number }>();
      for (const r of abData || []) abMap.set(r.code, { rate_basis: r.rate_basis, rate: Number(r.rate), max_depreciation: Number(r.max_depreciation) });
      const inputs = dvParseInputs(req.body, abMap);
      const result = calculateDv(inputs, ref);
      const row = {
        visitor_id: visitor,
        railcar_id: req.body.railcarId ?? null,
        railroad: req.body.railroad ?? null,
        ddct_incident_no: req.body.ddctNumber ?? null,
        incident_date: req.body.incidentDate,
        incident_location: req.body.incidentLocation ?? null,
        car_initial: req.body.carInitial ?? null,
        car_number: req.body.carNumber ?? null,
        build_date: req.body.buildDate,
        original_cost: inputs.originalCost,
        tare_weight_lb: Math.round(inputs.tareWeightLb),
        steel_weight_lb: Math.round(inputs.steelWeightLb),
        aluminum_weight_lb: Math.round(inputs.aluminumWeightLb),
        stainless_weight_lb: Math.round(inputs.stainlessWeightLb ?? 0),
        non_metallic_lb: Math.round(inputs.nonMetallicWeightLb),
        equipment_type: inputs.equipmentType,
        notes: req.body.notes ?? null,
        total_reproduction: result.totalReproductionCost,
        total_dv: result.totalDepreciatedValue,
        total_salvage: result.salvage.totalSalvage,
        salvage_plus_20: result.salvage.salvagePlus20,
        dismantling_allow: result.salvage.dismantlingAllowance,
        over_age_cutoff: result.overAgeCutoff,
        created_by: visitor,
        result_json: result,
      };
      const { data: calc, error } = await supabase.from("dv_calculations").insert(row).select().single();
      if (error) throw error;
      if (inputs.abItems.length) {
        const ab = inputs.abItems.map((it, seq) => ({
          calculation_id: calc.id,
          seq: seq + 1,
          code: it.code,
          value: it.value,
          install_date: it.installDate.toISOString().slice(0, 10),
          rate_basis: it.rateBasis ?? abMap.get(it.code)?.rate_basis ?? "ANNUAL",
          rate: it.rate ?? abMap.get(it.code)?.rate ?? 0,
          max_depreciation: it.max ?? abMap.get(it.code)?.max_depreciation ?? 1,
        }));
        const { error: e2 } = await supabase.from("dv_calculation_ab_items").insert(ab);
        if (e2) throw e2;
      }
      res.json({ ...calc, result });
    } catch (err) { errHandler(res, err); }
  });
  app.delete("/api/calculations/:id", async (req, res) => {
    try {
      const visitor = dvVisitorId(req);
      const { error } = await supabase.from("dv_calculations").delete().eq("id", req.params.id).eq("visitor_id", visitor);
      if (error) throw error; res.json({ ok: true });
=======
  // =====================================================================
  // AP TRACKER — Invoices, Dispute Logs, Communications
  // =====================================================================

  // Helper to get caller email
  async function getCallerEmail(userId: string): Promise<string> {
    const { data } = await supabase.from("user_roles").select("email").eq("user_id", userId).single();
    return data?.email ?? userId;
  }

  // GET /api/invoices — list with optional filters
  app.get("/api/invoices", async (req, res) => {
    try {
      let q = supabase.from("invoices").select("*").order("due_date", { ascending: true });
      if (req.query.status && req.query.status !== "all") q = q.eq("status", req.query.status as string);
      if (req.query.disputed === "true") q = q.eq("is_disputed", true);
      if (req.query.lessee) q = q.ilike("lessee_name", `%${req.query.lessee}%`);
      if (req.query.search) {
        const s = `%${req.query.search}%`;
        q = q.or(`invoice_number.ilike.${s},lessee_name.ilike.${s},vendor_name.ilike.${s},repair_description.ilike.${s}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      res.json(data ?? []);
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/invoices/:id — single invoice with dispute logs + communications
  app.get("/api/invoices/:id", async (req, res) => {
    try {
      const { data: inv, error: e1 } = await supabase.from("invoices").select("*").eq("id", req.params.id).single();
      if (e1) throw e1;
      const { data: disputes } = await supabase.from("dispute_logs").select("*").eq("invoice_id", req.params.id).order("log_date", { ascending: false });
      const { data: comms } = await supabase.from("invoice_communications").select("*").eq("invoice_id", req.params.id).order("comm_date", { ascending: false });
      res.json({ ...inv, dispute_logs: disputes ?? [], communications: comms ?? [] });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices — create
  app.post("/api/invoices", async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const payload = { ...req.body, created_by: userId, updated_at: new Date().toISOString() };
      delete payload.id;
      const { data, error } = await supabase.from("invoices").insert(payload).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // PATCH /api/invoices/:id — update
  app.patch("/api/invoices/:id", async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const payload = { ...req.body, updated_at: new Date().toISOString() };
      delete payload.id;
      const { data, error } = await supabase.from("invoices").update(payload).eq("id", req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // DELETE /api/invoices/:id
  app.delete("/api/invoices/:id", async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const { error } = await supabase.from("invoices").delete().eq("id", req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/:id/dispute-logs — add dispute entry
  app.post("/api/invoices/:id/dispute-logs", async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const email = await getCallerEmail(userId);
      const { log_date, description, outcome } = req.body;
      if (!description) return res.status(400).json({ error: "description required" });
      // Mark invoice as disputed
      await supabase.from("invoices").update({ is_disputed: true, updated_at: new Date().toISOString() }).eq("id", req.params.id);
      const { data, error } = await supabase.from("dispute_logs").insert({
        invoice_id: req.params.id,
        log_date: log_date ?? new Date().toISOString().slice(0, 10),
        logged_by: email,
        description,
        outcome: outcome ?? null,
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // DELETE /api/dispute-logs/:id
  app.delete("/api/dispute-logs/:id", async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const { error } = await supabase.from("dispute_logs").delete().eq("id", req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/:id/communications — add comm log entry
  app.post("/api/invoices/:id/communications", async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const email = await getCallerEmail(userId);
      const { comm_date, comm_type, contact_name, notes } = req.body;
      if (!notes) return res.status(400).json({ error: "notes required" });
      // Update last_communication_date on invoice
      const dateStr = comm_date ?? new Date().toISOString().slice(0, 10);
      await supabase.from("invoices").update({
        last_communication_date: dateStr,
        last_communication_notes: notes,
        updated_at: new Date().toISOString()
      }).eq("id", req.params.id);
      const { data, error } = await supabase.from("invoice_communications").insert({
        invoice_id: req.params.id,
        comm_date: dateStr,
        comm_type: comm_type ?? "email",
        contact_name: contact_name ?? null,
        notes,
        logged_by: email,
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (err) { errHandler(res, err); }
  });

  // DELETE /api/communications/:id
  app.delete("/api/communications/:id", async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const { error } = await supabase.from("invoice_communications").delete().eq("id", req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/:id/upload-pdf — upload cover sheet PDF
  app.post("/api/invoices/:id/upload-pdf", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const ext = req.file.originalname.split(".").pop() ?? "pdf";
      const path = `invoices/${req.params.id}/cover-${Date.now()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      await supabase.from("invoices").update({ pdf_url: publicUrl, updated_at: new Date().toISOString() }).eq("id", req.params.id);
      res.json({ pdf_url: publicUrl });
    } catch (err) { errHandler(res, err); }
  });

  // GET /api/invoices/export/csv — export full AP report as CSV
  app.get("/api/invoices/export/csv", async (req, res) => {
    try {
      const { data, error } = await supabase.from("invoices").select("*").order("due_date", { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      const headers = ["Invoice #","Lessee","Vendor","Amount","Amount Paid","Balance","Invoice Date","Due Date","Paid Date","Status","Disputed","Repair Description","Notes","Last Communication","Next Follow-up","PDF URL"];
      const escape = (v: any) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
      const csvRows = rows.map(r => [
        escape(r.invoice_number), escape(r.lessee_name), escape(r.vendor_name),
        r.amount ?? "", r.amount_paid ?? "", ((r.amount ?? 0) - (r.amount_paid ?? 0)).toFixed(2),
        r.invoice_date ?? "", r.due_date ?? "", r.paid_date ?? "",
        escape(r.status), r.is_disputed ? "Yes" : "No",
        escape(r.repair_description), escape(r.notes),
        r.last_communication_date ?? "", r.next_followup_date ?? "",
        escape(r.pdf_url),
      ].join(","));
      const csv = [headers.join(","), ...csvRows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="ap-report.csv"');
      res.send(csv);
    } catch (err) { errHandler(res, err); }
  });

  // POST /api/invoices/import-csv — bulk import from CSV
  app.post("/api/invoices/import-csv", upload.single("file"), async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const text = req.file.buffer.toString("utf-8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have header + data rows" });
      const parse = (s: string) => s.replace(/^["|']+|["|']+$/g, "").trim();
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"));
      const toInsert: Record<string, any>[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const row: Record<string, any> = {};
        headers.forEach((h, idx) => { row[h] = parse(cols[idx] ?? ""); });
        const inv: Record<string, any> = {
          invoice_number: row["invoice__"] || row["invoice_number"] || `IMP-${Date.now()}-${i}`,
          lessee_name: row["lessee"] || row["lessee_name"] || "Unknown",
          vendor_name: row["vendor"] || row["vendor_name"] || null,
          amount: parseFloat(row["amount"]) || null,
          amount_paid: parseFloat(row["amount_paid"]) || 0,
          invoice_date: row["invoice_date"] || null,
          due_date: row["due_date"] || null,
          status: row["status"] || "unpaid",
          repair_description: row["repair_description"] || row["description"] || null,
          notes: row["notes"] || null,
          created_by: userId,
        };
        toInsert.push(inv);
      }
      const { data, error } = await supabase.from("invoices").insert(toInsert).select();
      if (error) throw error;
      res.json({ inserted: (data ?? []).length });
    } catch (err) { errHandler(res, err); }
  });

  return httpServer;
}
