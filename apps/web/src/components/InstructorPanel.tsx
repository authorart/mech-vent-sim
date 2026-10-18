"use client";

import {
  PROFILES,
  progression,
  SCENARIO_KINDS,
  type ScenarioEventKind,
  type Agitation,
  type PatientFeatures,
  type ProfileId,
  type ProfilePatch,
  type SedationLevel,
  type Sex,
} from "@mech-vent/engine";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { num } from "@/engine/format";
import { usePbw, useStore } from "@/engine/store";
import { caseLink, currentCase } from "@/engine/useEngine";
import { GUIDE_BY_KIND } from "@/guide/asynchrony";
import { fmt, messages as m } from "@/i18n";

function Slider({
  label,
  unit,
  value,
  min,
  max,
  step,
  decimals = 0,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  onChange: (v: number) => void;
}) {
  const id = `slider-${label}`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm text-ink-2">
          {label}
        </label>
        <span className="tabular text-sm">
          <span className="font-readout text-lg">{num(value, decimals)}</span>{" "}
          <span className="text-xs text-ink-3">{unit}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--pending)]"
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-edge pt-4">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-edge p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded px-2 py-1 text-sm ${
            value === o.value ? "bg-edge text-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Copies a link that reopens this exact case (profile, changes, settings, sedation). */
