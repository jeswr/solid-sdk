// AUTHORED-BY Codex GPT-6.1-Sol
import { parseNanopublications } from "@jeswr/pkg-memory";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { expect, it, vi } from "vitest";
import { createAgentMemory } from "../src/index.js";
import { CONTAINER, claim, harness, OWNER, PD, QUERY, SHAPES } from "./helpers.js";

it("stages an owner-typed preference, queues remember, then approves, validates and recalls it", async () => {
  const h = await harness();
  const item = await h.memory.proposeRemember(claim);
  expect(item.kind).toBe("remember");
  expect(item.id).toMatch(new RegExp(`^${CONTAINER}pending/[a-f0-9-]+\\.trig$`));
  expect(h.queue.proposals.get(item.id)).toEqual(item);
  expect(await h.memory.recall(QUERY)).toEqual([]);
  const pending = await parseNanopublications(item.trig);
  expect(pending.nanopubs[0]).toMatchObject({
    epistemic: "SelfReportedExplicit",
    validity: "Current",
    attributedTo: [OWNER],
    categories: [`${PD}Preference`],
  });
  const approval = await h.sign(item);
  expect(await h.memory.approveRemember(item.id, approval)).toBe(item.target);
  await expect(h.storage.read(item.id)).rejects.toMatchObject({ code: "not-found" });
  expect((await h.storage.read(item.target)).contentType).toBe("application/trig");
  const recalled = await h.memory.recall({ ...QUERY, about: OWNER });
  expect(recalled).toHaveLength(1);
  expect(recalled[0]?.nanopubs[0]?.id).toBe(pending.nanopubs[0]?.id);
  expect(await createAgentMemory(h.options).approveRemember(item.id, approval)).toBe(item.target);
});

it("records inferred provenance and its rule plan without owner attribution", async () => {
  const h = await harness();
  const rule = "https://example.org/rules/scheduling";
  const item = await h.memory.proposeRemember({
    ...claim,
    origin: { kind: "inference", source: claim.origin.source, rule },
  });
  const data = await parseNanopublications(item.trig);
  expect(data.nanopubs[0]).toMatchObject({ epistemic: "Inferred", attributedTo: [] });
  expect(
    [...data.dataset]
      .filter((q) => q.predicate.value === "http://www.w3.org/ns/prov#hadPlan")
      .map((q) => q.object.value),
  ).toEqual([rule]);
});

it.each([
  { decision: "deny" as const },
  { expires: "2026-11-01T11:59:59Z" },
  { approves: "https://example.org/other-proposal" },
  { termsDigest: "sha-256:other-content" },
])("keeps pending memory on refused approval %j", async (changes) => {
  const validate = vi.fn(async () => ({ conforms: true, results: [] }));
  const h = await harness({ validator: { validate } });
  const item = await h.memory.proposeRemember(claim);
  await expect(h.memory.approveRemember(item.id, await h.sign(item, changes))).rejects.toThrow(
    "Memory approval refused",
  );
  expect(validate).not.toHaveBeenCalled();
  await expect(h.storage.read(item.target)).rejects.toMatchObject({ code: "not-found" });
  expect((await h.storage.read(item.id)).status).toBe(200);
});

it("rejects unsigned approvals and untrusted WebID keys", async () => {
  const h = await harness();
  const item = await h.memory.proposeRemember(claim);
  await expect(
    h.memory.approveRemember(item.id, { id: "urn:example:approval", document: "" }),
  ).rejects.toThrow("Memory approval refused");
  const other = createAgentMemory({
    ...h.options,
    webIdKeyResolver: {
      resolveKey: async () => h.key.publicKey,
      isControlledBy: async () => false,
    },
  });
  await expect(other.approveRemember(item.id, await h.sign(item))).rejects.toThrow("key");
});

it("binds approvals to the exact pending bytes and destination", async () => {
  const h = await harness();
  const item = await h.memory.proposeRemember(claim);
  const approval = await h.sign(item);
  await h.storage.write(item.id, `${item.trig}\n# altered\n`, {
    contentType: "application/trig",
    ifMatch: (await h.storage.head(item.id)).etag as string,
  });
  await expect(h.memory.approveRemember(item.id, approval)).rejects.toThrow("terms-digest");
  const otherAgent = createAgentMemory({
    ...h.options,
    agentId: "https://example.org/agents/other",
  });
  await expect(otherAgent.approveRemember(item.id, approval)).rejects.toThrow("terms-digest");
});

it("leaves nonconforming data pending under real SHACL validation", async () => {
  const h = await harness({ shapes: SHAPES.replace("sh:minCount 1", "sh:minCount 2") });
  const item = await h.memory.proposeRemember(claim);
  await expect(h.memory.approveRemember(item.id, await h.sign(item))).rejects.toThrow("SHACL");
  await expect(h.storage.read(item.target)).rejects.toMatchObject({ code: "not-found" });
  expect((await h.storage.read(item.id)).status).toBe(200);
});

it("fails closed when the validator is unavailable and recovers on retry", async () => {
  const h = await harness({
    validator: {
      validate: async () => {
        throw new Error("WASM unavailable");
      },
    },
  });
  const item = await h.memory.proposeRemember(claim);
  const approval = await h.sign(item);
  await expect(h.memory.approveRemember(item.id, approval)).rejects.toThrow("WASM unavailable");
  expect((await h.storage.read(item.id)).status).toBe(200);
  const real = createRdfEngine();
  try {
    const retry = createAgentMemory({ ...h.options, validator: real });
    expect(await retry.approveRemember(item.id, approval)).toBe(item.target);
  } finally {
    real.dispose();
  }
});

