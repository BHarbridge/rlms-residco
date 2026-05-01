/* eslint-disable no-console */
// Lightweight self-test for shared/residco-import.ts.
// Run with: npx tsx script/test-import.ts
//
// Scope: pure-function tests for header normalization, entity → managed-category
// derivation, date/number cell parsing, and the cleanup-predicate logic that
// decides which rows look like test data.

import {
  normalizeHeader,
  resolveHeader,
  normalizeRow,
  deriveManagedCategory,
  deriveActiveBool,
  parseDateCell,
  parseNumberCell,
  parseIntCell,
  splitCarNumber,
  deriveLeaseKey,
  synthesizeLeaseNumber,
} from "../shared/residco-import";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function eq<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// --- normalizeHeader ---------------------------------------------------------
eq(normalizeHeader("Mech Desig."), "mechdesig", "normalizeHeader strips dot+space");
eq(normalizeHeader("Comment / Event Note"), "commenteventnote", "normalizeHeader strips slash");
eq(normalizeHeader("NBV Per Car ($)"), "nbvpercar", "normalizeHeader strips parens/$");
eq(normalizeHeader("Total BV — Rider ($)"), "totalbvrider", "normalizeHeader strips em-dash");

// --- resolveHeader -----------------------------------------------------------
eq(resolveHeader("Car Number"), "car_number", "resolveHeader Car Number");
eq(resolveHeader("Mech Desig."), "mechanical_designation", "resolveHeader Mech Desig.");
eq(resolveHeader("Mechanical Designation"), "mechanical_designation", "resolveHeader Mechanical Designation");
eq(resolveHeader("mech_designation"), "mechanical_designation", "resolveHeader internal alias");
eq(resolveHeader("NBV Per Car ($)"), "nbv", "resolveHeader NBV Per Car ($)");
eq(resolveHeader("OEC Per Car ($)"), "oec", "resolveHeader OEC Per Car ($)");
eq(resolveHeader("Monthly Rent P/C ($)"), "monthly_rent_per_car", "resolveHeader Monthly Rent P/C ($)");
eq(resolveHeader("Monthly Depr P/C ($)"), "monthly_depr_per_car", "resolveHeader Monthly Depr P/C ($)");
eq(resolveHeader("Total BV — Rider ($)"), "total_bv_rider", "resolveHeader Total BV — Rider ($)");
eq(resolveHeader("Cars on Rider (AR)"), "cars_on_rider_ar", "resolveHeader Cars on Rider (AR)");
eq(resolveHeader("Comment / Event Note"), "comment_event_note", "resolveHeader Comment / Event Note");
eq(resolveHeader("DOT Code"), "dot_code", "resolveHeader DOT Code");
eq(resolveHeader("DOT Specification"), "dot_code", "resolveHeader DOT Specification → dot_code (alias)");
eq(resolveHeader("Build Year"), "build_year", "resolveHeader Build Year");
eq(resolveHeader("Built Year"), "build_year", "resolveHeader Built Year alias");
eq(resolveHeader("Lining"), "lining", "resolveHeader Lining");
eq(resolveHeader("Coating"), "lining", "resolveHeader Coating → lining");
eq(resolveHeader("Lessee"), "lessee_name", "resolveHeader Lessee");
eq(resolveHeader("Rider ID"), "rider_external_id", "resolveHeader Rider ID");
eq(resolveHeader("Active"), "active_status", "resolveHeader Active → active_status");
eq(resolveHeader("Data Source"), "data_source", "resolveHeader Data Source");
eq(resolveHeader("Bogus Column"), null, "resolveHeader unknown column → null");

// --- normalizeRow ------------------------------------------------------------
eq(
  normalizeRow({
    "Car Number": "TFOX88031",
    "Rider ID": "EA1503",
    "Lessee": "IDLE (xAxiall)",
    "Entity": "Main",
    "Active": "Active",
    "NBV Per Car ($)": "85,000",
    "Mech Desig.": "LO",
    "Comment / Event Note": "Cleaned & returned to LBWR storage",
    "Bogus": "drop me",
  }),
  {
    car_number: "TFOX88031",
    rider_external_id: "EA1503",
    lessee_name: "IDLE (xAxiall)",
    entity: "Main",
    active_status: "Active",
    nbv: "85,000",
    mechanical_designation: "LO",
    comment_event_note: "Cleaned & returned to LBWR storage",
  },
  "normalizeRow: workbook row maps to canonical fields, drops unknown"
);

