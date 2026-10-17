import type { SedationLevel } from "./drive";
import type { GasParams } from "./gas";
import { PROFILES, type ProfileId, type Sex } from "./profiles";
import type { ProfilePatch } from "./protocol";
import type { Drive, Mechanics, Mode, VentSettings } from "./types";
import type { CirculationParams } from "./vitals";

/**
 * A teaching case an instructor can share as a link (R3-Q11): the profile, any Instructor
 * Panel changes, sedation, the ventilator settings and the patient's size for PBW.
 * It holds no personal data.
 */
export interface CaseState {
  v: 1;
  profileId: ProfileId;
  settings: VentSettings;
  sedation: SedationLevel;
  sex: Sex;
  heightCm: number;
  /** Only the values that differ from the profile defaults. */
  patch: ProfilePatch;
}

const MODES: Mode[] = ["VCV", "PCV", "PSV"];
const SEDATION: SedationLevel[] = ["deep", "light", "awake"];

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeCase(c: CaseState): string {
  return toBase64Url(JSON.stringify(c));
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Keep only finite numeric fields that exist in `reference`. */
function numericSubset<T extends object>(value: unknown, reference: T): Partial<T> | undefined {
  if (!isObj(value)) return undefined;
  const out: Record<string, number> = {};
  for (const k of Object.keys(reference)) {
    const v = value[k];
    if (isNum(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? (out as Partial<T>) : undefined;
}

function validSettings(s: unknown): s is VentSettings {
  if (!isObj(s) || !MODES.includes(s.mode as Mode)) return false;
  if (![s.peep, s.fio2, s.highPressureLimit].every(isNum)) return false;
  const t = s.trigger;
  if (!isObj(t) || (t.type !== "flow" && t.type !== "pressure") || !isNum(t.threshold))
    return false;
  switch (s.mode) {
    case "VCV":
      return (
        [s.tidalVolume, s.rate, s.peakFlow, s.pauseTime].every(isNum) &&
        (s.flowPattern === "square" || s.flowPattern === "decelerating")
      );
    case "PCV":
      return [s.pInsp, s.rate, s.inspTime, s.riseTime].every(isNum);
    case "PSV": {
      const b = s.backup;
      return (
        [s.pSupport, s.riseTime, s.esens, s.apneaTime].every(isNum) &&
        isObj(b) &&
        [b.pInsp, b.rate, b.inspTime].every(isNum)
      );
    }
    default:
      return false;
  }
}

/** Parse a case link. Returns null for anything malformed or unknown, never throws. */
export function decodeCase(encoded: string): CaseState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(encoded));
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.v !== 1) return null;
  const id = raw.profileId;
  if (typeof id !== "string" || !(id in PROFILES)) return null;
  const profile = PROFILES[id as ProfileId];
  if (!validSettings(raw.settings)) return null;

  const p = isObj(raw.patch) ? raw.patch : {};
  const patch: ProfilePatch = {};
  const mechanics = numericSubset<Mechanics>(p.mechanics, profile.patient.mechanics);
  const drive = numericSubset<Drive>(p.drive, profile.patient.drive);
  const gas = numericSubset<GasParams>(p.gas, profile.gas);
  const circulation = numericSubset<CirculationParams>(p.circulation, profile.circulation);
  if (mechanics) patch.mechanics = mechanics;
  if (drive) patch.drive = drive;
  if (gas) patch.gas = gas;
  if (circulation) patch.circulation = circulation;

  return {
    v: 1,
    profileId: profile.id,
    settings: raw.settings,
    sedation: SEDATION.includes(raw.sedation as SedationLevel)
      ? (raw.sedation as SedationLevel)
      : "deep",
    sex: raw.sex === "female" ? "female" : "male",
    heightCm: isNum(raw.heightCm) ? Math.min(220, Math.max(120, raw.heightCm)) : 170,
    patch,
  };
}

/** The Instructor Panel changes relative to the profile defaults. */
export function diffFromProfile(
  profileId: ProfileId,
  current: {
    mechanics: Mechanics;
    baseDrive: Drive;
    gas: GasParams;
    circulation: CirculationParams;
  },
): ProfilePatch {
  const p = PROFILES[profileId];
  const diff = <T extends object>(cur: T, ref: T): Partial<T> | undefined => {
    const out: Partial<T> = {};
    for (const k of Object.keys(ref) as (keyof T)[]) {
      if (cur[k] !== ref[k]) out[k] = cur[k];
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const patch: ProfilePatch = {};
  const m = diff(current.mechanics, p.patient.mechanics);
  const d = diff(current.baseDrive, p.patient.drive);
  const g = diff(current.gas, p.gas);
  const c = diff(current.circulation, p.circulation);
  if (m) patch.mechanics = m;
  if (d) patch.drive = d;
  if (g) patch.gas = g;
  if (c) patch.circulation = c;
  return patch;
}
