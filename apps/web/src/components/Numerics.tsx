"use client";

import type { Measured } from "@mech-vent/engine";
import type { ReactNode } from "react";
import { ie, num } from "@/engine/format";
import { usePbw, useStore } from "@/engine/store";
import { messages as m } from "@/i18n";

function Readout({
  label,
  value,
  unit,
  size = "md",
  note,
  dim = false,
}: {
  label: string;
  value: string;
  unit?: string;
  size?: "lg" | "md";
  note?: ReactNode;
  dim?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-ink-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-readout tabular leading-none ${
            size === "lg" ? "text-5xl font-medium" : "text-3xl"
          } ${dim ? "text-ink-3" : "text-ink"}`}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-ink-3">{unit}</span>}
      </div>
      {note && <div className="mt-0.5 text-xs leading-snug text-ink-3">{note}</div>}
    </div>
  );
}

function measured(v: Measured | null, decimals = 0) {
  return v ? num(v.value, decimals) : "–";
}

/** A group of readouts, with a left rule in the matching trace color. */
function Group({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div
      className="grid grid-cols-2 gap-x-4 gap-y-3 border-l-2 pl-3"
      style={{ borderColor: `var(${color})` }}
    >
      {children}
    </div>
  );
}

export function Numerics() {
  const x = useStore((s) => s.metrics);
  const measuring = useStore((s) => s.measuring);
  const extraTrace = useStore((s) => s.extraTrace);
  const pbw = usePbw();

  const unreliable = (v: Measured | null) =>
    v && !v.reliable ? <span className="text-pending">{m.unreliable}</span> : null;

  return (
    <div className="flex flex-col gap-5">
      <Group color="--trace-pressure">
        <Readout label="P peak" value={num(x?.ppeak)} unit="cmH₂O" size="lg" />
        <Readout label="PEEP" value={num(x?.peep)} unit="cmH₂O" size="lg" />
        <Readout
          label="P plat"
          value={measured(x?.pplat ?? null)}
          unit="cmH₂O"
          dim={!x?.pplat}
          note={
            measuring === "inspiratoryPause"
              ? m.measuring
              : (unreliable(x?.pplat ?? null) ?? (x?.pplat ? null : m.notMeasured))
          }
        />
        <Readout
          label="Driving P"
          value={num(x?.drivingPressure)}
          unit="cmH₂O"
          dim={x?.drivingPressure == null}
        />
        <Readout
          label="Total PEEP"
          value={measured(x?.totalPeep ?? null)}
          unit="cmH₂O"
          dim={!x?.totalPeep}
          note={
            measuring === "expiratoryHold"
              ? m.measuring
              : (unreliable(x?.totalPeep ?? null) ??
                (x?.peepI ? `PEEPi ${num(x.peepI.value, 1)}` : m.notMeasuredHold))
          }
        />
        <Readout label="P mean" value={num(x?.pmean)} unit="cmH₂O" />
      </Group>

      <Group color="--trace-volume">
        <Readout
          label="Vte"
          value={num(x ? x.vte * 1000 : null)}
          unit="mL"
          size="lg"
          note={x ? `${num((x.vte * 1000) / pbw, 1)} mL/kg PBW` : null}
        />
        <Readout label="V̇E" value={num(x?.ve, 1)} unit="L/min" size="lg" />
        <Readout
          label="RR total"
          value={num(x?.rrTotal)}
          unit="/min"
          note={x ? `${num(x.rrSpont)} patient-triggered` : null}
        />
        <Readout label="I : E" value={ie(x?.ieRatio)} note={x ? `Ti ${num(x.ti, 2)} s` : null} />
        <Readout
          label="C stat"
          value={num(x?.cstat != null ? x.cstat * 1000 : null)}
          unit="mL/cmH₂O"
          dim={x?.cstat == null}
        />
        <Readout label="R aw" value={num(x?.raw)} unit="cmH₂O/L/s" dim={x?.raw == null} />
        <Readout
          label="C dyn"
          value={num(x?.cdyn != null ? x.cdyn * 1000 : null)}
          unit="mL/cmH₂O"
          dim={x?.cdyn == null}
        />
        <Readout
          label="Stress index"
          value={num(x?.stressIndex, 2)}
          dim={x?.stressIndex == null}
          note={
            x?.stressIndex != null
              ? m.stressIndexHint[x.stressIndex < 0.9 ? "low" : x.stressIndex > 1.1 ? "high" : "ok"]
              : null
          }
        />
      </Group>

      {extraTrace === "pes" && x && (
        <Group color="--trace-aux">
          <Readout
            label="Pes"
            value={num(x.esophageal.pesEndExp, 1)}
            unit="cmH₂O"
            note={m.pesHint.endExp}
          />
          <Readout
            label="Pes"
            value={num(x.esophageal.pesEndInsp, 1)}
            unit="cmH₂O"
            note={m.pesHint.endInsp}
          />
          <Readout
            label="P transpulm."
            value={num(x.esophageal.plEndExp, 1)}
            unit="cmH₂O"
            note={m.pesHint.endExp}
          />
          <Readout
            label="P transpulm."
            value={num(x.esophageal.plEndInsp, 1)}
            unit="cmH₂O"
            note={m.pesHint.endInsp}
          />
        </Group>
      )}
    </div>
  );
}

export function GasPanel() {
  const g = useStore((s) => s.gas);
  const v = useStore((s) => s.vitals);
  const engine = useStore((s) => s.engine);
  const fio2 = engine?.settings.fio2;

  if (!g || !v) {
    return <p className="text-sm text-ink-3">{m.waitingGas}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="mb-2 text-sm font-medium text-ink-2">{m.bloodGas}</h2>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3">
          <Readout label="pH" value={num(g.ph, 2)} />
          <Readout label="PaCO₂" value={num(g.paco2)} unit="mmHg" />
          <Readout label="PaO₂" value={num(g.pao2)} unit="mmHg" />
          <Readout label="EtCO₂" value={num(g.etco2)} unit="mmHg" />
          <Readout label="P/F" value={num(g.pf)} note={fio2 ? `FiO₂ ${num(fio2 * 100)}%` : null} />
          <Readout label="SpO₂" value={num(g.spo2)} unit="%" />
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-medium text-ink-2">{m.vitals}</h2>
        <div className="grid grid-cols-[1fr_1.7fr_1fr] gap-x-4 gap-y-3">
          <Readout label="HR" value={num(v.hr)} unit="/min" />
          <Readout label="BP" value={`${num(v.sbp)}/${num(v.dbp)}`} unit="mmHg" />
          <Readout label="MAP" value={num(v.map)} unit="mmHg" />
          <Readout
            label="PPV"
            value={num(v.ppv)}
            unit="%"
            dim={v.ppv == null}
            note={m.ppvHint}
          />
        </div>
      </div>
    </div>
  );
}
