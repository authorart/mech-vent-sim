# P_mus is positive; PEEP_i is never set directly

These are two deliberate departures from `simulation-engine.md`:

1. That document calls P_mus a "negative deflection" but writes `P_vent + P_mus = …`. We define Muscle Pressure as a magnitude that is zero or positive, so the equation stays as written. The negative trace is a separate quantity, the Pleural Pressure Swing.
2. The obstructive profile lists "PEEP_i: 8–18 cmH2O" as if it were a setting. In the Engine, PEEP_i always comes out of the maths (tau, expiratory time, RR, Vt), and that range is only a check that the profile's default settings reproduce it. Setting PEEP_i directly would break the main lesson: lower the RR or lengthen expiration, and auto-PEEP falls.

## Amendment (M9, 2026-10-18): Expiratory Muscle Pressure (R6-Q3)

Active exhalation is modeled as a separate **Expiratory Muscle Pressure** P_exp ≥ 0, not as negative P_mus, so the sign rule above still holds. The equation of motion becomes Paw + P_mus = V/C + R·V̇ + PEEP_e + P_exp. P_exp builds when the ventilator keeps inflating after the patient's own inspiration has ended (delayed cycling, an inspiratory time set too long), up to 0.8 × the patient's current peak P_mus, with time constants of 0.15 s up and 0.2 s down. It is streamed as its own Sample channel.
