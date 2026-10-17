# MedVent Simulator

A web-based mechanical ventilation **teaching** simulator. Learners adjust ventilator settings on a simulated patient and watch pressure, flow and volume waveforms, breath metrics, blood gases and alarms respond the way physiology says they should.

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
- **Insp. pause / Exp. hold** measure P_plat and Total PEEP (PEEP_i).
- **Freeze** stops the traces; move over them to read values.
- **Instructor** panel: load a Patient Profile (starts deeply sedated on the Initial Settings), change sedation and patient values live, speed up blood gases, and **Copy case link** to share the exact case.
