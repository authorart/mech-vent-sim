import {
  DEFAULT_FEATURES,
  INITIAL_SETTINGS,
  settingsForMode,
  type AsynchronyKind,
  type PatientFeatures,
  type VsimvSettings,
  type PcvSettings,
  type ProfileId,
  type PsvSettings,
  type SedationLevel,
  type VentSettings,
} from "@mech-vent/engine";

/** A live example: the patient and settings that reproduce one asynchrony. */
export interface Example {
  profileId: ProfileId;
  settings: VentSettings;
  sedation: SedationLevel;
  features: PatientFeatures;
  /** What to look at once it is running. */
  watch: string;
  /** Overlay the same breath with no patient effort (dashed), shading the patient's work. */
  comparePassive?: boolean;
  /** Show the patient's effort (esophageal pressure) and label breaths by type, not asynchrony. */
  showEffort?: boolean;
  /** Seconds shown (default 8). */
  seconds?: number;
}

/** The classified asynchronies, plus mode asynchrony (SIMV), which is a pattern, not a breath. */
export type GuideKind = AsynchronyKind | "modeAsynchrony";

export interface GuideEntry {
  kind: GuideKind;
  title: string;
  /** Short label drawn on the waveforms. */
  label: string;
  family: "Trigger" | "Flow" | "Cycle" | "Mode";
  summary: string;
  recognize: string[];
  why: string[];
  fix: string[];
  source: string;
  example: Example;
}

const psv = (o: Partial<PsvSettings>): PsvSettings => ({
  ...(settingsForMode("PSV", INITIAL_SETTINGS) as PsvSettings),
  ...o,
});
const pcv = (o: Partial<PcvSettings>): PcvSettings => ({
  ...(settingsForMode("PCV", INITIAL_SETTINGS) as PcvSettings),
  ...o,
});
const vsimv = (o: Partial<VsimvSettings>): VsimvSettings => ({
  ...(settingsForMode("V-SIMV", INITIAL_SETTINGS) as VsimvSettings),
  ...o,
});
const features = (o: Partial<PatientFeatures> = {}): PatientFeatures => ({
  ...DEFAULT_FEATURES,
  ...o,
});

/**
 * Asynchrony Guide (M12, R6-Q13). Summarized from Hess DR, Kacmarek RM. Essentials of Mechanical
 * Ventilation, 3rd ed. (2014), mainly chapter 15, with chapters 7, 9, 18 and 31.
 */
