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
  HOLD_TIME,
  type AdvanceResult,
  type SimulatorOptions,
} from "./simulator";
export { Monitor, type BreathMetrics, type Measured } from "./monitor";
export {
  AlarmEngine,
  ALARM_PRIORITY,
  DEFAULT_ALARM_LIMITS,
  SILENCE_TIME,
  type AlarmEvent,
  type AlarmId,
  type AlarmLimits,
  type AlarmPriority,
  type AlarmState,
} from "./alarms";
export {
  Session,
  NORMAL_GAS,
  NORMAL_CIRCULATION,
  PHYSIOLOGY_PRIME_TIME,
  type SessionOptions,
  type SessionStep,
} from "./session";
export {
  GasExchange,
  o2Saturation,
  o2Content,
  type BloodGas,
  type GasInputs,
  type GasParams,
} from "./gas";
export { Circulation, type CirculationParams, type Vitals, type VitalsInputs } from "./vitals";
