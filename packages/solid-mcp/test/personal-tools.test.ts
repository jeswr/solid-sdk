// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildNanopublications,
  createFactAssertion,
  type Fact,
  NanopubStore,
  parseAssertion,
} from "@jeswr/pkg-memory";
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DataFactory as df, Parser } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { temporalRange } from "../src/personal-tools.js";
import type { PodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { createPodToolRegistry } from "../src/tools.js";

const ROOT = "https://example.org/pod/";
const OWNER = `${ROOT}profile/card#me`;
const CLIENT = "https://example.org/client";
const PD = "https://w3id.org/dpv/pd#";
const PROV = "http://www.w3.org/ns/prov#";
const POLICY = `${ROOT}private/pkg/mcp-policy.ttl`;
const purpose = "ServiceProvision";
const encoder = new TextEncoder();
const clients: Client[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});
function fixture() {
  return createMemoryPodPort({ root: ROOT, webId: OWNER });
}
function run(pod: PodPort, readOnly = false, clientId = CLIENT) {
  const tools = createPodToolRegistry(pod, readOnly, { clientId });
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
async function put(pod: PodPort, url: string, body: string) {
  return pod.write(url, encoder.encode(body), "text/turtle", {});
}
async function permit(pod: PodPort, categories: string[], client = CLIENT) {
  await put(
    pod,
    POLICY,
    `
    @prefix odrl: <http://www.w3.org/ns/odrl/2/> .
    <${POLICY}> a odrl:Set ; odrl:permission ${categories
      .map(
        (category) => `[
      odrl:action odrl:read ; odrl:target <${PD}${category}> ;
      odrl:assignee <${client}> ; odrl:constraint [
        odrl:leftOperand odrl:purpose ; odrl:operator odrl:eq ;
        odrl:rightOperand <https://w3id.org/dpv#ServiceProvision>
      ]
    ]`,
      )
      .join(",")} .`,
  );
}
async function seed(
  pod: PodPort,
  fact: Fact,
  category: string,
  options: {
    epistemic?: "SelfReportedExplicit" | "SelfReportedHedged" | "Mentioned";
    validity?: "Current" | "Historical" | "Contradicted";
    about?: string;
    categories?: string[];
    assertion?: string;
  } = {},
) {
  const store = new NanopubStore(pod);
  await store.writeDefaultPolicy();
  const value = await buildNanopublications(
    {
      batch_id: crypto.randomUUID(),
      worker: { agent_id: CLIENT, agent_label: "Fixture" },
      claims: [
        {
          id: "fact",
          assertion: options.assertion
            ? await parseAssertion(options.assertion, OWNER)
            : createFactAssertion(options.about ?? OWNER, fact),
          epistemic: options.epistemic ?? "SelfReportedExplicit",
          validity: options.validity ?? "Current",
          attributed_to: OWNER,
          categories: options.categories ?? [PD + category],
        },
      ],
    },
    { owner: OWNER, generatedAt: "2026-10-30T12:00:00Z" },
  );
  await store.put(value);
  const np = value.nanopubs[0];
  if (!np) throw new Error("Missing fixture nanopub");
  return np;
}
const condition: Fact = {
  template: "condition",
  value: { id: "https://example.org/condition", name: "Fictional condition" },
};

it("advertises all personal tools with required closed purposes over MCP", async () => {
  const server = createSolidMcpServer({ pod: fixture(), clientInfo: { clientId: CLIENT } });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fixture", version: "1" });
  clients.push(client);
  await Promise.all([client.connect(ct), server.connect(st)]);
  const { tools } = await client.listTools();
  for (const name of ["profile_get", "address_get", "health_query"]) {
    const tool = tools.find((tool) => tool.name === name);
    expect(tool?.inputSchema.required).toContain("purpose");
    expect(tool?.inputSchema.properties?.purpose).toMatchObject({
      enum: ["ServiceProvision", "Personalisation"],
    });
    for (const value of [undefined, "Advertising", "https://w3id.org/dpv#ServiceProvision"]) {
      expect(
        (await client.callTool({ name, arguments: { purpose: value, kind: "conditions" } }))
          .isError,
      ).toBe(true);
    }
  }
});

it("projects only the owner's profile contacts after checking Contact policy", async () => {
  const pod = fixture();
  await new NanopubStore(pod).writeDefaultPolicy();
  await put(
    pod,
    OWNER,
    `
    @prefix v: <http://www.w3.org/2006/vcard/ns#> .
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    <${OWNER}> v:fn "Avery" ; v:hasEmail <mailto:avery@example.org>, [v:hasValue <mailto:other@example.org>] ;
      v:hasTelephone <tel:+1234567>, [v:hasValue <tel:+7654321>] ; foaf:topic "private unrelated value" .
    <https://example.org/other> v:fn "Other person" ; v:hasEmail <mailto:secret@example.org> .`,
  );
  expect(json(await run(pod)("profile_get", { purpose }))).toEqual({
    name: "Avery",
    emails: ["avery@example.org", "other@example.org"],
    phones: ["+1234567", "+7654321"],
  });
  await permit(pod, ["Contact"], "https://example.org/another-client");
  const denied = await run(pod)("profile_get", { purpose });
  expect(denied.isError).toBe(true);
  expect(text(denied)).toBe("purpose denied: Contact");
});

it("filters the address timeline inclusively, retaining definitely and Current", async () => {
  const pod = fixture();
  for (const [locality, from, through, options] of [
    ["Oldtown", "2024", "2025-06", {}],
    ["Newtown", "2025-07", undefined, {}],
    ["Uncertain", "2024", undefined, { epistemic: "SelfReportedHedged" as const }],
    ["Historical", "2024", undefined, { validity: "Historical" as const }],
    ["Another person", "2024", undefined, { about: "https://example.org/other" }],
  ] as const) {
    await seed(
      pod,
      {
        template: "address",
        value: {
          id: `https://example.org/address/${encodeURIComponent(locality)}`,
          locality,
          country: "Exampleland",
          validFrom: { value: from, datatype: from.length === 4 ? "gYear" : "gYearMonth" },
          ...(through ? { validThrough: { value: through, datatype: "gYearMonth" as const } } : {}),
        },
      },
      "PhysicalAddress",
      options,
    );
  }
  const call = run(pod);
  for (const at of ["2024-01-01", "2025-06-30T23:59:59Z"]) {
    const result = json(await call("address_get", { purpose, at }));
    expect(result.addresses.map((address: { locality: string }) => address.locality)).toEqual([
      "Oldtown",
    ]);
  }
  expect(json(await call("address_get", { purpose, at: "2025-07-01" })).addresses[0].locality).toBe(
    "Newtown",
  );
  expect(json(await call("address_get", { purpose })).addresses[0].locality).toBe("Newtown");
  for (const at of ["2025-02-30", "nonsense", "2025-07-01T00:00:00"]) {
    expect((await call("address_get", { purpose, at })).isError).toBe(true);
  }
});

it.each([
  "MedicalHealth",
  "Financial",
])("denies %s by default without exposing data", async (category) => {
  const pod = fixture();
  await seed(pod, condition, category);
  const denied = await run(pod)("memory_recall", { purpose });
  expect(denied.isError).toBe(true);
  expect(text(denied)).toBe(`purpose denied: ${category}`);
  const health = await run(pod)("health_query", { purpose, kind: "conditions" });
  expect(health.isError).toBe(true);
  expect(text(health)).not.toContain("Fictional condition");
});

it("denies a health query before data access even when no health facts exist", async () => {
  const pod = fixture();
  await new NanopubStore(pod).writeDefaultPolicy();
  const list = vi.spyOn(pod, "list");
  const result = await run(pod)("health_query", { purpose, kind: "conditions" });
  expect(text(result)).toBe("purpose denied: MedicalHealth");
  expect(result.isError).toBe(true);
  expect(list).not.toHaveBeenCalled();
});

it("appends one private PROV activity per permitted special-category call, including recall", async () => {
  const pod = fixture();
  await seed(pod, condition, "MedicalHealth");
  await permit(pod, ["MedicalHealth"]);
  const write = vi.spyOn(pod, "write");
  const call = run(pod);
  for (const name of ["health_query", "memory_recall", "health_query"]) {
    const result = json(await call(name, { purpose, kind: "conditions" }));
    expect(JSON.stringify(result)).toContain("Fictional condition");
  }
  const url = `${ROOT}private/pkg/audit/${new Date().toISOString().slice(0, 7)}.ttl`;
  const body = new TextDecoder().decode((await pod.read(url)).body);
  const quads = new Parser().parse(body);
  const activities = quads.filter((q) => q.object.value === `${PROV}Activity`);
  expect(activities).toHaveLength(3);
  expect(new Set(activities.map((q) => q.subject.value)).size).toBe(3);
  for (const { subject } of activities) {
    const entries = quads.filter((q) => q.subject.equals(subject));
    expect(
      entries.some(
        (q) => q.predicate.value === `${PROV}wasAssociatedWith` && q.object.value === CLIENT,
      ),
    ).toBe(true);
    expect(entries.some((q) => q.object.value === "https://w3id.org/dpv#ServiceProvision")).toBe(
      true,
    );
    expect(entries.some((q) => q.object.value === `${PD}MedicalHealth`)).toBe(true);
    expect(
      entries.some(
        (q) =>
          q.predicate.value === `${PROV}startedAtTime` &&
          Number.isFinite(Date.parse(q.object.value)),
      ),
    ).toBe(true);
  }
  expect(body).not.toContain("Fictional condition");
  const aclIndex = write.mock.calls.findIndex(([target]) => target === `${url}.acl`);
  const dataIndex = write.mock.calls.findIndex(([target]) => target === url);
  expect(aclIndex).toBeGreaterThanOrEqual(0);
  expect(aclIndex).toBeLessThan(dataIndex);
  const acl = new TextDecoder().decode((await pod.read(`${url}.acl`)).body);
  expect(acl).toContain(OWNER);
  expect(acl).not.toContain("http://xmlns.com/foaf/0.1/Agent");
});

it.each([
  "readOnly",
  "audit write",
  "audit ACL",
])("withholds permitted special data when %s prevents auditing", async (failure) => {
  const pod = fixture();
  await seed(pod, condition, "MedicalHealth");
  await permit(pod, ["MedicalHealth"]);
  if (failure !== "readOnly") {
    const write = pod.write;
    pod.write = async (url, ...rest) => {
      if (url.includes("/audit/") && url.endsWith(failure === "audit ACL" ? ".acl" : ".ttl"))
        throw new Error("Fictional condition secret backend failure");
      return write(url, ...rest);
    };
  }
  for (const name of ["health_query", "memory_recall"]) {
    const result = await run(pod, failure === "readOnly")(name, { purpose, kind: "conditions" });
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain("Fictional condition");
  }
});

it.each([
  "profile_get",
  "address_get",
  "health_query",
])("fails closed for missing, unreadable or malformed policy in %s", async (name) => {
  for (const failure of ["missing", "unreadable", "malformed"]) {
    const pod = fixture();
    if (failure === "malformed") await put(pod, POLICY, "PRIVATE invalid policy");
    if (failure === "unreadable") {
      pod.read = async () => {
        throw new Error("HTTP 403 PRIVATE");
      };
    }
    const write = vi.spyOn(pod, "write");
    const result = await run(pod)(name, { purpose, kind: "conditions" });
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain("PRIVATE");
    expect(write).not.toHaveBeenCalled();
  }
});

it.each([
  "profile_get",
  "address_get",
  "health_query",
])("requires trusted clientInfo for %s", async (name) => {
  const pod = fixture();
  await new NanopubStore(pod).writeDefaultPolicy();
  for (const info of [undefined, { clientId: "not an IRI" }]) {
    const tool = createPodToolRegistry(pod, false, info).find((tool) => tool.name === name);
    expect((await tool?.handler({ purpose, kind: "conditions" }))?.isError).toBe(true);
  }
});

it("rechecks owner policy edits and purpose/client constraints on every call", async () => {
  const pod = fixture();
  await seed(pod, condition, "MedicalHealth");
  await permit(pod, ["MedicalHealth"]);
  const call = run(pod);
  expect(json(await call("health_query", { purpose, kind: "conditions" })).facts).toHaveLength(1);
  expect(text(await call("health_query", { purpose: "Personalisation", kind: "conditions" }))).toBe(
    "purpose denied: MedicalHealth",
  );
  expect(
    text(
      await run(
        pod,
        false,
        "https://example.org/other-client",
      )("health_query", { purpose, kind: "conditions" }),
    ),
  ).toBe("purpose denied: MedicalHealth");
  await permit(pod, ["Contact"]);
  const list = vi.spyOn(pod, "list");
  expect(text(await call("health_query", { purpose, kind: "conditions" }))).toBe(
    "purpose denied: MedicalHealth",
  );
  expect(list).not.toHaveBeenCalled();
});

it("checks every candidate category before content matching and sanitizes unknown category IRIs", async () => {
  const pod = fixture();
  await seed(pod, condition, "MedicalHealth", {
    categories: [`${PD}MedicalHealth`, `${PD}Financial`, "https://example.org/PRIVATE"],
  });
  await permit(pod, ["MedicalHealth"]);
  for (const kind of ["conditions", "allergies", "medications", "observations"]) {
    const result = await run(pod)("health_query", { purpose, kind });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("purpose denied: Financial, MedicalHealth, unsupported category");
    expect(text(result)).not.toContain("PRIVATE");
  }
});

it("returns each health kind with graph-scoped provenance, excluding other people and uncertain/past facts", async () => {
  const pod = fixture();
  await seed(pod, condition, "MedicalHealth");
  await seed(
    pod,
    {
      template: "allergy",
      value: { id: "https://example.org/allergy", name: "Fictional allergy" },
    },
    "MedicalHealth",
  );
  await seed(
    pod,
    {
      template: "medication",
      value: {
        id: "https://example.org/statement",
        medication: { id: "https://example.org/drug", name: "Fictional drug" },
      },
    },
    "MedicalHealth",
  );
  for (const [ns, patient] of [
    ["https://jeswr.org/ns/sectors/health#", "patient"],
    ["https://w3id.org/jeswr/sectors/health#", "patient"],
    ["http://hl7.org/fhir/", "subject"],
  ]) {
    await seed(pod, condition, "MedicalHealth", {
      assertion: `<https://example.org/observation> a <${ns}Observation> ; <${ns}${patient}> <${OWNER}> .`,
    });
  }
  for (const options of [
    { epistemic: "SelfReportedHedged" as const },
    { epistemic: "Mentioned" as const },
    { validity: "Historical" as const },
    { validity: "Contradicted" as const },
    { about: "https://example.org/another" },
  ])
    await seed(pod, condition, "MedicalHealth", options);
  await permit(pod, ["MedicalHealth"]);
  const call = run(pod);
  for (const [kind, count, value] of [
    ["conditions", 1, "Fictional condition"],
    ["allergies", 1, "Fictional allergy"],
    ["medications", 1, "Fictional drug"],
    ["observations", 3, "Observation"],
  ] as const) {
    const result = json(await call("health_query", { purpose, kind }));
    expect(result.kind).toBe(kind);
    expect(result.facts).toHaveLength(count);
    for (const fact of result.facts) {
      expect(fact.provenanceId).toMatch(/^urn:uuid:/);
      expect(fact.assertion).toContain(value);
      expect(fact.assertion).not.toContain("nanopub.org/nschema");
    }
  }
  expect((await call("health_query", { purpose, kind: "unknown" })).isError).toBe(true);
});

it("does not bypass the current read decorator, including on a later call", async () => {
  const pod = fixture();
  const np = await seed(pod, condition, "MedicalHealth");
  await permit(pod, ["MedicalHealth"]);
  const call = run(pod);
  expect(json(await call("health_query", { purpose, kind: "conditions" })).facts).toHaveLength(1);
  const read = pod.read;
  pod.read = async (url, ...rest) => {
    if (url === new NanopubStore(pod).url(np.id)) throw new Error("HTTP 403 PRIVATE");
    return read(url, ...rest);
  };
  const result = await call("health_query", { purpose, kind: "conditions" });
  expect(result.isError).toBe(true);
  expect(text(result)).not.toContain("PRIVATE");
});

it("keeps profile scope, redirects, representation negotiation and field projection authoritative", async () => {
  const pod = fixture();
  await new NanopubStore(pod).writeDefaultPolicy();
  await put(pod, OWNER, `<${OWNER}> <http://xmlns.com/foaf/0.1/name> "Fallback" .`);
  const read = vi.spyOn(pod, "read");
  const call = run(pod);
  expect(json(await call("profile_get", { purpose }))).toEqual({
    name: "Fallback",
    emails: [],
    phones: [],
  });
  expect(read).toHaveBeenCalledWith(OWNER, { accept: "text/turtle" });
  await put(
    pod,
    OWNER,
    `<${OWNER}> <http://www.w3.org/2006/vcard/ns#fn> <https://example.org/bad> ; <http://xmlns.com/foaf/0.1/name> "Fallback" .`,
  );
  expect(json(await call("profile_get", { purpose })).name).toBe("Fallback");
  await put(pod, OWNER, "");
  expect(json(await call("profile_get", { purpose })).name).toBe(null);
  const original = pod.read;
  pod.read = async (url, options) => ({
    ...(await original(url, options)),
    ...(url === OWNER ? { url: "https://example.org/off-pod" } : {}),
  });
  const redirected = await call("profile_get", { purpose });
  expect(redirected.isError).toBe(true);
  expect(text(redirected)).toBe("pod-scope violation");
  const foreign = { ...fixture(), webId: "https://elsewhere.example/profile#me" };
  await new NanopubStore(foreign).writeDefaultPolicy();
  const foreignRead = vi.spyOn(foreign, "read");
  expect((await run(foreign)("profile_get", { purpose })).isError).toBe(true);
  expect(foreignRead.mock.calls.some(([url]) => url === foreign.webId)).toBe(false);
});

it("denies address reads before accessing the timeline when purpose is not permitted", async () => {
  const pod = fixture();
  await permit(pod, ["Contact"]);
  const list = vi.spyOn(pod, "list");
  const result = await run(pod)("address_get", { purpose });
  expect(result.isError).toBe(true);
  expect(text(result)).toBe("purpose denied: PhysicalAddress");
  expect(list).not.toHaveBeenCalled();
});

it("applies exact dateTime address endpoints across offsets and microseconds", async () => {
  const pod = fixture();
  await seed(
    pod,
    {
      template: "address",
      value: {
        id: "https://example.org/address",
        locality: "Storyville",
        country: "Exampleland",
        street: "12 Fiction Lane",
        postalCode: "EX1",
        validFrom: { datatype: "dateTime", value: "2026-02-28T23:00:00.000001-01:00" },
        validThrough: { datatype: "dateTime", value: "2026-03-01T00:00:00.000002Z" },
      },
    },
    "PhysicalAddress",
  );
  const call = run(pod);
  for (const [at, count] of [
    ["2026-03-01T00:00:00Z", 0],
    ["2026-03-01T01:00:00.000001+01:00", 1],
    ["2026-03-01T00:00:00.000002Z", 1],
    ["2026-03-01T00:00:00.000003Z", 0],
  ] as const) {
    const addresses = json(await call("address_get", { purpose, at })).addresses;
    expect(addresses).toHaveLength(count);
    if (count) expect(addresses[0]).toMatchObject({ street: "12 Fiction Lane", postalCode: "EX1" });
  }
});

it.each([
  [
    '"2024"^^<http://www.w3.org/2001/XMLSchema#gYear>',
    '"2024"^^<http://www.w3.org/2001/XMLSchema#gYear>',
    "2024-12-31T23:59:59.999999Z",
  ],
  [
    '"2024-02-29"^^<http://www.w3.org/2001/XMLSchema#date>',
    '"2024-02-29"^^<http://www.w3.org/2001/XMLSchema#date>',
    "2024-02-29T23:59:59.999999Z",
  ],
])("expands calendar address bounds inclusively: %s", async (from, through, at) => {
  const pod = fixture();
  await seed(pod, condition, "PhysicalAddress", {
    assertion: `
    <${OWNER}> <http://www.w3.org/2006/vcard/ns#hasAddress> <https://example.org/address> .
    <https://example.org/address> a <http://www.w3.org/2006/vcard/ns#Address> ;
      <https://schema.org/validFrom> ${from} ; <https://schema.org/validThrough> ${through} .`,
  });
  expect(json(await run(pod)("address_get", { purpose, at })).addresses).toHaveLength(1);
});

it.each([
  '<https://schema.org/validFrom> "not a date"',
  '<https://schema.org/validFrom> "2026-01-01T00:00:00"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
  "<https://schema.org/validFrom> <https://example.org/not-a-date>",
  '<https://schema.org/validFrom> "2026-01-01", "2026-02-01"',
  '<https://schema.org/validFrom> "2026-02"^^<http://www.w3.org/2001/XMLSchema#gYearMonth> ; <https://schema.org/validThrough> "2025"^^<http://www.w3.org/2001/XMLSchema#gYear>',
])("fails closed on ambiguous or unsupported address bounds: %s", async (bounds) => {
  const pod = fixture();
  await seed(pod, condition, "PhysicalAddress", {
    assertion: `
    <${OWNER}> <http://www.w3.org/2006/vcard/ns#hasAddress> <https://example.org/address> .
    <https://example.org/address> a <http://www.w3.org/2006/vcard/ns#Address> ; ${bounds} .`,
  });
  const result = await run(pod)("address_get", { purpose, at: "2026-01-01" });
  expect(result.isError).toBe(true);
  expect(text(result)).toBe("Pod operation failed");
});

it("rejects invalid calendar lexical forms and unsupported RDF bound terms", () => {
  const xsd = "http://www.w3.org/2001/XMLSchema#";
  for (const term of [
    df.namedNode("https://example.org/not-a-bound"),
    df.literal("2026-01-01", df.namedNode("https://example.org/foreign-datatype")),
    df.literal("2026-13", df.namedNode(`${xsd}gYearMonth`)),
    df.literal("2026-02-30", df.namedNode(`${xsd}date`)),
    df.literal("2026-01-01", df.namedNode(`${xsd}dateTime`)),
    df.literal("not a date", df.namedNode(`${xsd}dateTime`)),
    df.literal("202601", df.namedNode(`${xsd}gYear`)),
  ])
    expect(() => temporalRange(term)).toThrow();
});

it("checks mixed address categories before temporal filters, then audits sensitive address reads", async () => {
  const pod = fixture();
  await seed(
    pod,
    {
      template: "address",
      value: {
        id: "https://example.org/address/a",
        locality: "A town",
        country: "Exampleland",
      },
    },
    "PhysicalAddress",
    { categories: [`${PD}PhysicalAddress`, `${PD}MentalHealth`] },
  );
  const call = run(pod);
  for (const at of ["2025-01-01", "2026-01-01"]) {
    const denied = await call("address_get", { purpose, at });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toBe("purpose denied: MentalHealth, PhysicalAddress");
  }
  await permit(pod, ["PhysicalAddress", "MentalHealth"]);
  expect(json(await call("address_get", { purpose })).addresses).toHaveLength(1);
  expect((await call("address_get", { purpose: "Personalisation" })).isError).toBe(true);
  expect((await run(pod, true)("address_get", { purpose })).isError).toBe(true);
});

it("retains all simultaneous addresses and their distinct provenance in deterministic order", async () => {
  const pod = fixture();
  for (const [id, locality] of [
    ["b", "Second"],
    ["a", "First"],
    ["a", "Changed"],
  ]) {
    await seed(
      pod,
      {
        template: "address",
        value: {
          id: `https://example.org/address/${id}`,
          locality,
          country: "Exampleland",
        },
      },
      "PhysicalAddress",
    );
  }
  const addresses = json(await run(pod)("address_get", { purpose })).addresses;
  expect(addresses).toHaveLength(3);
  expect(addresses.map((address: { id: string }) => address.id)).toEqual([
    "https://example.org/address/a",
    "https://example.org/address/a",
    "https://example.org/address/b",
  ]);
});
