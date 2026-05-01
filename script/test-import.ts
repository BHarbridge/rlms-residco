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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\n" + failures.join("\n\n"));
  process.exit(1);
}
