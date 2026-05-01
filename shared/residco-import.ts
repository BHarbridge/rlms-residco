// Shared helpers for ingesting the RESIDCO Master Car List workbook.
// Used by both the bulk-import API (/api/import/preview, /api/import/commit)
// and any future programmatic ingest.

export type WorkbookRow = Record<string, unknown>;

/** Canonical field names in the railcars table that this importer writes. */
export type CanonicalRailcarField =
  | "car_number"
  | "car_initial"
  | "rider_external_id"
  | "lessee_name"
  | "entity"
  | "active_status"
  | "active"
  | "data_source"
  | "car_type"
  | "general_description"
  | "description"
  | "assignment_label"
  | "lease_type"
  | "lease_start_date"
  | "lease_end_date"
  | "lease_expiry"
  | "nbv"
  | "oec"
  | "monthly_rent_per_car"
  | "monthly_depr_per_car"
  | "total_bv_rider"
  | "cars_on_rider_ar"
  | "commodity_family"
  | "commodity"
  | "build_year"
  | "lining"
  | "mechanical_designation"
  | "dot_code"
  | "dot_specification"
  | "comment_event_note"
  | "notes"
  | "reporting_marks"
  | "fleet_name"
  | "rider_name"
  | "status"
  | "managed_category"
  | "capacity_cf"
  | "oac";

/**
 * Normalize a header string for matching: lowercase, strip non-alphanumerics,
 * collapse whitespace. "Mech Desig." -> "mechdesig". "Comment / Event Note" -> "commenteventnote".
 */
