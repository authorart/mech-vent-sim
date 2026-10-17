import {
  ENGINE_CONTRACT_VERSION,
  type EngineCommand,
  type EngineMessage,
  type ProfileId,
  type SedationLevel,
  type VentSettings,
} from "@mech-vent/engine";

/** Main-thread handle to the Engine Worker. */
export class EngineClient {
  private worker: Worker;

  constructor(onMessage: (msg: EngineMessage) => void) {
    this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<EngineMessage>) => onMessage(e.data);
    this.worker.onerror = (e) => onMessage({ type: "error", message: e.message });
  }

  init(profileId: ProfileId, settings?: VentSettings, sedation?: SedationLevel): void {
    this.send({
      type: "init",
      version: ENGINE_CONTRACT_VERSION,
      profileId,
      ...(settings ? { settings } : {}),
      ...(sedation ? { sedation } : {}),
    });
  }

  send(cmd: EngineCommand): void {
    this.worker.postMessage(cmd);
  }

  dispose(): void {
    this.worker.terminate();
  }
}
