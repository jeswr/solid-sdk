// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  buildNanopublications,
  classifyNanopublications,
  createFactAssertion,
  NanopubStore,
  parseNanopublications,
  pkgId,
  serializeNanopublications,
} from "@jeswr/pkg-memory";
import { buildMemory, parseMemory } from "@jeswr/solid-memory/memory";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory as df, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_CONTENT_BYTES } from "../src/content.js";
import type { MemoryClientInfo } from "../src/memory-tools.js";
import { createFetchPodPort, type PodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { createPodToolRegistry } from "../src/tools.js";
import { containerTurtle } from "./fake-pod.js";
import { createWacMemoryPodPort } from "./wac-memory-pod.js";

const ROOT = "https://example.org/pod/";
const OWNER = "https://example.org/people/avery#me";
const CLIENT = "https://example.org/clients/one";
const OTHER = "https://example.org/clients/two";
const PROV = "http://www.w3.org/ns/prov#";
const SCHEMA = "https://schema.org/";
const DCT = "http://purl.org/dc/terms/";
const PD = "https://w3id.org/dpv/pd#";
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.restoreAllMocks();
});

function podFixture(): PodPort {
  return createWacMemoryPodPort({ root: ROOT, webId: OWNER });
}
function registry(
  pod: PodPort,
  readOnly = false,
  clientInfo: MemoryClientInfo = { clientId: CLIENT },
) {
  const tools = createPodToolRegistry(pod, readOnly, clientInfo);
  return async (name: string, input: unknown) => {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(`Missing tool ${name}`);
    return tool.handler(input);
  };
}
function text(result: { content: unknown }) {
  return (result.content as { text: string }[]).map((part) => part.text).join("\n");
}
function json(result: { content: unknown; isError?: unknown }) {
  expect(result.isError, text(result)).not.toBe(true);
  return JSON.parse(text(result));
}
const email = { template: "email", value: "avery@example.org" };
const remember = { text: "My email address", fact: email, quote: "Use avery@example.org" };
const recall = { purpose: "ServiceProvision" };
function objects(dataset: DatasetCore, graph: string, subject: string, predicate: string) {
  return [
    ...dataset.match(df.namedNode(subject), df.namedNode(predicate), null, df.namedNode(graph)),
  ].map((quad) => quad.object.value);
}
function graph(dataset: DatasetCore, id: string) {
  return new Store(
    [...dataset.match(null, null, null, df.namedNode(id))].map((q) =>
      df.quad(q.subject, q.predicate, q.object),
    ),
  );
}

async function seed(
  pod: PodPort,
  options: {
    epistemic?: "SelfReportedExplicit" | "Mentioned";
    validity?: "Current" | "Contradicted" | "Historical";
    categories?: string[];
    about?: string;
    agent?: string;
    text?: string;
    batchId?: string;
    generatedAt?: string;
  } = {},
) {
  const store = new NanopubStore(pod);
  await store.writeDefaultPolicy();
  const value = await buildNanopublications(
    {
      batch_id: options.batchId ?? crypto.randomUUID(),
      worker: { agent_id: options.agent ?? CLIENT, agent_label: "fixture" },
      claims: [
        {
          id: "fact",
          assertion:
            options.epistemic === "Mentioned"
              ? buildMemory(`${ROOT}note`, { text: "Fictional note" })
              : createFactAssertion(options.about ?? OWNER, email),
          epistemic: options.epistemic ?? "SelfReportedExplicit",
          validity: options.validity ?? "Current",
          categories: options.categories ?? [`${PD}EmailAddress`],
          attributed_to: OWNER,
          note: options.text ?? "Fictional email",
        },
      ],
    },
    { owner: OWNER, generatedAt: options.generatedAt ?? "2026-10-29T10:00:00Z" },
  );
  await store.put(value);
  return value.nanopubs[0];
}

