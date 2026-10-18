# Clinical review: V2 values

Every number added in V1.2 and V2 (M9–M15) that a clinician should check, in one place. The V1 values you accepted on 2026-10-17 are in `task.md` (Phase 0) and are not repeated here unless V2 changed them.

Source for the behavior: Hess DR, Kacmarek RM. *Essentials of Mechanical Ventilation*, 3rd ed. (2014). Mark each row **OK** or write the value you want.

## 1. Patient Profiles: new lung values

Compliance is respiratory-system compliance in mL/cmH2O; resistance in cmH2O/(L/s).

| Profile | C_rs | R_insp / R_exp | Chest wall (mL/cmH2O) / resting Pes | Other lung values | Changed from V1 | OK? |
| --- | --- | --- | --- | --- | --- | --- |
| Normal lungs | 60 | 5 / 5 | 200 / 3 | Overdistension above 1.1 L | – | |
| Severe ARDS | 20 | 8 / 8 | 150 / 5 | Units close below 12, reopen above 38 cmH2O; fully open adds 20 mL/cmH2O; overdistension above 0.7 L | Plateau on Vt 500 is now ~29 (tidal recruitment), was ≥ 30 | |
| Status asthmaticus | 45 | 25 / 45 at 1.1 L, rising as the lung empties (up to 2×) | 200 / 3 | No flow limitation (added PEEP adds to Total PEEP) | R_exp was 90 constant | |
| COPD exacerbation | 80 | **18** / 45 at 1.5 L, rising as the lung empties | 200 / 3 | Critical (closing) pressure 6 cmH2O: PEEP up to 6 doesn't raise Total PEEP | R_insp was 20, R_exp 75 constant | |
| Severe metabolic acidosis | 60 | 4 / 4 | 200 / 3 | Opens **awake** | Opened deeply sedated | |
| Cardiogenic edema | 30 | 11 / 11 | 150 / 4 | Close below 8, reopen above 18; fully open adds 20 | – | |
| Massive PE | 52 | 4.5 / 4.5 | 200 / 3 | – | – | |
| Central apnea | 60 | 5 / 5 | 200 / 3 | – | – | |
| **Neuromuscular weakness** (new) | 60 | 5 / 5 | 200 / 3 | Neural rate 18, P_mus 2.5, opens awake, HCO3 26, reference pH 7.30, HR 95, BP 125/75 | new | |
| **ARDS with stiff chest wall** (new) | 15 | 9 / 9 | **40 / 10** | Shunt 45%, close below 16, reopen above 40; fully open adds 15; HR 110, BP 125/75 | new | |

Viscoelastic tissue (the slow pressure fall during a pause): 3 cmH2O/(L/s) with τ 1 s in most profiles; ARDS and edema 4; asthma 5 (τ 1.2 s); COPD 3 (τ 1.2 s).

## 2. Circulation

| Value | Setting | Effect | OK? |
| --- | --- | --- | --- |
| Preload sensitivity | PE 1.5, metabolic acidosis 1.3, cardiogenic edema −0.5, others 1 | PEEP 5 → 15: BP steady in edema, −14 mmHg in PE | |
| Pulse pressure variation | 2.2 % per cmH2O of pleural swing × preload sensitivity (passive breaths only) | Normal ~5%, PE ~8%, stiff chest wall ~22% | |

## 3. Patient effort (M9)

| Value | Setting | OK? |
| --- | --- | --- |
| Natural breathing variability | Rate 10%, depth 15%, inspiratory time 10% (coefficients of variation) | |
| Sighs | About 1 in 60 efforts: 2× depth, 1.4× Ti, 1.5× cycle | |
| Agitation (moderate / severe) | P_mus ×1.5 / ×2; rate ×1.3 / ×1.6; variability ×1.5 / ×2; raises the drive floor by 0.3 / 0.6 | |
| Wakefulness drive floor | Awake 0.4, light 0.15 (multiplier under the chemoreflex) | |
| Reverse triggering | Entrained effort of 8 cmH2O starting 0.35 s after each machine breath, Ti 0.7 s | |
| Expiratory muscles | Up to 0.8 × P_mus when inflation outlasts the patient's inspiration (builds over 0.08 s) | |
| Neural effort shape | (1 − cos) rise over Ti, relaxation over half of Ti; Ti = 35% of the neural cycle | |

## 4. Ventilator (V1.2, M10)

| Value | Setting | OK? |
| --- | --- | --- |
| Expiratory circuit resistance | 2 cmH2O/(L/s); exhalation valve opens over ~40 ms | |
| VCV flow valve | Reaches set flow in 50 ms (Ti lengthened so Vt stays exact) | |
| Bias flow | 5 L/min, at least trigger + 2 L/min | |
| Pressure servo | Up to 180 L/min; responds at 80 rad/s, damping 0.5; cuts flow at up to 6 L/s² + flow/0.15 s | |
| Exhalation-valve relief | Target + 4 cmH2O | |
| PSV pressure cycling | Target + 3 cmH2O, ignored for 0.15 s after the rise | |
| Apnea Backup exit | After 2 patient-triggered breaths | |
| Heartbeat ripple | Small 0.12 cmH2O (default), strong 0.7 cmH2O (≈ 4–6 L/min) | |
| Display noise | Pressure 0.04 cmH2O, flow 0.25 L/min (traces only) | |
| Capnogram (M15) | Phase II width 25 mL; phase III slope 3% (normal) rising with expiratory resistance to 40% | |

