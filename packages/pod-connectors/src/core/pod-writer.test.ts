// AUTHORED-BY Codex GPT-6.1-Sol

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { PodScopeError, RedirectRefusedError } from "@jeswr/guarded-fetch";
import { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ResourceWriteError } from "../pod/resource.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { NormalisedDoc } from "./types.js";

const doc: NormalisedDoc = {
  slug: "media/items.ttl",
  category: "media",
  forClass: "https://schema.org/Thing",
  dataset: new Store(),
};
function writer(fetch: typeof globalThis.fetch) {
  return createFetchPodWriter({
    adapterId: "toy",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch,
  });
}

describe("fetch-backed PodWriter", () => {
  it("round-trips RDF and preserves read ETags and conditional writes", async () => {
    const pod = createMemoryPod();
    const port = writer(pod.fetch);
    expect(await port.read(doc.slug)).toBeUndefined();
    const written = await port.write(doc, { ifNoneMatch: "*" });
    expect(written.url).toBe(port.resolve(doc.slug));
    const existing = await port.read(doc.slug);
    expect(existing?.dataset.size).toBe(0);
    expect(existing?.etag).toBe('"v1"');
    await expect(port.write(doc, { ifNoneMatch: "*" })).rejects.toMatchObject({ status: 412 });
    await port.write(doc, { ifMatch: existing!.etag! });
    await expect(port.write(doc, { ifMatch: existing!.etag! })).rejects.toBeInstanceOf(
      ResourceWriteError,
    );
    expect((await port.read(doc.slug))?.etag).toBe('"v2"');
  });

  it("propagates unreadable and invalid RDF instead of treating it as absent", async () => {
    await expect(
      writer(async () => new Response(null, { status: 403 })).read(doc.slug),
    ).rejects.toBeInstanceOf(RdfFetchError);
    await expect(
      writer(
        async () => new Response("not turtle {", { headers: { "content-type": "text/turtle" } }),
      ).read(doc.slug),
    ).rejects.toThrow();
  });

  it.each([
    "../outside.ttl",
    "https://foreign.test/leak.ttl",
    "/alice/elsewhere.ttl",
    ".",
    "%2e%2e/out.ttl",
    "media%2fescape.ttl",
  ])("refuses escaping slug %s before any transport is used", async (slug) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const port = writer(fetch);
    expect(() => port.resolve(slug)).toThrow();
    await expect(port.write({ ...doc, slug })).rejects.toThrow();
    await expect(port.read(slug)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "read",
    "write",
  ] as const)("confines every %s redirect hop to the connector root", async (operation) => {
    const seen: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      seen.push(url);
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 307,
        headers: { location: seen.length === 1 ? "next.ttl" : `${TEST_POD_ROOT}private/other.ttl` },
      });
    });
    const port = writer(fetch);
    const failure = await (operation === "read" ? port.read(doc.slug) : port.write(doc)).catch(
      (error: unknown) => error,
    );
    expect(failure instanceof RdfFetchError ? failure.cause : failure).toBeInstanceOf(
      PodScopeError,
    );
    expect(seen).toEqual([port.resolve(doc.slug), port.resolve("media/next.ttl")]);
    expect(
      fetch.mock.calls.every(
        ([, init]) => (init?.method ?? "GET") === (operation === "write" ? "PUT" : "GET"),
      ),
    ).toBe(true);
  });

  it.each([
    "read",
    "write",
  ] as const)("follows %s redirects within the connector root", async (operation) => {
    const pod = createMemoryPod();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).endsWith("items.ttl")) {
        return new Response(null, { status: 307, headers: { location: "next.ttl" } });
      }
      return pod.fetch(input, init);
    });
    const port = writer(fetch);
    await port.write({ ...doc, slug: "media/next.ttl" });
    if (operation === "read") expect((await port.read(doc.slug))?.etag).toBe('"v1"');
    else await port.write(doc);
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(port.resolve("media/next.ttl"));
  });

  it("refuses an unsafe adapter id", () => {
    expect(() =>
      createFetchPodWriter({
        adapterId: "../other",
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        podRoot: TEST_POD_ROOT,
        fetch: vi.fn(),
      }),
    ).toThrow();
  });

  it.each([
    "pim",
    "solid",
  ])("bootstraps and reuses a Type Index with only %s:storage", async (prefix) => {
    const pod = createMemoryPod();
    await pod.fetch(TEST_PROFILE_DOC, {
      method: "PUT",
      body: pod.get(TEST_PROFILE_DOC)!.replace("pim:storage", `${prefix}:storage`),
    });
    const port = writer(pod.fetch);
    const registrations = [{ forClass: doc.forClass, container: port.resolve("media/") }];
    const first = await port.registerType(registrations);
    const putCount = pod.putCount;
    expect(pod.get(first.indexUrl)).toContain(doc.forClass);
    expect(await port.registerType(registrations)).toMatchObject({ indexUrl: first.indexUrl });
    expect(pod.putCount).toBe(putCount);
  });

  it.each([
    "profile",
    "index",
  ])("refuses redirects from the %s to unrelated Pod documents", async (target) => {
    const pod = createMemoryPod();
    const port = writer(pod.fetch);
    const { indexUrl } = await port.registerType([]);
    const profileUrl = TEST_WEBID.split("#")[0];
    const redirectUrl = target === "profile" ? profileUrl : indexUrl;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).split("#")[0] === redirectUrl) {
        return new Response(null, {
          status: 307,
          headers: { location: `${TEST_POD_ROOT}private/other.ttl` },
        });
      }
      return pod.fetch(input, init);
    });
    await expect(
      writer(fetch).registerType([{ forClass: doc.forClass, container: port.resolve("media/") }]),
    ).rejects.toThrow();
    expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
      `${TEST_POD_ROOT}private/other.ttl`,
    );
  });

  it("pins bootstrap and reuse to the host-resolved profile document, preserving the WebID subject", async () => {
    const pod = createMemoryPod();
    // The canonical document can be outside storage and on a different origin from the WebID.
    const profileDocumentUrl = "https://profiles.test/alice/card?view=public";
    await pod.fetch(profileDocumentUrl, { method: "PUT", body: pod.get(TEST_PROFILE_DOC) });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).split("#")[0] === TEST_PROFILE_DOC) {
        return new Response(null, { status: 302, headers: { location: profileDocumentUrl } });
      }
      return pod.fetch(input, init);
    });
    const port = createFetchPodWriter({
      adapterId: "toy",
      webId: TEST_WEBID,
      profileDocumentUrl,
      podRoot: TEST_POD_ROOT,
      fetch,
    });
    const registrations = [{ forClass: doc.forClass, container: port.resolve("media/") }];
    const first = await port.registerType(registrations);
    expect(first).toMatchObject({ added: 1, bootstrapped: true });
    const putCount = pod.putCount;
    expect(await port.registerType(registrations)).toMatchObject({ added: 0, bootstrapped: false });
    expect(pod.putCount).toBe(putCount);
    expect(pod.get(first.indexUrl)).toContain(doc.forClass);
    const { typeIndexLinks } = await import("../pod/type-index.js");
    expect(typeIndexLinks(TEST_WEBID, pod.dataset(profileDocumentUrl)).privateIndex).toBe(
      first.indexUrl,
    );
    expect(typeIndexLinks(TEST_WEBID, pod.dataset(TEST_PROFILE_DOC)).privateIndex).toBeUndefined();
    const profileCalls = fetch.mock.calls.filter(([input]) => String(input) === profileDocumentUrl);
    expect(profileCalls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
    expect(new Headers(profileCalls[1][1]?.headers).get("if-match")).toBe('"v1"');
    expect(fetch.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    expect(fetch.mock.calls.map(([input]) => String(input).split("#")[0])).not.toContain(
      TEST_PROFILE_DOC,
    );
  });

  it.each([
    "profile",
    "index-create",
    "index-update",
  ])("refuses an authenticated %s write redirect even within advertised storage", async (target) => {
    const pod = createMemoryPod();
    const profileDocumentUrl = `${TEST_POD_ROOT}profile/canonical`;
    await pod.fetch(profileDocumentUrl, { method: "PUT", body: pod.get(TEST_PROFILE_DOC) });
    const options = {
      adapterId: "toy",
      webId: TEST_WEBID,
      profileDocumentUrl,
      podRoot: TEST_POD_ROOT,
    };
    const indexUrl = `${TEST_POD_ROOT}settings/privateTypeIndex.ttl`;
    if (target === "index-update") {
      await createFetchPodWriter({ ...options, fetch: pod.fetch }).registerType([]);
    }
    const redirectFrom = target === "profile" ? profileDocumentUrl : indexUrl;
    const redirectTo = `${TEST_POD_ROOT}private/other.ttl`;
    const before = pod.get(redirectFrom);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(init?.redirect).toBe("manual");
      if (String(input) === redirectFrom && init?.method === "PUT") {
        return new Response(null, { status: 307, headers: { location: redirectTo } });
      }
      return pod.fetch(input, init);
    });
    const port = createFetchPodWriter({ ...options, fetch });
    await expect(
      port.registerType([{ forClass: doc.forClass, container: port.resolve("media/") }]),
    ).rejects.toBeInstanceOf(RedirectRefusedError);
    expect(pod.get(redirectFrom)).toBe(before);
    expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(redirectTo);
    expect(pod.get(redirectTo)).toBeUndefined();
  });

  it.each([
    "file:///profile",
    "https://user:pass@profile.test/card",
  ])("rejects an unsafe canonical profile document before transport: %s", async (profileDocumentUrl) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const port = createFetchPodWriter({
      adapterId: "toy",
      webId: TEST_WEBID,
      profileDocumentUrl,
      podRoot: TEST_POD_ROOT,
      fetch,
    });
    await expect(port.registerType([])).rejects.toBeInstanceOf(PodScopeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("updates an existing profile-linked index outside the connector root", async () => {
    const pod = createMemoryPod();
    const port = writer(pod.fetch);
    const first = await port.registerType([]);
    const result = await port.registerType([
      { forClass: doc.forClass, container: port.resolve("media/") },
    ]);
    expect(result).toMatchObject({ indexUrl: first.indexUrl, added: 1, bootstrapped: false });
    expect(pod.get(result.indexUrl)).toContain(doc.forClass);
  });

  it.each([
    "https://second.test/alice/",
    "https://pod.test/second/",
  ])("registers an import into %s in an index in the first advertised storage", async (secondRoot) => {
    const pod = createMemoryPod();
    const { indexUrl } = await writer(pod.fetch).registerType([]);
    await pod.fetch(TEST_PROFILE_DOC, {
      method: "PUT",
      body: `${pod.get(TEST_PROFILE_DOC)}
<${TEST_WEBID}> <http://www.w3.org/ns/pim/space#storage> <${secondRoot}> .`,
    });
    const fetch = vi.fn(pod.fetch);
    const port = createFetchPodWriter({
      adapterId: "toy",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: secondRoot,
      fetch,
    });
    const written = await port.write(doc);
    const container = port.resolve("media/");
    const result = await port.registerType([{ forClass: doc.forClass, container }]);
    expect(written.url).toBe(`${secondRoot}integrations/toy/${doc.slug}`);
    expect(pod.get(written.url)).toBeDefined();
    expect(result).toEqual({ indexUrl, added: 1, bootstrapped: false });
    expect(pod.get(indexUrl)).toContain(container);
    const indexCalls = fetch.mock.calls.filter(([input]) => String(input) === indexUrl);
    expect(indexCalls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PUT"]);
    expect(indexCalls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    expect(new Headers(indexCalls[1][1]?.headers).get("if-match")).toBe('"v1"');
  });

  it.each([
    "https://outside.test/index.ttl",
    "https://pod.test/alice-sibling/index.ttl",
    "https://second.test/alice-sibling/index.ttl",
  ])("rejects an index outside both advertised storages: %s", async (indexUrl) => {
    const pod = createMemoryPod();
    const secondRoot = "https://second.test/alice/";
    await pod.fetch(TEST_PROFILE_DOC, {
      method: "PUT",
      body: `${pod.get(TEST_PROFILE_DOC)}
<${TEST_WEBID}> <http://www.w3.org/ns/pim/space#storage> <${secondRoot}> ;
  <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${indexUrl}> .`,
    });
    const fetch = vi.fn(pod.fetch);
    const port = createFetchPodWriter({
      adapterId: "toy",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: secondRoot,
      fetch,
    });
    const putsBefore = pod.putCount;
    await expect(
      port.registerType([{ forClass: doc.forClass, container: port.resolve("media/") }]),
    ).rejects.toBeInstanceOf(PodScopeError);
    expect(fetch.mock.calls.map(([input]) => String(input).split("#")[0])).toEqual([
      TEST_PROFILE_DOC,
    ]);
    expect(pod.putCount).toBe(putsBefore);
  });

  it("refuses a profile-linked foreign Type Index before sending Pod credentials", async () => {
    const pod = createMemoryPod();
    const seen: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push(url);
      if ((init?.method ?? "GET") === "GET" && url.split("#")[0] === TEST_WEBID.split("#")[0]) {
        return new Response(
          `<${TEST_WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <https://foreign.test/index> .`,
          { headers: { "content-type": "text/turtle" } },
        );
      }
      return pod.fetch(input, init);
    };
    await expect(writer(fetch).registerType([])).rejects.toThrow();
    expect(seen).not.toContain("https://foreign.test/index");
  });
});
