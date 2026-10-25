// AUTHORED-BY Codex GPT-6.1-Sol
import { assert, describe, expect, it, vi } from "vitest";
import { buildDocument, parseDocument } from "../../src/apps/docs/lib/model/document.js";
import {
  OutOfScopeError,
  ResourceReadError,
  ResourceWriteError,
  TitleConflictError,
} from "../../src/apps/docs/lib/model/errors.js";
import { docContainerUrls } from "../../src/apps/docs/lib/model/layout.js";
import { serializeTurtle } from "../../src/apps/docs/lib/model/rdf-io.js";
import {
  createDocsStore,
  DocsStore,
  type StoredDocument,
} from "../../src/apps/docs/lib/model/store.js";
import { mockFetch, type RecordedCall } from "./helpers.js";

const POD = "https://pod.example/";
const WEBID = `${POD}profile/card#me`;
const INDEX = `${POD}settings/privateTypeIndex.ttl`;
const DOC = `${POD}docs/plan.ttl`;
const NOW = new Date("2026-10-25T12:00:00Z");
const WAIT = async () => {};

async function document(title = "Plan", body = "old"): Promise<StoredDocument> {
  const dataset = buildDocument(DOC, {
    title,
    body,
    now: NOW,
    creator: WEBID,
    ...docContainerUrls(DOC),
  });
  const data = parseDocument(DOC, dataset);
  assert(data);
  return { url: DOC, etag: '"v1"', data };
}

/** In-memory HTTP seam: exercises real RDF parsing, serialization and preconditions. */
async function server() {
  const resources = new Map<string, { body: string; etag: string; contentType: string }>([
    [
      WEBID,
      {
        body: `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${INDEX}>.`,
        etag: '"p"',
        contentType: "text/turtle",
      },
    ],
    [INDEX, { body: "", etag: '"i"', contentType: "text/turtle" }],
  ]);
  const initial = await document();
  resources.set(DOC, {
    body: await serializeTurtle(
      buildDocument(DOC, { ...initial.data, priorRevisions: [], now: NOW }),
    ),
    etag: '"v1"',
    contentType: "text/turtle",
  });
  const calls: RecordedCall[] = [];
  let count = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers));
    calls.push({
      url,
      method,
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const existing = resources.get(url);
    if (method === "GET")
      return existing
        ? new Response(existing.body, {
            headers: { etag: existing.etag, "content-type": existing.contentType },
          })
        : new Response(null, { status: 404 });
    if (
      (headers["if-none-match"] === "*" && existing) ||
      (headers["if-match"] && headers["if-match"] !== "*" && headers["if-match"] !== existing?.etag)
    )
      return new Response(null, { status: 412 });
    const body =
      typeof init?.body === "string"
        ? init.body
        : new TextDecoder().decode(init?.body as ArrayBuffer);
    const etag = `"write-${count++}"`;
    resources.set(url, {
      body,
      etag,
      contentType: headers["content-type"] ?? "application/octet-stream",
    });
    return new Response(null, { status: 201, headers: { etag } });
  };
  return {
    resources,
    calls,
    fetchImpl,
    store: createDocsStore({ podRoot: POD, webId: WEBID, fetchImpl }),
  };
}

function listing(children: string[]): string {
  return `@prefix ldp: <http://www.w3.org/ns/ldp#>. <> a ldp:Container; ldp:contains ${children.map((u) => `<${u}>`).join(", ")}.`;
}

