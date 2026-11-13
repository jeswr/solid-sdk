// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { AgentRuntime, CONFIGURATIONS, DirectBus, PILOT_PROFILE } from "../src/index.js";

describe("@jeswr/agent-reference entry point", () => {
  it("exposes the runtime, the direct binding and the pilot profile", () => {
    expect(typeof AgentRuntime.create).toBe("function");
    expect(new DirectBus().trace).toEqual([]);
    expect(PILOT_PROFILE).toMatch(/^https?:|^urn:/);
    expect(Object.keys(CONFIGURATIONS).length).toBeGreaterThan(0);
  });
});
