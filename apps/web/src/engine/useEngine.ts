"use client";

import type { ProfileId, SedationLevel, VentSettings } from "@mech-vent/engine";
import { useEffect } from "react";
import { EngineClient } from "./client";
import { useStore } from "./store";

export interface EngineStart {
  profileId: ProfileId;
  settings?: VentSettings;
  sedation?: SedationLevel;
}

/** Start the Engine Worker once and connect it to the store. */
export function useEngine(start: EngineStart): void {
  useEffect(() => {
    const { receive, setSend } = useStore.getState();
    const client = new EngineClient(receive);
    setSend((cmd) => client.send(cmd));
    client.init(start.profileId, start.settings, start.sedation);
    return () => {
      setSend(() => {});
      client.dispose();
    };
    // Start values are read once; later changes go through commands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
