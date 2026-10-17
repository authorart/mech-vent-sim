/// <reference lib="webworker" />
import { EngineHost, type EngineCommand } from "@mech-vent/engine";

declare const self: DedicatedWorkerGlobalScope;

const host = new EngineHost((msg, transfer) => self.postMessage(msg, transfer ?? []));

self.onmessage = (e: MessageEvent<EngineCommand>) => host.handle(e.data);

// Advance by elapsed real time. EngineHost caps each step, so a backgrounded tab can't jump ahead.
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  host.tick((now - last) / 1000);
  last = now;
}, 16);
