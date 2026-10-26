// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRegistry, parseStorage } from "../src/index.js";

const OIDC = "https://www.w3.org/ns/solid/oidc-context.jsonld";
const UNKNOWN = "https://untrusted.example/context";
const REGISTRY = "https://registry.example/federation";
const APP = "https://app.example/clientid.jsonld";
const STORAGE = "https://pod.example/";
const SPEC = "https://example.org/spec/1.0.0";
const terms = { fedreg: "https://w3id.org/jeswr/fedreg#" };

function registry(context: unknown): string {
  return JSON.stringify({
    "@context": context,
    client_id: REGISTRY,
    "@type": "fedreg:Registry",
    "fedreg:member": {
      "@id": `${REGISTRY}#member`,
      "@type": "fedreg:Membership",
      "fedreg:app": { "@id": APP },
      "fedreg:status": { "@id": "fedreg:Active" },
      "fedreg:assertedBy": { "@id": "https://authority.example/#me" },
    },
    extension: { "@id": "https://example.org/nested" },
  });
}

function storage(context: unknown): string {
  return JSON.stringify({
    "@context": context,
    client_id: STORAGE,
    "@type": "fedreg:StorageDescription",
    "fedreg:acceptsSpec": { "@id": SPEC },
    extension: { "@id": "https://example.org/nested" },
  });
}

function documentFetch(body: string) {
  return vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(body, { headers: { "content-type": "application/ld+json" } }),
  );
}

describe("offline federation registry contexts", () => {
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

  it.each([
    "body",
    "fetch",
  ])("loads registry and storage OIDC contexts through %s", async (mode) => {
    const registryBody = registry([OIDC, terms]);
    const registryFetch = documentFetch(registryBody);
    const parsed = await parseRegistry(
      REGISTRY,
      mode === "body"
        ? { body: registryBody, bodyContentType: "application/ld+json", fetch: registryFetch }
        : { fetch: registryFetch },
    );
    expect(parsed.valid).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.registry?.id).toBe(REGISTRY);
    expect(parsed.members).toHaveLength(1);
    expect(parsed.members[0]).toMatchObject({
      valid: true,
      membership: { app: APP, status: "Active" },
    });
    expect(registryFetch).toHaveBeenCalledTimes(mode === "body" ? 0 : 1);

    const storageBody = storage([OIDC, terms]);
    const storageFetch = documentFetch(storageBody);
    const description = await parseStorage(
      STORAGE,
      mode === "body"
        ? { body: storageBody, bodyContentType: "application/ld+json", fetch: storageFetch }
        : { fetch: storageFetch },
    );
    expect(description.valid).toBe(true);
    expect(description.issues).toEqual([]);
    expect(description.storage).toMatchObject({ id: STORAGE, acceptsSpec: [SPEC] });
    expect(storageFetch).toHaveBeenCalledTimes(mode === "body" ? 0 : 1);
  });

  it.each([
    [UNKNOWN],
    [OIDC, terms, UNKNOWN],
    [OIDC, terms, { extension: { "@id": "https://example.org/extension", "@context": UNKNOWN } }],
    [`${OIDC}?untrusted`],
  ])("refuses unbundled and scoped contexts on body and fetch paths: %j", async (...context) => {
    for (const [parse, input, body] of [
      [parseRegistry, REGISTRY, registry(context)],
      [parseStorage, STORAGE, storage(context)],
    ] as const) {
      const fetch = documentFetch(body);
      for (const options of [{ body, bodyContentType: "application/ld+json", fetch }, { fetch }]) {
        const result = await parse(input, options);
        expect(result.valid).toBe(false);
        expect(result.issues).toMatchObject([{ code: "parse-failed" }]);
      }
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});
