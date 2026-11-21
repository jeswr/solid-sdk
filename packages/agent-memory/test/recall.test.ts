// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type Batch,
  buildNanopublications,
  createFactAssertion,
  parseNanopublications,
  serializeNanopublications,
} from "@jeswr/pkg-memory";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { createHash } from "crypto";
import { expect, it, vi } from "vitest";
import { createAgentMemory } from "../src/index.js";
import {
  AGENT,
  approvalKey,
  CONTAINER,
  claim,
  harness,
  mandate,
  NOW,
  OWNER,
  PD,
  QUERY,
  SHAPES,
} from "./helpers.js";

// Scope filtering also rejects uncategorised claims under shapes that permit them.
const scopeShapes = SHAPES.replace(
  "sh:path dpv:hasPersonalData; sh:minCount 1;",
  "sh:path dpv:hasPersonalData;",
);

// These fixtures exercise recall on prebuilt batches, including malformed and out-of-scope data.
async function seedSigned(
  h: Awaited<ReturnType<typeof harness>>,
  name: string,
  trig: string,
  contentType = "application/trig",
) {
  const id = `${CONTAINER}pending/${name}`;
  const target = `${CONTAINER}${name}`;
  const terms = JSON.stringify(["remember", OWNER, AGENT, id, target, trig]);
  const termsDigest = `sha-256:${createHash("sha256").update(terms).digest("hex")}`;
  const approval = await h.sign({
    id,
    target,
    termsDigest,
    trig,
    kind: "remember",
    nanopublications: [],
  });
  await h.storage.create(CONTAINER, trig, { name, contentType });
  await h.storage.create(CONTAINER, JSON.stringify(approval), {
    name: `${name}.approval.json`,
    contentType: "application/json",
  });
}

it("requires durable owner approval for the exact approved resource bytes", async () => {
  const h = await harness();
  const item = await h.memory.proposeRemember(claim);
  const name = item.target.slice(CONTAINER.length);
  const contentType = "application/trig";
  await h.storage.create(CONTAINER, item.trig, { name, contentType });
  const reopened = createAgentMemory(h.options);
  expect(await reopened.recall(QUERY)).toHaveLength(0);

  await h.memory.approveRemember(item.id, await h.sign(item));
  expect(await reopened.recall(QUERY)).toMatchObject([{ resource: item.target }]);
  const wrongKey = await approvalKey();
  const wrongVerifier = createAgentMemory({
    ...h.options,
    webIdKeyResolver: {
      ...h.options.webIdKeyResolver,
      resolveKey: async () => wrongKey.publicKey,
    },
  });
  expect(await wrongVerifier.recall(QUERY)).toHaveLength(0);
  const afterExpiry = createAgentMemory({
    ...h.options,
    now: () => new Date(NOW.getTime() + 7_200_000),
  });
  expect(await afterExpiry.recall(QUERY)).toHaveLength(0);
  await h.storage.write(item.target, `\uFEFF${item.trig}`, { contentType, ifMatch: "*" });
  expect(await reopened.recall(QUERY)).toHaveLength(0);
});

it("skips an exact signed copy of a resource that fails promotion's SHACL shape", async () => {
  const h = await harness({ shapes: SHAPES.replace("sh:minCount 1", "sh:minCount 2") });
  const item = await h.memory.proposeRemember(claim);
  const approval = await h.sign(item);
  await expect(h.memory.approveRemember(item.id, approval)).rejects.toThrow("SHACL");

  const name = item.target.slice(CONTAINER.length);
  await h.storage.create(CONTAINER, item.trig, { name, contentType: "application/trig" });
  await h.storage.create(CONTAINER, JSON.stringify(approval), {
    name: `${name}.approval.json`,
    contentType: "application/json",
  });
  expect(await createAgentMemory({ ...h.options, shapes: SHAPES }).recall(QUERY)).toMatchObject([
    { resource: item.target },
  ]);
  expect(await h.memory.recall(QUERY)).toHaveLength(0);
});

async function seed(h: Awaited<ReturnType<typeof harness>>) {
  const preference = (value: string) =>
    createFactAssertion(OWNER, {
      template: "preference",
      value: { propertyID: "scheduling", value },
    });
  const batch: Batch = {
    batch_id: "recall-fixture",
    worker: { agent_id: AGENT, agent_label: "Fixture" },
    sources: [{ id: "source", kind: "document", url: "https://example.org/source" }],
    claims: [
      {
        id: "preference",
        assertion: preference("Afternoons"),
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
        assertion: preference(`Preference marked ${validity}`),
        epistemic: "SelfReportedExplicit" as const,
        categories: ["pd:Preference"],
        validity,
      })),
      { id: "uncategorised", assertion: preference("Uncategorised"), epistemic: "Mentioned" },
    ],
  };
  const data = await buildNanopublications(batch, { owner: OWNER, generatedAt: NOW.toISOString() });
  await seedSigned(h, "all.trig", await serializeNanopublications(data));
  return data;
}

