// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type Batch,
  buildNanopublications,
  createFactAssertion,
  serializeNanopublications,
} from "@jeswr/pkg-memory";
import { expect, it, vi } from "vitest";
import { createAgentMemory } from "../src/index.js";
import { AGENT, CONTAINER, harness, mandate, NOW, OWNER, PD, QUERY } from "./helpers.js";

async function seed(h: Awaited<ReturnType<typeof harness>>) {
  const preference = createFactAssertion(OWNER, {
    template: "preference",
    value: { propertyID: "scheduling", value: "Afternoons" },
  });
  const batch: Batch = {
    batch_id: "recall-fixture",
    worker: { agent_id: AGENT, agent_label: "Fixture" },
    sources: [{ id: "source", kind: "document", url: "https://example.org/source" }],
    claims: [
      {
        id: "preference",
        assertion: preference,
        epistemic: "SelfReportedExplicit",
        categories: ["pd:Preference"],
      },
      {
        id: "health",
        assertion: createFactAssertion(OWNER, {
          template: "condition",
          value: { id: "https://example.org/condition", name: "Fictional private diagnosis" },
        }),
        epistemic: "Documented",
        categories: ["pd:Health"],
        evidence: [{ source: "source", quote: "Secret health evidence." }],
      },
      {
        id: "mixed",
        assertion: createFactAssertion(OWNER, {
          template: "preference",
          value: { propertyID: "private", value: "Mixed health preference" },
        }),
        epistemic: "Inferred",
        categories: ["pd:Preference", "pd:Health"],
      },
      {
        id: "finance",
        assertion: createFactAssertion(OWNER, {
          template: "preference",
          value: { propertyID: "finance", value: "Fictional account detail" },
        }),
        epistemic: "SelfReportedExplicit",
        categories: ["pd:Financial"],
      },
      ...(["Superseded", "Retracted", "Historical", "Contradicted"] as const).map((validity) => ({
        id: validity,
        assertion: preference,
        epistemic: "SelfReportedExplicit" as const,
        categories: ["pd:Preference"],
        validity,
      })),
      { id: "uncategorised", assertion: preference, epistemic: "Mentioned" },
    ],
  };
  const data = await buildNanopublications(batch, { owner: OWNER, generatedAt: NOW.toISOString() });
  await h.storage.create(CONTAINER, await serializeNanopublications(data), {
    name: "all.trig",
    contentType: "application/trig",
  });
  return data;
}

it("defaults to current preferences and removes every filtered sibling graph and quote", async () => {
  const h = await harness();
  await seed(h);
  const results = await h.memory.recall(QUERY);
  expect(results).toHaveLength(1);
  expect(results[0]?.nanopubs[0]?.identifier).toBe("recall-fixture/preference");
  const serialized = await serializeNanopublications(
    results[0] as NonNullable<(typeof results)[0]>,
  );
  expect(serialized).not.toContain("diagnosis");
  expect(serialized).not.toContain("Secret health");
  expect(serialized).not.toContain("Mixed health");
  expect(new Set([...(results[0]?.dataset ?? [])].map((q) => q.graph.value)).size).toBe(4);
});

it("requires every category in the mandate and permits health only when explicitly named", async () => {
  const h = await harness();
  await seed(h);
  expect(await h.memory.recall({ ...QUERY, categories: ["pd:Health"] })).toEqual([]);
  const healthOnly = createAgentMemory({
    ...h.options,
    loadMandate: async () => ({ ...mandate, memoryScope: ["pd:Health"] }),
  });
  expect((await healthOnly.recall(QUERY)).map((x) => x.nanopubs[0]?.identifier)).toEqual([
    "recall-fixture/health",
  ]);
  const both = createAgentMemory({
    ...h.options,
    loadMandate: async () => ({ ...mandate, memoryScope: ["pd:Health", `${PD}Preference`] }),
  });
  expect(await both.recall({ ...QUERY, categories: ["pd:Health"] })).toHaveLength(2);
  expect(await both.recall(QUERY)).toHaveLength(3);
});

it("filters by about, category and limit without reading pending or foreign listing members", async () => {
  const h = await harness();
  await seed(h);
  expect(await h.memory.recall({ ...QUERY, about: "https://example.org/someone-else" })).toEqual(
    [],
  );
  expect(await h.memory.recall({ ...QUERY, categories: [] })).toEqual([]);
  expect(await h.memory.recall({ ...QUERY, about: OWNER, limit: 1 })).toHaveLength(1);
  const original = h.storage.listAll.bind(h.storage);
  const read = vi.spyOn(h.storage, "read");
  h.storage.listAll = async function* (url, options) {
    yield {
      url: "https://foreign.example/private.trig",
      kind: "resource",
      contentType: "application/trig",
      size: null,
      modified: null,
      types: [],
    };
    yield {
      url: `${CONTAINER}pending/ignored.trig`,
      kind: "resource",
      contentType: "application/trig",
      size: null,
      modified: null,
      types: [],
    };
    yield* original(url, options);
  };
  await h.memory.recall(QUERY);
  expect(read.mock.calls.every(([url]) => url === `${CONTAINER}all.trig`)).toBe(true);
});

it.each([
  undefined,
  { ...mandate, issuer: "https://example.org/other-owner" },
  { ...mandate, subject: "https://example.org/other-agent" },
  { ...mandate, validUntil: NOW.toISOString() },
  { ...mandate, validFrom: "2026-11-02T00:00:00Z" },
  { ...mandate, validUntil: "invalid" },
  { ...mandate, memoryScope: [] },
])("refuses absent, invalid, expired and empty-scope authority %j before listing", async (authority) => {
  const h = await harness({ loadMandate: async () => authority });
  const list = vi.spyOn(h.storage, "listAll");
  expect(await h.memory.recall(QUERY)).toEqual([]);
  expect(list).not.toHaveBeenCalled();
});

it("reloads scope and forwards purpose on every recall", async () => {
  const loader = vi.fn(async () => ({ ...mandate, memoryScope: ["pd:Health"] }));
  const h = await harness({ loadMandate: loader });
  await seed(h);
  expect(await h.memory.recall(QUERY)).toHaveLength(1);
  loader.mockResolvedValueOnce({ ...mandate, memoryScope: [] });
  expect(await h.memory.recall(QUERY)).toHaveLength(0);
  expect(loader).toHaveBeenNthCalledWith(2, QUERY);
});

it("rejects wildcard scopes, invalid queries, malformed memory and bounded overflows", async () => {
  const h = await harness();
  const scoped = createAgentMemory({
    ...h.options,
    loadMandate: async () => ({ ...mandate, memoryScope: ["pd:*"] }),
  });
  await expect(scoped.recall(QUERY)).rejects.toThrow("category");
  await expect(h.memory.recall({ ...QUERY, limit: 0 })).rejects.toThrow("positive");
  await expect(h.memory.recall({ ...QUERY, purpose: "not-an-iri" })).rejects.toThrow("IRI");
  await expect(h.memory.recall({ ...QUERY, categories: ["not-a-category"] })).rejects.toThrow(
    "category",
  );
  await seed(h);
  const bounded = createAgentMemory({ ...h.options, maxResourceBytes: 10 });
  await expect(bounded.recall(QUERY)).rejects.toThrow("size limit");
  await h.storage.create(CONTAINER, "invalid", {
    name: "bad.trig",
    contentType: "application/trig",
  });
  await expect(
    h.memory.recall({ ...QUERY, categories: ["pd:Preference"], limit: 100 }),
  ).rejects.toThrow();
});
