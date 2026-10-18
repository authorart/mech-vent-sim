import type { ProfileId, TargetKey } from "@mech-vent/engine";

/**
 * Short management notes per profile for the Targets card (M14), summarized from Hess &
 * Kacmarek, Essentials of Mechanical Ventilation, 3rd ed., with chapter references.
 */
export const TARGET_NOTES: Record<ProfileId, { notes: string[]; source: string }> = {
  normal: {
    notes: [
      "Full support with volume or pressure control; Vt 6–8 mL/kg PBW, rate 15–20.",
      "Start FiO₂ 1.0, then lower it to the least that keeps SpO₂ in range.",
    ],
    source: "ch. 14",
  },
  ards: {
    notes: [
      "Vt 6 mL/kg PBW (4–8) with plateau pressure ≤ 30; lower Vt toward 4 if the plateau is higher.",
      "PEEP 10–20: by the PEEP/FiO₂ table, best compliance + 2 after a recruitment maneuver, or a stress index near 1.",
      "Rates up to 35 to limit acidosis; permissive hypercapnia (pH ≥ 7.20) is accepted.",
    ],
    source: "ch. 17 (fig. 17-1, tables 17-2 to 17-5)",
  },
  ardsStiffChestWall: {
    notes: [
      "Obesity or abdominal pressure raises pleural (esophageal) pressure and collapses the lung.",
      "Set PEEP to about the end-expiratory esophageal pressure, so transpulmonary pressure isn't negative.",
      "A plateau above 30 can be safe here if the end-inspiratory transpulmonary pressure stays below about 25.",
    ],
    source: "ch. 17, ch. 31 (fig. 31-13)",
  },
  asthma: {
    notes: [
      "The danger is air trapping: small Vt (4–6 mL/kg), rate 8–20, enough expiratory time.",
      "Peak pressure of 60–70 can be acceptable if the plateau stays below 30: raise the pressure limit.",
      "Permissive hypercapnia: pH ≥ 7.20 (7.10 tolerated). Added PEEP usually doesn't offset PEEP_i in asthma.",
    ],
    source: "ch. 18 (table 18-6, fig. 18-3)",
  },
  copd: {
    notes: [
      "Vt 6–8 mL/kg, low rate (8–15) and Ti 0.6–1.0 s to limit PEEP_i.",
      "If efforts fail to trigger, add PEEP up to about 80% of PEEP_i (flow limitation).",
      "Bring PaCO₂ back to the patient's usual level only (pH > 7.30); FiO₂ rarely above 0.5.",
    ],
    source: "ch. 18 (table 18-5, fig. 18-2)",
  },
  metabolicAcidosis: {
    notes: [
      "The patient is compensating by breathing hard: the ventilator must match that minute ventilation.",
      "Too little ventilation removes the compensation and pH falls further.",
      "Expect flow starvation and double triggering in volume control; consider PSV or PCV.",
    ],
    source: "ch. 14, ch. 15",
  },
  cardiogenicEdema: {
    notes: [
      "Mask CPAP 8–12 may avoid intubation; if ventilated, A/C with Vt 6–8 mL/kg and rate > 15.",
      "PEEP 5–10 unloads the failing left ventricle; Ti ≤ 1 s.",
      "Edema can return when support is removed (weaning).",
    ],
    source: "ch. 23 (table 23-3, fig. 23-1)",
  },
  massivePe: {
    notes: [
      "Huge alveolar dead space: PaCO₂ high and EtCO₂ low; raising the rate helps only partly.",
      "The right ventricle is preload dependent: high PEEP or mean airway pressure lowers BP.",
    ],
    source: "ch. 14, ch. 23, ch. 28",
  },
  centralApnea: {
    notes: [
      "Drug overdose or brainstem injury: the lungs are normal; full support, Vt 6–8 mL/kg, PEEP 5.",
      "Oxygenation is rarely the problem unless the patient aspirated.",
    ],
    source: "ch. 26 (table 26-2)",
  },
  neuromuscular: {
    notes: [
      "Normal lungs, weak muscles: A/C with comfortable, slightly larger breaths (8 to < 10 mL/kg), Ti > 1 s.",
      "Large Vt can cause hypocapnia; some centers add mechanical dead space.",
      "Weak efforts need a sensitive trigger.",
    ],
    source: "ch. 22 (table 22-3)",
  },
};

export const TARGET_LABELS: Record<TargetKey, { label: string; unit: string; decimals: number }> = {
  vtPerKg: { label: "Vt", unit: "mL/kg", decimals: 1 },
  rr: { label: "Rate", unit: "/min", decimals: 0 },
  ti: { label: "Ti", unit: "s", decimals: 2 },
  peep: { label: "PEEP", unit: "cmH₂O", decimals: 0 },
  pplat: { label: "P plat", unit: "cmH₂O", decimals: 0 },
  pl: { label: "Transpulmonary (end-insp.)", unit: "cmH₂O", decimals: 0 },
  ph: { label: "pH", unit: "", decimals: 2 },
  spo2: { label: "SpO₂", unit: "%", decimals: 0 },
};
