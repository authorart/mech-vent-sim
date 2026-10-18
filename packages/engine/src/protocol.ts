/**
 * Engine ↔ UI message contract (R3-Q6). The Engine runs in a Web Worker; these are the only
 * shapes that cross the boundary. Bump ENGINE_CONTRACT_VERSION when any shape changes.
 */
import type { AlarmEvent, AlarmLimits, AlarmState } from "./alarms";
import type { PatientFeatures, SedationLevel } from "./drive";
import type { BloodGas, GasParams } from "./gas";
import type { BreathMetrics } from "./monitor";
import type { ProfileId } from "./profiles";
import type { ScenarioEvent, ScenarioEventKind } from "./scenario";
import type { Drive, EngineEvent, Mechanics, VentSettings } from "./types";
import type { CirculationParams, Vitals } from "./vitals";

export const ENGINE_CONTRACT_VERSION = 7;

/** Instructor Panel changes; each field is merged into the running patient. */
export interface ProfilePatch {
  mechanics?: Partial<Mechanics>;
  drive?: Partial<Drive>;
  gas?: Partial<GasParams>;
  circulation?: Partial<CirculationParams>;
}

export type EngineCommand =
  | {
      type: "init";
      version: number;
      profileId: ProfileId;
      settings?: VentSettings;
      sedation?: SedationLevel;
    }
  | { type: "loadProfile"; profileId: ProfileId; settings?: VentSettings }
  | { type: "applySettings"; settings: VentSettings }
  | { type: "setProfileParam"; patch: ProfilePatch }
  | { type: "setSedation"; level: SedationLevel }
  | { type: "setPatientFeatures"; features: Partial<PatientFeatures> }
  /** Scenario Events (M13): start `delay` s from now; optionally treated `resolveAfter` s later. */
  | { type: "scheduleEvent"; kind: ScenarioEventKind; delay: number; resolveAfter?: number | null }
  | { type: "resolveEvent"; id: number }
  | { type: "cancelEvent"; id: number }
  | { type: "inspiratoryPause" }
  | { type: "expiratoryHold" }
  | { type: "endApneaBackup" }
  | { type: "silenceAlarms" }
  | { type: "setAlarmLimits"; limits: AlarmLimits }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "fastForward"; factor: number }
  | { type: "reset" };

/** A snapshot of everything the controls need to render. Sent whenever it changes. */
export interface EngineState {
  profileId: ProfileId;
  settings: VentSettings;
  pendingSettings: VentSettings | null;
  apneaBackupActive: boolean;
  sedation: SedationLevel;
  features: PatientFeatures;
  appliedDrive: Drive;
  mechanics: Mechanics;
  baseDrive: Drive;
  gas: GasParams;
  circulation: CirculationParams;
  alarmLimits: AlarmLimits;
  paused: boolean;
  fastForward: number;
  /** Scenario Events on the timeline (session time, s). */
  scenario: ScenarioEvent[];
  /** Session time when this state was posted (s). */
  time: number;
}

export type EngineMessage =
  | { type: "ready"; version: number }
  | { type: "state"; state: EngineState }
  /** Interleaved Samples (see SAMPLE). The buffer is transferred, not copied. */
  | { type: "samples"; data: Float32Array }
  | { type: "breath"; metrics: BreathMetrics }
  | { type: "physiology"; t: number; gas: BloodGas; vitals: Vitals }
  | {
      type: "alarms";
      events: AlarmEvent[];
      active: AlarmState[];
      silenced: boolean;
    }
  | { type: "event"; event: EngineEvent }
  | { type: "error"; message: string };
