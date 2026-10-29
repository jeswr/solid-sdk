// AUTHORED-BY Codex GPT-6
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { parseRdf } from "@jeswr/fetch-rdf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { federationDocumentLoader } from "../src/context-loader.js";
import { list, verify } from "../src/index.js";

const OIDC = "https://www.w3.org/ns/solid/oidc-context.jsonld";
const FEDERATION = "https://w3id.org/jeswr/fed";
const UNKNOWN = "https://untrusted.example/context";
const APP = "https://app.example/clientid.jsonld";
const CONTAINER = "https://registry.example/apps/";
const appsDirectory = new URL("../../../apps/", import.meta.url);
const shippedApps = readdirSync(appsDirectory).filter((app) =>
  existsSync(new URL(`${app}/clientid.jsonld`, appsDirectory)),
);
const terms = {
  fedapp: "https://w3id.org/jeswr/fed#",
  acl: "http://www.w3.org/ns/auth/acl#",
  sector: { "@id": "fedapp:sector", "@type": "@id" },
  access: { "@id": "fedapp:access", "@type": "@id" },
};

function registration(context: unknown = [OIDC, terms]): string {
  return JSON.stringify({
    "@context": context,
    client_id: APP,
    client_name: "Offline app",
    "@type": "fedapp:App",
    sector: "https://example.org/sector",
    access: ["acl:Read", "acl:Write"],
    extension: { "@id": "https://example.org/nested" },
  });
}

function documentFetch(body: string) {
  return vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(body, { headers: { "content-type": "application/ld+json" } }),
  );
}

describe("offline federation client contexts", () => {
  const network = vi.fn(() => {
    throw new Error("Unexpected global fetch");
  });
  beforeEach(() => {
    network.mockClear();
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(network).not.toHaveBeenCalled();
  });

  it.each(["body", "fetch"])("verifies the bundled OIDC context through %s", async (mode) => {
    const fetch = documentFetch(registration());
    const result = await verify(
      APP,
      mode === "body"
        ? { body: registration(), bodyContentType: "application/ld+json", fetch }
        : { fetch },
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.registration).toMatchObject({
      id: APP,
      sectors: ["https://example.org/sector"],
      access: ["Read", "Write"],
    });
    expect(fetch).toHaveBeenCalledTimes(mode === "body" ? 0 : 1);
  });

  it.each([
    FEDERATION,
    "https://jeswr.org/ns/fed",
  ])("verifies and lists a registration using context %s", async (context) => {
    const body = registration([OIDC, context]);
    const result = await verify(APP, { body, bodyContentType: "application/ld+json" });
    expect(result.valid).toBe(true);
    expect(result.registration).toMatchObject({
      id: APP,
      sectors: ["https://example.org/sector"],
      access: ["Read", "Write"],
    });
    const fetch = documentFetch(body);
    expect(await list(APP, { fetch })).toMatchObject([{ id: APP, valid: true }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(shippedApps)("parses the shipped %s client identifier offline", async (app) => {
    const body = readFileSync(new URL(`${app}/clientid.jsonld`, appsDirectory), "utf8");
    const { client_id: id } = JSON.parse(body);
    const dataset = await parseRdf(body, "application/ld+json", {
      baseIRI: id,
      documentLoader: federationDocumentLoader,
    });
    expect(dataset.size).toBeGreaterThan(0);
    for (const mode of ["body", "fetch"]) {
      const fetch = documentFetch(body);
      const result = await verify(
        id,
        mode === "body" ? { body, bodyContentType: "application/ld+json", fetch } : { fetch },
      );
      expect(result.issues.map((issue) => issue.code)).not.toContain("parse-failed");
      expect(fetch).toHaveBeenCalledTimes(mode === "body" ? 0 : 1);
      if (app === "pod-chat") {
        expect(result.valid).toBe(true);
        expect(result.issues).toEqual([]);
        expect(result.registration).toMatchObject({
          id,
          sectors: ["https://jeswr.org/ns/sectors/social#sector"],
          access: ["Read", "Write", "Append"],
          produces: [
            "https://jeswr.org/ns/pod-chat#ChatRoom",
            "https://www.w3.org/ns/activitystreams#Note",
          ],
          consumes: [
            "https://jeswr.org/ns/pod-chat#ChatRoom",
            "https://www.w3.org/ns/activitystreams#Note",
            "http://www.w3.org/2005/01/wf/flow#Task",
          ],
        });
      }
    }
  });

  it.each([OIDC, FEDERATION])("isolates the bundled context from mutations: %s", async (url) => {
    const first = await federationDocumentLoader.load(url);
    const original = structuredClone(first);
    Object.assign(first as object, { "@context": UNKNOWN });
    expect(await federationDocumentLoader.load(url)).toEqual(original);
  });

  it("lists a JSON-LD source using the bundled context", async () => {
    const fetch = documentFetch(registration());
    const entries = await list(APP, { fetch });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: APP, valid: true, source: APP });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("loads OIDC container members and skips members with unknown contexts", async () => {
    const badMember = `${CONTAINER}bad`;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (input === CONTAINER) {
        return new Response(
          `<${CONTAINER}> <http://www.w3.org/ns/ldp#contains> <${APP}>, <${badMember}> .`,
          { headers: { "content-type": "text/turtle" } },
        );
      }
      return new Response(registration(input === APP ? [OIDC, terms] : [OIDC, terms, UNKNOWN]), {
        headers: { "content-type": "application/ld+json" },
      });
    });
    const entries = await list(CONTAINER, { fetch });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: APP, valid: true, source: APP });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([CONTAINER, APP, badMember]);
  });

  const refusedContexts = [
    [UNKNOWN],
    [OIDC, terms, UNKNOWN],
    [OIDC, terms, { extension: { "@id": "https://example.org/extension", "@context": UNKNOWN } }],
    [`${OIDC}?untrusted`],
    [`${FEDERATION}?untrusted`],
    [`${FEDERATION}/`],
    [OIDC, FEDERATION, UNKNOWN],
    [
      OIDC,
      FEDERATION,
      { extension: { "@id": "https://example.org/extension", "@context": UNKNOWN } },
    ],
  ];
  it.each(
    refusedContexts,
  )("refuses unbundled contexts through every entry point: %j", async (...context) => {
    const body = registration(context);
    const fetch = documentFetch(body);
    for (const options of [{ body, bodyContentType: "application/ld+json", fetch }, { fetch }]) {
      const result = await verify(APP, options);
      expect(result.valid).toBe(false);
      expect(result.issues).toMatchObject([{ code: "parse-failed" }]);
    }
    await expect(list(APP, { fetch })).rejects.toMatchObject({
      cause: { message: expect.stringContaining("Remote JSON-LD context refused:") },
    });
    // Only the registration document is fetched, never any context.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([url]) => url === APP)).toBe(true);
  });
});
