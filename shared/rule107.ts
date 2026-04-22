/**
 * Rule 107 Depreciated Value Calculation Engine
 *
 * Implements AAR Office Manual (Jan 2026) Rule 107.E step by step.
 * This module is pure, deterministic, and contains no I/O. It takes reference
 * data as arguments so calculations can be reproduced exactly from historical
 * inputs.
 *
 * References (page numbers in Jan 2026 Office Manual):
 *  - Rule 107.E.2.a   Base Reproduction Cost              (p. 59)
 *  - Rule 107.E.2.b   A&B Reproduction Cost               (p. 60)
 *  - Rule 107.E.3.a   Base Depreciated Value              (p. 61)
 *  - Rule 107.E.3.b   A&B Depreciated Value               (p. 61–62)
 *  - Rule 107.E.5     Salvage Value                       (p. 63)
 *  - Rule 107.G Ex I  Settlement Value Matrix             (p. 65)
 *  - Rule 107.G Ex II Settlement Value Chart (age cutoff) (p. 66)
 *  - Rule 107.G Ex III Cost Factor Chart                  (p. 67)
 *  - Rule 107.G Ex IV Depreciation Rate Chart             (p. 68)
 *  - Rule 107.G Ex V  Additions & Betterments Chart       (p. 69)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Exhibit IV equipment categories. The "age cutoff" comes from Exhibit II. */
export type EquipmentType =
  | "TANK_COATED_OR_NONCORROSIVE_PRE_1974"
  | "TANK_UNCOATED_CORROSIVE"
  | "OTHER_PRE_1974"
  | "MODERN_OR_ILS"
  | "RACK_PRE_2016"
  | "RACK_POST_2016";

/** Rate basis for A&B depreciation. */
export type AbRateBasis =
  | "ANNUAL"      // rate × years (e.g. 7% per annum)
  | "MONTHLY"     // rate × months (e.g. 2% per month — LOLI, TKLI)
  | "SAME_AS_CAR"; // rate/max follow the car's Exhibit IV entry, age = car age

/** Input for a single addition/betterment. */
export interface AbItemInput {
  code: string;                // e.g. "GNRL", "LOLI", "INIT"
  value: number;               // original capitalized cost
  installDate: Date;           // date A&B was installed
  /** Overrides for when rate / max in DB differ from defaults. */
  rate?: number;               // decimal, e.g. 0.02 or 0.07
  max?: number;                // decimal cap, e.g. 0.90 or 1.00
  rateBasis?: AbRateBasis;
}

export interface CostFactorRow {
  year: number;
  factor: number;
}

export interface SalvageQuarterRow {
  quarterCode: number;         // e.g. 20204 == 2020 Q4
  steelPerLb: number;          // Job Code 4244
  aluminumPerLb: number;       // Job Code 4236
  stainlessPerLb: number | null; // Job Code 4246 (may be null if not yet tracked)
  dismantlingPerGt: number;    // Job Code 4489 — $/gross ton (2240 lb)
}

export interface CarDepRateRow {
  equipmentType: EquipmentType;
  annualRate: number;          // Exhibit IV
  maxDepreciation: number;     // Exhibit IV
  ageCutoffYears: number;      // Exhibit II — over this, settle on Salvage Value Only
}

export interface DvInputs {
  incidentDate: Date;
  buildDate: Date;             // built / rebuilt / ILS-certified date
  originalCost: number;        // original, rebuilt, or ILS cost
  tareWeightLb: number;
  steelWeightLb: number;
  aluminumWeightLb: number;
  stainlessWeightLb?: number;  // optional, defaults to 0
  nonMetallicWeightLb: number; // subtracted from tare when computing salvage if no explicit material weights given
  equipmentType: EquipmentType;
  abItems: AbItemInput[];
}

export interface DvReferenceData {
  costFactors: CostFactorRow[];
  salvageQuarters: SalvageQuarterRow[];
  carDepRates: CarDepRateRow[];
}

export interface DvLineResult {
  label: string;
  yearOrMonthBasis: string;    // e.g. "27.67 years" or "46 months"
  reproductionCost: number;
  depreciationRate: number;    // decimal, e.g. 0.7194 meaning 71.94%
  depreciation: number;
  depreciatedValue: number;
  notes?: string[];
}

export interface DvResult {
  // Ages
  ageYears: number;
  ageMonths: number;
  ageTotalYearsDecimal: number;   // years + months/12, rounded to 2 dp per Rule

  // Cost factors
  costFactorBuildYear: number;
  costFactorPriorToDamageYear: number;
  priorYear: number;
  quarterCode: number;

  // Base car
  base: DvLineResult;

  // A&B items (one per input)
  abItems: DvLineResult[];

  // Totals
  totalReproductionCost: number;
  totalDepreciatedValue: number;

