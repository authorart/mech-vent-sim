import type { SedationLevel } from "./drive";
import type { GasParams } from "./gas";
import type { Mechanics, Patient } from "./types";
import type { CirculationParams } from "./vitals";

export type ProfileId =
  | "normal"
  | "ards"
  | "asthma"
  | "copd"
  | "metabolicAcidosis"
  | "cardiogenicEdema"
  | "massivePe"
  | "centralApnea";

/** A Patient Profile: everything about the patient, nothing about the ventilator. */
export interface PatientProfile {
  id: ProfileId;
  name: string;
  summary: string;
  patient: Patient;
  gas: GasParams;
  circulation: CirculationParams;
  /** Recommended lung-protective tidal volume (mL/kg PBW). */
  recommendedVtPerKg: number;
  /** Arterial pH at which the profile's drive applies unchanged (chemoreflex reference). */
  referencePh: number;
  startSedation: SedationLevel;
}

/**
 * Profile values in clinical units, as reviewed in task.md (R3-Q3).
 * Vd/Vt is at Vt 500 mL; shunt is at PEEP 5.
 */
export interface ProfileValues {
  compliance: number; // mL/cmH2O
  rInsp: number; // cmH2O/(L/s)
  rExp: number;
  vco2: number; // mL/min
  vdvt: number;
  shunt: number;
  recruitable: number;
  peepHalf: number; // cmH2O
  vqMismatch: number;
  hco3: number; // mmol/L
  neuralRate: number; // /min
  pmusMax: number; // cmH2O
  hr: number;
  sbp: number;
  dbp: number;
  /** Presenting pH: the chemoreflex reference. */
  referencePh: number;
  /** Small-airway narrowing on expiration (see Mechanics.airwayCollapse); collapseVolume in L. */
  airwayCollapse?: number;
  collapseVolume?: number;
  /** Overdistension: elastic volume (L) where the P–V curve bends up, and its stiffness (cmH2O/L²). */
  overdistensionVolume?: number;
  overdistensionStiffness?: number;
  /** Sedation level the profile opens with (default deep, R4-Q1). */
  startSedation?: SedationLevel;
  /** Further lung mechanics (M11): flow limitation, recruitment, viscoelasticity, chest wall. */
  lung?: Partial<Mechanics>;
}

export const ANATOMIC_DEAD_SPACE = 0.125;
const HB = 12;
const INSP_FRACTION = 0.35;
const REF_VT = 0.5;
const RECRUIT_WIDTH = 3;

export function buildProfile(
  id: ProfileId,
  name: string,
  summary: string,
  v: ProfileValues,
  recommendedVtPerKg = 8,
): PatientProfile {
  const s5 = 1 / (1 + Math.exp(-(5 - v.peepHalf) / RECRUIT_WIDTH));
  return {
    id,
    name,
    summary,
    recommendedVtPerKg,
    referencePh: v.referencePh,
    startSedation: v.startSedation ?? "deep",
    patient: {
      mechanics: {
        compliance: v.compliance / 1000,
        rInsp: v.rInsp,
        rExp: v.rExp,
        ...(v.airwayCollapse && { airwayCollapse: v.airwayCollapse, collapseVolume: v.collapseVolume }),
        ...(v.overdistensionStiffness && {
          overdistensionVolume: v.overdistensionVolume,
          overdistensionStiffness: v.overdistensionStiffness,
        }),
        ...v.lung,
      },
      drive: { neuralRate: v.neuralRate, pmusMax: v.pmusMax, inspFraction: INSP_FRACTION },
    },
    gas: {
      vco2: v.vco2,
      anatomicDeadSpace: ANATOMIC_DEAD_SPACE,
      alveolarDeadSpaceFraction: Math.max(
        0,
        (v.vdvt * REF_VT - ANATOMIC_DEAD_SPACE) / (REF_VT - ANATOMIC_DEAD_SPACE),
      ),
      shuntMax: v.shunt / (1 - v.recruitable * s5),
      recruitableFraction: v.recruitable,
      peepHalf: v.peepHalf,
      vqMismatch: v.vqMismatch,
      hco3: v.hco3,
      hb: HB,
    },
    circulation: { hr: v.hr, sbp: v.sbp, dbp: v.dbp },
  };
}

const base = { recruitable: 0, peepHalf: 10, vqMismatch: 0.02 };

