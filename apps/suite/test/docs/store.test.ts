// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6 — review regression tests
// AUTHORED-BY Codex — preferences-based index bootstrap

import { RedirectRefusedError } from "@jeswr/guarded-fetch";
import { DataFactory } from "n3";
import { assert, describe, expect, it, vi } from "vitest";
import { buildDocument, parseDocument } from "../../src/apps/docs/lib/model/document.js";
import {
  ConcurrencyValidatorError,
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
  type Snapshot,
  type StoredDocument,
} from "../../src/apps/docs/lib/model/store.js";
import { ProfileTypeIndexAnchor } from "../../src/apps/docs/lib/model/type-index.js";
import { mockFetch, privateIndexPolicy, type RecordedCall, turtleToStore } from "./helpers.js";

const POD = "https://pod.example/";
const WEBID = `${POD}profile/card#me`;
const INDEX = `${POD}settings/privateTypeIndex.ttl`;
const PREFERENCES = `${POD}settings/prefs.ttl`;
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
    const policy = {
      ...privateIndexPolicy(INDEX, WEBID),
      ...privateIndexPolicy(PREFERENCES, WEBID),
    }[`${method} ${url}`];
    if (policy)
      return new Response(method === "GET" ? policy.body : null, {
        headers: { "content-type": "text/turtle", ...policy.headers },
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

describe("store redirect refusal", () => {
  it.each([
    ["read", "GET", DOC],
    ["save", "PUT", DOC],
    ["list", "GET", WEBID],
    ["list", "GET", `${POD}docs/`],
    ["list", "GET", `${POD}pod-docs/`],
    ["list child", "GET", DOC],
    ["create", "PUT", `${POD}docs/new/`],
    ["create", "PUT", `${POD}docs/new/updates/`],
    ["create", "PUT", `${POD}docs/new/assets/`],
    ["create", "PUT", `${POD}docs/new/comments/`],
    ["create", "PUT", `${POD}docs/new.ttl`],
    ["copy", "GET", `${POD}docs/plan/assets/chart.png`],
    ["copy", "PUT", `${POD}docs/plan-copy/assets/chart.png`],
    ["copy", "PUT", `${POD}docs/plan-copy/updates/state`],
    ["copy finalization", "PUT", `${POD}docs/plan-copy.ttl`],
  ])("refuses %s %s redirects at %s", async (operation, method, target) => {
    const s = await server();
    s.resources.set(`${POD}docs/`, {
      body: listing([DOC]),
      etag: '"c"',
      contentType: "text/turtle",
    });
    if (target === `${POD}pod-docs/`) {
      const index = s.resources.get(INDEX);
      assert(index);
      index.body = `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
        <#legacy> a solid:TypeRegistration; solid:forClass <https://jeswr.org/ns/pod-docs#Document>;
        solid:instanceContainer <${target}>.`;
    }
    const asset = `${POD}docs/plan/assets/chart.png`;
    s.resources.set(asset, { body: "png", etag: '"a"', contentType: "image/png" });
    const destination = "https://evil.example/stolen";
    let targetCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url) === target && (init?.method ?? "GET") === method) {
        targetCalls++;
        if (operation !== "copy finalization" || targetCalls === 2) {
          return new Response(null, { status: 307, headers: { location: destination } });
        }
      }
      return s.fetchImpl(url, init);
    });
    const store = new DocsStore(POD, WEBID, fetchImpl);
    const stored = await document();
    const pending = operation.startsWith("list")
      ? store.list()
      : operation === "read"
        ? store.read(DOC)
        : operation === "save"
          ? store.save(stored, {}, { regenerate: () => ({ format: "text/html", body: "live" }) })
          : operation === "create"
            ? store.create({ title: "New" })
            : store.makeCopy(stored, {
                assets: [asset],
                snapshot: () => ({ format: "text/html", body: "copied" }),
                persistFullState: async (updates, fetch) => {
                  await fetch(`${updates}state`, {
                    method: "PUT",
                    body: "state",
                    redirect: "follow",
                  });
                },
              });
    if (operation === "list child") await expect(pending).resolves.toEqual([]);
    else
      await expect(pending).rejects.toMatchObject(
        method === "GET" && operation !== "copy"
          ? { cause: expect.any(RedirectRefusedError) }
          : expect.any(RedirectRefusedError),
      );
    expect(targetCalls).toBe(operation === "copy finalization" ? 2 : 1);
    expect(
      fetchImpl.mock.calls.every(
        ([url, init]) => String(url) !== destination && init?.redirect === "manual",
      ),
    ).toBe(true);
  });
});

