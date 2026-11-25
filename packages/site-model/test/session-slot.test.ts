// AUTHORED-BY Codex GPT-6.1-Sol

import { describe, expect, it } from "vitest";
import type { Operation, SiteModel } from "../src/index.js";
import { readSiteModel, validateSiteModel, writeSiteModel } from "../src/index.js";

const operation: Operation = {
  id: "urn:shop:model#orders",
  actionType: "https://schema.org/ViewAction",
  label: "Orders",
  inputs: [],
  request: { method: "GET", urlTemplate: "https://shop.test/data/{session}/orders" },
  csrf: [{ source: { kind: "cookie", name: "sid" }, target: { kind: "query", name: "session" } }],
  effect: "read",
  session: "signed-in",
  provenance: {
    derivedFrom: [],
    learnedAt: "2026-11-13T00:00:00.000Z",
    method: "fallback",
    confidence: 0.3,
  },
};
const model = (op: Operation): SiteModel => ({
  id: "urn:shop:model",
  site: "https://shop.test",
  version: "0.1.0",
  generatedAt: "2026-11-13T00:00:00.000Z",
  operations: [op],
  flows: [],
});

describe("session decoration slot validation", () => {
  it("accepts and round-trips the executor's unbound whole-segment CSRF convention", async () => {
    const result = readSiteModel(await writeSiteModel(model(operation)));
    expect(validateSiteModel(result)).toEqual([]);
    expect(result.operations[0]?.inputs).toEqual([]);
  });
  it.each([
    "https://shop.test/data/prefix-{session}/orders",
    "https://shop.test/data/{session}/{session}",
    "https://shop.test/data/{session}/orders?x={session}",
  ])("does not exempt embedded or repeated slots: %s", (urlTemplate) => {
    expect(
      validateSiteModel(
        model({ ...operation, request: { ...operation.request, urlTemplate } }),
      ).some((p) => p.message.includes('"session"')),
    ).toBe(true);
  });
});
