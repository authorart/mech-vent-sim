# P_mus is positive; PEEP_i is never set directly

These are two deliberate departures from `simulation-engine.md`:

1. That document calls P_mus a "negative deflection" but writes `P_vent + P_mus = …`. We define Muscle Pressure as a magnitude that is zero or positive, so the equation stays as written. The negative trace is a separate quantity, the Pleural Pressure Swing.
2. The obstructive profile lists "PEEP_i: 8–18 cmH2O" as if it were a setting. In the Engine, PEEP_i always comes out of the maths (tau, expiratory time, RR, Vt), and that range is only a check that the profile's default settings reproduce it. Setting PEEP_i directly would break the main lesson: lower the RR or lengthen expiration, and auto-PEEP falls.