describe("store creation and scope", () => {
  it("creates both documents when first-use profile linking races", async () => {
    const s = await server();
    const profileDocument = WEBID.split("#")[0] as string;
    const profile = { body: "", etag: '"profile-old"', contentType: "text/turtle" };
    s.resources.set(WEBID, profile);
    s.resources.set(profileDocument, profile);
    let profileReads = 0;
    let release = () => {};
    const initialReads = new Promise<void>((resolve) => {
      release = resolve;
    });
    const profileStatuses: number[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const response = await s.fetchImpl(url, init);
      if (String(url) === WEBID && ++profileReads <= 2) {
        if (profileReads === 2) release();
        await initialReads;
      }
      if (String(url) === profileDocument && init?.method === "PUT") {
        profileStatuses.push(response.status);
        if (response.ok) s.resources.set(WEBID, s.resources.get(profileDocument) as typeof profile);
      }
      return response;
    };
    const store = new DocsStore(POD, WEBID, fetchImpl);
    const documents = await Promise.all([
      store.create({ title: "First" }),
      store.create({ title: "Second" }),
    ]);
    expect(profileStatuses.sort()).toEqual([201, 412]);
    const profileLinks = new ProfileTypeIndexAnchor(
      WEBID,
      turtleToStore(s.resources.get(WEBID)?.body ?? "", WEBID),
      DataFactory,
    );
    expect([...profileLinks.preferencesFiles]).toEqual([PREFERENCES]);
    expect(profileLinks.privateIndex).toBeUndefined();
    expect(
      new ProfileTypeIndexAnchor(
        WEBID,
        turtleToStore(s.resources.get(PREFERENCES)?.body ?? "", PREFERENCES),
        DataFactory,
      ).privateIndex,
    ).toBe(INDEX);
    for (const doc of documents) expect(await store.read(doc.url)).toEqual(doc);
  });
  it.each([
    "create",
    "copy",
  ])("repairs a missing linked index during document %s", async (operation) => {
    const s = await server();
    s.resources.delete(INDEX);
    const created =
      operation === "create"
        ? await s.store.create({ title: "New" })
        : await s.store.makeCopy(await document(), {
            assets: [],
            snapshot: () => ({ format: "text/html", body: "copied" }),
            persistFullState: async () => {},
          });
    expect(await s.store.read(created.url)).toEqual(created);
    expect(s.resources.get(INDEX)?.body).toContain(`${POD}docs/`);
    expect(s.calls.some((call) => call.method === "PUT" && call.url.includes("profile/card"))).toBe(
      false,
    );
  });
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
  it.each([
    "container",
    "updateLog",
    "assets",
    "comments",
  ] as const)("skips a slug with an existing %s and preserves its old updates", async (child) => {
    const s = await server();
    s.resources.delete(DOC);
    const layout = docContainerUrls(DOC);
    const old = { body: "old container", etag: '"c"', contentType: "text/turtle" };
    s.resources.set(layout[child], old);
    const update = `${layout.updateLog}old-update`;
    s.resources.set(update, { ...old, body: "unrelated CRDT state" });

    const created = await s.store.create({ title: "Plan", body: "fresh content" });

    expect(created.url).toBe(`${POD}docs/plan-2.ttl`);
    expect(created.data.updateLog).toBe(`${POD}docs/plan-2/updates/`);
    expect(s.resources.get(layout[child])).toEqual(old);
    expect(s.resources.get(update)?.body).toBe("unrelated CRDT state");
    expect(s.resources.has(DOC)).toBe(false);
    const writes = s.calls.filter((c) => c.method === "PUT" && c.url.includes("/docs/"));
    expect(writes.every((c) => c.headers["if-none-match"] === "*")).toBe(true);
    expect(writes.at(-1)?.url).toBe(created.url);
  });
  it("allocates distinct resources and companions for simultaneous creates", async () => {
    const s = await server();
    s.resources.delete(DOC);
    const created = await Promise.all([
      s.store.create({ title: "Plan", body: "first" }),
      s.store.create({ title: "Plan", body: "second" }),
    ]);
    expect(new Set(created.map((doc) => doc.url)).size).toBe(2);
    expect(new Set(created.map((doc) => doc.data.updateLog)).size).toBe(2);
    expect(created.map((doc) => doc.data.body).sort()).toEqual(["first", "second"]);
  });
  it("propagates container and document creation errors", async () => {
    const s = await server();
    const f: typeof fetch = async (url, init) => {
      if (init?.method === "PUT" && String(url).endsWith("/updates/"))
        return new Response(null, { status: 403 });
      return s.fetchImpl(url, init);
    };
    const store = new DocsStore(POD, WEBID, f);
    await expect(store.create({ title: "Fail" })).rejects.toMatchObject({ status: 403 });
    expect(s.resources.has(`${POD}docs/fail.ttl`)).toBe(false);
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
      s.store.save(
        { ...stored, url: legacy },
        {},
        { regenerate: () => ({ format: "text/html", body: "" }) },
      ),
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
  it.each([
    ["text/markdown", "text/html", "<p>Regenerated HTML</p>"],
    ["text/html", "text/markdown", "# Regenerated Markdown"],
  ])("keeps regenerated body and format together after a remote %s change", async (remoteFormat, format, body) => {
    const s = await server();
    const stored = await document();
    const now = new Date(NOW.getTime() + 600_000);
    s.resources.set(DOC, {
      body: await serializeTurtle(
        buildDocument(DOC, {
          ...stored.data,
          body: "Remote",
          format: remoteFormat,
          now,
          priorRevisions: stored.data.revisions,
          revisionLabel: "Remote format change",
        }),
      ),
      etag: '"remote"',
      contentType: "text/turtle",
    });
    const regenerate = vi.fn((): Snapshot => ({ body, format, wordCount: 2 }));
    const saved = await s.store.save(
      stored,
      { body: "Stale", format: remoteFormat, now: new Date(now.getTime() + 600_000) },
      { regenerate, wait: WAIT },
    );
    expect(regenerate).toHaveBeenCalledOnce();
    const reopened = await s.store.read(DOC);
    expect(reopened).toEqual(saved);
    expect(saved.data).toMatchObject({ body, format, wordCount: 2 });
    expect(saved.data.revisions[0]).toMatchObject({ body, format });
    expect(saved.data.revisions[1]).toMatchObject({
      body: "Remote",
      format: remoteFormat,
      label: "Remote format change",
    });
  });
  it.each([
    'W/"v1"',
    null,
  ])("rejects stale saves with validator %j and preserves remote history", async (etag) => {
    const s = await server();
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const response = await s.fetchImpl(url, init);
      if (etag === null) response.headers.delete("etag");
      else response.headers.set("etag", etag);
      return response;
    });
    const store = new DocsStore(POD, WEBID, fetchImpl);
    const source = await store.read(DOC);
    assert(source);
    expect(source.etag).toBe(etag);
    const remote = {
      body: await serializeTurtle(
        buildDocument(DOC, {
          ...source.data,
          body: "Remote edit",
          now: new Date(NOW.getTime() + 600_000),
          priorRevisions: source.data.revisions,
          revisionLabel: "Remote revision",
        }),
      ),
      etag: '"remote"',
      contentType: "text/turtle",
    };
    s.resources.set(DOC, remote);
    const regenerate = vi.fn(() => ({ format: "text/html", body: "regenerated" }));
    const wait = vi.fn(WAIT);
    await expect(store.save(source, { body: "live" }, { regenerate, wait })).rejects.toBeInstanceOf(
      ConcurrencyValidatorError,
    );
    expect(s.calls.filter((call) => call.method === "PUT")).toEqual([]);
    expect(s.resources.get(DOC)).toEqual(remote);
    expect(source.data.body).toBe("old");
    expect(source.data.revisions).not.toContainEqual(expect.objectContaining({ body: "live" }));
    expect(regenerate).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });
  it.each([
    'W/"remote"',
    "",
  ])("stops a conflict retry if the refreshed validator is unusable (%j)", async (etag) => {
    const s = await server();
    const stored = await document();
    const existing = s.resources.get(DOC);
    assert(existing);
    const remote = { ...existing, etag };
    s.resources.set(DOC, remote);
    const regenerate = vi.fn(() => ({ format: "text/html", body: "live" }));
    const wait = vi.fn(WAIT);
    await expect(
      s.store.save(stored, { body: "stale" }, { regenerate, wait }),
    ).rejects.toBeInstanceOf(ConcurrencyValidatorError);
    expect(regenerate).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledOnce();
    expect(
      s.calls.filter((call) => call.method === "PUT").map((call) => call.headers["if-match"]),
    ).toEqual(['"v1"']);
    expect(s.resources.get(DOC)).toEqual(remote);
  });
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
    const regenerate = vi.fn(() => ({
      format: "text/html",
      body: "merged live state",
      wordCount: 3,
    }));
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
      s.store.save(
        stored,
        { title: "Mine" },
        { regenerate: () => ({ format: "text/html", body: "live" }), wait: WAIT },
      ),
    ).rejects.toMatchObject({
      name: "TitleConflictError",
      localTitle: "Mine",
      remoteTitle: "Theirs",
    });
    const saved = await s.store.save(
      stored,
      { title: "Theirs" },
      { regenerate: () => ({ format: "text/html", body: "live" }), wait: WAIT },
    );
    expect(saved.data.title).toBe("Theirs");
    const same = await server();
    expect(
      (
        await same.store.save(
          stored,
          { title: "Mine" },
          { regenerate: () => ({ format: "text/html", body: "unused" }) },
        )
      ).data.title,
    ).toBe("Mine");
  });
  it("caps retries at three, backs off exponentially, and propagates terminal failures", async () => {
    const s = await server();
    const stored = await document();
    const f: typeof fetch = async (url, init) =>
      init?.method === "PUT" ? new Response(null, { status: 412 }) : s.fetchImpl(url, init);
    const wait = vi.fn(WAIT);
    const regenerate = vi.fn(() => ({ format: "text/html", body: "live" }));
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
        { regenerate: () => ({ format: "text/html", body: "live" }) },
      );
      const expectation = expect(pending).rejects.toBeInstanceOf(ResourceReadError);
      await vi.runAllTimersAsync();
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
  it("attributes revisions to the editor while retaining the original creator", async () => {
    const s = await server();
    const stored = await document();
    stored.data.creator = "https://bob.example/#me";
    const saved = await s.store.save(
      stored,
      { body: "new", now: new Date(NOW.getTime() + 600_000) },
      { regenerate: () => ({ format: "text/html", body: "unused" }) },
    );
    expect(saved.data.creator).toBe("https://bob.example/#me");
    expect(saved.data.revisions[0]?.attributedTo).toBe(WEBID);
  });
  it("preserves snapshot defaults with a strong ETag", async () => {
    const s = await server();
    const stored = await document();
    const result = await s.store.save(
      stored,
      {},
      { regenerate: () => ({ format: "text/html", body: "unused" }) },
    );
    expect(result.data.body).toBe("old");
    expect(s.calls.find((c) => c.method === "PUT")?.headers["if-match"]).toBe(stored.etag);
  });
});