  // Salvage
  salvage: {
    steelValue: number;
    aluminumValue: number;
    stainlessValue: number;
    totalSalvage: number;
    dismantlingAllowance: number;
    salvagePlus20: number;
  };

  // Age cutoff — if true, car is older than Exhibit II cutoff → settlement = SV only
  overAgeCutoff: boolean;
  ageCutoffYears: number;

  // Settlement matrix — Exhibit I
  // Rows: A.HandlingLinePossess, B.OwnerPossessRepaired, C.OwnerPossessDismantled
  // Cols: dv (settlement offered), sv, svPlus20
  // When overAgeCutoff = true, only salvage/sv+20% columns are applicable.
  settlementMatrix: SettlementMatrix;

  // Diagnostic warnings (non-fatal): missing cost factors, stale quarter, etc.
  warnings: string[];
}

export interface SettlementMatrix {
  // A. Handling Line in Possession — Settlement offered
  handlingLine: { dv: number; sv: number; svPlus20: number };

  // B. Owner in Possession — Car Repaired
  ownerRepairedOffered:    { dv: number; sv: number; svPlus20: number };
  ownerRepairedNotOffered: { dv: number; sv: number; svPlus20: number };  // + UC (unloading) if applicable — user adds UC post-hoc

  // C. Owner in Possession — Car Dismantled
  ownerDismantledOffered:    { dv: number; sv: number; svPlus20: number };
  ownerDismantledNotOffered: { dv: number; sv: number; svPlus20: number }; // + DA + UC if applicable
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to n decimal places (banker's rounding not used — matches Excel). */
export function round(v: number, places = 2): number {
  const f = Math.pow(10, places);
  return Math.round(v * f) / f;
}

/**
 * Age in (years, months) of event B measured from event A.
 * Matches Rule 107.E.3.a.(1): "subtracting year and month in which car was
 * originally built from year and month in which car was destroyed. Age of car
 * must be in years and months; no fractional part of month will be considered."
 */
export function ageYearsMonths(
  from: Date,
  to: Date,
): { years: number; months: number } {
  const fromY = from.getUTCFullYear();
  const fromM = from.getUTCMonth() + 1; // 1..12
  const toY = to.getUTCFullYear();
  const toM = to.getUTCMonth() + 1;

  let years = toY - fromY;
  let months = toM - fromM;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months) };
}

/** Convert incident date to quarter code 20204 style (YYYY*10 + Q). */
export function quarterCode(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const q = Math.ceil(m / 3);
  return y * 10 + q;
}

/** Look up an exact cost factor for a year. Returns undefined if missing. */
export function costFactorForYear(
  factors: CostFactorRow[],
  year: number,
): number | undefined {
  return factors.find((f) => f.year === year)?.factor;
}

/**
 * Look up salvage rates for an exact quarter code. If missing, fall back to the
 * most recent quarter <= target. Returns null if no row at or before target.
 */
export function salvageForQuarter(
  rows: SalvageQuarterRow[],
  qc: number,
): { row: SalvageQuarterRow | null; exact: boolean } {
  const exact = rows.find((r) => r.quarterCode === qc);
  if (exact) return { row: exact, exact: true };
  const earlier = rows
    .filter((r) => r.quarterCode <= qc)
    .sort((a, b) => b.quarterCode - a.quarterCode)[0];
  return { row: earlier ?? null, exact: false };
}

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

/**
 * Compute a complete Rule 107 depreciated value per the 2026 Office Manual.
 * Deterministic — given the same inputs and reference data, always produces
 * the same output. No I/O.
 */
