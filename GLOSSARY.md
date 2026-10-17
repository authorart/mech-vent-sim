# MedVent Simulator

A simulator for teaching mechanical ventilation. Learners change ventilator settings on a simulated patient and watch waveforms, numbers, blood gases and alarms respond the way physiology says they should. For education only. Not for clinical use.

## Simulation

**Engine**:
The deterministic physiological model that produces every waveform, breath metric and blood-gas value. It is the only source of truth for simulated numbers.
_Avoid_: MedVent Engine (when meaning the LLM), AI, model

**Sample**:
One moment of simulated state: time, airway pressure, flow and volume.
_Avoid_: point, frame, tick

**Breath**:
One ventilator or patient cycle, from the start of inspiration to the start of the next inspiration.
_Avoid_: cycle (unqualified)

**Breath Metrics**:
The numbers measured from one completed Breath (P_peak, P_plat, Driving Pressure, PEEP_i, P_mean, Vt, V_E).
_Avoid_: vitals, readings

## Patient

**Patient Profile**:
The starting condition of a simulated patient: respiratory mechanics, gas-exchange defects and respiratory drive. It describes a state, not something that happens.
_Avoid_: disease, disease state, case

**Normal Profile**:
The Patient Profile with healthy adult mechanics, gas exchange and drive. It is the baseline every other profile is compared against.
_Avoid_: healthy patient, default

**Scenario Event**:
A change applied to a running patient at a set time or when a condition is met, e.g. tension pneumothorax, bronchospasm, the tube coming out.
_Avoid_: complication, disease (for transient changes)

**Initial Settings**:
The ventilator settings at the start of a session, before the learner changes anything. They are separate from the Patient Profile, so the same patient can start on settings that are wrong.
_Avoid_: default settings, presets

**Instructor Panel**:
The controls an instructor uses to change Patient Profile values while the patient is running.
_Avoid_: admin panel, god mode

**Scenario**:
A Patient Profile plus a timeline of Scenario Events, making up one teaching case.
_Avoid_: case, exercise, simulation

## Mechanics

**Muscle Pressure (P_mus)**:
The size of the patient's inspiratory effort, expressed as pressure. It is always zero or positive and helps inflate the lungs in the equation of motion.
_Avoid_: negative P_mus, patient pressure

**Pleural Pressure Swing**:
The drop in pleural (esophageal) pressure the patient's effort causes. It is shown as a negative deflection. It is the measured sign of Muscle Pressure, not the same quantity.
_Avoid_: P_mus (when meaning the negative trace)

**Extrinsic PEEP (PEEP_e)**:
The end-expiratory pressure set on the ventilator.
_Avoid_: PEEP (when PEEP_i might also be meant)

**Intrinsic PEEP (PEEP_i)**:
Alveolar pressure left above PEEP_e at end-expiration because the lungs didn't finish emptying. It always comes out of the mechanics and timing. It is never set directly.
_Avoid_: set auto-PEEP

**Total PEEP**:
PEEP_e plus PEEP_i.

**Inspiratory Resistance (R_insp)**:
Resistance to gas flowing in. It sets the gap between P_peak and P_plat.
_Avoid_: R_aw (when the direction matters)

**Expiratory Resistance (R_exp)**:
Resistance to gas flowing out. It is higher than R_insp in obstructive disease because the airways collapse during expiration. It sets how fast the lungs empty and so PEEP_i.

**Recruitment**:
Collapsed or flooded alveoli reopening as PEEP rises, which lowers shunt.
_Avoid_: lung opening

**Time Constant (tau)**:
The product of resistance and compliance. It sets how fast the lungs fill and empty.

**Predicted Body Weight (PBW)**:
A body weight estimated from height and sex. Tidal volumes are expressed per kg of PBW.
_Avoid_: IBW, ideal body weight, actual weight

**Expiratory Hold**:
Briefly closing the circuit at end-expiration so alveolar and airway pressure equalize. This is how Total PEEP, and so PEEP_i, is measured.

**Inspiratory Pause**:
Holding inspiration at end-inspiration with no flow. P_plat is read during this pause.

**Sedation Level**:
How much of the patient's own respiratory drive is allowed through: deep (none), light (half), awake (full). Patients start deeply sedated.
_Avoid_: paralysis (that's a different thing), consciousness

**Chemoreflex**:
The patient's drive rising as arterial pH falls and fading as pH rises, so drive stops near the apneic threshold.
_Avoid_: CO2 response, feedback

## Patient–ventilator interaction

**Trigger**:
The ventilator detecting the patient's effort, by a drop in flow or pressure, and starting a breath.
_Avoid_: initiation

**Ineffective Trigger**:
A patient effort that doesn't reach the trigger threshold, so no breath is delivered. Usually happens because the effort first has to overcome PEEP_i.
_Avoid_: missed breath, wasted effort

**Double Trigger**:
Two ventilator breaths delivered for a single patient effort, because the effort outlasts the ventilator's inspiratory time.
_Avoid_: breath stacking (that's a different thing)

**Flow Starvation**:
The patient demanding more flow than a volume-controlled breath delivers. It shows as a scooped-out airway pressure trace.
_Avoid_: air hunger (that's a symptom, not a waveform)

**Expiratory Sensitivity (Esens)**:
The fraction of peak inspiratory flow at which a pressure-support breath cycles to expiration.
_Avoid_: cycle-off %, ETS

**Apnea Backup**:
The mandatory ventilation that takes over automatically when no breath has occurred within the apnea time during a spontaneous mode.
_Avoid_: backup mode, rescue

## Measured values

**Driving Pressure**:
P_plat minus Total PEEP: the pressure needed to deliver the tidal volume against the compliance of the respiratory system.
_Avoid_: delta-P (that's for the set pressure above PEEP in PCV/PSV), P_insp
