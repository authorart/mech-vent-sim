"use client";

import {
  decodeCase,
  diffFromProfile,
  encodeCase,
  INITIAL_SETTINGS,
  PROFILES,
  type CaseState,
  type ProfileId,
} from "@mech-vent/engine";
import { useEffect } from "react";
import { EngineClient } from "./client";
import { useStore } from "./store";

const STORAGE_KEY = "medvent:last-case";
const SAVE_DELAY_MS = 500;

function linkedCase(): CaseState | null {
  const hash = new URLSearchParams(window.location.hash.slice(1)).get("case");
  return hash ? decodeCase(hash) : null;
}

function savedCase(): CaseState | null {
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

/** True for a case nobody has touched yet: nothing worth remembering. */
function isUntouchedDefault(c: CaseState, defaultProfile: ProfileId): boolean {
  return (
    c.profileId === defaultProfile &&
    c.sedation === PROFILES[defaultProfile].startSedation &&
    Object.keys(c.patch).length === 0 &&
    JSON.stringify(c.settings) === JSON.stringify(INITIAL_SETTINGS)
  );
}

/** Load a case into the running Engine (used by "Resume last case"). */
export function loadCase(c: CaseState): void {
  const { send, setPatientSize } = useStore.getState();
  setPatientSize(c.sex, c.heightCm);
  send({ type: "loadProfile", profileId: c.profileId, settings: c.settings });
  send({ type: "setSedation", level: c.sedation });
  if (Object.keys(c.patch).length > 0) send({ type: "setProfileParam", patch: c.patch });
}

/**
 * Start the Engine Worker once and connect it to the store. The app opens on the default
 * profile, or on a shared case link. A remembered session is offered, never forced.
 */
export function useEngine(defaultProfile: ProfileId): void {
  useEffect(() => {
    const { receive, setSend, setPatientSize } = useStore.getState();
    const client = new EngineClient(receive);
    setSend((cmd) => client.send(cmd));

    const linked = linkedCase();
    if (linked) {
      setPatientSize(linked.sex, linked.heightCm);
      client.init(linked.profileId, linked.settings, linked.sedation);
      if (Object.keys(linked.patch).length > 0) {
        client.send({ type: "setProfileParam", patch: linked.patch });
      }
    } else {
      client.init(defaultProfile);
      const saved = savedCase();
      if (saved && !isUntouchedDefault(saved, defaultProfile)) {
        useStore.setState({ resumable: saved });
      }
    }

    // Save shortly after the last change; storage may be unavailable (private mode), which is fine.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      const c = currentCase();
      if (!c || isUntouchedDefault(c, defaultProfile)) return;
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
