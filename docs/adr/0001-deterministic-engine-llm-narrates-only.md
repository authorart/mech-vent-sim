# Deterministic engine; the LLM only narrates

`simulation-engine.md` is written as an LLM system prompt, but it is treated as the **specification for a deterministic Engine** (code), not as a prompt. Every waveform, Breath Metric and blood-gas value comes from code. The LLM layer (scenario generation, instructor feedback, debriefs) reads Engine output and never produces simulated numbers. We chose this because an LLM can't reliably produce 100 Hz signals that obey the equation of motion, can't do it at real-time rates, and can't be tested against formulas the way code can.