describe("memory tool contracts", () => {
  it("registers on the portable server and advertises schemas and mutation hints", async () => {
    const pod = podFixture();
    const server = createSolidMcpServer({
      pod,
      readOnly: false,
      clientInfo: { clientId: CLIENT, model: "fixture model" },
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "fixture", version: "1" });
    clients.push(client);
    await Promise.all([client.connect(ct), server.connect(st)]);
    const { tools } = await client.listTools();
    for (const name of ["memory_remember", "memory_recall", "memory_forget"]) {
      const tool = tools.find((tool) => tool.name === name);
      expect(tool?.annotations?.readOnlyHint).toBe(name === "memory_recall");
      expect(tool?.inputSchema.type).toBe("object");
    }
    expect(tools.find((t) => t.name === "memory_recall")?.inputSchema.required).toContain(
      "purpose",
    );
    const saved = json(await client.callTool({ name: "memory_remember", arguments: remember }));
    expect(saved.epistemic).toBe("SelfReportedExplicit");
    expect(
      json(await client.callTool({ name: "memory_recall", arguments: recall })).facts[0].id,
    ).toBe(saved.id);
  });

  it.each([
    [{ quote: "My address" }, "SelfReportedExplicit"],
    [{ quote: "Maybe my address", hedged: true }, "SelfReportedHedged"],
    [{ hedged: true }, "SelfReportedHedged"],
    [{ hedged: false }, "Inferred"],
    [{}, "Inferred"],
  ])("applies the epistemic rule for %j", async (flags, epistemic) => {
    const pod = podFixture();
    const result = json(
      await registry(pod)("memory_remember", { text: "Email", fact: email, ...flags }),
    );
    expect(result.epistemic).toBe(epistemic);
    const stored = await new NanopubStore(pod).get(result.id);
    expect(stored.nanopubs[0].epistemic).toBe(epistemic);
    expect(stored.nanopubs[0].validity).toBe("Current");
  });

  it.each([
    {},
    { quote: "This is a note" },
    { quote: "Maybe a note", hedged: true },
  ])("wraps a free-text solid-memory note as Mentioned (%j)", async (flags) => {
    const pod = podFixture();
    const run = registry(pod);
    const saved = json(
      await run("memory_remember", { text: "A fictional note", about: OWNER, ...flags }),
    );
    expect(saved.epistemic).toBe("Mentioned");
    const store = new NanopubStore(pod);
    const stored = await store.get(saved.id);
    expect(stored.nanopubs).toHaveLength(1);
    expect(
      parseMemory(store.url(saved.id), graph(stored.dataset, stored.nanopubs[0].assertionId)),
    ).toMatchObject({ text: "A fictional note", about: OWNER, attributedTo: OWNER });
    expect(json(await run("memory_recall", recall))).toEqual({ facts: [] });
    const denied = await run("memory_recall", { ...recall, include: ["mentioned"] });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toBe("purpose denied: uncategorized");
    expect(text(denied)).not.toContain("fictional note");
  });

  it("records graph-scoped owner, client, model, conversation and exact quote", async () => {
    const pod = podFixture();
    const info = { clientId: CLIENT, name: "Fixture MCP", model: "Fictional model" };
    const run = registry(pod, false, info);
    const saved = json(
      await run("memory_remember", {
        ...remember,
        conversationId: "conversation/with arbitrary id",
      }),
    );
    const stored = await new NanopubStore(pod).get(saved.id);
    const np = stored.nanopubs[0];
    expect(
      objects(stored.dataset, np.provenanceId, np.assertionId, `${PROV}wasAttributedTo`),
    ).toEqual([OWNER]);
    expect(objects(stored.dataset, np.pubinfoId, np.id, `${PROV}wasAttributedTo`)).toEqual([
      CLIENT,
    ]);
    expect(objects(stored.dataset, np.pubinfoId, np.id, `${SCHEMA}instrument`)).toEqual([
      info.model,
    ]);
    expect(objects(stored.dataset, np.pubinfoId, np.id, `${DCT}isPartOf`)).toEqual([
      "conversation/with arbitrary id",
    ]);
    expect(np.evidence[0].quote).toBe(remember.quote);
    const recalled = json(await run("memory_recall", recall)).facts[0];
    expect(recalled).toMatchObject({
      id: saved.id,
      belief: "definitely",
      epistemic: "SelfReportedExplicit",
      validity: "Current",
      provenanceId: np.provenanceId,
      provenance: {
        owner: [OWNER],
        clientId: CLIENT,
        model: info.model,
        conversationId: "conversation/with arbitrary id",
      },
    });
    expect(recalled.date).toBe(np.generatedAt);
    expect(recalled.assertion).toContain("mailto:avery@example.org");
    info.clientId = OTHER;
    expect(json(await run("memory_remember", remember)).id).toBeTruthy();
    const all = await new NanopubStore(pod).list();
    expect(all.nanopubs.every((np) => np.agent === CLIENT)).toBe(true);
  });

  it.each([
    {
      template: "address",
      value: {
        id: "urn:example:home",
        locality: "Example town",
        country: "GB",
        validFrom: { value: "2026-01", datatype: "gYearMonth" },
      },
    },
    { template: "phone", value: "+44 123 4567" },
    { template: "preference", value: { propertyID: "theme", value: "dark" } },
    { template: "condition", value: { id: "urn:example:condition", name: "Fictional condition" } },
    { template: "allergy", value: { id: "urn:example:allergy", name: "Fictional allergy" } },
    {
      template: "medication",
      value: {
        id: "urn:example:statement",
        medication: { id: "urn:example:drug", name: "Fictional drug" },
      },
    },
    {
      template: "relationship",
      value: {
        id: "urn:example:role",
        person: "https://example.org/people/sam",
        roleName: "friend",
      },
    },
  ])("accepts the $template fact template", async (fact) => {
    const pod = podFixture();
    const saved = json(
      await registry(pod)("memory_remember", {
        text: "Fictional fact",
        fact,
        quote: "I said this",
      }),
    );
    expect((await new NanopubStore(pod).get(saved.id)).nanopubs[0].categories).not.toHaveLength(0);
  });
});