describe("store creation and scope", () => {
  it("creates canonical metadata, containers and private registration; retries readable collisions", async () => {
    const s = await server();
    expect(s.store.docContainerUrls("plan")).toEqual(docContainerUrls(DOC));
    const created = await s.store.create({ title: "Plan", body: "<h1>Plan</h1>" });
    expect(created.url).toBe(`${POD}docs/plan-2.ttl`);
    expect(created.data.creator).toBe(WEBID);
    expect(created.data.revisions).toHaveLength(1);
    const layout = docContainerUrls(created.url);
    for (const url of [layout.container, layout.updateLog, layout.assets, layout.comments]) {
      expect(s.resources.get(url)?.body).toContain("BasicContainer");
    }
    expect(s.resources.get(INDEX)?.body).toContain(`${POD}docs/`);
    expect(s.resources.get(INDEX)?.body).not.toContain("pod-docs/");
    expect(
      s.calls.filter((c) => c.url === created.url && c.method === "PUT")[0]?.headers[
        "if-none-match"
      ],
    ).toBe("*");
    const read = await s.store.read(created.url);
    expect(read).toEqual(created);
    const next = await s.store.create({ title: "", body: "" });
    expect(next.url).toMatch(/docs\/[a-f0-9]{8}\.ttl$/);
    const hint = await s.store.create({ title: "Display" }, "Other name");
    expect(hint.url).toBe(`${POD}docs/other-name.ttl`);
  });
  it("tolerates existing child containers, and propagates other creation errors", async () => {
    const s = await server();
    const layout = docContainerUrls(`${POD}docs/new.ttl`);
    s.resources.set(layout.container, { body: "", etag: '"c"', contentType: "text/turtle" });
    await expect(s.store.create({ title: "New" })).resolves.toHaveProperty(
      "url",
      `${POD}docs/new.ttl`,
    );
    const f: typeof fetch = async (url, init) => {
      if (init?.method === "PUT" && String(url).endsWith("/updates/"))
        return new Response(null, { status: 403 });
      return s.fetchImpl(url, init);
    };
    const store = new DocsStore(POD, WEBID, f);
    await expect(store.create({ title: "Fail" })).rejects.toMatchObject({ status: 403 });
    const bad: typeof fetch = async (url, init) => {
      if (init?.method === "PUT" && String(url).endsWith("fail-2.ttl"))
        return new Response(null, { status: 507 });
      return s.fetchImpl(url, init);
    };
    await expect(new DocsStore(POD, WEBID, bad).create({ title: "Fail" })).rejects.toMatchObject({
      status: 507,
    });
  });
  it("permits legacy reads but rejects writes and foreign resources before fetch", async () => {
    const s = await server();
    const legacy = `${POD}pod-docs/old.ttl`;
    s.resources.set(legacy, {
      body: `<#it> a <https://w3id.org/jeswr/pod-docs#Document>.`,
      etag: '"l"',
      contentType: "text/turtle",
    });
    expect((await s.store.read(legacy))?.data.title).toBe("");
    const n = s.calls.length;
    await expect(s.store.read("https://evil.example/docs/a.ttl")).rejects.toBeInstanceOf(
      OutOfScopeError,
    );
    const stored = await document();
    await expect(
      s.store.save({ ...stored, url: legacy }, {}, { regenerate: () => ({ body: "" }) }),
    ).rejects.toBeInstanceOf(OutOfScopeError);
    expect(s.calls).toHaveLength(n);
    s.resources.set(`${POD}docs/stray.ttl`, { body: "", etag: '"s"', contentType: "text/turtle" });
    expect(await s.store.read(`${POD}docs/stray.ttl`)).toBeUndefined();
  });
});

