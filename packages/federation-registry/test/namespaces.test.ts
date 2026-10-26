// AUTHORED-BY Codex GPT-6.1-Sol
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildMembership,
  buildRegistry,
  listMembers,
  parseRegistry,
  parseRegistryDataset,
  verifyMembership,
  verifyMembershipDataset,
} from "../src/registry.js";
import { describeStorage, parseStorage, parseStorageDataset } from "../src/storage.js";
import { MEMBERSHIP_STATUS, statusName } from "../src/vocab.js";
import { wrap } from "../src/wrappers.js";

const CANONICAL = "https://jeswr.org/ns/fedreg#";
const LEGACY = "https://w3id.org/jeswr/fedreg#";
const REGISTRY = "https://registry.example/catalog";
const MEMBER = `${REGISTRY}#member`;
const APP = "https://app.example/clientid";
const AUTHORITY = "https://authority.example/#me";
const STORAGE = "https://pod.example/";
const SPEC = "https://example.org/spec/1.0.0";
const SECTOR = "https://example.org/sector";
const ASSERTED = "2026-10-26T12:00:00Z";

function membership(namespace: string): string {
  return `<${MEMBER}> a <${namespace}Membership> ;
    <${namespace}app> <${APP}> ; <${namespace}status> <${namespace}Active> ;
    <${namespace}assertedBy> <${AUTHORITY}> ;
    <${namespace}asserted> "${ASSERTED}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`;
}
function registry(namespace: string): string {
  return `<${REGISTRY}> a <${namespace}Registry> ; <${namespace}member> <${MEMBER}> . ${membership(namespace)}`;
}
function storage(namespace: string): string {
  return `<${STORAGE}#description> a <${namespace}StorageDescription> ;
    <${namespace}storage> <${STORAGE}> ; <${namespace}acceptsSpec> <${SPEC}> ;
    <${namespace}supportsSector> <${SECTOR}> .`;
}
function dataset(body: string): Store {
  return new Store(new Parser().parse(body));
}
function fetchBody(body: string): typeof globalThis.fetch {
  return async () => new Response(body, { headers: { "content-type": "text/turtle" } });
}