describe("memory recall", () => {
  it("defaults to definitely and Current; include opts into each other belief", async () => {
    const pod = podFixture();
    const run = registry(pod);
    const current = await seed(pod);
    await seed(pod, { validity: "Contradicted" });
    await seed(pod, { validity: "Historical" });
    await seed(pod, { epistemic: "Mentioned" });
    json(await run("memory_remember", { text: "An inferred email", fact: email }));
    json(await run("memory_remember", { text: "A hedged email", fact: email, hedged: true }));
    expect(json(await run("memory_recall", recall)).facts.map((fact) => fact.id)).toEqual([
      current.id,
    ]);
    const all = json(
      await run("memory_recall", { ...recall, include: ["might", "mentioned", "past"] }),
    ).facts;
    expect(all).toHaveLength(6);
    expect(new Set(all.map((fact) => fact.belief))).toEqual(
      new Set(["definitely", "might", "mentioned", "past"]),
    );
    expect(all.filter((fact) => fact.epistemic === "SelfReportedHedged")[0].hedge).toBe("hedged");
  });

  it("filters query, subject, categories and limit, including case-insensitive assertion values", async () => {
    const pod = podFixture();
    const run = registry(pod);
    const about = "https://example.org/people/sam";
    const first = json(
      await run("memory_remember", { ...remember, about, text: "Alternate email" }),
    );
    json(await run("memory_remember", remember));
    const filter = {
      ...recall,
      about,
      query: "AVERY@EXAMPLE.ORG",
      categories: [`${PD}EmailAddress`],
      limit: 1,
    };
    expect(json(await run("memory_recall", filter)).facts.map((fact) => fact.id)).toEqual([
      first.id,
    ]);
    expect(json(await run("memory_recall", { ...filter, query: "no match" })).facts).toEqual([]);
    expect(
      json(await run("memory_recall", { ...filter, categories: [`${PD}Preference`] })).facts,
    ).toEqual([]);
    expect(json(await run("memory_recall", { ...recall, limit: 1 })).facts).toHaveLength(1);
  });

  it.each([
    {
      precision: "whole and fractional seconds",
      dates: [
        "2026-10-29T10:00:00Z",
        "2026-10-29T10:00:00.100000Z",
        "2026-10-29T10:00:00.999999Z",
        "2026-10-29T10:00:01Z",
      ],
    },
    {
      precision: "microseconds within a millisecond",
      dates: [
        "2026-10-29T10:00:00Z",
        "2026-10-29T10:00:00.000001Z",
        "2026-10-29T10:00:00.000002Z",
        "2026-10-29T10:00:00.000999Z",
      ],
    },
    {
      precision: "timezone offsets and microseconds",
      dates: [
        "2026-10-29T11:00:00.000001+01:00",
        "2026-10-29T05:00:00.000002-05:00",
        "2026-10-29T10:00:00.100000Z",
        "2026-10-30T00:00:00.100001+14:00",
      ],
    },
  ])("sorts $precision chronologically before applying the limit", async ({ dates }) => {
    const pod = podFixture();
    const run = registry(pod);
    // Increasing IDs oppose newest-first order, exposing lost submillisecond precision.
    const batches = dates
      .map((_, index) => `recall-${index}`)
      .sort((a, b) => pkgId("np", a, "fact").localeCompare(pkgId("np", b, "fact")));
    const saved = [];
    for (const [index, generatedAt] of dates.entries())
      saved.push(await seed(pod, { batchId: batches[index], generatedAt }));
    const expected = saved.toReversed().map((np) => np.id);
    expect(json(await run("memory_recall", recall)).facts.map((fact) => fact.id)).toEqual(expected);
    expect(
      json(await run("memory_recall", { ...recall, limit: 1 })).facts.map((fact) => fact.id),
    ).toEqual(expected.slice(0, 1));
  });

  it.each([
    ["2026-10-29T10:00:00Z", "2026-10-29T12:00:00.000000+02:00", "2026-10-29T05:00:00-05:00"],
    [
      "2026-10-29T10:00:00.123456Z",
      "2026-10-29T12:00:00.123456+02:00",
      "2026-10-29T05:00:00.123456-05:00",
    ],
  ])("breaks equal-instant ties by ID for %s", async (...dates) => {
    const pod = podFixture();
    const saved = [];
    for (const generatedAt of dates) saved.push(await seed(pod, { generatedAt }));
    const expected = saved.map((np) => np.id).sort((a, b) => a.localeCompare(b));
    const run = registry(pod);
    expect(json(await run("memory_recall", recall)).facts.map((fact) => fact.id)).toEqual(expected);
    const list = pod.list;
    pod.list = async (container) => (await list(container)).toReversed();
    expect(
      json(await run("memory_recall", { ...recall, limit: 1 })).facts.map((fact) => fact.id),
    ).toEqual(expected.slice(0, 1));
  });

  it("evaluates policy per call and never discloses denied values", async () => {
    const pod = podFixture();
    const run = registry(pod);
    const saved = json(
      await run("memory_remember", {
        text: "PRIVATE medical detail",
        fact: {
          template: "condition",
          value: { id: "urn:example:private-condition", name: "PRIVATE diagnosis" },
        },
        quote: "PRIVATE quote",
      }),
    );
    const result = await run("memory_recall", recall);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("purpose denied: MedicalHealth");
    expect(text(result)).not.toContain("PRIVATE");
    expect(text(result)).not.toContain(saved.id);
    const store = new NanopubStore(pod);
    const policy = await pod.read(store.policyUrl);
    // Existing owner edits are authoritative and not replaced by a permissive default.
    await pod.write(
      store.policyUrl,
      new TextEncoder().encode("malformed policy PRIVATE"),
      "text/turtle",
      { ifMatch: policy.etag },
    );
    expect(text(await run("memory_recall", recall))).toBe("Pod operation failed");
    expect(new TextDecoder().decode((await pod.read(store.policyUrl)).body)).toBe(
      "malformed policy PRIVATE",
    );
  });

  it("returns the same denial before matching queries, subjects or assertion objects", async () => {
    const pod = podFixture();
    const run = registry(pod);
    const allowed = await seed(pod);
    const medicalSubject = "https://example.org/people/private-patient";
    const relative = "https://example.org/people/private-relative";
    const denied = [
      json(
        await run("memory_remember", {
          text: "PRIVATE medical detail",
          about: medicalSubject,
          fact: {
            template: "condition",
            value: { id: "urn:example:private-condition", name: "PRIVATE diagnosis" },
          },
          quote: "PRIVATE quote",
        }),
      ),
      json(
        await run("memory_remember", {
          text: "PRIVATE relationship detail",
          fact: {
            template: "relationship",
            value: { id: "urn:example:private-role", person: relative, roleName: "sibling" },
          },
          quote: "PRIVATE relative",
        }),
      ),
    ];
    const baseline = await run("memory_recall", recall);
    expect(baseline.isError).toBe(true);
    expect(text(baseline)).toBe("purpose denied: MedicalHealth, SocialNetwork");
    for (const filter of [
      { query: "PRIVATE medical detail" },
      { query: "PRIVATE diagnosis" },
      { query: "PRIVATE relationship detail" },
      { query: "no matching data" },
      { about: medicalSubject },
      { about: relative },
      { about: "https://example.org/people/absent" },
      { query: "Fictional email", about: OWNER, limit: 1 },
      { query: "no matching data", about: relative, limit: 1 },
    ])
      expect(await run("memory_recall", { ...recall, ...filter })).toEqual(baseline);
    expect(text(baseline)).not.toContain("PRIVATE");
    for (const saved of denied) expect(text(baseline)).not.toContain(saved.id);
    expect(
      json(
        await run("memory_recall", {
          ...recall,
          categories: [`${PD}EmailAddress`],
          query: "Fictional email",
          about: OWNER,
        }),
      ).facts.map((fact) => fact.id),
    ).toEqual([allowed.id]);
  });

  it("supports read-only recall with an existing policy and returns an empty fresh collection", async () => {
    const pod = podFixture();
    await new NanopubStore(pod).writeDefaultPolicy();
    const write = vi.spyOn(pod, "write");
    expect(json(await registry(pod, true)("memory_recall", recall))).toEqual({ facts: [] });
    expect(write).not.toHaveBeenCalled();
    const list = pod.list;
    pod.list = async () => {
      throw Object.assign(new Error("missing HTTP 404"), { status: 404 });
    };
    expect(json(await registry(pod, true)("memory_recall", recall))).toEqual({ facts: [] });
    pod.list = list;
  });
});