it("defaults to current preferences and removes every filtered sibling graph and quote", async () => {
  const h = await harness({ shapes: scopeShapes });
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

it.each([
  "en-US",
  "EN-US",
  "zh-Hant-TW",
])("preserves %s spelling and assertion identity through recall and reserialization", async (language) => {
  const h = await harness();
  const built = await buildNanopublications(
    {
      batch_id: "language-recall",
      worker: { agent_id: AGENT, agent_label: "Fixture" },
      claims: [
        {
          id: "preference",
          assertion: `<${OWNER}> schema:name "Afternoons"@${language} .`,
          epistemic: "SelfReportedExplicit",
          categories: ["pd:Preference"],
        },
      ],
    },
    { owner: OWNER, generatedAt: NOW.toISOString() },
  );
  await seedSigned(h, "language.trig", await serializeNanopublications(built));

  const results = await h.memory.recall(QUERY);
  expect(results).toHaveLength(1);
  const recalled = results[0] as NonNullable<(typeof results)[0]>;
  const serialized = await serializeNanopublications(recalled);
  expect(serialized).toContain(`"Afternoons"@${language}`);
  const reparsed = await parseNanopublications(serialized);
  for (const result of [recalled, reparsed]) {
    expect(result.nanopubs).toEqual(built.nanopubs);
    expect([...result.dataset].find((q) => q.object.value === "Afternoons")?.object).toMatchObject({
      termType: "Literal",
      language,
    });
  }
});

it("requires every category in the mandate and permits health only when explicitly named", async () => {
  const h = await harness({ shapes: scopeShapes });
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
  const h = await harness({ shapes: scopeShapes });
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
  expect(read.mock.calls.map(([url]) => url)).toEqual([
    `${CONTAINER}all.trig.approval.json`,
    `${CONTAINER}all.trig`,
  ]);
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
  const h = await harness({ shapes: scopeShapes, loadMandate: loader });
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
  await seedSigned(h, "bad.trig", "invalid");
  await expect(
    h.memory.recall({ ...QUERY, categories: ["pd:Preference"], limit: 100 }),
  ).rejects.toThrow();
});

it("excludes claims invalidated by a later revision even if their status remains Current", async () => {
  const h = await harness();
  const batch: Batch = {
    batch_id: "revisions",
    worker: { agent_id: AGENT, agent_label: "Fixture" },
    sources: [{ id: "source", kind: "document", url: "https://example.org/source" }],
    claims: [
      {
        id: "old",
        assertion: createFactAssertion(OWNER, {
          template: "preference",
          value: { propertyID: "scheduling", value: "Mornings" },
        }),
        epistemic: "SelfReportedExplicit",
        categories: ["pd:Preference"],
      },
      {
        id: "new",
        assertion: createFactAssertion(OWNER, {
          template: "preference",
          value: { propertyID: "scheduling", value: "Afternoons" },
        }),
        epistemic: "SelfReportedExplicit",
        categories: ["pd:Preference"],
        supersedes: ["old"],
        evidence: [
          { source: "source", timestamp: "2026-11-01T11:00:00Z", quote: "Now afternoons." },
        ],
      },
    ],
  };
  const data = await buildNanopublications(batch, { owner: OWNER, generatedAt: NOW.toISOString() });
  await seedSigned(h, "revisions.trig", await serializeNanopublications(data));
  expect((await h.memory.recall(QUERY)).map((result) => result.nanopubs[0]?.identifier)).toEqual([
    "revisions/new",
  ]);
});

it("bounds listings and rejects non-TriG resources before parsing", async () => {
  const h = await harness();
  await seed(h);
  // pending/ itself counts toward the bounded container scan.
  const limited = createAgentMemory({ ...h.options, maxResources: 1 });
  await expect(limited.recall({ ...QUERY, about: "urn:example:absent" })).rejects.toThrow(
    "resource limit",
  );
  await seedSigned(h, "invalid.trig", "not RDF", "text/plain");
  await expect(h.memory.recall({ ...QUERY, limit: 100 })).rejects.toThrow("TriG resource");
});

it("snapshots query filters before an asynchronous mandate load", async () => {
  let resolve: (() => void) | undefined;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  const h = await harness({
    loadMandate: async () => {
      await ready;
      return mandate;
    },
  });
  await seed(h);
  const query = { ...QUERY, about: "urn:example:absent" };
  const recalling = h.memory.recall(query);
  query.about = OWNER;
  resolve?.();
  expect(await recalling).toEqual([]);
});
