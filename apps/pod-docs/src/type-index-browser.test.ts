// AUTHORED-BY Codex GPT-6
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { mockFetch, turtleToStore } from "./test-helpers.js";
import { discoverRegistrations, ensureTypeRegistrations } from "./type-index.js";
import { DOCUMENT_CLASS } from "./vocab.js";

function opaqueRedirect(): Response {
  const response = new Response(null);
  Object.defineProperties(response, {
    type: { value: "opaqueredirect" },
    status: { value: 0 },
    ok: { value: false },
  });
  return response;
}

function followed(response: Response, url: string, redirected = true): Response {
  Object.defineProperties(response, {
    url: { value: url },
    redirected: { value: redirected },
  });
  return response;
}

describe("browser identity redirects", () => {
  it.each([
    ["https://identity.example/", "https://identity.example/"],
    ["https://pod.example/alice/", "https://pod.example/alice/"],
    ["https://identity.example/", "https://profiles.example/"],
    ["http://localhost:3000/", "http://localhost:3000/"],
  ])("bootstraps from %s at canonical %s with the final profile ETag", async (origin, finalOrigin) => {
    const podRoot = "https://pod.example/alice/";
    const profile = `${origin}id`;
    const canonical = `${finalOrigin}profiles/card`;
    const webId = `${profile}#me`;
    const index = `${podRoot}settings/privateTypeIndex.ttl`;
    const { fetch, calls } = mockFetch({
      [`GET ${canonical}`]: {
        body: `<${webId}> a <http://xmlns.com/foaf/0.1/Person>.`,
        etag: '"final-profile"',
      },
      [`HEAD ${podRoot}settings/`]: { status: 200 },
      [`PUT ${canonical}`]: { status: 205 },
      [`PUT ${index}`]: { status: 201 },
      [`GET ${index}`]: { body: "", etag: '"index"' },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) !== profile) return fetch(input, init);
      if (init?.redirect === "manual") return opaqueRedirect();
      expect(init?.redirect).toBe("follow");
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(new Headers(init?.headers).has("dpop")).toBe(false);
      return followed(await fetch(canonical, init), canonical);
    });
    await expect(
      ensureTypeRegistrations({
        webId,
        podRoot,
        registrations: [{ forClass: DOCUMENT_CLASS, container: `${podRoot}docs/` }],
        fetchImpl: transport,
        allowInsecureLoopback: origin.startsWith("http:"),
      }),
    ).resolves.toEqual({ indexUrl: index, added: 1, bootstrapped: true });
    expect(calls.filter((call) => call.method === "PUT" && call.url === canonical)).toEqual([
      expect.objectContaining({
        headers: expect.objectContaining({ "if-match": '"final-profile"' }),
        body: expect.stringContaining(`<${webId}>`),
      }),
    ]);
    expect(calls.some((call) => call.method === "PUT" && call.url === profile)).toBe(false);
  });

  it.each([
    "https://pod.example/alice/settings/",
    "https://other.example/alice/settings/",
  ])("resolves vouched preferences at %s and uses the final base for relative index links", async (destination) => {
    const webId = "https://id.example/id#me";
    const preferences = "https://pod.example/alice/prefs";
    const canonical = `${destination}prefs.ttl`;
    const index = `${destination}index.ttl`;
    const profile = turtleToStore(
      `<${webId}> <http://www.w3.org/ns/pim/space#storage>
        <https://pod.example/alice/>, <https://other.example/alice/>;
        <http://www.w3.org/ns/pim/space#preferencesFile> <${preferences}>.`,
      "https://id.example/id",
    );
    const { fetch, calls } = mockFetch({
      [`GET ${index}`]: {
        body: `<#r> a <http://www.w3.org/ns/solid/terms#TypeRegistration>;
          <http://www.w3.org/ns/solid/terms#forClass> <${DOCUMENT_CLASS}>;
          <http://www.w3.org/ns/solid/terms#instanceContainer> <https://pod.example/alice/docs/>.`,
      },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) !== preferences) return fetch(input, init);
      if (init?.redirect === "manual") return opaqueRedirect();
      expect(init?.credentials).toBe("omit");
      return followed(
        new Response(
          `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <index.ttl>.`,
          {
            headers: { "content-type": "text/turtle" },
          },
        ),
        canonical,
      );
    });
    await expect(discoverRegistrations(webId, profile, transport)).resolves.toEqual([
      {
        forClass: DOCUMENT_CLASS,
        container: "https://pod.example/alice/docs/",
        instance: undefined,
      },
    ]);
    expect(calls.map((call) => call.url)).toEqual([index]);
  });

  it.each([
    "https://foreign.example/prefs",
    "https://pod.example/alice-evil/prefs",
    "http://localhost:3000/prefs",
  ])("refuses the unvouched final preferences URL %s", async (destination) => {
    const webId = "https://id.example/id#me";
    const profile = turtleToStore(
      `<${webId}> <http://www.w3.org/ns/pim/space#storage> <https://pod.example/alice/>;
        <http://www.w3.org/ns/pim/space#preferencesFile> <https://pod.example/alice/prefs>.`,
      "https://id.example/id",
    );
    const response = followed(new Response("not RDF and must never be parsed"), destination);
    const transport = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      init?.redirect === "manual" ? opaqueRedirect() : response,
    );
    await expect(discoverRegistrations(webId, profile, transport)).rejects.toMatchObject({
      cause: { name: "SsrfError" },
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(response.bodyUsed).toBe(true);
  });

  it.each([
    "http://foreign.example/card",
    "http://localhost:3000/card",
    "https://user:secret@id.example/card",
    "https://id.example/%2fcard",
    "https://id.example/%5ccard",
    "https://127.0.0.1/card",
    "https://169.254.169.254/card",
    "https://metadata.google.internal/card",
    "https://id.example:8443/card",
    "file:///card",
  ])("refuses an unsafe final profile URL %s", async (destination) => {
    const response = followed(new Response("not RDF"), destination);
    const transport = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      init?.redirect === "manual" ? opaqueRedirect() : response,
    );
    await expect(
      ensureTypeRegistrations({
        webId: "https://id.example/id#me",
        podRoot: "https://pod.example/",
        storage: createMemoryStorage({ root: "https://pod.example/" }),
        registrations: [],
        fetchImpl: transport,
        // HTTPS must never downgrade even when development HTTP is allowed.
        allowInsecureLoopback: destination.startsWith("http://localhost"),
      }),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(response.bodyUsed).toBe(true);
  });

  it.each([
    ["", true],
    ["https://id.example/other", false],
    ["https://id.example/id", true],
  ])("refuses inconsistent followed metadata (URL %s, redirected %s)", async (url, redirected) => {
    const transport = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      init?.redirect === "manual" ? opaqueRedirect() : followed(new Response(""), url, redirected),
    );
    await expect(
      ensureTypeRegistrations({
        webId: "https://id.example/id#me",
        podRoot: "https://pod.example/",
        storage: createMemoryStorage({ root: "https://pod.example/" }),
        registrations: [],
        fetchImpl: transport,
      }),
    ).rejects.toMatchObject({ cause: { name: "SsrfError" } });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    true,
    false,
  ])("uses only the final index ETag for conditional writes (present: %s)", async (hasEtag) => {
    const podRoot = "https://pod.example/alice/";
    const webId = "https://id.example/id#me";
    const index = "https://metadata.example/index";
    const canonical = "https://metadata.example/indexes/current.ttl";
    const { fetch, calls } = mockFetch({
      "GET https://id.example/id": {
        body: `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}>.`,
      },
      [`GET ${canonical}`]: { body: "", etag: hasEtag ? '"final-index"' : undefined },
      [`PUT ${canonical}`]: { status: 205 },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) !== index) return fetch(input, init);
      return init?.redirect === "manual"
        ? opaqueRedirect()
        : followed(await fetch(canonical, init), canonical);
    });
    const result = ensureTypeRegistrations({
      webId,
      podRoot,
      storage: createMemoryStorage({ root: podRoot }),
      fetchImpl: transport,
      registrations: [{ forClass: DOCUMENT_CLASS, container: `${podRoot}docs/` }],
    });
    if (hasEtag) {
      await expect(result).resolves.toMatchObject({ indexUrl: canonical, added: 1 });
      expect(calls.filter((call) => call.method === "PUT")).toEqual([
        expect.objectContaining({
          url: canonical,
          headers: expect.objectContaining({ "if-match": '"final-index"' }),
        }),
      ]);
    } else {
      await expect(result).rejects.toMatchObject({ code: "precondition-required" });
      expect(calls.some((call) => call.method === "PUT")).toBe(false);
    }
  });

  it.each([
    false,
    true,
  ])("checks a foreign final index against this WebID's storage claims (vouched: %s)", async (vouched) => {
    const webId = "https://id.example/id#me";
    const index = "https://metadata.example/index";
    const canonical = "https://second.example/alice/index.ttl";
    const profile = turtleToStore(
      `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}>.
        ${vouched ? `<${webId}> <http://www.w3.org/ns/pim/space#storage> <https://second.example/alice/>.` : ""}`,
      "https://id.example/id",
    );
    const transport = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      init?.redirect === "manual"
        ? opaqueRedirect()
        : followed(new Response("", { headers: { "content-type": "text/turtle" } }), canonical),
    );
    const result = discoverRegistrations(webId, profile, transport);
    if (vouched) await expect(result).resolves.toEqual([]);
    else
      await expect(result).rejects.toMatchObject({
        cause: { name: "SsrfError" },
      });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    "declared",
    "streamed",
  ])("retains the guard's %s body-size limit after following", async (mode) => {
    const response = followed(
      new Response(mode === "streamed" ? "x".repeat(1_048_577) : "", {
        headers: {
          "content-type": "text/turtle",
          ...(mode === "declared" ? { "content-length": "1048577" } : {}),
        },
      }),
      "https://id.example/card",
    );
    const transport = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      init?.redirect === "manual" ? opaqueRedirect() : response,
    );
    await expect(
      ensureTypeRegistrations({
        webId: "https://id.example/id#me",
        podRoot: "https://pod.example/",
        storage: createMemoryStorage({ root: "https://pod.example/" }),
        registrations: [],
        fetchImpl: transport,
      }),
    ).rejects.toThrow("cap");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    "opaqueredirect",
    "opaque",
  ])("refuses a still-%s final response without retrying again", async (type) => {
    const response = opaqueRedirect();
    const final = new Response(null);
    Object.defineProperties(final, {
      type: { value: type },
      status: { value: 0 },
      url: { value: "https://id.example/card" },
      redirected: { value: true },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      init?.redirect === "manual" ? response : final,
    );
    await expect(
      ensureTypeRegistrations({
        webId: "https://id.example/id#me",
        podRoot: "https://pod.example/",
        storage: createMemoryStorage({ root: "https://pod.example/" }),
        registrations: [],
        fetchImpl: transport,
      }),
    ).rejects.toMatchObject({ cause: { name: "SsrfError" } });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("never enables follow for a status-0 response that is not opaqueredirect", async () => {
    const response = new Response(null);
    Object.defineProperties(response, { status: { value: 0 }, type: { value: "opaque" } });
    const transport = vi.fn<typeof globalThis.fetch>(async () => response);
    await expect(
      ensureTypeRegistrations({
        webId: "https://id.example/id#me",
        podRoot: "https://pod.example/",
        storage: createMemoryStorage({ root: "https://pod.example/" }),
        registrations: [],
        fetchImpl: transport,
      }),
    ).rejects.toMatchObject({ cause: { name: "SsrfError" } });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it.each([
    false,
    true,
  ])("keeps transport-thrown scope errors sanitised (opaque fallback: %s)", async (opaque) => {
    const failure = Object.assign(
      new StorageError("scope", {
        url: "https://user:transport-secret@id.example/card?token=transport-secret",
        method: "GET",
        cause: new Error('Transport echoed "transport-secret"'),
      }),
      { credential: "transport-secret" },
    );
    const transport = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (opaque && init?.redirect === "manual") return opaqueRedirect();
      throw failure;
    });
    const result = ensureTypeRegistrations({
      webId: "https://id.example/id#me",
      podRoot: "https://pod.example/",
      storage: createMemoryStorage({ root: "https://pod.example/" }),
      registrations: [],
      fetchImpl: transport,
    });
    await expect(result).rejects.toMatchObject({
      name: "RdfFetchError",
      cause: { name: "SsrfError" },
    });
    await expect(result).rejects.not.toHaveProperty("cause.cause");
    await expect(result).rejects.not.toHaveProperty("cause.code");
    await expect(result).rejects.not.toHaveProperty("cause.credential");
    await expect(result).rejects.not.toThrow("transport-secret");
    expect(transport).toHaveBeenCalledTimes(opaque ? 2 : 1);
  });
});
