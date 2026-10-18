import type {
  Mode,
  PcvSettings,
  PsimvSettings,
  PsvSettings,
  SimvSettings,
  VcvSettings,
  VentSettings,
  VsimvSettings,
} from "./types";

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

/** SIMV starts as partial support: 10 Mandatory Breaths a minute, pressure support 5 (R7-Q5). */
const SIMV_DEFAULTS = { rate: 10, pSupport: 5, esens: 0.25, riseTime: 0.1 };

export function isSimv(s: VentSettings): s is SimvSettings {
  return s.mode === "V-SIMV" || s.mode === "P-SIMV";
}

/**
 * Settings for a mode change: PEEP, FiO2, trigger and the pressure limit carry over, and so do the
 * volume breath (VCV ⇄ V-SIMV), the pressure breath (PCV ⇄ P-SIMV) and the SIMV rate and support.
 * Everything else starts from defaults. The mode-change dialog shows these before confirming.
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
  const volume =
    from.mode === "VCV" || from.mode === "V-SIMV"
      ? {
          tidalVolume: from.tidalVolume,
          peakFlow: from.peakFlow,
          flowPattern: from.flowPattern,
          pauseTime: from.pauseTime,
        }
      : {};
  const pressure =
    from.mode === "PCV" || from.mode === "P-SIMV"
      ? { pInsp: from.pInsp, inspTime: from.inspTime, riseTime: from.riseTime }
      : {};
  const support = isSimv(from)
    ? { rate: from.rate, pSupport: from.pSupport, esens: from.esens, riseTime: from.riseTime }
    : from.mode === "PSV"
      ? { esens: from.esens, riseTime: from.riseTime }
      : {};
  switch (mode) {
    case "VCV": {
      const s: VcvSettings = { ...INITIAL_SETTINGS, ...volume, ...common, rate };
      return s;
    }
    case "PCV": {
      const s: PcvSettings = { ...PCV_DEFAULTS, ...pressure, ...common, mode, rate };
      return s;
    }
    case "PSV": {
      const s: PsvSettings = { ...PSV_DEFAULTS, ...common, mode };
      return s;
    }
    case "V-SIMV": {
      const { mode: _vcv, rate: _rate, ...breath } = INITIAL_SETTINGS;
      const s: VsimvSettings = { ...breath, ...SIMV_DEFAULTS, ...volume, ...support, ...common, mode };
      return s;
    }
    case "P-SIMV": {
      const { rate: _rate, ...breath } = PCV_DEFAULTS;
      const s: PsimvSettings = {
        ...breath,
        ...SIMV_DEFAULTS,
        ...pressure,
        ...support,
        ...common,
        mode,
      };
      return s;
    }
  }
}