export const GUIDE: GuideEntry[] = [
  {
    kind: "ineffectiveTrigger",
    title: "Ineffective trigger",
    label: "Ineffective",
    family: "Trigger",
    summary: "The patient tries to breathe in, but the ventilator never notices, so no breath comes.",
    recognize: [
      "A small upward notch in the expiratory flow (flow moves toward zero) with no breath after it.",
      "A small dip in airway pressure during expiration without a triggered breath.",
      "The patient's own rate (chest movement, esophageal pressure) is higher than the ventilator's rate.",
      "Expiratory flow often hasn't returned to zero before the next breath: a sign of intrinsic PEEP.",
    ],
    why: [
      "Most often intrinsic PEEP: the patient must first pull alveolar pressure down by the whole PEEP_i before flow or pressure at the airway changes. Weak efforts can't.",
      "A trigger set too insensitive, or weak respiratory muscles.",
      "Too much support (big breaths, long inspiratory time) adds air trapping and lowers drive, making it worse.",
    ],
    fix: [
      "Reduce PEEP_i: lower the rate or tidal volume, shorten inspiratory time, treat bronchospasm and secretions.",
      "In COPD with flow limitation, add external PEEP up to about 80% of PEEP_i to counterbalance it. In asthma this usually doesn't help.",
      "Make the trigger as sensitive as possible without autotriggering.",
      "Avoid over-support (too high pressure support or too long Ti).",
    ],
    source: "Ch. 15 (trigger asynchrony, fig. 15-3, 15-4), ch. 18, ch. 31 (fig. 31-4)",
    example: {
      profileId: "copd",
      settings: INITIAL_SETTINGS,
      sedation: "awake",
      features: features(),
      watch:
        "Watch expiration: notches in the flow trace with no breath after them. Then raise PEEP toward 8 and see the efforts start triggering.",
    },
  },
  {
    kind: "autoTrigger",
    title: "Autotrigger",
    label: "Auto",
    family: "Trigger",
    summary: "The ventilator delivers breaths the patient didn't ask for, set off by something else.",
    recognize: [
      "The total rate is higher than the set rate even in a deeply sedated or apneic patient.",
      "Triggered breaths start without any dip in pressure or effort before them.",
      "A regular ripple in the flow trace at the heart rate (cardiogenic oscillation), or a leak.",
    ],
    why: [
      "The trigger is so sensitive that an artifact crosses it: the heart beating against the lungs (4–6 L/min of flow at the airway), a circuit leak, or water sloshing in the tubing.",
    ],
    fix: [
      "Make the trigger less sensitive (for example flow trigger 2 → 8 L/min).",
      "Fix leaks and drain water from the circuit.",
      "Leak compensation helps during noninvasive ventilation.",
    ],
    source: "Ch. 15 (fig. 15-2)",
    example: {
      profileId: "normal",
      settings: INITIAL_SETTINGS,
      sedation: "deep",
      features: features({ cardiacOscillation: "strong" }),
      watch:
        "Set rate 16, but the total rate is about 25 in a sedated patient. Raise the flow trigger to 8 L/min and the extra breaths stop.",
    },
  },
  {
    kind: "reverseTrigger",
    title: "Reverse trigger",
    label: "Reverse",
    family: "Trigger",
    summary: "A machine breath sets off a patient effort, instead of the patient setting off the breath.",
    recognize: [
      "In a deeply sedated patient on mandatory breaths, a patient effort appears late in, or just after, each machine breath.",
      "A dent in the expiratory flow, or a second breath stacked straight after the first (breath stacking).",
      "On esophageal pressure: a negative swing that starts after the ventilator breath starts.",
    ],
    why: [
      "The passive inflation entrains the patient's breathing rhythm (neuromechanical coupling), often in deep sedation.",
      "Breath stacking can double the tidal volume and raise lung stress.",
    ],
    fix: [
      "Recognize it: it is easy to mistake for a normal triggered breath.",
      "Review the depth of sedation and the set rate and inspiratory time; managing it depends on the clinical situation.",
    ],
    source: "Ch. 15 (fig. 15-5)",
    example: {
      profileId: "normal",
      settings: INITIAL_SETTINGS,
      sedation: "deep",
      features: features({ reverseTriggering: true }),
      watch:
        "Each machine breath is followed by a second, patient-triggered breath before exhalation finishes. Try the same with the ARDS profile: there the effort only dents the expiratory flow.",
    },
  },
  {
    kind: "doubleTrigger",
    title: "Double trigger",
    label: "Double",
    family: "Cycle",
    summary: "One patient effort gets two ventilator breaths, because it outlasts the first one.",
    recognize: [
      "Two breaths back to back with little or no exhalation between them.",
      "In volume control the exhaled volume of the pair can be about twice the set tidal volume (stacking).",
    ],
    why: [
      "The ventilator's inspiration ends before the patient's (premature cycling) and the effort is still strong enough to trigger again.",
      "Common with a short inspiratory time, a high Esens, or low tidal volumes in a patient with high drive.",
    ],
    fix: [
      "Lengthen inspiration: lower the peak flow or use a decelerating ramp in VCV, add an inspiratory pause, set a longer Ti in PCV, lower Esens in PSV.",
      "If plateau pressure allows, a slightly larger tidal volume (up to 8 mL/kg PBW).",
      "Treat the high drive: pain, anxiety, acidosis; sedation if needed.",
    ],
    source: "Ch. 15 (cycle asynchrony, table 15-1)",
    example: {
      profileId: "normal",
      settings: psv({ esens: 0.7 }),
      sedation: "awake",
      features: features(),
      watch:
        "Esens is 70%, so each breath ends early and the effort triggers a second one. Lower Esens to 25% and the pairs disappear.",
    },
  },
  {
    kind: "flowStarvation",
    title: "Flow starvation",
    label: "Starved",
    family: "Flow",
    summary: "The ventilator gives less flow than the patient wants, so the patient works against it.",
    recognize: [
      "VCV (fixed flow): the pressure rise caves in (scooped, concave) instead of climbing in a straight line, then curves up toward the end of the breath.",
      "Compare with a passive breath at the same settings (dashed line in the example): the gap between the two is the patient's work against the ventilator.",
      "The scoop changes from breath to breath with the patient's effort; in severe cases pressure falls below PEEP early in the breath.",
      "Pressure modes: a slow, concave rise that sags below the set pressure early in the breath. Clinically: fast breathing, retractions, chest–abdominal paradox.",
    ],
    why: [
      "In VCV the flow is fixed by the settings; when the patient's demand is higher, the extra effort can't get more gas and shows up as lower airway pressure.",
      "In PCV/PSV a rise time that is too slow for the demand.",
      "It adds work of breathing (Marini: lowering flow from 82 to 40 L/min raised work by more than 50%) and can lead to double triggering.",
    ],
    fix: [
      "Raise the peak flow so it meets the demand (note: this shortens Ti and can cause double triggering), or use a decelerating ramp.",
      "Switch to PCV or PSV, where flow follows demand; shorten the rise time.",
      "Treat the cause of high demand (hypoxemia, acidosis, pain, anxiety).",
    ],
    source: "Ch. 15 (flow asynchrony, fig. 15-6), ch. 7, ch. 31 (fig. 31-1)",
    example: {
      profileId: "ards",
      settings: { ...INITIAL_SETTINGS, peakFlow: 40 / 60, tidalVolume: 0.4 },
      sedation: "awake",
      features: features({ agitation: "moderate" }),
      comparePassive: true,
      watch:
        "An awake, agitated ARDS patient on VCV with peak flow 40 L/min: the pressure stalls and sags mid-breath, below where a passive breath would be. Raise the flow to 80 L/min, or switch to PCV, and the pressure rise straightens out.",
    },
  },
  {
    kind: "prematureCycling",
    title: "Premature cycling",
    label: "Early cycle",
    family: "Cycle",
    summary: "The ventilator ends inspiration while the patient is still breathing in.",
    recognize: [
      "Right after the breath ends, expiratory flow is pulled back toward zero (or above it) by the continuing effort.",
      "Often followed by a double trigger.",
    ],
    why: [
      "Inspiratory time set shorter than the patient's own (VCV with high flow, short PCV Ti).",
      "In PSV: low compliance makes flow fall to Esens quickly; a high Esens does the same.",
    ],
    fix: [
      "Lengthen Ti (VCV: lower flow, decelerating ramp, pause; PCV: longer Ti).",
      "PSV: lower Esens.",
    ],
    source: "Ch. 15 (fig. 15-8), ch. 9",
    example: {
      profileId: "ards",
      settings: pcv({ inspTime: 0.4, rate: 20 }),
      sedation: "light",
      features: features(),
      watch: "PCV Ti 0.4 s: expiratory flow is pulled up right after each breath ends. Lengthen Ti to 0.8 s.",
    },
  },
  {
    kind: "delayedCycling",
    title: "Delayed cycling",
    label: "Late cycle",
    family: "Cycle",
    summary: "The ventilator keeps inflating after the patient has finished breathing in.",
    recognize: [
      "A pressure spike above the set level at the end of a pressure-support breath (the patient pushing out), often ending the breath on pressure.",
      "In PCV with a long Ti, flow reverses during inspiration while pressure is still held.",
      "Expiratory muscle activity (felt on the abdomen); air trapping and missed triggers in COPD.",
    ],
    why: [
      "PSV in COPD: high compliance and resistance make flow fall slowly, so Esens is reached late.",
      "Inspiratory time set too long; leaks that stop flow from ever reaching Esens.",
    ],
    fix: [
      "PSV: raise Esens, lower the pressure support, or switch to PCV (time-cycled).",
      "Shorten the set inspiratory time.",
      "Look for leaks.",
    ],
    source: "Ch. 15 (fig. 15-9), ch. 7 (fig. 7-1), ch. 18",
    example: {
      profileId: "normal",
      settings: pcv({ inspTime: 2 }),
      sedation: "awake",
      features: features(),
      watch:
        "PCV Ti 2 s: the patient pushes back near the end, so flow turns negative while pressure is still held. Shorten Ti to 1 s.",
    },
  },
  {
    kind: "modeAsynchrony",
    title: "Mode asynchrony",
    label: "Mode",
    family: "Mode",
    summary:
      "In SIMV the patient often works as hard on the mandatory breaths as on the spontaneous ones, so the mandatory breaths don't rest them.",
    recognize: [
      "SIMV: big mandatory breaths at the set rate, smaller spontaneous breaths in between.",
      "On esophageal pressure, the dip (the patient's effort) on a mandatory breath is nearly as deep as on the spontaneous breaths.",
      "A patient-triggered V-SIMV breath may show a scooped pressure rise (flow starvation): the patient keeps pulling during it.",
      "Fast, small spontaneous breaths when the pressure support is low.",
    ],
    why: [
      "The patient's drive doesn't change from breath to breath with the breath type, so the effort is about the same for both.",
      "SIMV was meant to share the work: the ventilator does the mandatory breaths, the patient the spontaneous ones. This often doesn't happen, particularly at a low SIMV rate.",
      "At a low SIMV rate most breaths are spontaneous, so total support is low and the drive stays high, during the mandatory breaths too.",
    ],
    fix: [
      "Give enough support: raise the SIMV rate, and set the pressure support so the spontaneous breaths are supported properly.",
      "Or choose a mode where every breath is the same type: VCV or PCV (assist-control) for full support, PSV for partial support.",
      "Treat what drives the demand (hypoxemia, acidosis, pain, anxiety).",
    ],
    source: "Ch. 6 (SIMV, fig. 6-6 to 6-8), ch. 15 (mode asynchrony, fig. 15-10)",
    example: {
      profileId: "cardiogenicEdema",
      settings: vsimv({ rate: 6 }),
      sedation: "awake",
      features: features(),
      showEffort: true,
      seconds: 12,
      watch:
        "V-SIMV rate 6, PS 5, in a breathless patient, with the esophageal pressure shown as the 4th trace: its dip on the mandatory breath is nearly as deep as on the spontaneous ones. Then switch to VCV, where every breath is a mandatory breath.",
    },
  },
];

export const GUIDE_BY_KIND = Object.fromEntries(GUIDE.map((g) => [g.kind, g])) as Record<
  GuideKind,
  GuideEntry
>;