function ShareCase() {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={async () => {
          const c = currentCase();
          if (!c) return;
          const url = caseLink(c);
          setLink(url);
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
        className="rounded bg-pending px-3 py-1.5 text-sm font-medium text-chrome"
      >
        {m.shareCase}
      </button>
      {link && (
        <>
          <p role="status" className="text-xs text-ink-3">
            {copied ? m.shareCopied : m.shareManual}
          </p>
          <input
            readOnly
            value={link}
            aria-label={m.shareCase}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-edge bg-panel px-2 py-1 text-xs text-ink-2"
          />
        </>
      )}
    </div>
  );
}

/** Live patient controls for the instructor (R3-Q8). Changes apply immediately. */
export function InstructorPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const engine = useStore((s) => s.engine);
  const send = useStore((s) => s.send);
  const sex = useStore((s) => s.sex);
  const heightCm = useStore((s) => s.heightCm);
  const setPatientSize = useStore((s) => s.setPatientSize);
  const pbw = usePbw();
  const [profileChoice, setProfileChoice] = useState<ProfileId | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open || !engine) return null;
  const patch = (p: ProfilePatch) => send({ type: "setProfileParam", patch: p });
  const choice = profileChoice ?? engine.profileId;

  return (
    <aside
      aria-label={m.instructor}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="fixed inset-y-0 right-0 z-30 flex w-full flex-col gap-4 overflow-y-auto border-l border-edge bg-chrome p-4 shadow-2xl sm:w-[360px] sm:p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{m.instructor}</h2>
        <button
          ref={closeRef}
          type="button"
          aria-label={m.closeInstructor}
          onClick={onClose}
          className="rounded px-2 py-1 text-ink-2 hover:bg-panel"
        >
          ✕
        </button>
      </div>

      <section className="flex flex-col gap-2">
        <label htmlFor="profile" className="text-sm text-ink-2">
          {m.profile}
        </label>
        <select
          id="profile"
          value={choice}
          onChange={(e) => setProfileChoice(e.target.value as ProfileId)}
          className="rounded border border-edge bg-panel px-2 py-1.5"
        >
          {Object.values(PROFILES).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="text-sm text-ink-3">{PROFILES[choice].summary}</p>
        {choice !== engine.profileId && (
          <>
            <p className="text-xs text-ink-3">{m.loadProfileHint}</p>
            <button
              type="button"
              onClick={() => {
                send({ type: "loadProfile", profileId: choice });
                setProfileChoice(null);
              }}
              className="rounded bg-pending px-3 py-1.5 text-sm font-medium text-chrome"
            >
              {m.loadProfile}
            </button>
          </>
        )}
      </section>

      <Section title={m.sedation}>
        <Segmented<SedationLevel>
          label={m.sedation}
          value={engine.sedation}
          options={(["deep", "light", "awake"] as const).map((v) => ({
            value: v,
            label: m.sedationLevel[v],
          }))}
          onChange={(level) => send({ type: "setSedation", level })}
        />
        <p className="text-xs text-ink-3">
          Applied drive: P_mus {num(engine.appliedDrive.pmusMax, 1)} cmH₂O at{" "}
          {num(engine.appliedDrive.neuralRate)}/min
        </p>
      </Section>

      <Section title={m.breathingPattern}>
        <Segmented<PatientFeatures["breathing"]>
          label={m.breathingPattern}
          value={engine.features.breathing}
          options={(["natural", "regular"] as const).map((v) => ({
            value: v,
            label: m.breathing[v],
          }))}
          onChange={(breathing) => send({ type: "setPatientFeatures", features: { breathing } })}
        />
        <p className="text-xs text-ink-3">{m.breathingHint}</p>
        <span className="text-sm text-ink-2">{m.agitation}</span>
        <Segmented<Agitation>
          label={m.agitation}
          value={engine.features.agitation}
          options={(["none", "moderate", "severe"] as const).map((v) => ({
            value: v,
            label: m.agitationLevel[v],
          }))}
          onChange={(agitation) => send({ type: "setPatientFeatures", features: { agitation } })}
        />
        <p className="text-xs text-ink-3">{m.agitationHint}</p>
        <span className="text-sm text-ink-2">{m.reverseTriggering}</span>
        <Segmented<"off" | "on">
          label={m.reverseTriggering}
          value={engine.features.reverseTriggering ? "on" : "off"}
          options={(["off", "on"] as const).map((v) => ({ value: v, label: m.onOff[v] }))}
          onChange={(v) =>
            send({ type: "setPatientFeatures", features: { reverseTriggering: v === "on" } })
          }
        />
        <p className="text-xs text-ink-3">{m.reverseTriggeringHint}</p>
        <span className="text-sm text-ink-2">{m.cardiacOscillation}</span>
        <Segmented<PatientFeatures["cardiacOscillation"]>
          label={m.cardiacOscillation}
          value={engine.features.cardiacOscillation}
          options={(["off", "small", "strong"] as const).map((v) => ({
            value: v,
            label: m.cardiacLevel[v],
          }))}
          onChange={(cardiacOscillation) =>
            send({ type: "setPatientFeatures", features: { cardiacOscillation } })
          }
        />
        <p className="text-xs text-ink-3">{m.cardiacHint}</p>
      </Section>

      <ScenarioSection />

      <AsynchronySection />

      <Section title={m.patient}>
        <Segmented<Sex>
          label="Sex"
          value={sex}
          options={[
            { value: "male", label: m.sex.male },
            { value: "female", label: m.sex.female },
          ]}
          onChange={(s) => setPatientSize(s, heightCm)}
        />
        <Slider
          label={m.height}
          unit="cm"
          value={heightCm}
          min={140}
          max={210}
          step={1}
          onChange={(h) => setPatientSize(sex, h)}
        />
        <p className="text-sm text-ink-2">
          {m.pbw} {num(pbw, 1)} kg. Lung-protective Vt is{" "}
          {num(pbw * PROFILES[engine.profileId].recommendedVtPerKg)} mL (
          {PROFILES[engine.profileId].recommendedVtPerKg} mL/kg).
        </p>
      </Section>

      <Section title={m.mechanics}>
        <Slider
          label="Compliance"
          unit="mL/cmH₂O"
          value={engine.mechanics.compliance * 1000}
          min={5}
          max={120}
          step={1}
          onChange={(v) => patch({ mechanics: { compliance: v / 1000 } })}
        />
        <Slider
          label="Inspiratory resistance"
          unit="cmH₂O/L/s"
          value={engine.mechanics.rInsp}
          min={2}
          max={50}
          step={1}
          onChange={(v) => patch({ mechanics: { rInsp: v } })}
        />
        <Slider
          label="Expiratory resistance"
          unit="cmH₂O/L/s"
          value={engine.mechanics.rExp}
          min={2}
          max={120}
          step={1}
          onChange={(v) => patch({ mechanics: { rExp: v } })}
        />
      </Section>

      <Section title={m.gasExchange}>
        <Slider
          label="Shunt (no PEEP)"
          unit="%"
          value={engine.gas.shuntMax * 100}
          min={0}
          max={70}
          step={1}
          onChange={(v) => patch({ gas: { shuntMax: v / 100 } })}
        />
        <Slider
          label="Alveolar dead space"
          unit="%"
          value={engine.gas.alveolarDeadSpaceFraction * 100}
          min={0}
          max={80}
          step={1}
          onChange={(v) => patch({ gas: { alveolarDeadSpaceFraction: v / 100 } })}
        />
        <Slider
          label="CO₂ production"
          unit="mL/min"
          value={engine.gas.vco2}
          min={120}
          max={400}
          step={10}
          onChange={(v) => patch({ gas: { vco2: v } })}
        />
        <Slider
          label="Bicarbonate"
          unit="mmol/L"
          value={engine.gas.hco3}
          min={4}
          max={45}
          step={1}
          onChange={(v) => patch({ gas: { hco3: v } })}
        />
      </Section>

      <Section title={m.drive}>
        <Slider
          label="Neural rate"
          unit="/min"
          value={engine.baseDrive.neuralRate}
          min={0}
          max={45}
          step={1}
          onChange={(v) => patch({ drive: { neuralRate: v } })}
        />
        <Slider
          label="Peak muscle pressure"
          unit="cmH₂O"
          value={engine.baseDrive.pmusMax}
          min={0}
          max={25}
          step={1}
          onChange={(v) => patch({ drive: { pmusMax: v } })}
        />
      </Section>

      <Section title={m.shareHeading}>
        <ShareCase />
      </Section>

      <Section title={m.simulation}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => send({ type: engine.paused ? "resume" : "pause" })}
            className="rounded border border-edge px-3 py-1.5 text-sm hover:bg-panel"
          >
            {engine.paused ? m.resume : m.pause}
          </button>
          {engine.apneaBackupActive && (
            <button
              type="button"
              onClick={() => send({ type: "endApneaBackup" })}
              className="rounded border border-edge px-3 py-1.5 text-sm hover:bg-panel"
            >
              {m.endBackup}
            </button>
          )}
          <button
            type="button"
            onClick={() => send({ type: "reset" })}
            className="rounded border border-edge px-3 py-1.5 text-sm hover:bg-panel"
          >
            {m.reset}
          </button>
        </div>
        <div>
          <div className="mb-1 text-sm text-ink-2">{m.fastForward}</div>
          <Segmented<string>
            label={m.fastForward}
            value={String(engine.fastForward)}
            options={["1", "10", "30"].map((v) => ({ value: v, label: `×${v}` }))}
            onChange={(v) => send({ type: "fastForward", factor: Number(v) })}
          />
        </div>
      </Section>
      <p className="border-t border-edge pt-4 text-xs text-ink-3">
        {m.createdBy} {m.copyright}.
      </p>
    </aside>
  );
}

