// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { list, verify } from "../src/index.js";

const OIDC = "https://www.w3.org/ns/solid/oidc-context.jsonld";
const UNKNOWN = "https://untrusted.example/context";
const APP = "https://app.example/clientid.jsonld";
const CONTAINER = "https://registry.example/apps/";
// Keep the reader's existing vocabulary: namespace migration is a separate issue.
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

  it("parses the shipped Pod Docs client identifier without fetching its context", async () => {
    const body = readFileSync(
      new URL("../../../apps/pod-docs/clientid.jsonld", import.meta.url),
      "utf8",
    );
    const result = await verify("https://pod-docs.jeswr.org/clientid.jsonld", {
      body,
      bodyContentType: "application/ld+json",
    });
    // Its canonical fedapp namespace awaits VOC-05; loading must still succeed.
    expect(result.issues.map((issue) => issue.code)).toEqual(["no-app"]);
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
