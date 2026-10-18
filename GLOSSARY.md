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

**Expiratory Muscle Pressure (P_exp)**:
The patient pushing gas out with the expiratory muscles, as pressure. Always zero or positive, kept separate from Muscle Pressure. It appears when the ventilator keeps inflating after the patient has stopped breathing in.
_Avoid_: negative P_mus, active P_mus

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

**Breathing Pattern**:
Whether the patient's efforts vary breath to breath (natural, with occasional sighs) or repeat identically (regular, for demonstrations).
_Avoid_: noise, randomness

**Sigh**:
An occasional deeper and longer effort, followed by a longer pause, that is part of natural breathing.
_Avoid_: yawn, recruitment breath

**Agitation**:
Pain, anxiety or delirium raising the patient's drive and making the pattern more irregular, while the patient is not deeply sedated.
_Avoid_: fighting the ventilator

**Chemoreflex**:
The patient's drive rising as arterial pH falls and fading as pH rises. The chemical part of drive stops near the apneic threshold.
_Avoid_: CO2 response, feedback

**Wakefulness Drive**:
The drive to breathe that an awake (or lightly sedated) patient keeps even when alkalemic. It sets a floor under the Chemoreflex; losing it in sleep or deep sedation is what lets apnea happen.
_Avoid_: baseline drive

## Patient–ventilator interaction

**Asynchrony**:
Any mismatch between the patient's neural breathing and what the ventilator delivers. Its types are Trigger, Flow, Cycle and Mode Asynchrony.
_Avoid_: dyssynchrony, fighting the ventilator

**Bias Flow**:
The small continuous flow through the circuit between breaths when flow triggering. The patient can draw on it; pulling harder than it supplies drops airway pressure.
_Avoid_: flow-by, base flow

**Trigger**:
The ventilator detecting the patient's effort, by a drop in flow or pressure, and starting a breath.
_Avoid_: initiation

**Ineffective Trigger**:
A patient effort that doesn't reach the trigger threshold, so no breath is delivered. Usually happens because the effort first has to overcome PEEP_i.
_Avoid_: missed breath, wasted effort

**Double Trigger**:
Two ventilator breaths delivered for a single patient effort, because the effort outlasts the ventilator's inspiratory time.
_Avoid_: breath stacking (that's a different thing)

**Reverse Trigger**:
A patient effort set off by a passive machine breath rather than the other way round, typically in a deeply sedated patient. It can trigger a second, stacked breath.
_Avoid_: entrainment (that's the mechanism), backward trigger

**Delayed Cycling**:
The ventilator's inspiration lasting beyond the patient's own; the patient pushes back (Expiratory Muscle Pressure). In PSV it comes from a long time constant or an Esens set too low.
_Avoid_: late cycling, prolonged Ti

**Premature Cycling**:
The ventilator's inspiration ending before the patient's; the continuing effort can cause a Double Trigger.
_Avoid_: early cycling, short cycling

**Autotrigger**:
A breath triggered by something other than patient effort, such as the heartbeat's ripple in the flow signal or a leak.
_Avoid_: false trigger, self-cycling

**Cardiogenic Oscillation**:
The small ripple in airway flow and pressure at the heart rate, from the heart beating against the lungs.
_Avoid_: cardiac artifact, heart noise

**Rise Time**:
How quickly a pressure-control or pressure-support breath reaches its set pressure. Too fast overshoots the set pressure; too slow against a strong pull gives a concave, sagging rise.
_Avoid_: slope, ramp

**Pressure Cycling**:
A pressure-support breath ending because airway pressure climbed a few cmH2O above the set level, usually because the patient pushed against it.
_Avoid_: pressure limit (that's the high-pressure alarm), pop-off

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
