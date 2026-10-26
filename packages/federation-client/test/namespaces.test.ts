// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  discoverFromRegistry,
  list,
  resolveStorageSpecVersion,
  selfDescribe,
  verify,
  verifyDataset,
} from "../src/index.js";
import { AppNode, SectorUseNode, wrap } from "../src/wrappers.js";

const APP = "https://app.example/clientid";
const CANONICAL = "https://jeswr.org/ns/fed#";
const LEGACY = "https://w3id.org/jeswr/fed#";
const SECTOR = "https://example.org/sector";
const SHAPE = "https://example.org/shape";

function fixture(namespace: string): string {
  return `
    @prefix f: <${namespace}> .
    @prefix acl: <http://www.w3.org/ns/auth/acl#> .
    <${APP}> a f:App ;
      f:sector <${SECTOR}> ; f:access acl:Read ;
      f:consumes <${SHAPE}> ; f:produces <${SHAPE}> ; f:declaresShape <${SHAPE}> ;
      f:sectorUse <${APP}#use> .
    <${APP}#use> a f:SectorUse ; f:sector <${SECTOR}> ; f:access acl:Write ;
      f:consumes <${SHAPE}> ; f:produces <${SHAPE}> .
  `;
}

function dataset(body: string): Store {
  return new Store(new Parser().parse(body));
}

function fetchBody(body: string): typeof globalThis.fetch {
  return async () => new Response(body, { headers: { "content-type": "text/turtle" } });
}

describe.each([CANONICAL, LEGACY])("federation app readers: %s", (namespace) => {
  it("reads every flat and nested property through typed wrappers and validators", async () => {
    const body = fixture(namespace);
    const store = dataset(body);
    const app = wrap(store).apps()[0];
    expect(app).toBeInstanceOf(AppNode);
    expect([...(app?.sectorUses ?? [])][0]).toBeInstanceOf(SectorUseNode);
    expect([...(app?.sectors ?? [])][0]?.termType).toBe("NamedNode");
    const expected = {
      id: APP,
      sectors: [SECTOR],
      access: ["Read"],
      consumes: [SHAPE],
      produces: [SHAPE],
      declaresShape: [SHAPE],
      sectorUse: [
        {
          id: `${APP}#use`,
          sector: SECTOR,
          access: ["Write"],
          consumes: [SHAPE],
          produces: [SHAPE],
        },
      ],
    };
    for (const result of [
      verifyDataset(store, APP),
      await verify(APP, { body }),
      await verify(APP, { fetch: fetchBody(body) }),
    ]) {
      expect(result).toEqual({ valid: true, registration: expected, issues: [] });
    }
    expect(await list(APP, { fetch: fetchBody(body) })).toEqual([
      { id: APP, source: APP, valid: true, registration: expected, issues: [] },
    ]);
  });

  it("preserves term types and rejects malformed values in both forms", async () => {
    const body = fixture(namespace).replaceAll(`f:consumes <${SHAPE}>`, `f:consumes "${SHAPE}"`);
    const result = await verify(APP, { body });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "invalid-term-type",
      "invalid-term-type",
    ]);
  });
});

describe("mixed federation app namespaces", () => {
  it("deduplicates dual types and prefers canonical properties regardless of insertion order", async () => {
    const body = `${fixture(LEGACY)}
      <${APP}> a <${CANONICAL}App> ; <${CANONICAL}access> <http://www.w3.org/ns/auth/acl#Append> ;
        <${CANONICAL}sectorUse> <${APP}#use> .
      <${APP}#use> <${CANONICAL}access> <http://www.w3.org/ns/auth/acl#Control> .`;
    const result = await verify(APP, { body });
    expect(result.valid).toBe(true);
    expect(result.registration?.access).toEqual(["Append"]);
    expect(result.registration?.sectors).toEqual([SECTOR]);
    expect(result.registration?.sectorUse).toHaveLength(1);
    expect(result.registration?.sectorUse?.[0]?.access).toEqual(["Control"]);
    expect(await list(APP, { fetch: fetchBody(body) })).toHaveLength(1);
  });

  it("still rejects distinct apps across the two namespaces", async () => {
    const result = await verify(APP, {
      body: `${fixture(LEGACY)} <https://other.example/app> a <${CANONICAL}App> .`,
    });
    expect(result.issues.map((issue) => issue.code)).toContain("multiple-apps");
  });

  it("does not fall back when a canonical property is malformed", async () => {
    const result = await verify(APP, {
      body: `${fixture(LEGACY)} <${APP}> <${CANONICAL}access> "Read" .`,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid-term-type");
    expect(result.registration?.access).toEqual([]);
  });

  it("writes canonical classes and predicates for flat and nested registrations", async () => {
    const built = selfDescribe({
      id: APP,
      sectors: [SECTOR],
      access: ["Read"],
      consumes: [SHAPE],
      produces: [SHAPE],
      declaresShape: [SHAPE],
      sectorUse: [{ sector: SECTOR, access: ["Write"] }],
    });
    const body = await built.toString();
    expect(body).toContain(CANONICAL);
    expect(body).not.toContain("w3id.org/jeswr");
    const store = dataset(body);
    const app = new AppNode(APP, store, DataFactory);
    expect([...app.sectorUses]).toHaveLength(1);
    expect((await verify(APP, { body })).valid).toBe(true);
  });
});

describe.each([
  "https://jeswr.org/ns/fedreg#",
  "https://w3id.org/jeswr/fedreg#",
])("client registry delegation: %s", (namespace) => {
  const guard = { dnsLookup: async () => [{ address: "93.184.216.34", family: 4 as const }] };
  it("discovers trusted memberships and resolves advertised storage versions", async () => {
    const registry = "https://registry.example/catalog";
    const body = `<${registry}> a <${namespace}Registry> ; <${namespace}member> <${registry}#m> .
      <${registry}#m> a <${namespace}Membership> ; <${namespace}app> <${APP}> ;
        <${namespace}status> <${namespace}Active> ; <${namespace}assertedBy> <https://authority.example/#me> .`;
    const discovered = await discoverFromRegistry(registry, { fetch: fetchBody(body), guard });
    expect(discovered.valid).toBe(true);
    expect(discovered.members).toMatchObject([
      { id: APP, valid: true, trusted: true, status: "Active" },
    ]);
    const storage = "https://pod.example/";
    const resolved = await resolveStorageSpecVersion(storage, {
      fetch: fetchBody(
        `<${storage}> a <${namespace}StorageDescription> ; <${namespace}acceptsSpec> <https://example.org/spec/1> .`,
      ),
      guard,
    });
    expect(resolved.valid).toBe(true);
    expect(resolved.acceptsSpec).toEqual(["https://example.org/spec/1"]);
  });
});