## 5. Asynchrony detection (M12)

| Type | Rule | OK? |
| --- | --- | --- |
| Ineffective trigger | Own effort ≥ 1 cmH2O during expiration that no breath answered | |
| Autotrigger | Patient-triggered breath with no effort under way | |
| Reverse trigger | Any effort entrained by a machine breath | |
| Double trigger | Second breath for the same effort | |
| Premature cycling | Inspiration ends ≥ 0.12 s before the patient's, with ≥ 2.5 cmH2O still pulling | |
| Delayed cycling | Inflation continues > 0.2 s past the patient's inspiration | |
| Flow starvation | Patient pulls ≥ 3 cmH2O during a VCV breath, or Paw < PEEP − 1 in a pressure breath | |
| Asynchrony Index | Events ÷ (breaths + ineffective efforts) over 2 min; "frequent" above 10% | |

## 6. Scenario Events (M13)

| Event | Size and timing | OK? |
| --- | --- | --- |
| Tension pneumothorax | Over 2 min: compliance × 0.4, shunt + 60%, HR + 45, BP up to +15% then down to ~45%; decompression fades it in ~20 s | |
| Cuff leak / fistula | 0.012 L/s per cmH2O (≈ 11 L/min at 15 cmH2O); onset 5–10 s | |
| Bronchospasm | Resistance × 3 over 30 s; bronchodilator fades it over ~40 s | |
| Secretions | Resistance × 1.3 and a 9 Hz sawtooth; suction clears in ~3 s | |
| Agitation | Severe agitation until treated | |
| Sedation wears off | Light now, awake after 90 s | |

## 7. Disease targets and recommended starts (M14)

From `packages/engine/src/targets.ts`. Start values are what "Apply recommended start" sets (volume control, square flow sized for the target Ti).

| Profile | Vt mL/kg (start) | Rate (start) | Ti s (start) | PEEP (start) | P plat max | pH | SpO2 | FiO2 start | Limit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Normal | 6–8 (7) | 15–20 (16) | 0.6–1.0 (0.8) | 5–8 (5) | 30 | 7.35–7.45 | 92–98 | 1.0 | 40 |
| ARDS | 4–8 (6) | 20–35 (26) | 0.5–0.8 (0.6) | 10–20 (12) | 30 | 7.20–7.40 | 88–95 | 1.0 | 40 |
| ARDS stiff chest wall | 4–8 (6) | 20–35 (26) | 0.5–0.8 (0.6) | 12–22 (16) | 38 (transpulmonary ≤ 25) | 7.20–7.40 | 88–95 | 1.0 | 50 |
| Asthma | 4–6 (5) | 8–20 (12) | 1.0–1.5 (1.0) | 0–5 (5) | 30 | 7.20–7.45 | 88–95 | 1.0 | 60 |
| COPD | 6–8 (7) | 8–15 (12) | 0.6–1.0 (0.8) | 5–8 (5) | 30 | 7.30–7.45 | 90–95 | 0.4 | 40 |
| Metabolic acidosis | 6–8 (8) | 20–35 (28) | 0.6–1.0 (0.7) | 5–8 (5) | 30 | 7.20–7.45 | 92–98 | 1.0 | 40 |
| Cardiogenic edema | 6–8 (7) | 15–25 (18) | 0.6–1.0 (0.9) | 5–10 (8) | 30 | 7.35–7.45 | 92–98 | 1.0 | 40 |
| Massive PE | 6–8 (7) | 16–25 (20) | 0.6–1.0 (0.8) | 5–8 (5) | 30 | 7.35–7.45 | 92–98 | 1.0 | 40 |
| Central apnea / overdose | 6–8 (7) | 15–20 (16) | 0.8–1.0 (0.9) | 5 (5) | 30 | 7.35–7.45 | 92–98 | 0.4 | 40 |
| Neuromuscular | 8–10 (8) | 15–20 (16) | 1.0–1.5 (1.1) | 5 (5) | 30 | 7.35–7.45 | 92–98 | 0.4 | 40 |

Known teaching consequences you may want to keep or change:

- Asthma's start gives pH ~7.0 (permissive hypercapnia; the book tolerates 7.10–7.20).
- Massive PE's start gives pH ~7.18 (dead space).
- Normal lungs and central apnea run slightly alkalotic on their starts (pH 7.47–7.51).
- Neuromuscular weakness on larger breaths is hypocapnic (the book's reason for added dead space).