describe("listing", () => {
  it("lists registered legacy containers with read-only provenance and canonical default", async () => {
    const s = await server();
    const legacy = `${POD}pod-docs/`;
    const old = `${legacy}old.ttl`;
    s.resources.set(INDEX, {
      body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>. <#r> a solid:TypeRegistration; solid:forClass <https://w3id.org/jeswr/pod-docs#Document>; solid:instanceContainer <${legacy}>.`,
      etag: '"i"',
      contentType: "text/turtle",
    });
    const children = [
      DOC,
      `${POD}docs/`,
      `${POD}docs/nested/`,
      `${POD}docs/stray.ttl`,
      `${POD}docs/missing.ttl`,
      "https://evil.example/docs/stolen.ttl",
    ];
    s.resources.set(`${POD}docs/`, {
      body: listing(children),
      etag: '"c"',
      contentType: "text/turtle",
    });
    s.resources.set(legacy, { body: listing([old]), etag: '"l"', contentType: "text/turtle" });
    s.resources.set(old, {
      body: `<#it> a <https://w3id.org/jeswr/pod-docs#Document>; <http://purl.org/dc/terms/title> "Older".`,
      etag: '"old"',
      contentType: "text/turtle",
    });
    s.resources.set(`${POD}docs/stray.ttl`, { body: "", etag: '"s"', contentType: "text/turtle" });
    const entries = await s.store.list();
    expect(entries.map((e) => [e.title, e.legacy, e.readOnly])).toEqual([
      ["Older", true, true],
      ["Plan", false, false],
    ]);
    expect(s.calls.some((c) => c.url.includes("evil.example"))).toBe(false);
  });
  it("ignores unregistered legacy containers and absent/forbidden canonical locations", async () => {
    for (const status of [403, 404]) {
      const s = await server();
      const f: typeof fetch = async (url, init) =>
        String(url) === `${POD}docs/` ? new Response(null, { status }) : s.fetchImpl(url, init);
      expect(await new DocsStore(POD, WEBID, f).list()).toEqual([]);
      expect(s.calls.some((c) => c.url === `${POD}pod-docs/`)).toBe(false);
    }
  });
  it("handles a dataset with no container and propagates server failures", async () => {
    const s = await server();
    s.resources.set(`${POD}docs/`, { body: "", etag: '"c"', contentType: "text/turtle" });
    expect(await s.store.list()).toEqual([]);
    const f: typeof fetch = async (url, init) =>
      String(url) === `${POD}docs/` ? new Response(null, { status: 500 }) : s.fetchImpl(url, init);
    await expect(new DocsStore(POD, WEBID, f).list()).rejects.toMatchObject({ status: 500 });
  });
});

