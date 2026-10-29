// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { readRdf, readResource, search } from "../src/pod.js";
import { createFetchPodPort } from "../src/pod-port.js";
import { containerTurtle, makeFakePod } from "./fake-pod.js";

const ROOT = "https://alice.example/pod/";
const FILE = `${ROOT}note.txt`;

function responding(status = 200, headers: HeadersInit = {}) {
  return vi.fn<typeof fetch>(async () => new Response(null, { status, headers }));
}

describe("fetch PodPort", () => {
  it("retains raw bytes, normalized media type and ETag", async () => {
    const bytes = new Uint8Array([0, 255, 127]);
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(bytes, {
          headers: { "content-type": "IMAGE/PNG; charset=binary", etag: '"v1"' },
        }),
    );
    const pod = createFetchPodPort({ fetch, podRoot: ROOT });
    expect(pod.root).toBe(ROOT);
    expect(pod.webId).toBe("");
    expect(await pod.read(FILE)).toEqual({ body: bytes, contentType: "image/png", etag: '"v1"' });
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("accept")).toBeNull();
  });

  it("negotiates RDF only for RDF reads, preserving generic resource representations", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      const rdf =
        new Headers(init?.headers).get("accept") === "text/turtle, application/ld+json;q=0.9";
      return new Response(
        rdf ? '<#subject> <http://schema.org/name> "RDF view" .' : "default view",
        {
          headers: { "content-type": rdf ? "text/turtle" : "text/plain" },
        },
      );
    });
    const pod = createFetchPodPort({ fetch, podRoot: ROOT });
    expect((await readResource(pod, FILE)).text).toBe("default view");
    expect((await readRdf(pod, FILE)).turtle).toContain("RDF view");
  });

  it("requests RDF for configured off-pod profile discovery", async () => {
    const webId = "https://identity.example/card#me";
    const index = `${ROOT}index.ttl`;
    const solid = "http://www.w3.org/ns/solid/terms#";
    const fixture = makeFakePod({
      [ROOT]: { body: containerTurtle(ROOT, []), contentType: "text/turtle" },
      [index]: {
        body: `<#registration> <${solid}instance> <${ROOT}favorite.txt> .`,
        contentType: "text/turtle",
      },
      [`${ROOT}favorite.txt`]: { body: "readable instance", contentType: "text/plain" },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) !== webId) return fixture.fetch(input, init);
      const rdf =
        new Headers(init?.headers).get("accept") === "text/turtle, application/ld+json;q=0.9";
      return new Response(
        rdf ? `<${webId}> <${solid}publicTypeIndex> <${index}> .` : "<html>profile</html>",
        {
          headers: { "content-type": rdf ? "text/turtle" : "text/html" },
        },
      );
    });
    const pod = createFetchPodPort({ fetch, podRoot: ROOT, webId });
    expect((await search(pod, "favorite")).map((match) => match.url)).toContain(
      `${ROOT}favorite.txt`,
    );
  });

  it("supports a missing content type and ETag", async () => {
    const pod = createFetchPodPort({ fetch: responding(), podRoot: ROOT });
    expect(await pod.read(FILE)).toEqual({
      body: new Uint8Array(),
      contentType: "",
      etag: undefined,
    });
  });

  it.each(["legacy", "PodPort"])("defaults headerless RDF reads to Turtle via %s", async (mode) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          new TextEncoder().encode('<#subject> <http://schema.org/name> "Headerless RDF" .'),
        ),
    );
    const config = { fetch, podRoot: ROOT };
    const source = mode === "legacy" ? config : createFetchPodPort(config);
    const { dataset, turtle } = await readRdf(source, FILE);
    expect(dataset.getSubjects(null, null, null).map((subject) => subject.value)).toEqual([
      `${FILE}#subject`,
    ]);
    expect(turtle).toContain('"Headerless RDF"');
  });

  it.each([
    "legacy",
    "PodPort",
  ])("discovers Type Index hints from a headerless profile via %s", async (mode) => {
    const webId = "https://identity.example/card#me";
    const index = `${ROOT}index.ttl`;
    const instance = `${ROOT}favorite.txt`;
    const solid = "http://www.w3.org/ns/solid/terms#";
    const fixture = makeFakePod({
      [ROOT]: { body: containerTurtle(ROOT, []), contentType: "text/turtle" },
      [index]: {
        body: `<#registration> <${solid}instance> <${instance}> .`,
        contentType: "text/turtle",
      },
      [instance]: { body: "readable instance", contentType: "text/plain" },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) !== webId) return fixture.fetch(input, init);
      return new Response(
        new TextEncoder().encode(`<${webId}> <${solid}publicTypeIndex> <${index}> .`),
      );
    });
    const config = { fetch, podRoot: ROOT, webId };
    const source = mode === "legacy" ? config : createFetchPodPort(config);
    expect(await search(source, "favorite")).toEqual([
      { url: instance, name: "favorite.txt", snippet: "type-index instance" },
    ]);
  });

  it("preserves portable listing fields and legacy metadata", async () => {
    const fixture = makeFakePod({
      [ROOT]: {
        body: containerTurtle(ROOT, [{ name: "notes/", container: true }]),
        contentType: "text/turtle",
      },
    });
    const pod = createFetchPodPort({ fetch: fixture.fetch, podRoot: ROOT });
    expect(await pod.list(ROOT)).toEqual([
      expect.objectContaining({
        url: `${ROOT}notes/`,
        name: "notes",
        isContainer: true,
        type: expect.any(Array),
      }),
    ]);
  });

  it("preserves the configured external WebID exception only for discovery", async () => {
    const webId = "https://identity.example/card#me";
    const fetch = responding();
    const pod = createFetchPodPort({ fetch, podRoot: ROOT, webId });
    expect(pod.webId).toBe(webId);
    await pod.read(webId);
    expect(fetch.mock.calls[0]?.[0]).toBe(webId);
    await expect(pod.read("https://identity.example/other")).rejects.toThrow(/pod-scope/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never follows an off-pod WebID redirect to an internal service", async () => {
    const webId = "https://identity.example/card#me";
    const fetch = responding(302, { location: "http://169.254.169.254/internal" });
    const pod = createFetchPodPort({ fetch, podRoot: ROOT, webId });
    await expect(pod.read(webId)).rejects.toThrow(/HTTP 302/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(webId);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("snapshots the configured capability", async () => {
    const config = { fetch: responding(), podRoot: ROOT, readOnly: true };
    const pod = createFetchPodPort(config);
    config.podRoot = "https://evil.example/";
    config.readOnly = false;
    await expect(pod.read("https://evil.example/x")).rejects.toThrow(/pod-scope/);
    await expect(pod.write(FILE, new Uint8Array(), "text/plain", {})).rejects.toThrow(/read-only/);
    expect(config.fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 500])("fails closed on read HTTP %s", async (status) => {
    const pod = createFetchPodPort({ fetch: responding(status), podRoot: ROOT });
    await expect(pod.read(FILE)).rejects.toThrow(new RegExp(String(status)));
  });

  it("rejects a read redirect outside the pod before following it", async () => {
    const fetch = responding(302, { location: "https://evil.example/leak" });
    const pod = createFetchPodPort({ fetch, podRoot: ROOT });
    await expect(pod.read(FILE)).rejects.toThrow(/pod-scope/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("resolves relative RDF IRIs against the final in-pod redirect URL", async () => {
    const finalUrl = `${ROOT}nested/data.ttl`;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input) === FILE)
        return new Response(null, { status: 302, headers: { location: finalUrl } });
      const response = new Response('<#subject> <http://schema.org/name> "fixture" .', {
        headers: { "content-type": "text/turtle" },
      });
      Object.defineProperty(response, "url", { value: finalUrl });
      return response;
    });
    const pod = createFetchPodPort({ fetch, podRoot: ROOT });
    const { dataset } = await readRdf(pod, FILE);
    expect(dataset.getSubjects(null, null, null).map((subject) => subject.value)).toContain(
      `${finalUrl}#subject`,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([FILE, finalUrl]);
  });

  it("forwards byte writes and conditional headers, returning the ETag", async () => {
    const fetch = responding(201, { etag: '"new"' });
    const pod = createFetchPodPort({ fetch, podRoot: ROOT, readOnly: false });
    const bytes = new Uint8Array([0, 255]);
    expect(await pod.write(FILE, bytes, "application/octet-stream", { ifMatch: '"old"' })).toEqual({
      etag: '"new"',
    });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe("PUT");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("if-match")).toBe('"old"');
    expect(new Headers(init?.headers).get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(init?.body as Buffer)).toEqual(bytes);
    expect(await pod.write(FILE, bytes, "text/plain", { ifNoneMatch: "*" })).toEqual({
      etag: '"new"',
    });
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("if-none-match")).toBe("*");
  });

  it("supports a successful write without an ETag and conditional deletes", async () => {
    const fetch = responding(204);
    const pod = createFetchPodPort({ fetch, podRoot: ROOT, readOnly: false });
    expect(await pod.write(FILE, new Uint8Array(), "text/plain", {})).toEqual({ etag: undefined });
    await pod.delete(FILE, { ifMatch: '"old"' });
    const init = fetch.mock.calls[1]?.[1];
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
    expect(new Headers(init?.headers).get("if-match")).toBe('"old"');
    await pod.delete(FILE);
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get("if-match")).toBeNull();
  });

  it.each([undefined, true])("disables both mutations when readOnly is %s", async (readOnly) => {
    const fetch = responding();
    const pod = createFetchPodPort({ fetch, podRoot: ROOT, readOnly });
    await expect(pod.write(FILE, new Uint8Array(), "text/plain", {})).rejects.toThrow(/read-only/);
    await expect(pod.delete(FILE)).rejects.toThrow(/read-only/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ROOT,
    ROOT.slice(0, -1),
    "https://evil.example/x",
    `${ROOT}../x`,
  ])("rejects mutation target %s", async (url) => {
    const fetch = responding();
    const pod = createFetchPodPort({ fetch, podRoot: ROOT, readOnly: false });
    await expect(pod.write(url, new Uint8Array(), "text/plain", {})).rejects.toThrow(/pod-scope/);
    await expect(pod.delete(url)).rejects.toThrow(/pod-scope/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    301, 302, 303, 307, 308, 401, 403, 412, 500,
  ])("rejects mutation HTTP %s without following redirects", async (status) => {
    const fetch = responding(status, { location: `${ROOT}other` });
    const pod = createFetchPodPort({ fetch, podRoot: ROOT, readOnly: false });
    await expect(pod.write(FILE, new Uint8Array(), "text/plain", {})).rejects.toThrow(
      new RegExp(String(status)),
    );
    await expect(pod.delete(FILE)).rejects.toThrow(new RegExp(String(status)));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