/** The V1 registry. Mechanics, gas and drive values come from the table in task.md. */
export const PROFILES: Record<ProfileId, PatientProfile> = {
  normal: buildProfile(
    "normal",
    "Normal lungs",
    "Healthy adult mechanics and gas exchange. The baseline for comparison.",
    {
      ...base,
      compliance: 60,
      rInsp: 5,
      rExp: 5,
      vco2: 200,
      vdvt: 0.3,
      shunt: 0.05,
      hco3: 24,
      neuralRate: 14,
      pmusMax: 5,
      hr: 80,
      sbp: 120,
      dbp: 75,
      overdistensionVolume: 1.1,
      overdistensionStiffness: 20,
      lung: { viscoResistance: 3, viscoTime: 1, chestWallCompliance: 0.2, pesOffset: 3 },
      referencePh: 7.4,
    },
  ),
  ards: buildProfile(
    "ards",
    "Severe ARDS",
    "Diffuse alveolar damage: very low compliance, high shunt, recruitable with PEEP.",
    {
      compliance: 20,
      rInsp: 8,
      rExp: 8,
      vco2: 220,
      vdvt: 0.55,
      shunt: 0.45,
      recruitable: 0.5,
      peepHalf: 12,
      vqMismatch: 0.05,
      hco3: 22,
      neuralRate: 28,
      pmusMax: 8,
      hr: 105,
      sbp: 110,
      dbp: 65,
      overdistensionVolume: 0.7,
      overdistensionStiffness: 80,
      lung: {
        recruitCompliance: 0.02,
        recruitClosing: 12,
        recruitOpening: 38,
        viscoResistance: 4,
        viscoTime: 1,
        chestWallCompliance: 0.15,
        pesOffset: 5,
      },
      referencePh: 7.3,
    },
    6,
  ),
  asthma: buildProfile(
    "asthma",
    "Status asthmaticus",
    "Severe bronchospasm: very high resistance, worse on expiration. Dynamic hyperinflation.",
    {
      compliance: 45,
      rInsp: 25,
      rExp: 45,
      vco2: 220,
      vdvt: 0.45,
      shunt: 0.08,
      recruitable: 0,
      peepHalf: 10,
      vqMismatch: 0.15,
      hco3: 24,
      neuralRate: 24,
      pmusMax: 10,
      hr: 120,
      sbp: 135,
      dbp: 80,
      airwayCollapse: 4,
      collapseVolume: 1.1,
      lung: { viscoResistance: 5, viscoTime: 1.2, chestWallCompliance: 0.2, pesOffset: 3 },
      referencePh: 7.3,
    },
  ),
  copd: buildProfile(
    "copd",
    "COPD exacerbation",
    "High compliance, expiratory flow limitation, chronic compensated hypercapnia (HCO3⁻ 32).",
    {
      compliance: 80,
      rInsp: 20,
      rExp: 45,
      vco2: 200,
      vdvt: 0.5,
      shunt: 0.08,
      recruitable: 0,
      peepHalf: 10,
      vqMismatch: 0.15,
      hco3: 32,
      neuralRate: 20,
      pmusMax: 8,
      hr: 100,
      sbp: 140,
      dbp: 80,
      airwayCollapse: 5,
      collapseVolume: 1.5,
      lung: {
        criticalPressure: 7,
        viscoResistance: 6,
        viscoTime: 1.2,
        chestWallCompliance: 0.2,
        pesOffset: 3,
      },
      referencePh: 7.35,
    },
  ),
  metabolicAcidosis: buildProfile(
    "metabolicAcidosis",
    "Severe metabolic acidosis",
    "DKA / lactic acidosis: normal lungs, HCO3⁻ 8, intense drive for compensatory ventilation.",
    {
      ...base,
      compliance: 60,
      rInsp: 4,
      rExp: 4,
      vco2: 280,
      vdvt: 0.3,
      shunt: 0.05,
      hco3: 8,
      neuralRate: 32,
      pmusMax: 20,
      hr: 125,
      sbp: 100,
      dbp: 55,
      overdistensionVolume: 1.1,
      overdistensionStiffness: 20,
      startSedation: "awake",
      lung: { viscoResistance: 3, viscoTime: 1, chestWallCompliance: 0.2, pesOffset: 3 },
      referencePh: 7.1,
    },
  ),
  cardiogenicEdema: buildProfile(
    "cardiogenicEdema",
    "Cardiogenic pulmonary edema",
    "LV failure: reduced compliance, moderate shunt that responds well to PEEP.",
    {
      compliance: 30,
      rInsp: 11,
      rExp: 11,
      vco2: 220,
      vdvt: 0.35,
      shunt: 0.25,
      recruitable: 0.7,
      peepHalf: 8,
      vqMismatch: 0.1,
      hco3: 22,
      neuralRate: 26,
      pmusMax: 10,
      hr: 110,
      sbp: 160,
      dbp: 95,
      overdistensionVolume: 0.9,
      overdistensionStiffness: 60,
      lung: {
        recruitCompliance: 0.02,
        recruitClosing: 8,
        recruitOpening: 18,
        viscoResistance: 4,
        viscoTime: 1,
        chestWallCompliance: 0.15,
        pesOffset: 4,
      },
      referencePh: 7.3,
    },
  ),
  massivePe: buildProfile(
    "massivePe",
    "Massive pulmonary embolism",
    "Near-normal mechanics, huge alveolar dead space: wide PaCO2–EtCO2 gradient, hypotension.",
    {
      ...base,
      compliance: 52,
      rInsp: 4.5,
      rExp: 4.5,
      vco2: 220,
      vdvt: 0.65,
      shunt: 0.1,
      vqMismatch: 0.1,
      hco3: 22,
      neuralRate: 24,
      pmusMax: 8,
      hr: 125,
      sbp: 90,
      dbp: 60,
      overdistensionVolume: 1.0,
      overdistensionStiffness: 20,
      lung: { viscoResistance: 3, viscoTime: 1, chestWallCompliance: 0.2, pesOffset: 3 },
      referencePh: 7.35,
    },
  ),
  centralApnea: buildProfile(
    "centralApnea",
    "Central apnea",
    "Brainstem injury or sedative overdose: normal lungs, no respiratory drive.",
    {
      ...base,
      compliance: 60,
      rInsp: 5,
      rExp: 5,
      vco2: 180,
      vdvt: 0.3,
      shunt: 0.05,
      hco3: 24,
      neuralRate: 0,
      pmusMax: 0,
      hr: 70,
      sbp: 115,
      dbp: 70,
      overdistensionVolume: 1.1,
      overdistensionStiffness: 20,
      lung: { viscoResistance: 3, viscoTime: 1, chestWallCompliance: 0.2, pesOffset: 3 },
      referencePh: 7.4,
    },
  ),
};

export type Sex = "male" | "female";

/** Predicted Body Weight (kg), ARDSNet formula. */
export function predictedBodyWeight(sex: Sex, heightCm: number): number {
  return (sex === "male" ? 50 : 45.5) + 0.91 * (heightCm - 152.4);
}
