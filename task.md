# MedVent Simulator: Task Tracker

Source specs: [simulation-engine.md](./simulation-engine.md) (the Engine spec) · [Recommended-Simulator-Architecture.md](./Recommended-Simulator-Architecture.md) (stack)
Domain language: [GLOSSARY.md](./GLOSSARY.md) · Decisions: [docs/adr/](./docs/adr/)

**Status:** ✅ V1 prototype complete 2026-10-17. Live at https://mech-vent-sim.vercel.app. Next: the V2 backlog (needs a design round first). Repo: https://github.com/authorart/mech-vent-sim

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
| Status asthmaticus | 45 | 25 / **90** | 220 | 0.45 | 8% | 24 | 24 / 10 |
| COPD exacerbation | 80 | 20 / **75** | 200 | 0.50 | 8% | 32 | 20 / 8 |
| Metabolic acidosis | 60 | 4 / 4 | 280 | 0.30 | 5% | 8 | 32 / 20 |
| Cardiogenic edema | 30 | 11 / 11 | 220 | 0.35 | 25% | 22 | 26 / 10 |
| Massive PE | 52 | 4.5 / 4.5 | 220 | 0.65 | 10% | 22 | 24 / 8 |
| Central apnea | 60 | 5 / 5 | 180 | 0.30 | 5% | 24 | 0 / 0 |

Units: mL/cmH2O · cmH2O/(L/s) · mL/min · mmol/L · breaths/min / cmH2O. Still to set during M4: HR/BP per profile, recruitment settings, anatomic dead space (0.25 assumed).

### Round 4 ✅ (2026-10-17, raised during M5)

| # | Decision | Outcome |
| --- | --- | --- |
| R4-Q1 | Starting drive | Patients start **deeply sedated** (drive 0). Instructor Panel Sedation: deep (0) / light (P_mus ×0.5) / awake (×1). Maneuvers done during patient effort are flagged unreliable |
| R4-Q2 | Chemoreflex | Drive × m, where m = (7.50 − pH)/(7.50 − reference pH), clamped to 0–2. P_mus × m, neural RR × (0.5 + 0.5m). Reference pH: normal/apnea 7.40, ARDS/asthma/edema 7.30, COPD/PE 7.35, metabolic acidosis 7.10 |
| R4-Q3 | Obstructive R_exp | Asthma 55 → **90**, COPD 50 → **75** (PEEP_i ≈ 9 at RR 16) |
| R4-Q4 | High pressure limit | Stays at 40. In asthma every breath is cut short (Vte ≈ 260 mL); raising the limit is part of the lesson |

### Round 5 ✅ (2026-10-18, after the V1 release)

| # | Decision | Outcome |
| --- | --- | --- |
| R5-1 | Phones (supersedes R3-Q12) | Full controls on every screen size. Top bar shows Instructor on phones. Settings strip is pinned to the bottom with knobs scrolling sideways (44 px touch targets). Instructor panel is full screen on phones. Mode dialog fits the screen |
| R5-2 | Default patient | The app always opens on **Normal lungs**. A shared case link opens its case. The remembered last case is *offered* ("Resume last case") instead of restored automatically (refines R3-Q11) |
| R5-3 | AI layer | Not wanted for now. Removed from the active V2 plan |

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

## V1.1: phone support and Normal-lungs default (2026-10-18)

- [x] Responsive top bar, settings strip, Instructor panel, mode dialog; fixed the knob row stretching the phone layout viewport (overflow-x: clip on the strip)
- [x] Normal lungs by default; "Resume last case" prompt; untouched default sessions are not saved over the remembered case
- [x] Checked at 390×844 (phone) and 1440×900 (desktop) in a headless browser; redeployed

## V1 implementation plan

Each milestone ends with its tests passing and an update here.