// --- deriveManagedCategory ---------------------------------------------------
eq(deriveManagedCategory("Main"), "RESIDCO Owned", "Main → RESIDCO Owned");
eq(deriveManagedCategory("Rail Partners Select"), "RPS", "Rail Partners Select → RPS");
eq(deriveManagedCategory("Coal"), "Coal", "Coal → Coal (preserved)");
eq(deriveManagedCategory("Some Other"), "Some Other", "unknown entity preserved as-is");
eq(deriveManagedCategory(null), null, "null entity → null");
eq(deriveManagedCategory(""), null, "empty entity → null");

// --- deriveActiveBool --------------------------------------------------------
eq(deriveActiveBool("Active"), true, "Active → true");
eq(deriveActiveBool("active"), true, "lowercase active → true");
eq(deriveActiveBool("Inactive"), false, "Inactive → false");
eq(deriveActiveBool(null), false, "null → false");
eq(deriveActiveBool("Yes"), true, "Yes → true");

// --- parseDateCell -----------------------------------------------------------
eq(parseDateCell("2026-03-16"), "2026-03-16", "ISO date string");
eq(parseDateCell("3/16/2026"), "2026-03-16", "M/D/YYYY");
eq(parseDateCell("3-16-2026"), "2026-03-16", "M-D-YYYY");
eq(parseDateCell(new Date("2026-03-16T00:00:00Z")), "2026-03-16", "Date object");
eq(parseDateCell(""), null, "empty string");
eq(parseDateCell(null), null, "null");
eq(parseDateCell("not a date"), null, "garbage string → null");

// --- parseNumberCell ---------------------------------------------------------
eq(parseNumberCell("$85,000"), 85000, "money with $ and comma");
eq(parseNumberCell("(1,234.56)"), -1234.56, "parens denote negative");
eq(parseNumberCell(42), 42, "passthrough number");
eq(parseNumberCell(""), null, "empty string");
eq(parseNumberCell("abc"), null, "garbage → null");
eq(parseIntCell("2010"), 2010, "int parse");
eq(parseIntCell("2010.7"), 2010, "int truncates");

// --- Cleanup predicate (mirrors server findTestRailcarCandidates) ------------
function isTestCandidate(row: { car_number: string; reporting_marks?: string | null; notes?: string | null; general_description?: string | null }): boolean {
  const startsWithMarker = /^(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER|FOO|BAR|EXAMPLE|XXX+|ZZZ+)/i;
  const tokenMarker = /\b(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER)\b/i;
  const marksMarkers = new Set(["TEST", "SAMP", "DEMO", "XXXX", "ZZZZ", "DUMM", "FAKE"]);
  const NEEDLES = ["[test data]", "test record", "sample data", "placeholder", "do not use", "demo data"];
  const cn = String(row.car_number ?? "");
  if (startsWithMarker.test(cn) || tokenMarker.test(cn)) return true;
  if (row.reporting_marks && marksMarkers.has(row.reporting_marks.toUpperCase())) return true;
  for (const k of ["notes", "general_description"] as const) {
    const s = (row as any)[k]?.toLowerCase();
    if (s && NEEDLES.some(n => s.includes(n))) return true;
  }
  return false;
}

// Real-looking cars must NOT match
eq(isTestCandidate({ car_number: "TFOX88031" }), false, "real car TFOX88031 not test");
eq(isTestCandidate({ car_number: "HWCX010823", reporting_marks: "HWCX" }), false, "real HWCX not test");
eq(isTestCandidate({ car_number: "BNSF712345", notes: "Tested at Barstow shop" }), false, "comment with 'Tested' not test");
eq(isTestCandidate({ car_number: "ATSF99999" }), false, "9s not match (only XXX+/ZZZ+)");
// Test markers SHOULD match
eq(isTestCandidate({ car_number: "TEST001" }), true, "TEST prefix matches");
eq(isTestCandidate({ car_number: "DEMO123" }), true, "DEMO prefix matches");
eq(isTestCandidate({ car_number: "ZZZZ001" }), true, "ZZZZ prefix matches");
eq(isTestCandidate({ car_number: "XXX0001" }), true, "XXX prefix matches");
eq(isTestCandidate({ car_number: "ABCD-DEMO-1" }), true, "DEMO token matches");
eq(isTestCandidate({ car_number: "ABC1234", reporting_marks: "TEST" }), true, "TEST reporting marks");
eq(isTestCandidate({ car_number: "ABC1234", notes: "[TEST DATA] do not import" }), true, "[TEST DATA] note");
eq(isTestCandidate({ car_number: "ABC1234", notes: "this is a test record" }), true, "test record note");
eq(isTestCandidate({ car_number: "ABC1234", general_description: "placeholder car" }), true, "placeholder description");

