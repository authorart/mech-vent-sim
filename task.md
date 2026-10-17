# MedVent Simulator: Task Tracker

Source specs: [simulation-engine.md](./simulation-engine.md) (the Engine spec) · [Recommended-Simulator-Architecture.md](./Recommended-Simulator-Architecture.md) (stack)
Domain language: [GLOSSARY.md](./GLOSSARY.md) · Decisions: [docs/adr/](./docs/adr/)

**Status:** 🟢 Design confirmed 2026-10-17. V1 implementation in progress. Repo: https://github.com/authorart/mech-vent-sim

---

## Phase 0: Design grilling

### Round 1 ✅ (2026-10-17)

| # | Decision | Outcome |
| --- | --- | --- |
| R1-Q1 | Who computes the waveforms | Deterministic Engine (code). The LLM only narrates → ADR-0001 |
| R1-Q2 | Audience and accuracy | Teaching MVP (students, residents, RTs, ICU nurses), built so advanced training can be added. "Not for clinical use" |
| R1-Q3 | How the simulation runs | Continuous, stateful real-time loop streaming Samples. Breath Metrics measured from each completed Breath |
| R1-Q4 | PEEP_i | Always calculated, never set. The spec's ranges are checks → ADR-0002 |
| R1-Q5 | Sign of P_mus | Magnitude ≥ 0 in the equation of motion. The negative trace is the Pleural Pressure Swing → ADR-0002 |
| R1-Q6 | MVP scope | VCV, PCV, PSV + Normal, ARDS, Obstructive, Metabolic acidosis, Cardiogenic edema, PE, Apnea. Tension pneumothorax waits for Scenario Events |
| R1-Q7 | Disease registry structure | Patient Profile (a state) and Scenario Event (a change during the session) are separate. Scenario = Profile + Event timeline |
| R1-Q8 | Turning ranges into numbers | Middle of the range by default, instructor can adjust. Seeded random picking later |
| R1-Q9 | UI language | English now, built so other languages can be added |
| R1-Q10 | Faceplate look | Generic, brand-neutral |

### Round 2 ✅ (2026-10-17)

| # | Decision | Outcome |
| --- | --- | --- |
| R2-Q1 | Lung model | One compartment, linear R and C, behind a pluggable lung interface (curved compliance or two compartments later). ⚠ Revisited in R3-Q1 |
| R2-Q2 | Solver | RK4 at 1 kHz internally, Samples sent out at 100 Hz |
| R2-Q3 | Patient effort model | P_mus shape with its own neural clock (neural RR, amplitude, inspiratory fraction, rise/relax) |
| R2-Q4 | Ventilator behavior | Flow or pressure trigger, settable rise time, square/decelerating flow in VCV + inspiratory pause, PSV cycle-off by Esens, 50–100 ms trigger delay |
| R2-Q5 | Blood gases | Calculated values that move toward a target: PaCO2 τ 2–3 min; PaO2 via alveolar gas equation + shunt mixing, τ 30–60 s; pH by Henderson–Hasselbalch; EtCO2 via alveolar dead space; fast-forward button |
| R2-Q6 | Driving Pressure | P_plat − Total PEEP (Total PEEP measured with an Expiratory Hold) |
| R2-Q7 | PBW | ARDSNet formula from height and sex. Default Vt 6 mL/kg (ARDS) or 8 mL/kg (others). Profile mechanics are for a 70 kg adult, not scaled |
| R2-Q8 | Alarms | Settable limits (defaults from the spec) + low/high Vte, low/high MV, high RR, disconnection. Priority levels, 2-min silence, high pressure limit ends inspiration. PSV apnea (20 s) → Apnea Backup in PCV |
| R2-Q9 | Physics language | Pure TypeScript engine package (no browser dependencies), run in a Web Worker |
| R2-Q10 | Framework and deployment | Next.js App Router + Tailwind on Vercel. Monorepo with `packages/engine` and `apps/web` |
| R2-Q11 | Rendering | Canvas 2D sweep mode, 3 traces + P–V and F–V loops |
| R2-Q12 | LLM layer | Phase 2. Claude via the Anthropic SDK, server only. MVP is deterministic and works offline |
| R2-Q13 | Proving the physics | Tests against exact formulas, each profile's signature, and clinical cause-and-effect. You are the clinical reviewer of the default numbers |

### Round 3 ✅ (2026-10-17, "for V1")