export function normalizeHeader(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Map of normalized header -> canonical field. Each canonical field can have
 * multiple aliases (workbook variants). Keep this list deliberate — adding
 * an alias should be a conscious choice.
 */
const HEADER_ALIASES: Record<string, CanonicalRailcarField> = (() => {
  const m: Record<string, CanonicalRailcarField> = {};
  const add = (field: CanonicalRailcarField, ...aliases: string[]) => {
    for (const a of aliases) m[normalizeHeader(a)] = field;
  };

  add("car_number", "car_number", "carnumber", "Car Number", "Car #", "Car No");
  add("car_initial", "car_initial", "carinitial", "Car Initial", "Initial");
  add("rider_external_id", "rider_external_id", "Rider ID", "RiderID", "RiderId");
  add("lessee_name", "lessee_name", "Lessee", "Lessee Name");
  add("entity", "entity", "Entity");
  add("active_status", "active_status", "Active", "Active Status");
  add("data_source", "data_source", "Data Source", "DataSource", "Source");
  add("car_type", "car_type", "Car Type", "Type", "AAR Car Type");
  add("general_description", "general_description", "Description", "Desc", "Car Description");
  add("assignment_label", "assignment_label", "Assignment");
  add("lease_type", "lease_type", "Lease Type", "LeaseType");
  add("lease_start_date", "lease_start_date", "Start Date", "Lease Start", "Lease Start Date");
  add("lease_end_date", "lease_end_date", "End Date", "Lease End", "Lease End Date");
  add("lease_expiry", "lease_expiry", "Lease Expiry", "Expiry", "Expiration", "Expiration Date");
  add("nbv",
      "nbv", "NBV", "NBV Per Car ($)", "NBV Per Car", "Net Book Value", "NBV/Car");
  add("oec",
      "oec", "OEC", "OEC Per Car ($)", "OEC Per Car", "Original Equipment Cost", "OEC/Car");
  add("monthly_rent_per_car",
      "monthly_rent_per_car", "Monthly Rent P/C ($)", "Monthly Rent P/C",
      "Monthly Rent Per Car", "Rent P/C", "Rent Per Car");
  add("monthly_depr_per_car",
      "monthly_depr_per_car", "Monthly Depr P/C ($)", "Monthly Depr P/C",
      "Monthly Depreciation Per Car", "Depr P/C");
  add("total_bv_rider",
      "total_bv_rider", "Total BV — Rider ($)", "Total BV - Rider ($)",
      "Total BV Rider", "Total BV (Rider)");
  add("cars_on_rider_ar",
      "cars_on_rider_ar", "Cars on Rider (AR)", "Cars on Rider", "Cars On Rider AR");
  add("commodity_family", "commodity_family", "Commodity Family", "CommodityFamily");
  add("commodity", "commodity", "Commodity");
  add("build_year", "build_year", "Build Year", "BuildYear", "Built Year", "Year Built");
  add("lining", "lining", "Lining", "Lining Material", "lining_material", "Coating");
  add("mechanical_designation",
      "mechanical_designation", "Mech Desig.", "Mech Desig", "Mech Designation",
      "Mechanical Designation", "mech_designation");
  add("dot_code", "dot_code", "DOT Code", "DOT", "DOT Specification", "dot_specification");
  add("comment_event_note",
      "comment_event_note", "Comment / Event Note", "Comment/Event Note",
      "Comment Event Note", "Event Note");
  add("notes", "notes", "Notes");
  add("reporting_marks", "reporting_marks", "Reporting Marks", "Marks");
  add("fleet_name", "fleet_name", "Fleet", "Fleet Name");
  add("rider_name", "rider_name", "Rider", "Rider Name");
  add("status", "status", "Status");
  add("capacity_cf", "capacity_cf", "Capacity CF", "Capacity (cf)", "Capacity");
  add("oac", "oac", "OAC", "Outstanding Acquisition Cost");

  return m;
})();

/** Resolve any header from the workbook to its canonical field, or null if unrecognised. */
export function resolveHeader(header: string): CanonicalRailcarField | null {
  return HEADER_ALIASES[normalizeHeader(header)] ?? null;
}

/**
 * Translate a single workbook row (whose keys are arbitrary header strings)
 * into a normalized row whose keys are canonical field names. Unknown columns
 * are dropped. Empty strings become null.
 */
export function normalizeRow(row: WorkbookRow): Partial<Record<CanonicalRailcarField, unknown>> {
  const out: Partial<Record<CanonicalRailcarField, unknown>> = {};
  for (const [k, v] of Object.entries(row)) {
    const field = resolveHeader(k);
    if (!field) continue;
    if (v === "" || v === undefined) continue;
    out[field] = v;
  }
  return out;
}

/**
 * Derive the managed/ownership category from raw entity.
 * Always preserve the raw entity in the caller; this helper is non-destructive.
 *   Main                 -> RESIDCO Owned
 *   Rail Partners Select -> RPS
 *   Coal                 -> Coal
 *   anything else        -> entity unchanged (or null)
 */
export function deriveManagedCategory(entity: string | null | undefined): string | null {
  if (entity == null) return null;
  const e = String(entity).trim();
  if (!e) return null;
  if (e === "Main") return "RESIDCO Owned";
  if (e === "Rail Partners Select") return "RPS";
  if (e === "Coal") return "Coal";
  return e;
}

/** Convert the workbook's "Active" string to a boolean. Anything not matching is null/false. */
export function deriveActiveBool(activeStatus: string | null | undefined): boolean {
  if (activeStatus == null) return false;
  const s = String(activeStatus).trim().toLowerCase();
  return s === "active" || s === "yes" || s === "true" || s === "y" || s === "1";
}

/** Parse an Excel/ISO date-ish value into a YYYY-MM-DD string, or null if unparseable. */
export function parseDateCell(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Excel serial date (days since 1899-12-30, ignoring the Lotus bug for our range)
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  // Try ISO first
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // M/D/YYYY or M-D-YYYY
  const us = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(s);
  if (us) {
    const [, m, d, y] = us;
    const yyyy = y.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y;
    return `${yyyy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Fall back to Date.parse
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

/** Parse a money/numeric cell, stripping $ and commas. Returns null if not parseable. */
export function parseNumberCell(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[$,]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive the key used to dedupe master_leases during import. The workbook does
 * not provide an MLA number, so we use the lessee name as the natural key.
 * Returns null if the lessee is missing/blank — those rows can't form an MLA
 * relationship and will be imported without one.
 */
export function deriveLeaseKey(lesseeName: string | null | undefined): string | null {
  if (!lesseeName) return null;
  const s = String(lesseeName).trim();
  return s ? s : null;
}

/**
 * Synthesize a deterministic master-lease number from the lessee name. Used
 * when the workbook has no explicit lease number — matches what the live DB
 * post-repair settled on (one MLA per lessee, lease_number = "RES-<slug>").
 */
export function synthesizeLeaseNumber(lesseeName: string): string {
  const slug = String(lesseeName)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `RES-${slug || "UNKNOWN"}`;
}

/**
 * Split a workbook "Car Number" like "TFOX88031" into reporting marks (alpha
 * prefix) and the numeric tail. The RLMS data model stores `reporting_marks`
 * (e.g. "TFOX") on the left and `car_number` (e.g. "88031") on the right; the
 * UI concatenates them for display. `car_initial` mirrors `reporting_marks`
 * for legacy code paths.
 *
 * If the input has no leading alpha prefix (purely numeric), reporting_marks
 * is null and the whole value is treated as the number. If the input is
 * already split (no digits), the whole value becomes reporting_marks and
 * car_number is empty.
 *
 * Whitespace and an optional space/dash between the prefix and number are
 * tolerated. The output is uppercased.
 */
export function splitCarNumber(raw: unknown): {
  reporting_marks: string | null;
  car_number: string;
  car_initial: string | null;
} {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return { reporting_marks: null, car_number: "", car_initial: null };
  // Match leading alpha prefix, optional separator (space/dash already stripped),
  // then trailing digits (possibly with embedded letters like "X" suffix).
  const m = /^([A-Z]+)[-_]?(\d.*)$/.exec(s);
  if (m) {
    return { reporting_marks: m[1], car_number: m[2], car_initial: m[1] };
  }
  // Pure digits (no marks)
  if (/^\d+$/.test(s)) {
    return { reporting_marks: null, car_number: s, car_initial: null };
  }
  // Letters only — keep as marks; no number
  if (/^[A-Z]+$/.test(s)) {
    return { reporting_marks: s, car_number: "", car_initial: s };
  }
  // Anything else: best-effort — strip leading alpha as marks if present
  const m2 = /^([A-Z]+)(.*)$/.exec(s);
  if (m2 && m2[1]) {
    return { reporting_marks: m2[1], car_number: m2[2], car_initial: m2[1] };
  }
  return { reporting_marks: null, car_number: s, car_initial: null };
}

/** Parse an integer cell. */
export function parseIntCell(v: unknown): number | null {
  const n = parseNumberCell(v);
  if (n == null) return null;
  return Math.trunc(n);
}
