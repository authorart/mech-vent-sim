import { describe, expect, it } from "vitest";
import { ENGINE_CONTRACT_VERSION } from "./index";

describe("engine package", () => {
  it("exposes the contract version", () => {
    expect(ENGINE_CONTRACT_VERSION).toBe(3);
  });
});