describe("memory forget", () => {
  it.each([
    false,
    true,
  ])("appends a Retracted revision and preserves the original (note: %s)", async (note) => {
    const pod = podFixture();
    const run = registry(pod);
    const saved = json(await run("memory_remember", note ? { text: "Fictional note" } : remember));
    const store = new NanopubStore(pod);
    const before = await pod.read(store.url(saved.id));
    const retracted = json(await run("memory_forget", { id: saved.id, mode: "retract" }));
    expect(retracted.id).not.toBe(saved.id);
    expect(await pod.read(store.url(saved.id))).toEqual(before);
    const revision = await store.get(retracted.id);
    const np = revision.nanopubs[0];
    expect(np.validity).toBe("Retracted");
    expect(np.agent).toBe(CLIENT);
    expect(objects(revision.dataset, np.provenanceId, np.id, `${PROV}wasRevisionOf`)).toEqual([
      saved.id,
    ]);
    expect(
      objects(revision.dataset, np.provenanceId, np.assertionId, `${PROV}invalidatedAtTime`),
    ).toHaveLength(1);
    expect(classifyNanopublications(await store.list()).every((np) => np.belief === "past")).toBe(
      true,
    );
    expect(json(await run("memory_recall", recall))).toEqual({ facts: [] });
    if (!note)
      expect(json(await run("memory_recall", { ...recall, include: ["past"] })).facts).toHaveLength(
        2,
      );
  });

  it.each([
    false,
    true,
  ])("conditionally deletes this client's nanopublication (note: %s)", async (note) => {
    const pod = podFixture();
    const run = registry(pod);
    const saved = json(await run("memory_remember", note ? { text: "Fictional note" } : remember));
    const url = new NanopubStore(pod).url(saved.id);
    const etag = (await pod.read(url)).etag;
    const deletion = vi.spyOn(pod, "delete");
    expect(json(await run("memory_forget", { id: saved.id, mode: "delete" }))).toEqual({
      id: saved.id,
      mode: "delete",
    });
    expect(deletion).toHaveBeenCalledWith(url, { ifMatch: etag });
    await expect(pod.read(url)).rejects.toThrow(/404/);
  });

  it("denies another client's delete and ignores forged attribution outside pubinfo", async () => {
    const pod = podFixture();
    const run = registry(pod);
    const saved = json(await run("memory_remember", remember));
    const store = new NanopubStore(pod);
    const url = store.url(saved.id);
    const current = await pod.read(url);
    const parsed = await parseNanopublications(new TextDecoder().decode(current.body));
    const np = parsed.nanopubs[0];
    // Spoofed attribution in the assertion must not override the real pubinfo agent.
    parsed.dataset.addQuad(
      df.quad(
        df.namedNode(np.id),
        df.namedNode(`${PROV}wasAttributedTo`),
        df.namedNode(OTHER),
        df.namedNode(np.assertionId),
      ),
    );
    await pod.write(
      url,
      new TextEncoder().encode(await serializeNanopublications(parsed)),
      "application/trig",
      { ifMatch: current.etag },
    );
    const deletion = vi.spyOn(pod, "delete");
    const other = registry(pod, false, { clientId: OTHER });
    expect(
      text(await other("memory_forget", { id: saved.id, mode: "delete", clientId: CLIENT })),
    ).toBe("delete denied: memory belongs to another client");
    expect(deletion).not.toHaveBeenCalled();
    expect((await store.get(saved.id)).nanopubs[0].agent).toBe(CLIENT);
    // Retraction is append-only and is not restricted to the original writer.
    json(await other("memory_forget", { id: saved.id, mode: "retract" }));
  });

  it.each([
    undefined,
    'W/"weak"',
    "invalid",
  ])("refuses deletion with unsafe ETag %s", async (etag) => {
    const pod = podFixture();
    const run = registry(pod);
    const saved = json(await run("memory_remember", remember));
    const read = pod.read;
    const url = new NanopubStore(pod).url(saved.id);
    pod.read = async (target, options) => ({
      ...(await read(target, options)),
      ...(target === url ? { etag } : {}),
    });
    const deletion = vi.spyOn(pod, "delete");
    expect((await run("memory_forget", { id: saved.id, mode: "delete" })).isError).toBe(true);
    expect(deletion).not.toHaveBeenCalled();
  });

  it("fails a conditional delete if the resource changed after attribution was checked", async () => {
    const pod = podFixture();
    const run = registry(pod);
    const saved = json(await run("memory_remember", remember));
    const remove = pod.delete;
    pod.delete = async (url, condition) => {
      const previous = await pod.read(url);
      await pod.write(url, previous.body, previous.contentType, { ifMatch: previous.etag });
      return remove(url, condition);
    };
    expect((await run("memory_forget", { id: saved.id, mode: "delete" })).isError).toBe(true);
    expect((await new NanopubStore(pod).get(saved.id)).nanopubs[0].agent).toBe(CLIENT);
  });
});