describe.each([CANONICAL, LEGACY])("federation registry readers: %s", (namespace) => {
  const member = {
    id: MEMBER,
    app: APP,
    status: "Active",
    statusIri: `${namespace}Active`,
    assertedBy: [AUTHORITY],
    asserted: ASSERTED,
  };
  const verified = { valid: true, membership: member, issues: [] };

  it("reads every membership field through registry, standalone and bare-list readers", async () => {
    const body = registry(namespace);
    for (const result of [
      await parseRegistry(REGISTRY, { body }),
      await parseRegistry(REGISTRY, { fetch: fetchBody(body) }),
      parseRegistryDataset(dataset(body)),
    ]) {
      expect(result).toEqual({
        valid: true,
        issues: [],
        members: [verified],
        registry: { id: REGISTRY, members: [member] },
      });
    }
    for (const result of [
      await verifyMembership(MEMBER, { body: membership(namespace) }),
      await verifyMembership(MEMBER, { fetch: fetchBody(membership(namespace)) }),
      verifyMembershipDataset(dataset(body)),
    ])
      expect(result).toEqual(verified);
    expect(await listMembers(REGISTRY, { body })).toEqual([verified]);
    expect(await listMembers(REGISTRY, { body: membership(namespace) })).toEqual([verified]);
    expect([...(wrap(dataset(body)).registries()[0]?.members ?? [])][0]?.asserted).toBe(ASSERTED);
  });

  it("reads every storage field through body, fetch and dataset readers", async () => {
    const body = storage(namespace);
    for (const result of [
      await parseStorage(STORAGE, { body }),
      await parseStorage(STORAGE, { fetch: fetchBody(body) }),
      parseStorageDataset(dataset(body)),
    ]) {
      expect(result).toEqual({
        valid: true,
        issues: [],
        storage: {
          id: `${STORAGE}#description`,
          storage: STORAGE,
          acceptsSpec: [SPEC],
          supportsSector: [SECTOR],
        },
      });
    }
  });

  it("recognizes every status alias and rejects unknown statuses and literal objects", async () => {
    for (const name of Object.keys(MEMBERSHIP_STATUS))
      expect(statusName(`${namespace}${name}`)).toBe(name);
    const invalid = await verifyMembership(MEMBER, {
      body: membership(namespace).replace(`${namespace}Active`, `${namespace}Unknown`),
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toContain("unknown-status");
    const literal = await verifyMembership(MEMBER, {
      body: membership(namespace).replace(`<${namespace}Active>`, `"${namespace}Active"`),
    });
    expect(literal.valid).toBe(false);
    expect(literal.issues.map((issue) => issue.code)).toContain("invalid-term-type");
    const badStorage = await parseStorage(STORAGE, {
      body: storage(namespace).replace(`<${SPEC}>`, `"${SPEC}"`),
    });
    expect(badStorage.valid).toBe(false);
    expect(badStorage.issues.map((issue) => issue.code)).toContain("invalid-term-type");
  });
});

describe("mixed registry namespaces and canonical writers", () => {
  it("deduplicates dual types and prefers canonical properties with legacy fallbacks", async () => {
    const body = `${registry(LEGACY)} ${storage(LEGACY)}
      <${REGISTRY}> a <${CANONICAL}Registry> ; <${CANONICAL}member> <${MEMBER}> .
      <${MEMBER}> a <${CANONICAL}Membership> ; <${CANONICAL}status> <${CANONICAL}Revoked> ;
        <${CANONICAL}asserted> "2026-10-26T13:00:00Z" .
      <${STORAGE}#description> a <${CANONICAL}StorageDescription> ; <${CANONICAL}acceptsSpec> <https://example.org/spec/2.0.0> .`;
    const parsed = await parseRegistry(REGISTRY, { body });
    expect(parsed.valid).toBe(true);
    expect(parsed.members).toHaveLength(1);
    expect(parsed.members[0]?.membership).toMatchObject({
      app: APP,
      status: "Revoked",
      asserted: "2026-10-26T13:00:00Z",
    });
    const wrapped = wrap(dataset(body));
    expect(wrapped.registries()).toHaveLength(1);
    expect(wrapped.memberships()).toHaveLength(1);
    expect(wrapped.storageDescriptions()).toHaveLength(1);
    const description = await parseStorage(STORAGE, { body });
    expect(description.valid).toBe(true);
    expect(description.storage).toMatchObject({
      acceptsSpec: ["https://example.org/spec/2.0.0"],
      supportsSector: [SECTOR],
    });
  });

  it("still flags distinct registries across namespaces", async () => {
    const parsed = await parseRegistry(REGISTRY, {
      body: `${registry(LEGACY)} <https://other.example/registry> a <${CANONICAL}Registry> .`,
    });
    expect(parsed.valid).toBe(false);
    expect(parsed.issues.map((issue) => issue.code)).toContain("multiple-registries");
  });

  it("rejects malformed canonical values rather than falling back to legacy values", async () => {
    const parsed = await verifyMembership(MEMBER, {
      body: `${membership(LEGACY)} <${MEMBER}> <${CANONICAL}status> "Active" .`,
    });
    expect(parsed.valid).toBe(false);
    expect(parsed.issues.map((issue) => issue.code)).toContain("invalid-term-type");
  });

  it("writes canonical terms through all builders", async () => {
    const member = { id: MEMBER, app: APP, assertedBy: AUTHORITY, asserted: ASSERTED };
    const graphs = [
      buildRegistry({ id: REGISTRY, members: [member] }),
      buildMembership(member),
      describeStorage({
        id: `${STORAGE}#description`,
        storage: STORAGE,
        acceptsSpec: [SPEC],
        supportsSector: [SECTOR],
      }),
    ];
    for (const graph of graphs) {
      const body = await graph.toString();
      expect(body).toContain(CANONICAL);
      expect(body).not.toContain("w3id.org/jeswr");
      expect(graph.quads.some((quad) => quad.predicate.value.startsWith(CANONICAL))).toBe(true);
    }
  });
});