export function calculateDv(
  inputs: DvInputs,
  ref: DvReferenceData,
): DvResult {
  const warnings: string[] = [];

  // -------------------------------------------------------------------------
  // 1. Ages and quarter lookups
  // -------------------------------------------------------------------------
  const { years: ageY, months: ageM } = ageYearsMonths(inputs.buildDate, inputs.incidentDate);
  // Rule 107.E.3.a: "Calculate to two decimal points" — years + round(months/12, 2)
  const ageDecimal = ageY + round(ageM / 12, 2);

  const incidentYear = inputs.incidentDate.getUTCFullYear();
  const buildYear = inputs.buildDate.getUTCFullYear();
  const priorYear = incidentYear - 1;
  const qc = quarterCode(inputs.incidentDate);

  const cfBuild = costFactorForYear(ref.costFactors, buildYear);
  const cfPrior = costFactorForYear(ref.costFactors, priorYear);
  if (cfBuild === undefined) warnings.push(`No cost factor on file for build year ${buildYear}.`);
  if (cfPrior === undefined) warnings.push(`No cost factor on file for year prior to damage (${priorYear}).`);

  const carRate = ref.carDepRates.find((r) => r.equipmentType === inputs.equipmentType);
  if (!carRate) {
    throw new Error(`No depreciation rate defined for equipment type ${inputs.equipmentType}`);
  }

  // -------------------------------------------------------------------------
  // 2. Base Reproduction Cost (Rule 107.E.2.a)
  //    OC × (factor[priorYear] / factor[buildYear])
  //    Rule 107.E.2 Note: if destroyed within 12 months of build, repro = OC.
  // -------------------------------------------------------------------------
  const cfBuildSafe = cfBuild ?? 1;
  const cfPriorSafe = cfPrior ?? cfBuildSafe;

  // Within 12 months of build → reproduction cost = original cost (Exhibit III Note 1)
  const within12Months = ageY === 0 && ageM < 12;
  const baseReproduction = within12Months
    ? inputs.originalCost
    : (inputs.originalCost * cfPriorSafe) / cfBuildSafe;
  if (within12Months) warnings.push("Equipment destroyed within 12 months of build/rebuild/ILS — reproduction cost set to original cost per Exhibit III Note 1.");

  // -------------------------------------------------------------------------
  // 3. Base Depreciation (Rule 107.E.3.a)
  //    rate = min(max, ageDecimal * annualRate), round to 2 dp per Rule
  // -------------------------------------------------------------------------
  const baseRateUncapped = round(ageDecimal * carRate.annualRate, 4);
  const baseRate = Math.min(carRate.maxDepreciation, Math.max(0, baseRateUncapped));
  const baseDep = baseReproduction * baseRate;
  const baseDv = baseReproduction - baseDep;

  const baseLine: DvLineResult = {
    label: "Base Car",
    yearOrMonthBasis: `${ageDecimal.toFixed(2)} years`,
    reproductionCost: baseReproduction,
    depreciationRate: baseRate,
    depreciation: baseDep,
    depreciatedValue: baseDv,
  };

  // -------------------------------------------------------------------------
  // 4. A&B Reproduction + Depreciation (Rule 107.E.2.b and Rule 107.E.3.b)
  //    For each A&B:
  //      reproduction = value × (factor[priorYear] / factor[installYear])
  //      depreciation rate depends on rateBasis:
  //        ANNUAL       → rate × ageDecimalOfAB (using A&B install date)
  //        MONTHLY      → rate × totalMonths
  //        SAME_AS_CAR  → car rate × ageDecimalOfCar
  //      Capped at code's max.
  // -------------------------------------------------------------------------
  const abLines: DvLineResult[] = inputs.abItems
    .filter((ab) => ab && ab.value > 0)
    .map((ab) => {
      const rate = ab.rate ?? carRate.annualRate;
      const max = ab.max ?? carRate.maxDepreciation;
      const rateBasis = ab.rateBasis ?? "ANNUAL";
      const lineWarnings: string[] = [];

      const { years: abY, months: abM } = ageYearsMonths(ab.installDate, inputs.incidentDate);
      const abAgeDecimal = abY + round(abM / 12, 2);
      const totalMonths = abY * 12 + abM;

      const installYear = ab.installDate.getUTCFullYear();
      const cfInstall = costFactorForYear(ref.costFactors, installYear);
      if (cfInstall === undefined) {
        warnings.push(`[${ab.code}] No cost factor on file for install year ${installYear}.`);
        lineWarnings.push(`Missing cost factor for ${installYear}.`);
      }
      const cfInstallSafe = cfInstall ?? 1;

      // Exhibit IV Note (2): if damaged in same calendar year (annual) or month (monthly)
      // installed, reproduction = original cost.
      const sameCalendarYear = installYear === incidentYear;
      const sameCalendarMonth = sameCalendarYear && ab.installDate.getUTCMonth() === inputs.incidentDate.getUTCMonth();
      let abRepro: number;
      if (rateBasis === "MONTHLY" ? sameCalendarMonth : sameCalendarYear) {
        abRepro = ab.value;
        lineWarnings.push("Damaged in same period as install — reproduction set to original cost.");
      } else {
        abRepro = (ab.value * cfPriorSafe) / cfInstallSafe;
      }

      // Depreciation rate
      let rateApplied: number;
      let basisDescription: string;
      switch (rateBasis) {
        case "MONTHLY":
          rateApplied = Math.min(max, round(totalMonths * rate, 4));
          basisDescription = `${totalMonths} months`;
          break;
        case "SAME_AS_CAR":
          // Per Exhibit V: "Same rate as for car, from date car was originally
          // built/rebuilt/ILS-certified" — INIT, COIL, SPAR (sometimes JTHR, STNS).
          // This uses car age, not A&B install age.
          rateApplied = Math.min(max, round(ageDecimal * carRate.annualRate, 4));
          basisDescription = `${ageDecimal.toFixed(2)} years (car age)`;
          break;
        case "ANNUAL":
        default:
          rateApplied = Math.min(max, round(abAgeDecimal * rate, 4));
          basisDescription = `${abAgeDecimal.toFixed(2)} years`;
          break;
      }
      rateApplied = Math.max(0, rateApplied);

      const abDep = abRepro * rateApplied;
      const abDv = abRepro - abDep;

      return {
        label: `A&B ${ab.code}`,
        yearOrMonthBasis: basisDescription,
        reproductionCost: abRepro,
        depreciationRate: rateApplied,
        depreciation: abDep,
        depreciatedValue: abDv,
        notes: lineWarnings.length ? lineWarnings : undefined,
      };
    });

  const totalReproCost = baseReproduction + abLines.reduce((s, l) => s + l.reproductionCost, 0);
  const totalDv = baseDv + abLines.reduce((s, l) => s + l.depreciatedValue, 0);

  // -------------------------------------------------------------------------
  // 5. Salvage Value + Dismantling Allowance (Rule 107.E.5)
  // -------------------------------------------------------------------------
  const sv = salvageForQuarter(ref.salvageQuarters, qc);
  if (!sv.row) {
    warnings.push(`No salvage rates on file for or before ${qc}.`);
  } else if (!sv.exact) {
    warnings.push(`No exact salvage rates for quarter ${qc} — using most recent prior quarter ${sv.row.quarterCode}.`);
  }
  const steelRate = sv.row?.steelPerLb ?? 0;
  const alRate = sv.row?.aluminumPerLb ?? 0;
  const ssRate = sv.row?.stainlessPerLb ?? 0;
  const daRate = sv.row?.dismantlingPerGt ?? 0;

  const ssWeight = inputs.stainlessWeightLb ?? 0;
  const steelValue = inputs.steelWeightLb * steelRate;
  const alValue = inputs.aluminumWeightLb * alRate;
  const ssValue = ssWeight * ssRate;
  const totalSalvage = steelValue + alValue + ssValue;
  const dismantling = (inputs.tareWeightLb / 2240) * daRate;
  const salvagePlus20 = totalSalvage * 1.2;

  // -------------------------------------------------------------------------
  // 6. Age cutoff per Exhibit II
  // -------------------------------------------------------------------------
  const overAgeCutoff = ageY >= carRate.ageCutoffYears;
  if (overAgeCutoff) {
    warnings.push(`Car age (${ageY}y) meets or exceeds Exhibit II cutoff of ${carRate.ageCutoffYears}y — Settlement Value is Salvage Value Only.`);
  }

  // -------------------------------------------------------------------------
  // 7. Settlement matrix per Exhibit I
  // -------------------------------------------------------------------------
  const dvForMatrix = overAgeCutoff ? totalSalvage : totalDv;

  const handlingLine = {
    dv: dvForMatrix,
    sv: totalSalvage,
    svPlus20: salvagePlus20,
  };
  const ownerRepairedOffered = { ...handlingLine };
  // "Settlement Not Offered" rows add UC* (unloading) — we leave UC = 0 since
  // that's a post-calc add-on the user enters on the invoice.
  const ownerRepairedNotOffered = { ...handlingLine };

  // Owner in possession, dismantled — subtract salvage from DV (Exhibit I).
  const ownerDismantledOffered = {
    dv: dvForMatrix - totalSalvage,
    sv: 0,                        // SV − SV = 0
    svPlus20: salvagePlus20 - totalSalvage,
  };
  // "Settlement Not Offered" adds DA + UC and subtracts salvage
  const ownerDismantledNotOffered = {
    dv: dvForMatrix - totalSalvage + dismantling,
    sv: 0 + dismantling,
    svPlus20: salvagePlus20 - totalSalvage + dismantling,
  };

  return {
    ageYears: ageY,
    ageMonths: ageM,
    ageTotalYearsDecimal: ageDecimal,
    costFactorBuildYear: cfBuild ?? NaN,
    costFactorPriorToDamageYear: cfPrior ?? NaN,
    priorYear,
    quarterCode: qc,
    base: baseLine,
    abItems: abLines,
    totalReproductionCost: totalReproCost,
    totalDepreciatedValue: totalDv,
    salvage: {
      steelValue,
      aluminumValue: alValue,
      stainlessValue: ssValue,
      totalSalvage,
      dismantlingAllowance: dismantling,
      salvagePlus20,
    },
    overAgeCutoff,
    ageCutoffYears: carRate.ageCutoffYears,
    settlementMatrix: {
      handlingLine,
      ownerRepairedOffered,
      ownerRepairedNotOffered,
      ownerDismantledOffered,
      ownerDismantledNotOffered,
    },
    warnings,
  };
}