- [x] **M1 Scaffold**: git init, pnpm monorepo (`packages/engine`, `apps/web`), TS/ESLint/Prettier/Vitest, an empty Next.js app with the disclaimer. _Done 2026-10-17: Next.js 16.4 / React 19.3 / Tailwind 4, pnpm 9 via corepack; test, typecheck, lint and build all pass._
- [x] **M2 Engine core**: lung model (C, R_insp, R_exp) behind an interface · RK4 at 1 kHz, Samples sent out at 100 Hz · P_mus generator with its own neural clock · VCV (square/decelerating, pause), PCV (rise time), PSV (Esens) · flow/pressure trigger with delay · breath detection _Done 2026-10-17: 17 physics tests passing (exact VCV/PCV formulas, exhalation decay, steady-state PEEP_i matches the formula and falls with lower RR, flow and pressure triggers, ineffective triggering from PEEP_i, PSV cycles at Esens, Apnea Backup, high pressure limit ends inspiration, settings apply at the next breath, deterministic). Runs about 6000× faster than real time. Notes: decelerating VCV ramps to zero flow (Ti = 2·Vt/peak flow); Apnea Backup stays on until reset by hand (`endApneaBackup`)._
- [x] **M3 Measurements and alarms**: BreathMetrics · Inspiratory Pause and Expiratory Hold · C_stat/R_aw · alarm engine (settable limits, priority levels, silence, high pressure ends inspiration) · Apnea Backup _Done 2026-10-17: 10 new tests (28 total). Added `Session` = Simulator + Monitor + AlarmEngine (the Worker will host it in M6). ⚠ Decision for you to check: the **Auto-PEEP** and **High Driving Pressure** alarms use the Engine's true values every breath (real ventilators can't know these without a maneuver). Displayed P_plat, Total PEEP and PEEP_i only come from maneuvers. Default limits: Vte 0.25–1.0 L, V_E 4–20 L/min, RR > 35, Auto-PEEP > 5, Driving Pressure > 15. Holds last 0.5 s._
- [x] **M4 Blood gases and vitals**: PaCO2/PaO2 (shunt mixing)/pH/EtCO2 moving toward targets over time · recruitment curve · SpO2 · BP rule · fast-forward _Done 2026-10-17: 10 new tests (38 total). How it works: CO2 is a mass balance (store 13 mL/mmHg, so τ ≈ 2.5 min at normal V_A; apnea raises PaCO2 ≈ 15 mmHg in the first minute). Dead space = fixed 125 mL anatomic + an alveolar fraction, so Vd/Vt rises as Vt falls. PaO2 uses oxygen-content mixing (Hb 12, a-v difference 5 mL/dL) with true shunt + V/Q admixture that fades as FiO2 → 1. Recruitment is S-shaped in end-expiratory alveolar pressure (width 3). BP falls 1.5/cmH2O of P_mean above 12 and 2/cmH2O of PEEP_i. Gas and vitals start at steady state at t = 10 s. ⚠ New values for your review in M5: V/Q mismatch per profile, recruitable fraction / half-PEEP, HR/BP per profile._
- [x] **M5 Profiles**: the 8 Patient Profiles + Initial Settings + PBW · **signature tests** (exact formulas, each profile's signature, clinical cause-and-effect) _Done 2026-10-17: 62 tests total, including 19 profile-signature tests (ARDS, asthma, COPD, metabolic acidosis sedated/awake/PSV, edema PEEP response, PE, apnea, unreliable maneuvers). Values added in M4/M5 for your review: V/Q mismatch (normal/MA/apnea 0.02, ARDS 0.05, edema/PE 0.10, asthma/COPD 0.15) · recruitable fraction / half-PEEP (ARDS 0.5 / 12, edema 0.7 / 8, others 0) · HR and BP (normal 80 120/75, ARDS 105 110/65, asthma 120 135/80, COPD 100 140/80, MA 125 100/55, edema 110 160/95, PE 125 90/60, apnea 70 115/70). Note: on Initial Settings a hyperventilated awake patient (pH > 7.50) stops triggering; that is the chemoreflex working as designed._
- [x] **M6 Worker and contract**: Web Worker host, typed versioned messages, Float32Array batching _Done 2026-10-17: contract v2 (`protocol.ts`: 14 commands, 8 message types, `EngineState` snapshot). `EngineHost` runs the Session behind it with no timers (tested in Node, 8 tests, 70 total). The web Worker ticks every 16 ms with each real-time step capped at 100 ms. `EngineClient` is the main-thread handle. Waveform pause (instructor) is separate from the display freeze (UI, M7)._
- [x] **M7 UI**: Canvas sweep traces + loops · numbers · settings strip with confirm · mode-change dialog · alarm banner · Instructor Panel · freeze and cursor · gas/vitals panel · i18n scaffold _Done 2026-10-17: checked in a headless browser (screenshots of ARDS, asthma, pending settings, mode dialog, Instructor Panel, loops, freeze + cursor, phone). Design: blue-slate monitor glass, trace colors checked with the dataviz validator (pressure #C08A1E, flow #18977E, volume #6C7CF0), Barlow / Barlow Condensed, alarm red/yellow reserved for alarms and paired with a shape. Fixed during the check: knob clicks in quick succession lost updates; cursor readout crashed off the plot edge (error.tsx boundary added); Date.now() during render broke Cache Components prerender. ⚠ Dev server is unreliable inside OneDrive (sync keeps touching node_modules); verify with `next build && next start`._
- [x] **M8 Polish and ship**: shareable case URL, localStorage, view-only phone layout, **your clinical review session**, deploy to Vercel
  - [x] Shareable case URL (`#case=…`, checked and clamped on decode, 5 tests) + "Copy case link" in the Instructor Panel. Last session remembered in localStorage. Checked in the browser: reload restores the session, a link alone reproduces the case, a malformed link falls back safely (75 tests total)
  - [x] View-only phone layout (checked at 390 px in M7)
  - [x] Clinical review: you accepted all flagged values as-is for the first prototype (2026-10-17). They stay flagged ⚠ above for a later review
  - [x] Deployed to Vercel (project `mech-vent-sim`, root `apps/web`, Node 24): **https://mech-vent-sim.vercel.app**. Checked live in a headless browser

### V2 backlog

Scenario Events + Scenario timeline · tension pneumothorax (and circulation response) · curved compliance / two compartments · seeded random profile values · accounts and saved Scenarios · Thai localization

_Deferred by you (R5-3): the LLM layer (Scenario generation, instructor feedback, debrief). ADR-0001 still applies if it returns._