it("does not promote when approval expires during validation", async () => {
  let at = new Date("2026-11-01T12:00:00Z");
  const h = await harness({
    now: () => at,
    validator: {
      validate: async () => {
        at = new Date("2026-11-01T14:00:00Z");
        return { conforms: true, results: [] };
      },
    },
  });
  const item = await h.memory.proposeRemember(claim);
  await expect(h.memory.approveRemember(item.id, await h.sign(item))).rejects.toThrow("expired");
  await expect(h.storage.read(item.target)).rejects.toMatchObject({ code: "not-found" });
});

it("copies the approved snapshot and preserves a concurrently changed pending resource", async () => {
  const h = await harness();
  const item = await h.memory.proposeRemember(claim);
  const memory = createAgentMemory({
    ...h.options,
    validator: {
      validate: async () => {
        await h.storage.write(item.id, `${item.trig}\n# concurrent change\n`, {
          contentType: "application/trig",
          ifMatch: (await h.storage.head(item.id)).etag as string,
        });
        return { conforms: true, results: [] };
      },
    },
  });
  await expect(memory.approveRemember(item.id, await h.sign(item))).rejects.toMatchObject({
    code: "precondition-failed",
  });
  expect(await (await h.storage.read(item.target)).text()).toBe(item.trig);
  expect(await (await h.storage.read(item.id)).text()).toContain("concurrent change");
});

it("retries copy/delete interruption without overwriting conflicting approved content", async () => {
  const h = await harness();
  const item = await h.memory.proposeRemember(claim);
  const approval = await h.sign(item);
  await h.storage.create(CONTAINER, `${item.trig}\n# other content\n`, {
    name: item.target.split("/").at(-1),
    contentType: "application/trig",
  });
  await expect(h.memory.approveRemember(item.id, approval)).rejects.toThrow(
    "Conflicting approved memory",
  );
  await h.storage.write(item.target, item.trig, {
    contentType: "application/trig",
    ifMatch: (await h.storage.head(item.target)).etag as string,
  });
  expect(await h.memory.approveRemember(item.id, approval)).toBe(item.target);
});

it("keeps queued content after an approval queue outage and rejects unscoped proposal paths", async () => {
  const h = await harness({
    queueApproval: async () => {
      throw new Error("queue unavailable");
    },
  });
  await expect(h.memory.proposeRemember(claim)).rejects.toThrow("queue unavailable");
  const entries = await h.storage.list(`${CONTAINER}pending/`);
  expect(entries.items).toHaveLength(1);
  await expect(
    Promise.resolve().then(() =>
      h.memory.approveRemember("https://example.org/foreign.trig", {
        id: "urn:example:approval",
        document: "",
      }),
    ),
  ).rejects.toThrow("directly contained");
});

it("requires explicit source context, categories and health labels without writing", async () => {
  const h = await harness();
  await expect(h.memory.proposeRemember({ ...claim, categories: [] })).rejects.toThrow(
    "categories",
  );
  await expect(
    h.memory.proposeRemember({ ...claim, origin: { ...claim.origin, quote: "" } }),
  ).rejects.toThrow("quote");
  await expect(
    h.memory.proposeRemember({
      ...claim,
      fact: {
        template: "condition",
        value: { id: "https://example.org/condition", name: "Fictional condition" },
      },
    }),
  ).rejects.toThrow("pd:Health");
  expect((await h.storage.list(`${CONTAINER}pending/`)).items).toHaveLength(0);
});

it("requires strong pending validators before SHACL or promotion", async () => {
  const h = await harness();
  const item = await h.memory.proposeRemember(claim);
  const approval = await h.sign(item);
  const read = h.storage.read.bind(h.storage);
  h.storage.read = async (...args) => ({ ...(await read(...args)), etag: 'W/"weak"' });
  const validate = vi.fn(async () => ({ conforms: true, results: [] }));
  const memory = createAgentMemory({ ...h.options, validator: { validate } });
  await expect(memory.approveRemember(item.id, approval)).rejects.toThrow("strong ETag");
  expect(validate).not.toHaveBeenCalled();
});

it("still validates a completed promotion on retry", async () => {
  const h = await harness();
  const item = await h.memory.proposeRemember(claim);
  const approval = await h.sign(item);
  await h.memory.approveRemember(item.id, approval);
  const retry = createAgentMemory({
    ...h.options,
    validator: { validate: async () => ({ conforms: false, results: [] }) },
  });
  await expect(retry.approveRemember(item.id, approval)).rejects.toThrow("SHACL");
});

it("rejects unscoped containers, missing shapes, unsupported backends and invalid bounds", async () => {
  const h = await harness();
  expect(() =>
    createAgentMemory({ ...h.options, container: "https://foreign.example/memory/" }),
  ).toThrow("scoped");
  expect(() => createAgentMemory({ ...h.options, shapes: "" })).toThrow("SHACL shapes");
  expect(() => createAgentMemory({ ...h.options, maxResourceBytes: 0 })).toThrow("positive");
  expect(() =>
    createAgentMemory({ ...h.options, storage: { ...h.storage, protocol: "lws" } }),
  ).toThrow("scoped");
});