// Reporting marks that LOOK like real ones (4 alpha, e.g. CSXT, BNSF, NS) must NOT match
for (const m of ["CSXT", "BNSF", "NS", "UP", "GATX", "TILX", "TFOX", "HWCX", "ATSF"]) {
  eq(isTestCandidate({ car_number: "ABC1234", reporting_marks: m }), false, `marks ${m} not test`);
}

// --- splitCarNumber ----------------------------------------------------------
eq(splitCarNumber("TFOX88031"), { reporting_marks: "TFOX", car_number: "88031", car_initial: "TFOX" }, "split TFOX88031");
eq(splitCarNumber("HWCX010823"), { reporting_marks: "HWCX", car_number: "010823", car_initial: "HWCX" }, "split HWCX010823 keeps leading zero");
eq(splitCarNumber("BNSF 712345"), { reporting_marks: "BNSF", car_number: "712345", car_initial: "BNSF" }, "split BNSF 712345 (space tolerated)");
eq(splitCarNumber("UP-12345"), { reporting_marks: "UP", car_number: "12345", car_initial: "UP" }, "split UP-12345 (dash tolerated)");
eq(splitCarNumber("tfox88031"), { reporting_marks: "TFOX", car_number: "88031", car_initial: "TFOX" }, "split lowercases input");
eq(splitCarNumber("88031"), { reporting_marks: null, car_number: "88031", car_initial: null }, "split: pure digits → no marks");
eq(splitCarNumber("TFOX"), { reporting_marks: "TFOX", car_number: "", car_initial: "TFOX" }, "split: pure alpha → marks only");
eq(splitCarNumber(""), { reporting_marks: null, car_number: "", car_initial: null }, "split: empty");
eq(splitCarNumber(null), { reporting_marks: null, car_number: "", car_initial: null }, "split: null");
eq(splitCarNumber("  TFOX88031  "), { reporting_marks: "TFOX", car_number: "88031", car_initial: "TFOX" }, "split: surrounding whitespace");

// --- deriveLeaseKey ----------------------------------------------------------
eq(deriveLeaseKey("Trinity Industries"), "Trinity Industries", "lease key from lessee");
eq(deriveLeaseKey("  Trinity Industries  "), "Trinity Industries", "lease key trims");
eq(deriveLeaseKey(""), null, "lease key empty → null");
eq(deriveLeaseKey(null), null, "lease key null");
eq(deriveLeaseKey(undefined), null, "lease key undefined");

// --- synthesizeLeaseNumber ---------------------------------------------------
eq(synthesizeLeaseNumber("Trinity Industries"), "RES-TRINITY-INDUSTRIES", "lease number slugify");
eq(synthesizeLeaseNumber("IDLE (xAxiall)"), "RES-IDLE-XAXIALL", "lease number strips parens");
eq(synthesizeLeaseNumber("ACME, Inc."), "RES-ACME-INC", "lease number strips comma+period");
// Same lessee should always produce the same lease_number — i.e. import is idempotent
eq(
  synthesizeLeaseNumber("Trinity Industries") === synthesizeLeaseNumber("trinity industries"),
  true,
  "lease number is case-insensitive (idempotent re-import)"
);

// --- Entity → managed_category (PR #1 mapping must still hold) --------------
// These were previously covered above but are repeated explicitly to satisfy
// requirement #5 ("entity mapping Main->RESIDCO Owned and Rail Partners
// Select->RPS").
eq(deriveManagedCategory("Main"), "RESIDCO Owned", "explicit: Main -> RESIDCO Owned");
eq(deriveManagedCategory("Rail Partners Select"), "RPS", "explicit: Rail Partners Select -> RPS");

// --- Composite uniqueness key (marks|number) --------------------------------
// Mirrors server dupeKey() so we test the contract that `TFOX|88031` and
// `HWCX|88031` are distinct, even though the bare numeric is the same.
const dupeKey = (marks: string | null | undefined, num: string | null | undefined) =>
  `${(marks ?? "").trim().toUpperCase()}|${(num ?? "").trim().toUpperCase()}`;
eq(dupeKey("TFOX", "88031"), "TFOX|88031", "dupeKey basic");
eq(dupeKey("tfox", " 88031"), "TFOX|88031", "dupeKey normalises case+whitespace");
eq(
  dupeKey("TFOX", "88031") === dupeKey("HWCX", "88031"),
  false,
  "dupeKey: same number under different marks is NOT a duplicate"
);
eq(
  dupeKey("TFOX", "88031") === dupeKey("TFOX", "88031"),
  true,
  "dupeKey: same marks+number IS a duplicate"
);

