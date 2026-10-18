/**
 * M12 asynchrony detection: each scenario in the Asynchrony Guide is labeled with its own type,
 * and synchronous patients aren't labeled.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES, type PatientFeatures, type SedationLevel } from "./drive";
import type { ProfileId } from "./profiles";
import { createProfileSession } from "./session";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";
import type { AsynchronyKind, PcvSettings, PsvSettings, VentSettings } from "./types";

function detect(
  id: ProfileId,
  settings: VentSettings,
  sedation: SedationLevel,
  features: Partial<PatientFeatures> = {},
) {
  const s = createProfileSession(id, { settings, sedation, features: { ...DEFAULT_FEATURES, ...features } });
  s.advance(40);
  const r = s.advance(60);
  const counts: Partial<Record<AsynchronyKind, number>> = {};
  for (const e of r.events) if (e.type === "asynchrony") counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return { counts, breaths: r.metrics.length, summary: r.metrics.at(-1)!.asynchrony! };
}

const psv = (o: Partial<PsvSettings>): PsvSettings => ({
  ...(settingsForMode("PSV", INITIAL_SETTINGS) as PsvSettings),
  ...o,
});
const pcv = (o: Partial<PcvSettings>): PcvSettings => ({
  ...(settingsForMode("PCV", INITIAL_SETTINGS) as PcvSettings),
  ...o,
});

describe("Synchronous patients aren't labeled", () => {
  it.each([
    ["normal lungs on PSV, awake", "normal", psv({}), "awake"],
    ["normal lungs on VCV, sedated", "normal", INITIAL_SETTINGS, "deep"],
    ["ARDS on VCV, sedated", "ards", INITIAL_SETTINGS, "deep"],
  ] as const)("%s", (_, id, settings, sedation) => {
    // Once settled (the first 40 s are excluded).
    expect(Object.keys(detect(id, settings, sedation).counts)).toEqual([]);
  });
});

describe("Each asynchrony is detected", () => {
  it("ineffective triggers: COPD awake on VCV", () => {
    const x = detect("copd", INITIAL_SETTINGS, "awake");
    expect(x.counts.ineffectiveTrigger ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("autotriggering: strong heartbeat ripple with a 2 L/min flow trigger", () => {
    const x = detect("normal", INITIAL_SETTINGS, "deep", { cardiacOscillation: "strong" });
    expect(x.counts.autoTrigger ?? 0).toBeGreaterThan(5);
    expect(Object.keys(x.counts)).toEqual(["autoTrigger"]);
  });

  it.each(["normal", "ards"] as const)("reverse triggering (%s, deep sedation)", (id) => {
    const x = detect(id, INITIAL_SETTINGS, "deep", { reverseTriggering: true });
    expect(x.counts.reverseTrigger ?? 0).toBeGreaterThan(10);
    expect(Object.keys(x.counts)).toEqual(["reverseTrigger"]);
  });

  it("double triggering: PSV with Esens 70% in normal lungs", () => {
    const x = detect("normal", psv({ esens: 0.7 }), "awake");
    expect(x.counts.doubleTrigger ?? 0).toBeGreaterThan(10);
    expect(x.counts.prematureCycling ?? 0).toBeGreaterThan(10);
  });

  it("flow starvation: ARDS awake on VCV with 40 L/min", () => {
    const x = detect("ards", { ...INITIAL_SETTINGS, peakFlow: 40 / 60, tidalVolume: 0.4 }, "awake");
    expect(x.counts.flowStarvation ?? 0).toBeGreaterThan(10);
  });

  it("premature cycling: ARDS lightly sedated on PCV with Ti 0.4 s", () => {
    const x = detect("ards", pcv({ inspTime: 0.4, rate: 20 }), "light");
    expect(x.counts.prematureCycling ?? 0).toBeGreaterThan(10);
  });

  it("delayed cycling: normal lungs awake on PCV with Ti 2 s", () => {
    const x = detect("normal", pcv({ inspTime: 2 }), "awake");
    expect(x.counts.delayedCycling ?? 0).toBeGreaterThan(3);
  });

  it("the Asynchrony Index is high when most breaths are asynchronous", () => {
    const x = detect("normal", INITIAL_SETTINGS, "deep", { cardiacOscillation: "strong" });
    expect(x.summary.index).toBeGreaterThan(50);
    expect(x.summary.window).toBeGreaterThan(90);
  });
});
