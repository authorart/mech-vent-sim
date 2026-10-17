import { describe, expect, it } from "vitest";
import { EngineHost } from "./host";
import { ENGINE_CONTRACT_VERSION, type EngineMessage } from "./protocol";
import { SAMPLE } from "./types";
import { INITIAL_SETTINGS } from "./settings";

function host() {
  const out: { msg: EngineMessage; transfer?: ArrayBuffer[] }[] = [];
  const h = new EngineHost((msg, transfer) => out.push(transfer ? { msg, transfer } : { msg }));
  const of = <T extends EngineMessage["type"]>(type: T) =>
    out.filter((o) => o.msg.type === type).map((o) => o.msg as Extract<EngineMessage, { type: T }>);
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) h.tick(1 / 60);
  };
  return { h, out, of, run };
}

const init = { type: "init", version: ENGINE_CONTRACT_VERSION, profileId: "ards" } as const;

describe("EngineHost", () => {
  it("rejects a contract version mismatch", () => {
    const { h, of } = host();
    h.handle({ ...init, version: 1 });
    expect(of("error")[0]?.message).toMatch(/mismatch/);
    expect(of("ready")).toHaveLength(0);
  });

  it("init → ready + state, starting deeply sedated on the Initial Settings", () => {
    const { h, of } = host();
    h.handle(init);
    expect(of("ready")[0]?.version).toBe(ENGINE_CONTRACT_VERSION);
    const st = of("state")[0]!.state;
    expect(st.profileId).toBe("ards");
    expect(st.sedation).toBe("deep");
    expect(st.settings).toEqual(INITIAL_SETTINGS);
  });

  it("streams 100 Hz Samples in transferred buffers, plus breaths and 1 Hz physiology", () => {
    const { h, out, of, run } = host();
    h.handle(init);
    run(12);
    const samples = of("samples");
    const n = samples.reduce((s, m) => s + m.data.length / SAMPLE.STRIDE, 0);
    expect(n).toBeGreaterThan(1190);
    expect(n).toBeLessThanOrEqual(1200);
    expect(out.filter((o) => o.msg.type === "samples").every((o) => o.transfer?.length === 1)).toBe(
      true,
    );
    expect(of("breath").length).toBeGreaterThanOrEqual(3);
    expect(of("physiology").length).toBeGreaterThanOrEqual(2);
    expect(of("alarms").some((a) => a.active.some((x) => x.id === "HIGH_DRIVING_PRESSURE"))).toBe(
      true,
    );
  });

  it("pending settings appear in state, then clear when applied at the next breath", () => {
    const { h, of, run } = host();
    h.handle(init);
    h.handle({ type: "applySettings", settings: { ...INITIAL_SETTINGS, tidalVolume: 0.35 } });
    expect(of("state").at(-1)!.state.pendingSettings?.mode).toBe("VCV");
    run(4);
    const st = of("state").at(-1)!.state;
    expect(st.pendingSettings).toBeNull();
    expect(st.settings.mode === "VCV" && st.settings.tidalVolume).toBe(0.35);
  });

  it("Instructor Panel: compliance change takes effect immediately", () => {
    const { h, of, run } = host();
    h.handle(init);
    run(8);
    h.handle({ type: "setProfileParam", patch: { mechanics: { compliance: 0.01 } } });
    expect(of("state").at(-1)!.state.mechanics.compliance).toBe(0.01);
    run(8);
    expect(of("breath").at(-1)!.metrics.ppeak).toBeGreaterThan(40 - 1);
  });

  it("pause stops the stream; resume restarts it", () => {
    const { h, of, run } = host();
    h.handle(init);
    run(1);
    h.handle({ type: "pause" });
    const before = of("samples").length;
    run(2);
    expect(of("samples").length).toBe(before);
    h.handle({ type: "resume" });
    run(1);
    expect(of("samples").length).toBeGreaterThan(before);
  });

  it("silence is reported; loadProfile resets to the new patient", () => {
    const { h, of } = host();
    h.handle(init);
    h.handle({ type: "silenceAlarms" });
    expect(of("alarms").at(-1)!.silenced).toBe(true);
    h.handle({ type: "loadProfile", profileId: "massivePe" });
    expect(of("state").at(-1)!.state.profileId).toBe("massivePe");
  });

  it("commands before init are errors", () => {
    const { h, of } = host();
    h.handle({ type: "pause" });
    expect(of("error")).toHaveLength(1);
  });
});
