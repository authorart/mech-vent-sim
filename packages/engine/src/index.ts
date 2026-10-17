/** Engine contract version. Bump whenever the Engine ↔ UI message shapes change. */
export const ENGINE_CONTRACT_VERSION = 1;

export * from "./types";
export { LinearLung, type LungModel } from "./lung";
export { PatientEffort } from "./effort";
export {
  Simulator,
  DT,
  OUTPUT_EVERY,
  TRIGGER_DELAY,
  TRIGGER_LOCKOUT,
  MAX_PSV_INSP_TIME,
  type AdvanceResult,
  type SimulatorOptions,
} from "./simulator";