| # | Decision | Outcome |
| --- | --- | --- |
| R3-Q1 | Resistance | Separate R_insp and R_exp (R_exp ≈ 2.2× R_insp in obstructive profiles) → ADR-0003 |
| R3-Q2 | Starting settings | Same generic post-intubation Initial Settings for every profile in V1: VCV, Vt 500, RR 16, PEEP 5, FiO2 1.0, 60 L/min square |
| R3-Q3 | Profile numbers | The table below. Asthma and COPD are separate profiles. ARDS shunt is 45% |
| R3-Q4 | Recruitment | S-shaped shunt-vs-PEEP curve per profile (recruitable fraction, half-recruitment PEEP). Compliance stays fixed in V1 |
| R3-Q5 | Vital signs | SpO2 from the dissociation curve. HR/BP fixed per profile, plus a rule that P_mean or PEEP_i lowers BP |
| R3-Q6 | Data contract | Worker → UI: Sample batches (~16 ms, Float32Array), BreathMetrics, alarm events, gas/vitals at 1 Hz. UI → Worker commands as proposed |
| R3-Q7 | Applying settings | Turn → pending → confirm, takes effect at the next breath. A mode change opens a dialog. Instructor changes apply immediately |
| R3-Q8 | Instructor features in V1 | Live Instructor Panel in V1. Scenario Events, pneumothorax and the LLM in V2 |
| R3-Q9 | Time controls | Freeze with a measuring cursor. Fast-forward only speeds up blood gases |
| R3-Q10 | Monitor numbers | The full list proposed in R3-Q10 |
| R3-Q11 | Saving and sharing | No accounts. Last session in localStorage. A shareable case URL |
| R3-Q12 | Devices | Desktop and tablet landscape (≥1024 px). Phones are view-only |

#### V1 Patient Profile defaults (clinically reviewed by you, 2026-10-17)

| Profile | C_rs | R_insp / R_exp | VCO2 | Vd/Vt | Shunt | HCO3⁻ | Neural RR / P_mus |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Normal | 60 | 5 / 5 | 200 | 0.30 | 5% | 24 | 14 / 5 |
| ARDS | 20 | 8 / 8 | 220 | 0.55 | 45% | 22 | 28 / 8 |
| Status asthmaticus | 45 | 25 / 55 | 220 | 0.45 | 8% | 24 | 24 / 10 |
| COPD exacerbation | 80 | 20 / 50 | 200 | 0.50 | 8% | 32 | 20 / 8 |
| Metabolic acidosis | 60 | 4 / 4 | 280 | 0.30 | 5% | 8 | 32 / 20 |
| Cardiogenic edema | 30 | 11 / 11 | 220 | 0.35 | 25% | 22 | 26 / 10 |
| Massive PE | 52 | 4.5 / 4.5 | 220 | 0.65 | 10% | 22 | 24 / 8 |
| Central apnea | 60 | 5 / 5 | 180 | 0.30 | 5% | 24 | 0 / 0 |

Units: mL/cmH2O · cmH2O/(L/s) · mL/min · mmol/L · breaths/min / cmH2O. Still to set during M4: HR/BP per profile, recruitment settings, anatomic dead space (0.25 assumed).

### Defaults I'm assuming (not asked, tell me if any are wrong)

- Tooling: `git init` (branch `main`, no remote yet), pnpm workspaces, Node LTS, TypeScript strict, Vitest, ESLint + Prettier
- Libraries: current stable Next.js / React / Tailwind, Zustand for UI state
- Internal units: L, L/s, cmH2O, s. The UI shows mL and L/min
- Layout: alarm banner across the top · 3 sweep traces (P/F/V) in the middle-left · numbers in a right column · settings strip along the bottom · loops and blood gases in tabs or panels · "Education only, not for clinical use" always visible
- No analytics or telemetry in V1

### Exit criteria

- [x] All design questions answered (3 rounds)
- [x] You confirmed we understand the design the same way and approved the V1 plan (2026-10-17)

---

## V1 implementation plan

Each milestone ends with its tests passing and an update here.

- [x] **M1 Scaffold**: git init, pnpm monorepo (`packages/engine`, `apps/web`), TS/ESLint/Prettier/Vitest, an empty Next.js app with the disclaimer. _Done 2026-10-17: Next.js 16.4 / React 19.3 / Tailwind 4, pnpm 9 via corepack; test, typecheck, lint and build all pass._
- [ ] **M2 Engine core**: lung model (C, R_insp, R_exp) behind an interface · RK4 at 1 kHz, Samples sent out at 100 Hz · P_mus generator with its own neural clock · VCV (square/decelerating, pause), PCV (rise time), PSV (Esens) · flow/pressure trigger with delay · breath detection
- [ ] **M3 Measurements and alarms**: BreathMetrics · Inspiratory Pause and Expiratory Hold · C_stat/R_aw · alarm engine (settable limits, priority levels, silence, high pressure ends inspiration) · Apnea Backup
- [ ] **M4 Blood gases and vitals**: PaCO2/PaO2 (shunt mixing)/pH/EtCO2 moving toward targets over time · recruitment curve · SpO2 · BP rule · fast-forward
- [ ] **M5 Profiles**: the 8 Patient Profiles + Initial Settings + PBW · **signature tests** (exact formulas, each profile's signature, clinical cause-and-effect)
- [ ] **M6 Worker and contract**: Web Worker host, typed versioned messages, Float32Array batching
- [ ] **M7 UI**: Canvas sweep traces + loops · numbers · settings strip with confirm · mode-change dialog · alarm banner · Instructor Panel · freeze and cursor · gas/vitals panel · i18n scaffold
- [ ] **M8 Polish and ship**: shareable case URL, localStorage, view-only phone layout, **your clinical review session**, deploy to Vercel

### V2 backlog

Scenario Events + Scenario timeline · tension pneumothorax (and circulation response) · LLM layer (Claude: Scenario generation, instructor feedback, debrief) · curved compliance / two compartments · seeded random profile values · accounts and saved Scenarios · Thai localization