// --- Mini build-from-row simulation (mark/number split + rider+lessee ack) ---
// We can't call buildRailcarFromRow from server here without dragging in
// supabase, so we re-create the minimum split logic and assert it matches the
// shared helper end-to-end on a realistic row.
function buildIdentity(row: Record<string, unknown>) {
  const n = normalizeRow(row);
  const split = splitCarNumber((n as any).car_number);
  const reporting_marks = (n as any).reporting_marks ?? split.reporting_marks;
  return {
    reporting_marks,
    car_number: split.car_number || (typeof (n as any).car_number === "string" ? String((n as any).car_number).toUpperCase() : ""),
    // Mirror server: explicit > split > marks fallback
    car_initial: (n as any).car_initial ?? split.car_initial ?? reporting_marks,
    lessee_name: (n as any).lessee_name ?? null,
    rider_external_id: (n as any).rider_external_id ?? null,
    entity: (n as any).entity ?? null,
    managed_category: deriveManagedCategory((n as any).entity as string | null | undefined),
  };
}
eq(
  buildIdentity({
    "Car Number": "TFOX88031",
    "Lessee": "IDLE (xAxiall)",
    "Rider ID": "EA1503",
    "Entity": "Main",
  }),
  {
    reporting_marks: "TFOX",
    car_number: "88031",
    car_initial: "TFOX",
    lessee_name: "IDLE (xAxiall)",
    rider_external_id: "EA1503",
    entity: "Main",
    managed_category: "RESIDCO Owned",
  },
  "buildIdentity: TFOX88031 / Main row produces full identity + relationships"
);
eq(
  buildIdentity({
    "Car Number": "HWCX010823",
    "Lessee": "Trinity Industries",
    "Rider ID": "RP200",
    "Entity": "Rail Partners Select",
  }),
  {
    reporting_marks: "HWCX",
    car_number: "010823",
    car_initial: "HWCX",
    lessee_name: "Trinity Industries",
    rider_external_id: "RP200",
    entity: "Rail Partners Select",
    managed_category: "RPS",
  },
  "buildIdentity: HWCX / RPS row"
);
// Explicit reporting_marks column wins over derived
eq(
  buildIdentity({
    "Car Number": "88031",
    "Reporting Marks": "TFOX",
    "Lessee": "ACME",
  }),
  {
    reporting_marks: "TFOX",
    car_number: "88031",
    car_initial: "TFOX",
    lessee_name: "ACME",
    rider_external_id: null,
    entity: null,
    managed_category: null,
  },
  "buildIdentity: explicit Reporting Marks column wins"
);

// --- MLA dedupe simulation (one MLA per distinct lessee in a batch) ---------
// Mirrors the server commit logic at a unit-test level.
function distinctMlaCount(rows: Array<{ lessee_name: string | null }>): number {
  const set = new Set<string>();
  for (const r of rows) {
    const k = deriveLeaseKey(r.lessee_name);
    if (k) set.add(k);
  }
  return set.size;
}
eq(
  distinctMlaCount([
    { lessee_name: "Trinity" },
    { lessee_name: "Trinity" },
    { lessee_name: "ACME" },
    { lessee_name: null },
    { lessee_name: " trinity " }, // not normalised by case — exposes case sensitivity
  ]),
  3,
  "distinctMlaCount: groups by exact lessee name, drops null"
);

// --- Rider count simulation: distinct (lessee, rider_external_id) pairs ----
function distinctRiderCount(
  rows: Array<{ lessee_name: string | null; rider_external_id: string | null; assignment_label?: string | null }>
): number {
  const set = new Set<string>();
  for (const r of rows) {
    const lk = deriveLeaseKey(r.lessee_name);
    if (!lk) continue;
    const rname = (r.rider_external_id || r.assignment_label || lk)?.toString().trim();
    if (!rname) continue;
    set.add(`${lk}|${rname}`);
  }
  return set.size;
}
eq(
  distinctRiderCount([
    { lessee_name: "Trinity", rider_external_id: "EA1503" },
    { lessee_name: "Trinity", rider_external_id: "EA1503" },
    { lessee_name: "Trinity", rider_external_id: "EA1504" },
    { lessee_name: "ACME",    rider_external_id: "EA1503" },  // EA1503 under different lessee = distinct rider
    { lessee_name: "ACME",    rider_external_id: null, assignment_label: "Coal #5" },
    { lessee_name: null,      rider_external_id: "EA0001" },  // dropped — no lessee
  ]),
  4,
  "distinctRiderCount: groups by (lessee, rider name); falls back to assignment_label"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\n" + failures.join("\n\n"));
  process.exit(1);
}
