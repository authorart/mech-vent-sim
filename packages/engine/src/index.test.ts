import { describe, expect, it } from "vitest";
import { ENGINE_CONTRACT_VERSION } from "./index";

describe("engine package", () => {
  it("exposes a contract version", () => {
    expect(ENGINE_CONTRACT_VERSION).toBe(1);
  });
});
