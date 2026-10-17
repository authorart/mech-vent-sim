"use client";

import {
  predictedBodyWeight,
  type AlarmState,
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

  send: (cmd: EngineCommand) => void;
  setSend: (send: (cmd: EngineCommand) => void) => void;
  receive: (msg: EngineMessage) => void;
  setPatientSize: (sex: Sex, heightCm: number) => void;
}

/** Waveform data lives outside React state; canvases read it directly every frame. */
export const sweep = new SweepBuffer();

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
          set({ metrics: null, gas: null, vitals: null, alarms: [], measuring: null });
        }
        set({ engine: msg.state });
        return;
      }
      case "samples":
        sweep.push(msg.data);
        return;
      case "breath":
        set({ metrics: msg.metrics });
        return;
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
