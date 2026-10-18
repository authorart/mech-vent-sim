# MedVent Simulator

A web-based mechanical ventilation **teaching** simulator. Learners adjust ventilator settings on a simulated patient and watch pressure, flow and volume waveforms, breath metrics, blood gases and alarms respond the way physiology says they should.

**Live:** https://mech-vent-sim.vercel.app

Created by **Sirot Jantharaksa, MD**. © 2026 Sirot Jantharaksa, MD.

> ⚠️ **Education only. Not for clinical use.** This software is not a medical device and must not inform patient care.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/engine` | Deterministic physiology Engine (pure TypeScript, no browser dependencies) |
| `apps/web` | Next.js UI: ventilator faceplate, waveform canvas, Instructor Panel |
| `simulation-engine.md` | Original Engine specification |
| `Recommended-Simulator-Architecture.md` | Original stack recommendation |
| `GLOSSARY.md` | Domain language: use these terms |
| `docs/adr/` | Architecture decisions, including deliberate departures from the spec |
| `task.md` | Design decisions and the implementation tracker |

## Development

Requires Node 24+. pnpm is run through corepack, so you don't need to install it globally.

```sh
corepack pnpm install
corepack pnpm dev        # http://localhost:3000
corepack pnpm test       # engine tests
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

> **OneDrive note:** OneDrive sync keeps touching `node_modules`, which stalls `next dev` ("waiting for the filesystem to settle"). Either move the repo outside OneDrive, or use `corepack pnpm build` then `corepack pnpm --filter web start`.

## Using it

- **Settings strip** (bottom): change knobs, then **Confirm**. Changes apply at the next breath. Mode buttons open a dialog to check the new mode's settings.
- **Modes:** VCV and PCV (assist-control), PSV (with apnea backup), and **V-SIMV / P-SIMV**: mandatory breaths at the SIMV rate, each synchronized to a patient effort in the assist window (the first quarter of each cycle), with pressure-supported spontaneous breaths between them. In SIMV the monitor splits the rate and Vte into mandatory and spontaneous breaths.
- **Insp. pause / Exp. hold** measure P_plat and Total PEEP (PEEP_i).
- **Freeze** stops the traces; move over them to read values. A seconds scale runs under the traces. **4th trace** adds esophageal pressure or the capnogram.
- **Asynchrony guide** (top bar): one card per asynchrony type (including SIMV mode asynchrony) with a live example, how to recognize it, why it happens and how to fix it, and **Show me on the simulator**.
- **Instructor** panel (each section shows or hides from its heading; **Show all / Hide all** at the top, remembered on this device):
  - load one of 10 Patient Profiles, change sedation, breathing pattern (natural/regular, agitation, reverse triggering, heartbeat ripple) and patient values live;
  - **Targets** for the profile (optionally shown to learners) and **Apply recommended start**;
  - **PEEP trial** table (dynamic compliance per PEEP);
  - **Scenario events** (tension pneumothorax, cuff leak, fistula, bronchospasm, secretions, agitation, sedation wearing off) with their treatments;
  - **Asynchrony** index, log and optional labels on the waveforms;
  - **Copy case link** to share the exact case, including its scenario timeline.
- Clinical behavior follows Hess & Kacmarek, *Essentials of Mechanical Ventilation*, 3rd ed. The values to review are listed in [docs/clinical-review-v2.md](docs/clinical-review-v2.md).

## Deploying

Vercel project `mech-vent-sim` (root directory `apps/web`). From the repo root: `npx vercel deploy --prod`.