describe("memory serialized write limits", () => {
  it.each([
    "fact",
    "note",
    "metadata",
  ])("rejects serialized %s overflow before persistence", async (kind) => {
    const pod = podFixture();
    const run = registry(pod);
    const saved = json(await run("memory_remember", remember));
    const largeText = "é".repeat(MAX_CONTENT_BYTES / 2);
    const input =
      kind === "note"
        ? { text: largeText }
        : kind === "metadata"
          ? { ...remember, conversationId: largeText }
          : { ...remember, text: largeText };
    const write = vi.spyOn(pod, "write");
    const rejected = await run("memory_remember", input);
    expect(rejected.isError).toBe(true);
    expect(text(rejected)).toBe("Pod operation failed");
    expect(write.mock.calls.some(([url]) => url.endsWith(".trig"))).toBe(false);
    expect(write.mock.calls.every(([, body]) => body.byteLength <= MAX_CONTENT_BYTES)).toBe(true);
    expect(json(await run("memory_recall", recall)).facts.map((fact) => fact.id)).toEqual([
      saved.id,
    ]);
    json(await run("memory_remember", remember));
    json(await run("memory_forget", { id: saved.id, mode: "delete" }));
  });

  it("rejects an oversized retraction while preserving the readable original", async () => {
    const pod = podFixture();
    const run = registry(pod);
    const store = new NanopubStore(pod);
    const input = {
      text: "Preference",
      quote: "Preference",
      fact: { template: "preference", value: { propertyID: "fixture", value: "x" } },
    };
    const small = json(await run("memory_remember", input));
    const overhead = (await pod.read(store.url(small.id))).body.byteLength - 1;
    const saved = json(
      await run("memory_remember", {
        ...input,
        fact: {
          ...input.fact,
          // Escapes approach the serialized byte cap without exhausting the RDF term budget.
          value: {
            ...input.fact.value,
            value: "\\".repeat(Math.floor((MAX_CONTENT_BYTES - overhead - 64) / 2)),
          },
        },
      }),
    );
    const original = await pod.read(store.url(saved.id));
    expect(original.body.byteLength).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
    expect(original.body.byteLength).toBeGreaterThan(MAX_CONTENT_BYTES - 128);
    const write = vi.spyOn(pod, "write");
    expect((await run("memory_forget", { id: saved.id, mode: "retract" })).isError).toBe(true);
    expect(write.mock.calls.some(([url]) => url.endsWith(".trig"))).toBe(false);
    expect(await pod.read(store.url(saved.id))).toEqual(original);
    expect(json(await run("memory_recall", recall)).facts).toHaveLength(2);
    json(await run("memory_forget", { id: saved.id, mode: "delete" }));
  });
});

