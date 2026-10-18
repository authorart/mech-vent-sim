import { describe, expect, it } from "vitest";
import { decodeCase, diffFromProfile, encodeCase, type CaseState } from "./case";
import { PROFILES } from "./profiles";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";

const base: CaseState = {
  v: 1,
  profileId: "asthma",
  settings: { ...INITIAL_SETTINGS, highPressureLimit: 60, rate: 10 },
  sedation: "light",
  sex: "female",
  heightCm: 160,
  patch: { mechanics: { rExp: 70 } },
  features: {
    breathing: "regular",
    agitation: "moderate",
    reverseTriggering: true,
    cardiacOscillation: "strong",
  },
  events: [],
};

describe("Case links", () => {
  it("round-trip, URL-safe", () => {
    const s = encodeCase(base);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCase(s)).toEqual(base);
  });

  it("round-trip PSV settings with backup", () => {
    const c = { ...base, settings: settingsForMode("PSV", INITIAL_SETTINGS) };
    expect(decodeCase(encodeCase(c))).toEqual(c);
  });

  it("older links without features get the default breathing", () => {
    const { features: _, ...old } = base;
    expect(decodeCase(encodeCase(old))?.features).toEqual({
      breathing: "natural",
      agitation: "none",
      reverseTriggering: false,
      cardiacOscillation: "small",
    });
  });

  it("reject garbage, unknown profiles and malformed settings", () => {
    expect(decodeCase("not-base64!!")).toBeNull();
    expect(decodeCase(encodeCase({ ...base, profileId: "flu" as never }))).toBeNull();
    expect(
      decodeCase(encodeCase({ ...base, settings: { ...base.settings, peep: "5" as never } })),
    ).toBeNull();
  });

  it("drop unknown or non-numeric patch fields, and clamp height", () => {
    const evil = encodeCase({
      ...base,
      heightCm: 999,
      patch: { mechanics: { rExp: 70, foo: 1, rInsp: "x" } as never },
    });
    const c = decodeCase(evil)!;
    expect(c.patch).toEqual({ mechanics: { rExp: 70 } });
    expect(c.heightCm).toBe(220);
  });

  it("diffFromProfile keeps only changed values", () => {
    const p = PROFILES.ards;
    const patch = diffFromProfile("ards", {
      mechanics: { ...p.patient.mechanics, compliance: 0.015 },
      baseDrive: p.patient.drive,
      gas: p.gas,
      circulation: p.circulation,
    });
    expect(patch).toEqual({ mechanics: { compliance: 0.015 } });
  });
});
