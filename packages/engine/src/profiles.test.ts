import { describe, expect, it } from "vitest";
import { PROFILES, predictedBodyWeight } from "./profiles";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";

describe("Predicted Body Weight", () => {
  it("uses the ARDSNet formula", () => {
    expect(predictedBodyWeight("male", 170)).toBeCloseTo(66.0, 1);
    expect(predictedBodyWeight("female", 160)).toBeCloseTo(52.4, 1);
  });
});

describe("Profile registry", () => {
  it("rebuilds the reviewed Vd/Vt at 500 mL and shunt at PEEP 5", () => {
    const pe = PROFILES.massivePe.gas;
    const vdvt =
      (pe.anatomicDeadSpace + pe.alveolarDeadSpaceFraction * (0.5 - pe.anatomicDeadSpace)) / 0.5;
    expect(vdvt).toBeCloseTo(0.65, 3);
    const a = PROFILES.ards.gas;
    const s5 = 1 / (1 + Math.exp(-(5 - a.peepHalf) / 3));
    expect(a.shuntMax * (1 - a.recruitableFraction * s5)).toBeCloseTo(0.45, 3);
  });

  it("stores mechanics in Engine units", () => {
    expect(PROFILES.ards.patient.mechanics.compliance).toBeCloseTo(0.02);
    expect(PROFILES.centralApnea.patient.drive.neuralRate).toBe(0);
  });
});

describe("Settings", () => {
  it("Initial Settings are the generic post-intubation set", () => {
    expect(INITIAL_SETTINGS).toMatchObject({
      mode: "VCV",
      tidalVolume: 0.5,
      rate: 16,
      peep: 5,
      fio2: 1,
    });
  });

  it("a mode change keeps PEEP, FiO2, trigger and the pressure limit", () => {
    const s = settingsForMode("PSV", { ...INITIAL_SETTINGS, peep: 10, fio2: 0.5 });
    expect(s).toMatchObject({ mode: "PSV", peep: 10, fio2: 0.5, highPressureLimit: 40 });
  });
});
