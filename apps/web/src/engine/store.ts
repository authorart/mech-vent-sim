"use client";

import {
  predictedBodyWeight,
  type AlarmState,
  type AsynchronyKind,
  type BloodGas,
  type BreathMetrics,
  type CaseState,
  type EngineCommand,
  type EngineEvent,
  type EngineMessage,
  type EngineState,
  type Sex,
  type Vitals,
} from "@mech-vent/engine";
import { create } from "zustand";
import { SweepBuffer } from "./ring";

export type Connection = "connecting" | "ready" | "error";

interface Store {
  connection: Connection;
  error: string | null;
  engine: EngineState | null;
  metrics: BreathMetrics | null;
  gas: BloodGas | null;
  vitals: Vitals | null;
  alarms: AlarmState[];
  silenced: boolean;
  /** Real time when the current silence ends (ms since epoch). */
  silencedUntil: number | null;
  /** Maneuver in progress, if any. */
  measuring: "inspiratoryPause" | "expiratoryHold" | null;
  lastEvent: EngineEvent | null;

  /** UI-only patient demographics, for PBW. */
  sex: Sex;
  heightCm: number;
  /** The remembered last case, offered on open (null once resumed or dismissed). */
  resumable: CaseState | null;
  /** Recent asynchrony events, newest first (Instructor Panel log). */
  asynchronyLog: AsynchronyMark[];
  /** Draw asynchrony labels on the waveforms (instructor's choice, R6-Q10). */
  showLabels: boolean;
  /** Show the Targets card to learners (instructor's choice, R6-Q11). */
  showTargets: boolean;
  /** Optional 4th waveform (M15). */
  extraTrace: ExtraTrace;
  /** Dynamic compliance collected per PEEP for a decremental PEEP trial (M14). */
  peepTrial: Record<string, { cdyn: number[]; stressIndex: number | null }>;

  send: (cmd: EngineCommand) => void;
  setSend: (send: (cmd: EngineCommand) => void) => void;
  receive: (msg: EngineMessage) => void;
  setPatientSize: (sex: Sex, heightCm: number) => void;
}

export type ExtraTrace = "off" | "pes" | "co2";

export interface AsynchronyMark {
  t: number;
  kind: AsynchronyKind;
}

/** Waveform data lives outside React state; canvases read it directly every frame. */
export const sweep = new SweepBuffer();

/** Asynchrony events for the waveform labels (outside React state, like `sweep`). */
export const asynchronyMarks: AsynchronyMark[] = [];
const MAX_MARKS = 80;
/** Breaths averaged per PEEP level in the PEEP trial. */
const PEEP_TRIAL_BREATHS = 8;
const LOG_LENGTH = 12;

export const useStore = create<Store>((set, get) => ({
  connection: "connecting",
  error: null,
  engine: null,
  metrics: null,
  gas: null,
  vitals: null,
  alarms: [],
  silenced: false,
  silencedUntil: null,
  measuring: null,
  lastEvent: null,
  sex: "male",
  heightCm: 170,
  resumable: null,
  asynchronyLog: [],
  showLabels: false,
  showTargets: false,
  extraTrace: "off",
  peepTrial: {},

  send: () => {},
  setSend: (send) => set({ send }),
  setPatientSize: (sex, heightCm) => set({ sex, heightCm }),

  receive: (msg) => {
    switch (msg.type) {
      case "ready":
        set({ connection: "ready", error: null });
        return;
      case "error":
        set({ connection: "error", error: msg.message });
        return;
      case "state": {
        const prev = get().engine;
        if (prev && prev.profileId !== msg.state.profileId) {
          sweep.clear();
          asynchronyMarks.length = 0;
          set({
            metrics: null,
            gas: null,
            vitals: null,
            alarms: [],
            measuring: null,
            asynchronyLog: [],
            peepTrial: {},
          });
        }
        set({ engine: msg.state });
        return;
      }
      case "samples":
        sweep.push(msg.data);
        return;
      case "breath": {
        const x = msg.metrics;
        const peep = get().engine?.settings.peep;
        if (x.cdyn !== null && x.trigger !== "patient" && peep !== undefined) {
          const key = String(peep);
          const prev = get().peepTrial[key] ?? { cdyn: [], stressIndex: null };
          const entry = {
            cdyn: [...prev.cdyn, x.cdyn].slice(-PEEP_TRIAL_BREATHS),
            stressIndex: x.stressIndex ?? prev.stressIndex,
          };
          set({ metrics: x, peepTrial: { ...get().peepTrial, [key]: entry } });
        } else {
          set({ metrics: x });
        }
        return;
      }
      case "physiology":
        set({ gas: msg.gas, vitals: msg.vitals });
        return;
      case "alarms":
        set({
          alarms: msg.active,
          silenced: msg.silenced,
          silencedUntil: msg.silenced ? (get().silencedUntil ?? Date.now() + 120_000) : null,
        });
        return;
      case "event": {
        const e = msg.event;
        if (e.type === "breathStart") {
          sweep.markBreathStart(e.t);
          return;
        }
        if (e.type === "asynchrony") {
          const mark = { t: e.t, kind: e.kind };
          asynchronyMarks.push(mark);
          if (asynchronyMarks.length > MAX_MARKS) asynchronyMarks.shift();
          set({ asynchronyLog: [mark, ...get().asynchronyLog].slice(0, LOG_LENGTH) });
          return;
        }
        if (e.type === "plateauMeasured" || e.type === "totalPeepMeasured") {
          set({ measuring: null });
        }
        set({ lastEvent: e });
        return;
      }
    }
  },
}));

export function usePbw(): number {
  return useStore((s) => predictedBodyWeight(s.sex, s.heightCm));
}