describe("memory security boundaries", () => {
  it.each([
    true,
    undefined,
  ])("blocks mutations independently when server readOnly is %s", async (readOnly) => {
    const pod = podFixture();
    const write = vi.spyOn(pod, "write");
    const tools = createPodToolRegistry(pod, readOnly, { clientId: CLIENT });
    for (const [name, input] of [
      ["memory_remember", remember],
      ["memory_forget", { id: "urn:uuid:invalid", mode: "delete" }],
    ] as const) {
      const result = await tools.find((tool) => tool.name === name).handler(input);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("read-only");
    }
    expect(write).not.toHaveBeenCalled();
  });

  it("requires an explicit owner and client identity, without pod I/O", async () => {
    for (const missing of ["owner", "client", "unsafe client"]) {
      const pod = podFixture();
      if (missing === "owner") Object.assign(pod, { webId: "" });
      const read = vi.spyOn(pod, "read");
      const tools = createPodToolRegistry(
        pod,
        false,
        missing === "client"
          ? undefined
          : { clientId: missing === "unsafe client" ? "urn:evil:> <urn:p>" : CLIENT },
      );
      expect(
        (await tools.find((tool) => tool.name === "memory_remember").handler(remember)).isError,
      ).toBe(true);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it.each([
    {
      text: "x",
      fact: {
        template: "address",
        value: { id: "https://example.org/> <urn:injected>", locality: "x", country: "x" },
      },
    },
    { text: "x", fact: email, about: "https://example.org/> <urn:injected>" },
    { text: "x", fact: { template: "email", value: "avery@example.org> . <urn:injected>" } },
    { text: "x", fact: email, quote: "a".repeat(301) },
    { text: "x", fact: { template: "unknown", value: "x" } },
    { text: "" },
  ])("rejects invalid or injecting input before writes: %j", async (input) => {
    const pod = podFixture();
    const write = vi.spyOn(pod, "write");
    expect((await registry(pod)("memory_remember", input)).isError).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it("round-trips adversarial literals without adding RDF statements", async () => {
    const pod = podFixture();
    const literal = '" . <urn:injected> <urn:p> <urn:o> . #';
    const saved = json(
      await registry(pod, false, { clientId: CLIENT, model: literal })("memory_remember", {
        text: literal,
        quote: literal,
        conversationId: literal,
        fact: { template: "preference", value: { propertyID: "test", value: literal } },
      }),
    );
    const stored = await new NanopubStore(pod).get(saved.id);
    expect([...stored.dataset].some((q) => q.subject.value === "urn:injected")).toBe(false);
    expect(stored.nanopubs[0].evidence[0].quote).toBe(literal);
  });

  it("requires a closed purpose and validates include and limit", async () => {
    const pod = podFixture();
    const read = vi.spyOn(pod, "read");
    const run = registry(pod);
    for (const input of [
      {},
      { purpose: "Advertising" },
      { ...recall, limit: 0 },
      { ...recall, limit: 101 },
      { ...recall, include: ["all"] },
    ])
      expect((await run("memory_recall", input)).isError).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    "https://evil.example/leak",
    ROOT,
    `${ROOT}../other`,
    "urn:uuid:invalid",
    `${ROOT}private/pkg/mcp-policy.ttl`,
  ])("never reads client-selected forget target %s", async (id) => {
    const pod = podFixture();
    const read = vi.spyOn(pod, "read");
    expect((await registry(pod)("memory_forget", { id, mode: "delete" })).isError).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it("uses the current decorated PodPort and keeps denial diagnostics free of data", async () => {
    const pod = podFixture();
    const run = registry(pod);
    const saved = json(await run("memory_remember", remember));
    const read = pod.read;
    const url = new NanopubStore(pod).url(saved.id);
    pod.read = async (target, options) => {
      if (target === url) throw new Error(`purpose denied: PRIVATE ${remember.text} ${url}`);
      return read(target, options);
    };
    const result = await run("memory_recall", recall);
    expect(text(result)).toBe("purpose denied");
    expect(result.isError).toBe(true);
    expect(text(await run("memory_forget", { id: saved.id, mode: "delete" }))).toBe(
      "purpose denied",
    );
  });

  it("ignores poisoned listing entries and fails closed before data writes if ACLs are denied", async () => {
    const pod = podFixture();
    const list = pod.list;
    pod.list = async (container) => [
      ...(await list(container)),
      { url: "https://evil.example/leak.trig", isContainer: false },
      { url: `${ROOT}private/pkg/mcp/../secret.trig`, isContainer: false },
    ];
    const read = vi.spyOn(pod, "read");
    const run = registry(pod);
    json(await run("memory_remember", remember));
    expect(json(await run("memory_recall", recall)).facts).toHaveLength(1);
    expect(read.mock.calls.every(([url]) => url.startsWith(ROOT) && !url.includes("../"))).toBe(
      true,
    );
    const deniedPod = podFixture();
    const write = vi
      .spyOn(deniedPod, "write")
      .mockRejectedValue(new Error("ACL forbidden PRIVATE"));
    expect((await registry(deniedPod)("memory_remember", remember)).isError).toBe(true);
    expect(write.mock.calls.every(([url]) => url.endsWith(".acl"))).toBe(true);
  });
});

describe("additional memory boundary regressions", () => {
  it("works through legacy fetch configuration with conditional private writes", async () => {
    const backing = podFixture();
    const requests: { url: string; method: string }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      const headers = new Headers(init?.headers);
      if (method === "HEAD")
        return new Response(null, { status: 404, headers: { link: `<${url}.acl>; rel="acl"` } });
      const cond = {
        ...(headers.has("if-match") ? { ifMatch: headers.get("if-match") as string } : {}),
        ...(headers.has("if-none-match") ? { ifNoneMatch: "*" as const } : {}),
      };
      try {
        if (method === "PUT") {
          const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
          const written = await backing.write(url, bytes, headers.get("content-type") ?? "", cond);
          return new Response(null, { status: 201, headers: { etag: written.etag as string } });
        }
        if (method === "DELETE") {
          await backing.delete(url, cond);
          return new Response(null, { status: 204 });
        }
        const read = await backing.read(url);
        const body = url.endsWith("/")
          ? containerTurtle(
              url,
              (await backing.list(url)).map((entry) => ({
                name: entry.url.slice(url.length),
                container: entry.isContainer,
              })),
            )
          : read.body;
        return new Response(body, {
          headers: { "content-type": read.contentType, etag: read.etag as string },
        });
      } catch (error) {
        return new Response(null, { status: (error as { status: number }).status ?? 500 });
      }
    };
    const server = createSolidMcpServer({
      fetch,
      podRoot: ROOT,
      webId: OWNER,
      readOnly: false,
      clientInfo: { clientId: CLIENT },
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "legacy fixture", version: "1" });
    clients.push(client);
    await Promise.all([client.connect(ct), server.connect(st)]);
    const saved = json(await client.callTool({ name: "memory_remember", arguments: remember }));
    expect(
      json(await client.callTool({ name: "memory_recall", arguments: recall })).facts[0].id,
    ).toBe(saved.id);
    json(
      await client.callTool({ name: "memory_forget", arguments: { id: saved.id, mode: "delete" } }),
    );
    expect(requests.every(({ url }) => url.startsWith(ROOT))).toBe(true);
    expect(requests.find(({ method }) => method === "PUT")?.url).toBe(`${ROOT}private/.acl`);
    const readonlyAdapter = createFetchPodPort({ fetch, podRoot: ROOT, webId: OWNER });
    expect((await registry(readonlyAdapter)("memory_remember", remember)).isError).toBe(true);
  });

  it.each([
    true,
    false,
  ])("does not write a missing policy (server readOnly: %s)", async (readOnly) => {
    const pod = podFixture();
    const write = vi.spyOn(pod, "write");
    expect(text(await registry(pod, readOnly)("memory_recall", recall))).toBe(
      "write disabled: server is read-only",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    [new Error("container HTTP 404"), false],
    [new Error("container HTTP 500 PRIVATE"), true],
    [new Error("offline"), true],
    ["offline", true],
    [{ status: "404" }, true],
    [null, true],
  ])("handles missing listings and propagates other listing failures: %j", async (error, fails) => {
    const pod = podFixture();
    await new NanopubStore(pod).writeDefaultPolicy();
    pod.list = async () => {
      throw error;
    };
    const result = await registry(pod, true)("memory_recall", recall);
    expect(result.isError === true).toBe(fails);
    if (!fails) expect(json(result)).toEqual({ facts: [] });
    expect(text(result)).not.toContain("PRIVATE");
  });

  it("does not turn a missing listed nanopublication into an empty successful recall", async () => {
    const pod = podFixture();
    await seed(pod);
    const read = pod.read;
    pod.read = async (url, options) => {
      if (url.endsWith(".trig")) throw Object.assign(new Error("HTTP 404"), { status: 404 });
      return read(url, options);
    };
    expect((await registry(pod, true)("memory_recall", recall)).isError).toBe(true);
  });

  it("redacts unknown category identifiers from denial diagnostics", async () => {
    const pod = podFixture();
    await seed(pod, { categories: ["urn:example:PRIVATE-category"] });
    const result = await registry(pod, true)("memory_recall", recall);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("purpose denied: unsupported category");
  });
});

it("honors owner policy edits, the calling client, and the requested purpose on every recall", async () => {
  const pod = podFixture();
  const run = registry(pod);
  json(await run("memory_remember", remember));
  expect(json(await run("memory_recall", { purpose: "Personalisation" })).facts).toHaveLength(1);
  const store = new NanopubStore(pod);
  const policy = await pod.read(store.policyUrl);
  const body = `
    @prefix odrl: <http://www.w3.org/ns/odrl/2/> .
    <${store.policyUrl}> a odrl:Set ; odrl:permission [
      odrl:action odrl:read ; odrl:target <${PD}EmailAddress> ;
      odrl:assignee <${CLIENT}> ; odrl:constraint [
        odrl:leftOperand odrl:purpose ; odrl:operator odrl:eq ;
        odrl:rightOperand <https://w3id.org/dpv#ServiceProvision>
      ]
    ] .`;
  await pod.write(store.policyUrl, new TextEncoder().encode(body), "text/turtle", {
    ifMatch: policy.etag,
  });
  expect(json(await run("memory_recall", recall)).facts).toHaveLength(1);
  expect(text(await run("memory_recall", { purpose: "Personalisation" }))).toBe(
    "purpose denied: EmailAddress",
  );
  expect(text(await registry(pod, true, { clientId: OTHER })("memory_recall", recall))).toBe(
    "purpose denied: EmailAddress",
  );
  expect(new TextDecoder().decode((await pod.read(store.policyUrl)).body)).toBe(body);
});

it.each([
  "MedicalHealth",
  "Financial",
])("audits permitted %s recall and withholds results when audit cannot commit", async (category) => {
  const pod = podFixture();
  await seed(pod, { categories: [`${PD}${category}`] });
  const store = new NanopubStore(pod);
  await pod.write(
    store.policyUrl,
    new TextEncoder().encode(`
    @prefix odrl: <http://www.w3.org/ns/odrl/2/> .
    <${store.policyUrl}> a odrl:Set ; odrl:permission [
      odrl:action odrl:read ; odrl:target <${PD}${category}> ; odrl:assignee <${CLIENT}> ;
      odrl:constraint [ odrl:leftOperand odrl:purpose ; odrl:operator odrl:eq ;
        odrl:rightOperand <https://w3id.org/dpv#ServiceProvision> ]
    ] .`),
    "text/turtle",
    {},
  );
  const result = json(await registry(pod)("memory_recall", recall));
  expect(result.facts).toHaveLength(1);
  const auditUrl = `${ROOT}private/pkg/audit/${new Date().toISOString().slice(0, 7)}.ttl`;
  const audit = new TextDecoder().decode((await pod.read(auditUrl)).body);
  expect(audit).toContain(CLIENT);
  expect(audit).toContain(`${PD}${category}`);
  expect(audit).not.toContain("Fictional email");
  const readOnly = await registry(pod, true)("memory_recall", recall);
  expect(readOnly.isError).toBe(true);
  expect(text(readOnly)).not.toContain("Fictional email");
  const write = pod.write;
  pod.write = async (url, ...args) => {
    if (url.includes("/audit/")) throw new Error("PRIVATE error");
    return write(url, ...args);
  };
  const failed = await registry(pod)("memory_recall", { ...recall, query: "no match" });
  expect(failed.isError).toBe(true);
  expect(text(failed)).not.toContain("PRIVATE");
});
