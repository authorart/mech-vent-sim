import {
  createProfileSession,
  SAMPLE,
  type Mechanics,
  type ProfileId,
  type VentSettings,
} from "@mech-vent/engine";

export interface PassiveTemplate {
  /** Time since breath start (s) and airway pressure (cmH2O) over inspiration. */
  t: number[];
  paw: number[];
}

let cache: { key: string; template: PassiveTemplate } | null = null;

/**
 * Airway pressure of one breath for this patient and these settings with no patient effort:
 * the dashed reference that makes flow starvation visible (Hess & Kacmarek fig. 15-6).
 * Simulated in the page (~50 s of engine time, a few milliseconds) and cached.
 */
export function passiveTemplate(
  profileId: ProfileId,
  settings: VentSettings,
  mechanics: Mechanics,
): PassiveTemplate {
  const key = JSON.stringify([profileId, settings, mechanics]);
  if (cache?.key === key) return cache.template;
  const s = createProfileSession(profileId, {
    settings,
    sedation: "deep",
    noiseSeed: null,
    features: {
      breathing: "regular",
      agitation: "none",
      reverseTriggering: false,
      cardiacOscillation: "off",
    },
  });
  s.setMechanics(mechanics);
  s.advance(40);
  const r = s.sim.advance(12);
  const bins: number[][] = [];
  for (const b of r.breaths) {
    for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
      const dt = r.samples[i + SAMPLE.T]! - b.startTime;
      if (dt < 0 || dt > b.inspTime) continue;
      (bins[Math.round(dt * 100)] ??= []).push(r.samples[i + SAMPLE.PAW]!);
    }
  }
  const template: PassiveTemplate = { t: [], paw: [] };
  bins.forEach((v, k) => {
    if (!v) return;
    template.t.push(k / 100);
    template.paw.push(v.reduce((a, x) => a + x, 0) / v.length);
  });
  cache = { key, template };
  return template;
}
