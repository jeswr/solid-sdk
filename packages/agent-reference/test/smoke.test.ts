// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync } from "fs";
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

it("keeps JSON data exports distinct from code modules", () => {
  expect(import.meta.resolve("@jeswr/agent-reference/scenarios/common")).toBe(
    new URL("../dist/scenarios/common.js", import.meta.url).href,
  );
  for (const data of [
    "profiles/mortgage.json",
    "scenarios/probing-counterparty.json",
    "schemas/domain-profile.schema.json",
    "outlines/mortgage-core--baseline.json",
  ]) {
    expect(existsSync(new URL(`../${data}`, import.meta.url))).toBe(true);
    expect(import.meta.resolve(`@jeswr/agent-reference/${data}`)).toBe(
      new URL(`../${data}`, import.meta.url).href,
    );
  }
});