describe("makeCopy", () => {
  it.each([
    'W/"reservation"',
    null,
  ])("refuses to finalize a copy with an unusable reservation validator (%j)", async (etag) => {
    const s = await server();
    const copyUrl = `${POD}docs/plan-copy.ttl`;
    const fetchImpl: typeof fetch = async (url, init) => {
      const response = await s.fetchImpl(url, init);
      if (String(url) === copyUrl && init?.method === "PUT") {
        if (etag === null) response.headers.delete("etag");
        else response.headers.set("etag", etag);
      }
      return response;
    };
    const remote = {
      body: await serializeTurtle(buildDocument(copyUrl, { title: "Remote copy", body: "Remote" })),
      etag: '"remote"',
      contentType: "text/turtle",
    };
    await expect(
      new DocsStore(POD, WEBID, fetchImpl).makeCopy(await document(), {
        assets: [],
        snapshot: () => ({ format: "text/html", body: "live" }),
        persistFullState: async () => {
          s.resources.set(copyUrl, remote);
        },
      }),
    ).rejects.toBeInstanceOf(ConcurrencyValidatorError);
    expect(s.resources.get(copyUrl)).toEqual(remote);
    const writes = s.calls.filter((call) => call.url === copyUrl && call.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.headers["if-none-match"]).toBe("*");
    expect(writes[0]?.headers["if-match"]).toBeUndefined();
  });

  it.each([
    "text/html",
    "text/markdown",
  ])("preserves %s in copied snapshots and revisions", async (format) => {
    const s = await server();
    const source = await document();
    source.data.format = format;
    const copy = await s.store.makeCopy(source, {
      assets: [],
      snapshot: () => ({ format, body: "# Live snapshot", wordCount: 2 }),
      persistFullState: async () => {},
    });
    expect(copy.data.format).toBe(format);
    expect(copy.data.revisions[0]?.format).toBe(format);
    expect((await s.store.read(copy.url))?.data).toMatchObject({
      body: "# Live snapshot",
      format,
      wordCount: 2,
    });
    const reservation = s.calls.find((call) => call.url === copy.url && call.method === "PUT");
    expect(parseDocument(copy.url, turtleToStore(reservation?.body ?? "", copy.url))?.format).toBe(
      format,
    );
  });
  it("skips an orphaned companion when reserving a copy", async () => {
    const s = await server();
    const oldContainer = `${POD}docs/plan-copy/`;
    const old = { body: "old updates", etag: '"old"', contentType: "text/turtle" };
    s.resources.set(oldContainer, old);
    const persistFullState = vi.fn(async () => {});
    const copy = await s.store.makeCopy(await document(), {
      assets: [],
      snapshot: () => ({ format: "text/html", body: "copied" }),
      persistFullState,
    });
    expect(copy.url).toBe(`${POD}docs/plan-copy-2.ttl`);
    expect(persistFullState).toHaveBeenCalledWith(
      `${POD}docs/plan-copy-2/updates/`,
      expect.any(Function),
      new Map(),
    );
    expect(s.resources.get(oldContainer)).toEqual(old);
    expect(s.resources.has(`${POD}docs/plan-copy.ttl`)).toBe(false);
  });
  it("copies the live body, referenced assets, new full-state log and derivation", async () => {
    const s = await server();
    const source = await document();
    const asset = `${docContainerUrls(DOC).assets}chart.png`;
    s.resources.set(asset, { body: "png bytes", contentType: "image/png", etag: '"a"' });
    const persistFullState = vi.fn(
      async (updates: string, fetchImpl: typeof fetch, mapping: ReadonlyMap<string, string>) => {
        expect(fetchImpl).toEqual(expect.any(Function));
        expect(mapping.get(asset)).toBe(`${POD}docs/plan-copy/assets/chart.png`);
        await fetchImpl(`${updates}state`, {
          method: "PUT",
          body: `current CRDT state ${mapping.get(asset)}`,
          headers: { "if-none-match": "*", "content-type": "application/octet-stream" },
        });
      },
    );
    const copy = await s.store.makeCopy(source, {
      assets: [asset, asset],
      persistFullState,
      snapshot: (mapping) => ({
        format: "text/html",
        body: `<img src="${mapping.get(asset)}">live body`,
        wordCount: 2,
      }),
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
      `current CRDT state ${POD}docs/plan-copy/assets/chart.png`,
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
      return s.fetchImpl(url, init);
    };
    const copy = await new DocsStore(POD, WEBID, f).makeCopy(source, {
      assets: [asset],
      snapshot: () => ({ format: "text/html", body: "" }),
      persistFullState: async () => {},
    });
    expect(copy.url).toBe(`${POD}docs/document-copy.ttl`);
    // Byte responses with no media type use the binary fallback.
    expect(s.resources.get(`${docContainerUrls(copy.url).assets}image`)?.body).toBe("binary");
    expect(s.resources.get(`${docContainerUrls(copy.url).assets}image`)?.contentType).toBe(
      "application/octet-stream",
    );
  });
  it("keeps long renamed documents copyable within the title limit", async () => {
    const s = await server();
    const source = await document("x".repeat(200));
    source.url = `${POD}docs/${"a".repeat(48)}.ttl`;
    delete source.data.assets;
    const copy = await s.store.makeCopy(source, {
      assets: [],
      snapshot: () => ({ format: "text/html", body: "live" }),
      persistFullState: async () => {},
    });
    expect(copy.url).toBe(`${POD}docs/${"a".repeat(48)}-copy.ttl`);
    expect(copy.data.title.length).toBe(200);
    expect(copy.data.title.startsWith("Copy of ")).toBe(true);
  });
  it("rejects foreign asset links before any I/O", async () => {
    const s = await server();
    const source = await document();
    const state = {
      assets: ["https://evil.example/image"],
      snapshot: () => ({ format: "text/html", body: "" }),
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
          snapshot: () => ({ format: "text/html", body: "" }),
          persistFullState: async () => {},
        }),
      ).rejects.toBeInstanceOf(status === 404 ? ResourceReadError : ResourceWriteError);
    }
    const s = await server();
    await expect(
      s.store.makeCopy(await document(), {
        assets: [],
        snapshot: () => ({ format: "text/html", body: "" }),
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