/** Live asynchrony summary from the Engine's ground truth (M12, R6-Q10). */
function AsynchronySection() {
  const summary = useStore((s) => s.metrics?.asynchrony ?? null);
  const log = useStore((s) => s.asynchronyLog);
  const showLabels = useStore((s) => s.showLabels);
  const now = useStore((s) => s.metrics?.t ?? 0);
  const counts = summary
    ? (Object.entries(summary.counts) as [keyof typeof GUIDE_BY_KIND, number][]).filter(
        ([, n]) => n > 0,
      )
    : [];
  return (
    <Section title={m.asynchronyHeading}>
      <span className="text-sm text-ink-2">{m.labelsOnWaveforms}</span>
      <Segmented<"off" | "on">
        label={m.labelsOnWaveforms}
        value={showLabels ? "on" : "off"}
        options={(["off", "on"] as const).map((v) => ({ value: v, label: m.onOff[v] }))}
        onChange={(v) => useStore.setState({ showLabels: v === "on" })}
      />
      <p className="text-xs text-ink-3">{m.labelsHint}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-ink-2">{m.asynchronyIndex}</span>
        <span className="font-readout text-2xl text-ink">
          {summary ? `${num(summary.index, 0)}%` : "–"}
        </span>
      </div>
      <p className="text-xs text-ink-3">{m.asynchronyIndexHint}</p>
      {counts.length === 0 ? (
        <p className="text-sm text-ink-3">{m.asynchronyNone}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5 text-sm">
          {counts.map(([kind, n]) => (
            <li key={kind} className="rounded border border-edge px-2 py-0.5 text-ink-2">
              {GUIDE_BY_KIND[kind].title} <span className="font-readout text-ink">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {log.length > 0 && (
        <div>
          <div className="mb-1 text-sm text-ink-2">{m.asynchronyRecent}</div>
          <ol className="space-y-0.5 text-sm">
            {log.slice(0, 6).map((e) => (
              <li key={`${e.t}-${e.kind}`} className="flex justify-between gap-2 text-ink-2">
                <span>{GUIDE_BY_KIND[e.kind].title}</span>
                <span className="tabular text-ink-3">
                  {fmt(m.secondsAgo, { s: num(Math.max(0, now - e.t), 0) })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  );
}

/** Scenario Events (M13): add events now or later, and treat them. */
function ScenarioSection() {
  const send = useStore((s) => s.send);
  const events = useStore((s) => s.engine?.scenario ?? []);
  const now = useStore((s) => Math.max(s.metrics?.t ?? 0, s.engine?.time ?? 0));
  const [kind, setKind] = useState<ScenarioEventKind>("tensionPneumothorax");
  const [delay, setDelay] = useState<keyof typeof m.scenarioDelays>("0");

  const status = (e: (typeof events)[number]) => {
    if (now < e.at) return fmt(m.scenarioStartsIn, { s: num(e.at - now, 0) });
    if (e.resolvedAt !== null && now >= e.resolvedAt) return m.scenarioTreated;
    const p = progression(e, now);
    return p < 0.99 ? fmt(m.scenarioDeveloping, { p: num(p * 100, 0) }) : m.scenarioActive;
  };

  return (
    <Section title={m.scenarioHeading}>
      <p className="text-xs text-ink-3">{m.scenarioHint}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          {m.scenarioEvent}
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ScenarioEventKind)}
            className="rounded border border-edge bg-panel px-2 py-1.5 text-ink"
          >
            {SCENARIO_KINDS.map((k) => (
              <option key={k} value={k}>
                {m.scenarioKind[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          {m.scenarioWhen}
          <select
            value={delay}
            onChange={(e) => setDelay(e.target.value as keyof typeof m.scenarioDelays)}
            className="rounded border border-edge bg-panel px-2 py-1.5 text-ink"
          >
            {(Object.keys(m.scenarioDelays) as (keyof typeof m.scenarioDelays)[]).map((d) => (
              <option key={d} value={d}>
                {m.scenarioDelays[d]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-ink-3">{m.scenarioDescription[kind]}</p>
      <button
        type="button"
        onClick={() => send({ type: "scheduleEvent", kind, delay: Number(delay) })}
        className="self-start rounded bg-pending px-3 py-1.5 text-sm font-medium text-chrome"
      >
        {m.scenarioAdd}
      </button>
      {events.length === 0 ? (
        <p className="text-sm text-ink-3">{m.scenarioNone}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {events.map((e) => {
            const treated = e.resolvedAt !== null && now >= e.resolvedAt;
            const started = now >= e.at;
            return (
              <li key={e.id} className="rounded border border-edge p-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-ink">{m.scenarioKind[e.kind]}</span>
                  <span className="text-xs text-ink-3">{status(e)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {started && !treated && (
                    <button
                      type="button"
                      onClick={() => send({ type: "resolveEvent", id: e.id })}
                      className="rounded border border-edge px-2 py-1 hover:bg-panel"
                    >
                      {m.scenarioTreat[e.kind]}
                    </button>
                  )}
                  {(!started || treated) && (
                    <button
                      type="button"
                      onClick={() => send({ type: "cancelEvent", id: e.id })}
                      className="rounded border border-edge px-2 py-1 text-ink-2 hover:bg-panel"
                    >
                      {m.scenarioRemove}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
