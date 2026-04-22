/* Frontend mirror of server types. */

export type EquipmentType =
  | "TANK_COATED_OR_NONCORROSIVE_PRE_1974"
  | "TANK_UNCOATED_CORROSIVE"
  | "OTHER_PRE_1974"
  | "MODERN_OR_ILS"
  | "RACK_PRE_2016"
  | "RACK_POST_2016";

export type AbRateBasis = "ANNUAL" | "MONTHLY" | "SAME_AS_CAR";

export interface CostFactorRow {
  id: number;
  year: number;
  factor: number;
  publication_q: number;
  source: string | null;
  created_at: string;
}

export interface SalvageQuarterRow {
  id: number;
  quarter_code: number;
  steel_per_lb: number;
  aluminum_per_lb: number;
  stainless_per_lb: number | null;
  dismantling_per_gt: number;
  loading_flat: number | null;
  misc_labor: number | null;
  source: string | null;
  created_at: string;
}

export interface CarDepRateRow {
  equipment_type: EquipmentType;
  display_name: string;
  annual_rate: number;
  max_depreciation: number;
  age_cutoff_years: number;
  notes: string | null;
}

export interface AbCodeRow {
  id: number;
  code: string;
  description: string;
  rate_basis: AbRateBasis;
  rate: number;
  max_depreciation: number;
  effective_from: string;
  effective_to: string | null;
}

export interface RailcarRow {
  id: number;
  car_initial: string;
  car_number: string;
  tare_weight_lbs: number | null;
  built_year: number | null;
  oec: number | null;
  oac: number | null;
  nbv: number | null;
}

export interface DvLineResult {
  label: string;
  yearOrMonthBasis: string;
  reproductionCost: number;
  depreciationRate: number;
  depreciation: number;
  depreciatedValue: number;
  notes?: string[];
}

export interface DvResult {
  ageYears: number;
  ageMonths: number;
  ageTotalYearsDecimal: number;
  costFactorBuildYear: number;
  costFactorPriorToDamageYear: number;
  priorYear: number;
  quarterCode: number;
  base: DvLineResult;
  abItems: DvLineResult[];
  totalReproductionCost: number;
  totalDepreciatedValue: number;
  salvage: {
    steelValue: number;
    aluminumValue: number;
    stainlessValue: number;
    totalSalvage: number;
    dismantlingAllowance: number;
    salvagePlus20: number;
  };
  overAgeCutoff: boolean;
  ageCutoffYears: number;
  settlementMatrix: {
    handlingLine: { dv: number; sv: number; svPlus20: number };
    ownerRepairedOffered: { dv: number; sv: number; svPlus20: number };
    ownerRepairedNotOffered: { dv: number; sv: number; svPlus20: number };
    ownerDismantledOffered: { dv: number; sv: number; svPlus20: number };
    ownerDismantledNotOffered: { dv: number; sv: number; svPlus20: number };
  };
  warnings: string[];
}

export interface DvCalculation {
  id: number;
  visitor_id: string;
  railcar_id: number | null;
  railroad: string | null;
  incident_date: string;
  incident_location: string | null;
  ddct_incident_no: string | null;
  car_initial: string | null;
  car_number: string | null;
  tare_weight_lb: number;
  steel_weight_lb: number;
  aluminum_weight_lb: number;
  stainless_weight_lb: number;
  non_metallic_lb: number;
  original_cost: number;
  build_date: string;
  equipment_type: EquipmentType;
  total_reproduction: number;
  total_dv: number;
  total_salvage: number;
  salvage_plus_20: number;
  dismantling_allow: number;
  over_age_cutoff: boolean;
  result_json: DvResult;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  dv_calculation_ab_items?: Array<{
    id: number;
    seq: number;
    code: string;
    value: number;
    install_date: string;
    rate_basis: AbRateBasis;
    rate: number;
    max_depreciation: number;
  }>;
}

export interface CalculationPayload {
  // Metadata
  railcarId?: number | null;
  railroad?: string;
  ddctNumber?: string;
  incidentLocation?: string;
  carInitial?: string;
  carNumber?: string;
  notes?: string;

  // Engine inputs
  incidentDate: string;        // YYYY-MM-DD
  buildDate: string;           // YYYY-MM-DD
  originalCost: number;
  tareWeightLb: number;
  steelWeightLb: number;
  aluminumWeightLb: number;
  stainlessWeightLb: number;
  nonMetallicWeightLb: number;
  equipmentType: EquipmentType;

  abItems: Array<{
    code: string;
    value: number;
    installDate: string;       // YYYY-MM-DD
    rateBasis?: AbRateBasis;
    rate?: number;
    maxDepreciation?: number;
  }>;
}
