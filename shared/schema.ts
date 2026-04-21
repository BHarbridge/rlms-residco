import { z } from "zod";

// ---- Database row types ----

export type MasterLease = {
  id: number;
  lease_number: string;
  agreement_number: string | null;
  lessor: string | null;
  lessee: string | null;
  lease_type: string | null;
  effective_date: string | null;
  sold_to: string | null;          // buyer company if this MLA was sold/transferred
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Rider = {
  id: number;
  master_lease_id: number;
  rider_name: string;
  schedule_number: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  permissible_commodity: string | null;
  monthly_rate_pct: number | null;
  lessors_cost: number | null;
  base_term_months: number | null;
  monthly_rent_per_car: number | null;  // monthly rent charged per car (USD)
  sold_to: string | null;               // buyer if this rider was sold/transferred
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Railcar = {
  id: number;
  car_number: string;
  reporting_marks: string | null;
  car_type: string | null;
  capacity_cf: number | null;
  tare_weight_lbs: number | null;
  load_limit_lbs: number | null;
  aar_designation: string | null;
  dot_specification: string | null;
  built_year: number | null;
  entity: string | null;
  car_initial: string | null;
  old_car_initial: string | null;
  old_car_number: string | null;
  mechanical_designation: string | null;
  general_description: string | null;
  lease_type: string | null;
  managed: string | null;
  managed_category: string | null;
  lining_material: string | null;
  active: boolean;
  status: string | null;
  coating: string | null;
  transit_status: string | null;
  transit_label: string | null;
  sold_to: string | null;           // buyer if this car was individually sold/transferred
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CarNumberHistory = {
  id: number;
  railcar_id: number;
  old_car_number: string;
  new_car_number: string;
  changed_at: string;
  changed_by: string | null;
  reason: string | null;
};

export type RailcarAssignment = {
  id: number;
  railcar_id: number;
  rider_id: number;
  fleet_name: string | null;
  sub_lease_number: string | null;
  sublease_expiration_date: string | null;
  assigned_at: string;
};

export type RiderContact = {
  id: number;
  rider_id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AssignmentHistory = {
  id: number;
  railcar_id: number;
  from_rider_id: number | null;
  to_rider_id: number | null;
  from_fleet_name: string | null;
  to_fleet_name: string | null;
  moved_at: string;
  moved_by: string | null;
  reason: string | null;
};

// ---- Zod validation schemas ----

export const insertMasterLeaseSchema = z.object({
  lease_number: z.string().min(1),
  agreement_number: z.string().nullable().optional(),
  lessor: z.string().nullable().optional(),
  lessee: z.string().nullable().optional(),
  lease_type: z.string().nullable().optional(),
  effective_date: z.string().nullable().optional(),
  sold_to: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type InsertMasterLease = z.infer<typeof insertMasterLeaseSchema>;

export const insertRiderSchema = z.object({
  master_lease_id: z.number().int().positive(),
  rider_name: z.string().min(1),
  schedule_number: z.string().nullable().optional(),
  effective_date: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  permissible_commodity: z.string().nullable().optional(),
  monthly_rate_pct: z.coerce.number().nullable().optional(),
  lessors_cost: z.coerce.number().nullable().optional(),
  base_term_months: z.coerce.number().int().nullable().optional(),
  monthly_rent_per_car: z.coerce.number().nullable().optional(),
  sold_to: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type InsertRider = z.infer<typeof insertRiderSchema>;

export const insertRailcarSchema = z.object({
  car_number: z.string().min(1),
  reporting_marks: z.string().nullable().optional(),
  car_type: z.string().nullable().optional(),
  capacity_cf: z.coerce.number().int().nullable().optional(),
  tare_weight_lbs: z.coerce.number().int().nullable().optional(),
  load_limit_lbs: z.coerce.number().int().nullable().optional(),
  aar_designation: z.string().nullable().optional(),
  dot_specification: z.string().nullable().optional(),
  built_year: z.coerce.number().int().nullable().optional(),
  entity: z.string().nullable().optional(),
  car_initial: z.string().nullable().optional(),
  old_car_initial: z.string().nullable().optional(),
  old_car_number: z.string().nullable().optional(),
  mechanical_designation: z.string().nullable().optional(),
  general_description: z.string().nullable().optional(),
  lease_type: z.string().nullable().optional(),
  managed: z.string().nullable().optional(),
  managed_category: z.string().nullable().optional(),
  lining_material: z.string().nullable().optional(),
  active: z.boolean().optional(),
  status: z.string().nullable().optional(),
  coating: z.string().nullable().optional(),
  transit_status: z.string().nullable().optional(),
  transit_label: z.string().nullable().optional(),
  sold_to: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type InsertRailcar = z.infer<typeof insertRailcarSchema>;

export const changeCarNumberSchema = z.object({
  new_car_number: z.string().min(1),
  reason: z.string().nullable().optional(),
  changed_by: z.string().nullable().optional(),
});
export type ChangeCarNumberInput = z.infer<typeof changeCarNumberSchema>;

export const insertRiderContactSchema = z.object({
  rider_id: z.number().int().positive(),
  name: z.string().min(1),
  title: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type InsertRiderContact = z.infer<typeof insertRiderContactSchema>;

export const moveCarsSchema = z.object({
  car_ids: z.array(z.number().int().positive()).min(1),
  to_rider_id: z.number().int().positive(),
  new_fleet_name: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  moved_by: z.string().nullable().optional(),
});
export type MoveCarsInput = z.infer<typeof moveCarsSchema>;

// ---- Composite shapes used by API ----

export type RailcarWithAssignment = Railcar & {
  assignment: (RailcarAssignment & {
    rider: (Rider & { master_lease: MasterLease | null }) | null;
  }) | null;
};

export type RiderWithCounts = Rider & {
  car_count: number;
};

export type MasterLeaseWithRiders = MasterLease & {
  riders: RiderWithCounts[];
  car_count: number;
};

export type HistoryRow = AssignmentHistory & {
  railcar: Pick<Railcar, "id" | "car_number" | "reporting_marks"> | null;
  from_rider: (Pick<Rider, "id" | "rider_name"> & { master_lease: Pick<MasterLease, "id" | "lease_number"> | null }) | null;
  to_rider: (Pick<Rider, "id" | "rider_name"> & { master_lease: Pick<MasterLease, "id" | "lease_number"> | null }) | null;
};
