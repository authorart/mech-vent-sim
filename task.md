# MedVent Simulator: Task Tracker

Source specs: [simulation-engine.md](./simulation-engine.md) (the Engine spec) · [Recommended-Simulator-Architecture.md](./Recommended-Simulator-Architecture.md) (stack)
Domain language: [GLOSSARY.md](./GLOSSARY.md) · Decisions: [docs/adr/](./docs/adr/)

**Status:** ✅ V1 prototype complete 2026-10-17. Live at https://mech-vent-sim.vercel.app. V1 backed up 2026-10-18 (tag `v1.1.0`, branch `v1-backup`, zip `../mech-vent-v1.1.0-backup.zip`). **V1.2 fixes done** (see below). Next: **V2** (Round 6 agreed): M9 done, next M10 (ventilator realism). Repo: https://github.com/authorart/mech-vent-sim

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
| Status asthmaticus | 45 | 25 / **90** → V1.2: 45 at 1.1 L, rising as the lung empties | 220 | 0.45 | 8% | 24 | 24 / 10 |
| COPD exacerbation | 80 | 20 / **75** → V1.2: 45 at 1.5 L, rising as the lung empties | 200 | 0.50 | 8% | 32 | 20 / 8 |
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

---

## V1.2: waveform fixes you asked for (2026-10-18)

