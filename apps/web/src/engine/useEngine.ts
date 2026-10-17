"use client";

import {
  decodeCase,
  diffFromProfile,
  encodeCase,
  type CaseState,
  type ProfileId,
} from "@mech-vent/engine";
import { useEffect } from "react";
import { EngineClient } from "./client";
import { useStore } from "./store";

const STORAGE_KEY = "medvent:last-case";
const SAVE_DELAY_MS = 500;

/** A shared link wins over the remembered session; both fall back to the default profile. */
function startingCase(): CaseState | null {
  const hash = new URLSearchParams(window.location.hash.slice(1)).get("case");
  if (hash) {
    const c = decodeCase(hash);
    if (c) return c;
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? decodeCase(saved) : null;
  } catch {
    return null;
  }
}

/** The current session as a shareable case, or null before the Engine has reported state. */
export function currentCase(): CaseState | null {
  const { engine, sex, heightCm } = useStore.getState();
  if (!engine) return null;
  return {
    v: 1,
    profileId: engine.profileId,
    settings: engine.pendingSettings ?? engine.settings,
    sedation: engine.sedation,
    sex,
    heightCm,
    patch: diffFromProfile(engine.profileId, engine),
  };
}

export function caseLink(c: CaseState): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#case=${encodeCase(c)}`;
}

/** Start the Engine Worker once, connect it to the store, and remember the session. */
export function useEngine(defaultProfile: ProfileId): void {
  useEffect(() => {
    const { receive, setSend, setPatientSize } = useStore.getState();
    const client = new EngineClient(receive);
    setSend((cmd) => client.send(cmd));

    const start = startingCase();
    if (start) {
      setPatientSize(start.sex, start.heightCm);
      client.init(start.profileId, start.settings, start.sedation);
      if (Object.keys(start.patch).length > 0) {
        client.send({ type: "setProfileParam", patch: start.patch });
      }
    } else {
      client.init(defaultProfile);
    }

    // Save shortly after the last change; storage may be unavailable (private mode), which is fine.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      const c = currentCase();
      if (!c) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, encodeCase(c));
      } catch {
        // Not saving is acceptable.
      }
    };
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.engine === prev.engine && s.sex === prev.sex && s.heightCm === prev.heightCm) return;
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY_MS);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
      setSend(() => {});
      client.dispose();
    };
    // The default profile is read once; later changes go through commands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