describe("snapshot conflicts", () => {
  it("regenerates every retry, uses the fresh ETag, and preserves remote metadata/history", async () => {
    const s = await server();
    const stored = await document();
    const remote = buildDocument(DOC, {
      ...stored.data,
      title: "Remote title",
      body: "remote body",
      now: new Date(NOW.getTime() + 600_000),
      revisionLabel: "Remote named",
      priorRevisions: stored.data.revisions,
    });
    s.resources.set(DOC, {
      body: await serializeTurtle(remote),
      etag: '"remote"',
      contentType: "text/turtle",
    });
    const regenerate = vi.fn(() => ({ body: "merged live state", wordCount: 3 }));
    const wait = vi.fn(WAIT);
    const saved = await s.store.save(
      stored,
      { body: "stale HTML", now: new Date(NOW.getTime() + 600_001) },
      { regenerate, wait },
    );
    expect(saved.data.title).toBe("Remote title");
    expect(saved.data.body).toBe("merged live state");
    expect(saved.data.wordCount).toBe(3);
    expect(saved.data.revisions[0]?.label).toBe("Remote named");
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(2000);
    const writes = s.calls.filter((c) => c.method === "PUT");
    expect(writes.map((c) => c.headers["if-match"])).toEqual(['"v1"', '"remote"']);
    expect(writes[0]?.body).toContain("stale HTML");
    expect(writes[1]?.body).toContain("merged live state");
    expect(writes[1]?.body).not.toContain("stale HTML");
  });
  it("surfaces a typed title conflict only when both changed differently", async () => {
    const s = await server();
    const stored = await document();
    const data = { ...stored.data, title: "Theirs" };
    s.resources.set(DOC, {
      body: await serializeTurtle(buildDocument(DOC, data)),
      etag: '"r"',
      contentType: "text/turtle",
    });
    await expect(
      s.store.save(stored, { title: "Mine" }, { regenerate: () => ({ body: "live" }), wait: WAIT }),
    ).rejects.toMatchObject({
      name: "TitleConflictError",
      localTitle: "Mine",
      remoteTitle: "Theirs",
    });
    const saved = await s.store.save(
      stored,
      { title: "Theirs" },
      { regenerate: () => ({ body: "live" }), wait: WAIT },
    );
    expect(saved.data.title).toBe("Theirs");
    const same = await server();
    expect(
      (await same.store.save(stored, { title: "Mine" }, { regenerate: () => ({ body: "unused" }) }))
        .data.title,
    ).toBe("Mine");
  });
  it("caps retries at three, backs off exponentially, and propagates terminal failures", async () => {
    const s = await server();
    const stored = await document();
    const f: typeof fetch = async (url, init) =>
      init?.method === "PUT" ? new Response(null, { status: 412 }) : s.fetchImpl(url, init);
    const wait = vi.fn(WAIT);
    const regenerate = vi.fn(() => ({ body: "live" }));
    await expect(
      new DocsStore(POD, WEBID, f).save(stored, {}, { regenerate, wait }),
    ).rejects.toBeInstanceOf(ResourceWriteError);
    expect(wait.mock.calls).toEqual([[2000], [4000], [8000]]);
    expect(regenerate).toHaveBeenCalledTimes(3);
    const denied: typeof fetch = async () => new Response(null, { status: 403 });
    await expect(
      new DocsStore(POD, WEBID, denied).save(stored, {}, { regenerate, wait }),
    ).rejects.toMatchObject({ status: 403 });
    const network: typeof fetch = async () => {
      throw new Error("offline");
    };
    await expect(
      new DocsStore(POD, WEBID, network).save(stored, {}, { regenerate, wait }),
    ).rejects.toThrow("offline");
  });
  it("uses the real backoff seam by default and reports a disappeared document", async () => {
    vi.useFakeTimers();
    try {
      const stored = await document();
      const { fetch } = mockFetch({
        [`PUT ${DOC}`]: { status: 412 },
        [`GET ${DOC}`]: { body: "" },
      });
      const pending = new DocsStore(POD, WEBID, fetch).save(
        stored,
        {},
        { regenerate: () => ({ body: "live" }) },
      );
      const expectation = expect(pending).rejects.toBeInstanceOf(ResourceReadError);
      await vi.runAllTimersAsync();
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
  it("preserves defaults and sends explicit If-Match on servers with no ETag", async () => {
    const s = await server();
    const stored = { ...(await document()), etag: null };
    const result = await s.store.save(stored, {}, { regenerate: () => ({ body: "unused" }) });
    expect(result.data.body).toBe("old");
    expect(s.calls.find((c) => c.method === "PUT")?.headers["if-match"]).toBe("*");
  });
});

describe("makeCopy", () => {
  it("copies the live body, referenced assets, new full-state log and derivation", async () => {
    const s = await server();
    const source = await document();
    const asset = `${docContainerUrls(DOC).assets}chart.png`;
    s.resources.set(asset, { body: "png bytes", contentType: "image/png", etag: '"a"' });
    const persistFullState = vi.fn(async (updates: string, fetchImpl: typeof fetch) => {
      expect(fetchImpl).toBe(s.fetchImpl);
      await fetchImpl(`${updates}state`, {
        method: "PUT",
        body: "current CRDT state",
        headers: { "if-none-match": "*", "content-type": "application/octet-stream" },
      });
    });
    const copy = await s.store.makeCopy(source, {
      assets: [asset, asset],
      persistFullState,
      snapshot: (mapping) => ({ body: `<img src="${mapping.get(asset)}">live body`, wordCount: 2 }),
    });
    expect(copy.url).toBe(`${POD}docs/plan-copy.ttl`);
    expect(copy.data).toMatchObject({
      title: "Copy of Plan",
      body: `<img src="${docContainerUrls(copy.url).assets}chart.png">live body`,
      wasDerivedFrom: `${DOC}#it`,
      wordCount: 2,
    });
    expect(copy.data.revisions).toHaveLength(1);
    expect(copy.data.revisions[0]?.body).toBe(copy.data.body);
    expect(persistFullState).toHaveBeenCalledOnce();
    expect(s.calls.filter((c) => c.url === asset)).toHaveLength(1);
    expect(s.resources.get(`${docContainerUrls(copy.url).assets}chart.png`)?.body).toBe(
      "png bytes",
    );
    expect(s.resources.get(`${docContainerUrls(copy.url).updateLog}state`)?.body).toBe(
      "current CRDT state",
    );
    const fresh = await s.store.read(copy.url);
    expect(fresh).toEqual(copy);
  });
  it("copies untitled legacy documents with layout fallbacks and binary content-type fallback", async () => {
    const s = await server();
    const source = { ...(await document("")), url: `${POD}pod-docs/---.ttl` };
    delete source.data.assets;
    const asset = `${docContainerUrls(source.url).assets}image`;
    const f: typeof fetch = async (url, init) => {
      if (String(url) === asset) return new Response(new Uint8Array([98, 105, 110, 97, 114, 121]));
      const response = await s.fetchImpl(url, init);
      response.headers.delete("etag");
      return response;
    };
    const copy = await new DocsStore(POD, WEBID, f).makeCopy(source, {
      assets: [asset],
      snapshot: () => ({ body: "" }),
      persistFullState: async () => {},
    });
    expect(copy.url).toBe(`${POD}docs/document-copy.ttl`);
    // Byte responses with no media type use the binary fallback.
    expect(s.resources.get(`${docContainerUrls(copy.url).assets}image`)?.body).toBe("binary");
    expect(s.resources.get(`${docContainerUrls(copy.url).assets}image`)?.contentType).toBe(
      "application/octet-stream",
    );
  });
  it("rejects foreign asset links before any I/O", async () => {
    const s = await server();
    const source = await document();
    const state = {
      assets: ["https://evil.example/image"],
      snapshot: () => ({ body: "" }),
      persistFullState: async () => {},
    };
    await expect(s.store.makeCopy(source, state)).rejects.toBeInstanceOf(OutOfScopeError);
    await expect(
      s.store.makeCopy(
        { ...source, data: { ...source.data, assets: "https://evil.example/" } },
        state,
      ),
    ).rejects.toBeInstanceOf(OutOfScopeError);
    expect(s.calls).toHaveLength(0);
  });
  it("propagates asset read/write and state-persistence failures", async () => {
    for (const status of [404, 403]) {
      const s = await server();
      const source = await document();
      const asset = `${docContainerUrls(DOC).assets}chart.png`;
      const f: typeof fetch = async (url, init) => {
        if (String(url) === asset)
          return status === 404 ? new Response(null, { status }) : new Response("bytes");
        if (String(url).endsWith("chart.png")) return new Response(null, { status });
        return s.fetchImpl(url, init);
      };
      await expect(
        new DocsStore(POD, WEBID, f).makeCopy(source, {
          assets: [asset],
          snapshot: () => ({ body: "" }),
          persistFullState: async () => {},
        }),
      ).rejects.toBeInstanceOf(status === 404 ? ResourceReadError : ResourceWriteError);
    }
    const s = await server();
    await expect(
      s.store.makeCopy(await document(), {
        assets: [],
        snapshot: () => ({ body: "" }),
        persistFullState: async () => {
          throw new Error("log failed");
        },
      }),
    ).rejects.toThrow("log failed");
  });
});

it("typed title conflicts retain their structured fields", () => {
  expect(new TitleConflictError(DOC, "Mine", "Theirs")).toMatchObject({
    url: DOC,
    localTitle: "Mine",
    remoteTitle: "Theirs",
  });
});