- [x] **Backup first**: tag `v1.1.0` and branch `v1-backup` pushed to GitHub; zip snapshot `../mech-vent-v1.1.0-backup.zip`
- [x] **PSV / Esens did nothing**: the Esens logic was right, but patients start deeply sedated, so PSV fell into Apnea Backup (time-cycled PCV) and stayed there. The backup's 15 cmH2O also hyperventilated normal lungs to pH 7.68, which switched off all drive. Fixes: Apnea Backup now hands back to PSV after 2 patient-triggered breaths; a **Wakefulness Drive** floor keeps awake (×0.4) and lightly sedated (×0.15) patients breathing when alkalemic (book ch. 7, 15); the mode dialog warns when choosing PSV for a patient with no effort; a note under the settings explains Apnea Backup while it runs. Esens now visibly moves Ti (5% → 1.3 s, 70% → 0.2 s on awake normal lungs)
- [x] **Metabolic acidosis didn't show high demand**: the profile opened deeply sedated (no effort at all). It now opens **awake** (its lesson is the drive). On PSV/PCV the patient pulls peak flows near 120 L/min and Vt about 900 mL (area under the flow curve). On VCV the flow is set by the ventilator, so the demand shows the book's way instead: scooped pressure (Flow Starvation) and Double Triggers
- [x] **No scooped expiratory flow in asthma/COPD**: expiratory resistance now rises as the lung empties (small-airway narrowing, ADR-0003 amendment): early expiratory peak, then a concave, slow tail. COPD added PEEP is partly absorbed, as in the book. Reviewed numbers changed: asthma R_exp 45 at 1.1 L (n = 4), COPD R_exp 45 at 1.5 L (n = 5); PEEP_i stays in the spec's 8–18 range; lowering RR still halves asthma PEEP_i
- [x] **Polygon loops**: the loops were drawn at full resolution; the straight lines came from ideal physics. Added: exhalation valve that opens over ~40 ms and a 2 cmH2O/(L/s) expiratory circuit (pressure eases down to PEEP), a 50 ms VCV flow-valve ramp (Vt stays exact), and overdistension (the P–V curve bends right, "beak", when volume passes a profile's upper limit; strongest in ARDS). The S-shaped lower part with recruitment comes in M11
- [x] Found while checking: (a) between breaths the flow trigger let a patient draw unlimited gas at PEEP (volume trace drifted to −600 mL). Now a **Bias Flow** of 5 L/min (≥ trigger + 2) is all the circuit supplies; harder pulls drop airway pressure. (b) COPD blood gases started falsely high (PaCO2 ~100) because the first exhaled volumes are small while air trapping builds; gas priming now uses inspired volume. (c) Loading a profile from the Instructor Panel forced deep sedation; it now uses the profile's start sedation
- [x] 85 engine tests (10 new in `realism.test.ts`), typecheck and lint clean, checked in a headless browser (COPD/asthma loops, metabolic acidosis VCV and PSV, PSV warning)

---

## V2: realistic waveforms, asynchrony and disease behavior (planned 2026-10-18, not started)

**Source:** Hess DR, Kacmarek RM. *Essentials of Mechanical Ventilation*, 3rd ed. (McGraw-Hill, 2014). Chapters used: 7 (pressure vs volume), 9 (flow waveforms, I:E), 14 (initial settings), 15 (patient–ventilator asynchrony), 17 (ARDS), 18 (obstructive disease), 22 (neuromuscular), 23 (cardiac failure), 25 (bronchopleural fistula), 26 (drug overdose), 28 (capnography), 30–31 (basic and advanced mechanics). The PDF stays on your machine and is kept out of git (`*.pdf` in `.gitignore`); this plan only summarizes it.

### What V1 already does, measured

A probe run (awake patients, Initial Settings, 60 s) showed the physics already produces some asynchrony on its own:

| Profile | Mode | Result |
| --- | --- | --- |
| COPD | VCV | 20 neural efforts/min, **0 triggered** (all Ineffective Triggers from PEEP_i) |
| Metabolic acidosis | VCV | 32 efforts → 64 breaths: **31 Double Triggers** (stacked breaths) |
| Asthma | VCV | Every breath ends at the 40 cmH2O limit (as decided in R4-Q4) |
| All | VCV, PSV | Flow Starvation "scooping" appears when effort is strong |

**The main realism gap:** every breath is identical (same Ti to the millisecond, same effort). Real patients vary. Several asynchronies and artifacts in the book are also missing completely.

### Gap list: book vs V1

| Topic (chapter) | What the book describes | V1 today | V2 work |
| --- | --- | --- | --- |
| Breath variability | Real effort varies breath to breath; sighs occur | Perfectly periodic P_mus | Seeded variability of neural rate, amplitude and Ti; occasional sighs |
| Trigger asynchrony (15) | Ineffective efforts from PEEP_i; autotriggering from cardiac oscillations (4–6 L/min at the airway; a 2 L/min flow trigger fires, 8 L/min stops it) and from leaks; reverse triggering (effort entrained by the ventilator's breath, can stack breaths) | Ineffective triggers ✅. No autotriggering, no reverse triggering | Cardiogenic oscillation signal; leak; entrainment model for reverse triggering |
| Flow asynchrony (15, 31) | Fixed VCV flow below demand: pressure trace scoops and varies breath to breath | Scooping ✅ (constant because effort is constant) | Comes free with variability; add tests |
| Cycle asynchrony (7, 9, 15) | Premature cycling → double trigger. Delayed cycling (COPD in PSV: flow decays slowly, Esens reached late) → patient actively exhales → pressure bump at end of inspiration and PSV pressure-cycles | Double trigger ✅. No expiratory muscles, no PSV pressure-cycle rule (only the 40 limit and a 3 s time limit) | Expiratory muscle activity; PSV secondary cycle on pressure (target + a few cmH2O) |
| Mode asynchrony (15) | SIMV: same effort on mandatory and spontaneous breaths. PSV periodic breathing (hyperventilation → apnea → alarm → arousal) | No SIMV. Apnea Backup latches | Later (backlog) |
| Rise time (7, 9) | Too fast → pressure overshoot at the start; too slow → concave rise and flow starvation | Ideal linear ramp to target, no overshoot | Servo-like pressure controller with finite response |
| Inspiratory pause (9, 30) | Pressure drops from peak to P1 quickly, then slowly to P2 (gas redistribution between fast and slow units, pendelluft) | Perfectly flat plateau | Simple viscoelastic element (or two compartments) |
| COPD vs asthma PEEP (15, 18) | COPD has **expiratory flow limitation**: external PEEP up to ~80% of PEEP_i counterbalances it, so triggering improves without raising total PEEP. Asthma usually has no flow limitation: added PEEP adds to total PEEP | V1.2: volume-dependent R_exp partly absorbs added PEEP in COPD | Full waterfall (critical closing pressure) model for COPD in M11 |
| ARDS mechanics (17, 31) | Stress index (upward concavity = overdistension, downward = tidal recruitment); best-compliance decremental PEEP trial; inflation/deflation hysteresis after a recruitment maneuver; stiff chest wall → transpulmonary pressure via esophageal pressure | Fixed compliance; recruitment changes shunt only | Curved P–V with recruitment that changes compliance and has hysteresis; chest-wall split and esophageal pressure |
| Pneumothorax (25) | VCV: rising peak pressure. PCV: falling Vt. HR and BP rise first, then collapse | Not modeled | Scenario Event |
| Bronchopleural fistula / cuff leak (25, 31) | Vte < Vti; volume trace doesn't return to zero; PSV fails to cycle (flow never falls to Esens); CO2 leaves through the fistula | Not modeled | Scenario Event |
| Cardiac failure (23) | Positive pressure and PEEP 5–10 *help* the failing LV; removing support (SBT) can bring edema back | BP falls with P_mean in every profile | Profile-specific hemodynamic response; pulse pressure variation |
| Neuromuscular disease (22) | Normal lungs, weak effort, often wants larger Vt; hypoxemia resolves once ventilated | No profile | New profile |
| Capnogram (28) | Phases I–III; phase III steeper in obstruction; wide PaCO2–EtCO2 gap in dead-space disease | EtCO2 number and PaCO2–EtCO2 gap ✅, no waveform | Optional CO2 waveform |
| Disease management (14, 17, 18, 22, 23, 26) | Per-disease starting settings and targets (see table below) | Same generic Initial Settings for every profile (R3-Q2) | Targets card per profile, deterministic checks against current settings |

#### Disease targets from the book (to drive the Targets card and tests)

| Profile | Vt (mL/kg PBW) | RR | Ti (s) | PEEP | Pressure limits | Gas targets |
| --- | --- | --- | --- | --- | --- | --- |
| ARDS | 6 (4–8) | 20–35, avoid PEEP_i | 0.5–0.8 | 10–20 (PEEP/FiO2 table, or best compliance + 2) | P_plat ≤ 30 | SpO2 88–95, PaO2 55–80, pH 7.20–7.40 (permissive hypercapnia) |
| COPD | 6–8 | 8–15 | 0.6–1.0 | 5, or up to ~80% of PEEP_i to help triggering; rarely > 10 | P_plat < 30 | PaCO2 back to the patient's baseline, pH > 7.30; FiO2 rarely > 0.5 |
| Status asthmaticus | 4–6 | 8–20 | 1–1.5 (short enough to avoid PEEP_i) | Controversial; only if total PEEP doesn't rise | Peak 60–70 acceptable if P_plat < 30 | pH ≥ 7.20 (7.10 tolerated), SpO2 88–95 |
| Cardiogenic edema | 6–8 | > 15 | ≤ 1 | 5–10 (unloads the LV) | P_plat < 30 | FiO2 1.0 first, then titrate |
| Neuromuscular weakness | 8 to < 10 if lung volumes normal | ≥ 15 | > 1 | ~5 | P_plat < 30 | Normal PaCO2 (add dead space if large Vt makes it low) |
| Drug overdose / central apnea | 6–8 | 15–20 | ≤ 1 | 5 | P_plat < 30 | Oxygenation rarely the problem unless aspiration |

### Round 6 ✅ (2026-10-18, "Agree all")

| # | Question | My recommendation |
| --- | --- | --- |
| R6-Q1 | Word for the umbrella concept: "asynchrony" or "dyssynchrony"? | **Asynchrony** (the book's term), with types Trigger, Flow, Cycle and Mode Asynchrony. "Dyssynchrony" listed as a word to avoid, so the UI uses one word |
| R6-Q2 | Should asynchronies only *emerge* from physics and settings, or can the instructor *inject* them? | **Emerge** for trigger, flow and cycle asynchrony (fixing them is the lesson). Artifacts that need a cause (cardiac oscillations, leaks, reverse-trigger entrainment, agitation) become patient features or Scenario Events the instructor turns on |
| R6-Q3 | Active exhalation: let P_mus go negative, or add a separate expiratory muscle pressure? | **Separate Expiratory Muscle Pressure (≥ 0)**, amending ADR-0002, so the sign rule for P_mus stays intact |
| R6-Q4 | Breath-to-breath variability on by default? | **On by default**, seeded by the case so a shared link replays exactly. Instructor toggle "Regular breathing" for clean demonstrations |
| R6-Q5 | COPD expiratory flow limitation (PEEP counterbalances PEEP_i)? | **Yes, COPD only.** Asthma stays linear (added PEEP adds to total PEEP), matching the book |
| R6-Q6 | Lung model upgrade: curved compliance or two compartments first? | **Curved P–V + recruitment-dependent compliance with hysteresis, plus a viscoelastic element** for the P1→P2 pause decay. Two compartments later |
| R6-Q7 | Esophageal pressure and chest wall split? | **Yes.** Chest wall compliance per profile, optional esophageal/transpulmonary trace, and a stiff-chest-wall ARDS variant (obesity / abdominal pressure) |
| R6-Q8 | Hemodynamics per profile? | **Yes.** A per-profile preload sensitivity: PEEP helps BP in cardiogenic edema and hurts in the others; show pulse pressure variation |
| R6-Q9 | New profiles in V2? | **Neuromuscular weakness** (Guillain–Barré type) and **ARDS with stiff chest wall**. Pneumothorax, fistula/cuff leak, bronchospasm, secretions and agitation become Scenario Events |
| R6-Q10 | Who sees the asynchrony labels? | The **Instructor Panel** gets a live asynchrony log and an Asynchrony Index (% of breaths). Learners see only waveforms unless the instructor turns on "Show labels" |
| R6-Q11 | Disease targets card (table above): visible to learners? | **Instructor reveals it.** Hidden by default so learners set the ventilator themselves first |
| R6-Q12 | Starting settings per profile instead of the generic Initial Settings (R3-Q2)? | **Keep the generic start** (fixing it is the exercise) and add an Instructor button "Apply recommended start" from the targets table |
| R6-Q13 | (Your request) A teaching menu for asynchrony | **Yes**: a new **Asynchrony Guide** menu. One card per type (ineffective trigger, auto-trigger, reverse trigger, double trigger, flow starvation, premature and delayed cycling, PSV periodic breathing): a small example waveform, how to recognize it on the scalars and loops, why it happens, and the book's fixes. "Show me" loads a live example on the simulator. Built in M12 |

### V2 milestones (proposed; final order after Round 6)

Each milestone ends with tests passing, the V1 profile signatures re-checked, and an update here.

- [x] **M9 Patient effort realism**: seeded variability (neural rate, amplitude, Ti) and sighs · Expiratory Muscle Pressure (active exhalation when the ventilator's inspiration outlasts the neural one) · agitation/pain drive · reverse-trigger entrainment _Done 2026-10-18: 96 engine tests (11 new in `asynchrony.test.ts`). Instructor Panel "Breathing pattern": Natural (default; CV rate 10%, depth 15%, Ti 10%, a sigh about every 60 efforts) or Regular · Agitation none/moderate/severe (P_mus ×1.5/×2, rate ×1.3/×1.6, variability ×1.5/×2) · Reverse triggering (each machine breath entrains an 8 cmH2O effort 0.35 s after it starts; in normal lungs it triggers a second breath, in ARDS it notches expiratory flow). Expiratory Muscle Pressure is its own Sample channel (ADR-0002 amendment, contract v3); it builds to 0.8 × P_mus when inflation outlasts the patient's inspiration. Features travel in shared case links. Book fixes verified by tests: delayed cycling in COPD PSV 20 (Esens 5% → Ti 1.2 s, push 6 cmH2O, 70% of efforts missed; Esens 50% fixes it) · double trigger in metabolic acidosis VCV (decelerating flow removes it, but the longer Ti then makes the patient push back) · flow starvation (60 → 100 L/min lifts the pressure scoop by > 4 cmH2O and shortens Ti, the book's trade-off) · COPD ineffective triggers (PEEP 10 restores triggering) · PCV Ti 2 s causes active exhalation. ⚠ Values for your review: the variability CVs, sigh rate, agitation multipliers, reverse-trigger strength/timing, expiratory muscle gain. Note: the end-inspiratory pressure "bump" in PSV needs the M10 servo and PSV pressure-cycle rule; today the push shows as falling or reversed flow_
- [ ] **M10 Ventilator realism**: servo-like pressure rise (overshoot when too fast, concave when too slow) · PSV secondary cycle on pressure · cardiogenic oscillations in flow and pressure (autotriggering with a 2 L/min flow trigger, stops at ~8 L/min) · small signal noise
- [ ] **M11 Lung realism**: COPD flow limitation · curved P–V with recruitment-dependent compliance and hysteresis (stress index shape, best-compliance PEEP) · viscoelastic pause decay (peak → P1 → P2) · chest wall split and esophageal pressure
- [ ] **M12 Asynchrony detection and Asynchrony Guide**: Engine-truth classifier (ineffective, double, auto, reverse trigger; premature/delayed cycle; flow starvation) · Asynchrony Index · Instructor log · optional labels on the waveforms · **Asynchrony Guide menu** (R6-Q13): short notes per type on recognition, mechanism and fixes, with an example waveform and a "Show me" live example
- [ ] **M13 Scenario Events**: timeline in the Instructor Panel · tension pneumothorax (VCV peak ↑, PCV Vt ↓, HR/BP up then collapse) · fistula / cuff leak (Vte < Vti, volume not returning to zero, PSV not cycling, autotriggering) · bronchospasm · secretions (sawtooth flow) · agitation · sedation wearing off. Included in shared case links
- [ ] **M14 Disease behavior**: Neuromuscular and stiff-chest-wall ARDS profiles · per-profile hemodynamics and pulse pressure variation · Targets card and "Apply recommended start" · stress index and dynamic compliance trend for a decremental PEEP trial
- [ ] **M15 Displays and ship**: optional 4th trace (esophageal/transpulmonary pressure or capnogram) · loops and numbers for the new values · phone and desktop check · your clinical review of the new numbers · deploy

### Later (not in V2)

SIMV and adaptive modes (mode asynchrony, PRVC/volume support) · PSV periodic breathing with sleep · two-compartment lung · seeded random profile values · accounts and saved Scenarios · Thai localization

_Deferred by you (R5-3): the LLM layer (Scenario generation, instructor feedback, debrief). ADR-0001 still applies if it returns._
