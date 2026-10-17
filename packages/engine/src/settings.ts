import type { Mode, PcvSettings, PsvSettings, VcvSettings, VentSettings } from "./types";

/** Initial Settings (R3-Q2): the same generic post-intubation settings for every profile. */
export const INITIAL_SETTINGS: VcvSettings = {
  mode: "VCV",
  tidalVolume: 0.5,
  rate: 16,
  peakFlow: 1,
  flowPattern: "square",
  pauseTime: 0,
  peep: 5,
  fio2: 1,
  trigger: { type: "flow", threshold: 2 / 60 },
  highPressureLimit: 40,
};

const PCV_DEFAULTS = { pInsp: 15, rate: 16, inspTime: 1, riseTime: 0.1 };
const PSV_DEFAULTS = {
  pSupport: 10,
  riseTime: 0.1,
  esens: 0.25,
  apneaTime: 20,
  backup: { pInsp: 15, rate: 12, inspTime: 1 },
};

/**
 * Settings for a mode change: PEEP, FiO2, trigger and the pressure limit carry over, and the
 * mode's own values start from defaults. The mode-change dialog shows these before confirming.
 */
export function settingsForMode(mode: Mode, from: VentSettings): VentSettings {
  const common = {
    peep: from.peep,
    fio2: from.fio2,
    trigger: from.trigger,
    highPressureLimit: from.highPressureLimit,
  };
  if (from.mode === mode) return from;
  const rate = "rate" in from ? from.rate : PCV_DEFAULTS.rate;
  switch (mode) {
    case "VCV": {
      const s: VcvSettings = { ...INITIAL_SETTINGS, ...common, rate };
      return s;
    }
    case "PCV": {
      const s: PcvSettings = { ...PCV_DEFAULTS, ...common, mode, rate };
      return s;
    }
    case "PSV": {
      const s: PsvSettings = { ...PSV_DEFAULTS, ...common, mode };
      return s;
    }
  }
}
