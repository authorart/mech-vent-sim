import type { SedationLevel } from "./drive";
import { PROFILES, type ProfileId } from "./profiles";
import {
  ENGINE_CONTRACT_VERSION,
  type EngineCommand,
  type EngineMessage,
  type EngineState,
} from "./protocol";
import { createProfileSession, type Session } from "./session";
import { INITIAL_SETTINGS } from "./settings";
import type { VentSettings } from "./types";

export type Post = (msg: EngineMessage, transfer?: ArrayBuffer[]) => void;

/** Longest real-time step taken in one tick (s), so a backgrounded tab doesn't jump ahead. */
export const MAX_TICK = 0.1;

/**
 * Runs a Session behind the message contract. It has no timers: the Worker calls `tick(dt)`
 * with elapsed real time, which keeps it testable in Node.
 */
export class EngineHost {
  private session: Session | null = null;
  private profileId: ProfileId = "normal";
  private paused = false;
  private lastAlarmSilenced = false;

  constructor(private post: Post) {}

  handle(cmd: EngineCommand): void {
    try {
      this.dispatch(cmd);
    } catch (e) {
      this.post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  tick(realSeconds: number): void {
    const s = this.session;
    if (!s || this.paused || realSeconds <= 0) return;
    const step = s.advance(Math.min(realSeconds, MAX_TICK));

    // Events first, so the UI knows breath-start times before it draws the samples.
    for (const e of step.events) this.post({ type: "event", event: e });
    if (step.samples.length > 0) {
      this.post({ type: "samples", data: step.samples }, [step.samples.buffer as ArrayBuffer]);
    }
    for (const m of step.metrics) this.post({ type: "breath", metrics: m });
    if (step.physiology) this.post({ type: "physiology", ...step.physiology });

    const silenced = s.alarms.isSilenced(s.sim.time);
    if (step.alarms.length > 0 || silenced !== this.lastAlarmSilenced) {
      this.lastAlarmSilenced = silenced;
      this.post({ type: "alarms", events: step.alarms, active: s.alarms.activeAlarms, silenced });
    }
    if (step.events.some((e) => e.type !== "breathStart" && e.type !== "plateauMeasured")) {
      this.postState();
    }
  }

  private dispatch(cmd: EngineCommand): void {
    if (cmd.type === "init") {
      if (cmd.version !== ENGINE_CONTRACT_VERSION) {
        throw new Error(
          `Engine contract mismatch: UI v${cmd.version}, Engine v${ENGINE_CONTRACT_VERSION}`,
        );
      }
      this.load(cmd.profileId, cmd.settings, cmd.sedation);
      this.post({ type: "ready", version: ENGINE_CONTRACT_VERSION });
      this.postState();
      return;
    }

    const s = this.session;
    if (!s) throw new Error(`Engine not initialised (got "${cmd.type}")`);

    switch (cmd.type) {
      case "loadProfile":
        this.load(cmd.profileId, cmd.settings ?? INITIAL_SETTINGS, "deep");
        break;
      case "reset":
        this.load(this.profileId, INITIAL_SETTINGS, "deep");
        break;
      case "applySettings":
        s.sim.applySettings(cmd.settings);
        break;
      case "setProfileParam": {
        const { mechanics, drive, gas, circulation } = cmd.patch;
        if (mechanics) s.sim.setPatient({ mechanics: { ...s.sim.lung.mechanics, ...mechanics } });
        if (drive) s.baseDrive = { ...s.baseDrive, ...drive };
        if (gas) s.gas.params = { ...s.gas.params, ...gas };
        if (circulation) s.circulation.params = { ...s.circulation.params, ...circulation };
        break;
      }
      case "setSedation":
        s.setSedation(cmd.level);
        break;
      case "inspiratoryPause":
        s.sim.inspiratoryPause();
        return;
      case "expiratoryHold":
        s.sim.expiratoryHold();
        return;
      case "endApneaBackup":
        s.sim.endApneaBackup();
        break;
      case "silenceAlarms":
        s.alarms.silence(s.sim.time);
        this.lastAlarmSilenced = true;
        this.post({ type: "alarms", events: [], active: s.alarms.activeAlarms, silenced: true });
        return;
      case "setAlarmLimits":
        s.alarms.limits = { ...cmd.limits };
        break;
      case "pause":
        this.paused = true;
        break;
      case "resume":
        this.paused = false;
        break;
      case "fastForward":
        s.gasTimeScale = Math.max(1, cmd.factor);
        break;
    }
    this.postState();
  }

  private load(
    id: ProfileId,
    settings: VentSettings = INITIAL_SETTINGS,
    sedation: SedationLevel = "deep",
  ) {
    if (!(id in PROFILES)) throw new Error(`Unknown profile "${id}"`);
    this.profileId = id;
    this.session = createProfileSession(id, { settings, sedation });
    this.paused = false;
    this.lastAlarmSilenced = false;
  }

  private postState(): void {
    const s = this.session;
    if (!s) return;
    const state: EngineState = {
      profileId: this.profileId,
      settings: s.sim.currentSettings,
      pendingSettings: s.sim.pendingSettings,
      apneaBackupActive: s.sim.isApneaBackupActive,
      sedation: s.sedation,
      appliedDrive: s.appliedDrive,
      mechanics: { ...s.sim.lung.mechanics },
      baseDrive: { ...s.baseDrive },
      gas: { ...s.gas.params },
      circulation: { ...s.circulation.params },
      alarmLimits: { ...s.alarms.limits },
      paused: this.paused,
      fastForward: s.gasTimeScale,
    };
    this.post({ type: "state", state });
  }
}
