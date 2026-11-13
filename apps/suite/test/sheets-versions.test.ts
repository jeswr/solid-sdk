// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { assert, describe, expect, it, vi } from "vitest";
import { WorkbookConflictError } from "../src/apps/sheets/lib/contract";
import { createVersionHistory } from "../src/apps/sheets/lib/versions";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { harness, listing, NOW, snapshot } from "./sheets-workbook-helpers";

function required<T>(value: T | undefined): T {
  assert(value !== undefined);
  return value;
}

async function fixture() {
  const h = await harness();
  const book = await h.service.create({ title: "History", snapshot: snapshot() });
  const history = createVersionHistory({
    ...h.options,
    container: book.container,
    author: h.options.webId,
  });
  return { ...h, book, history, root: `${book.container}versions/` };
}

describe("JSON spreadsheet versions", () => {
  it("captures exact JSON, lists newest first with names/authors, reads and conditionally names", async () => {
    const h = await fixture();
    expect(await h.history.list()).toEqual([]);
    await h.history.capture("First");
    h.setDate(new Date(NOW.getTime() + 1000));
    const ack = await h.history.beforeSave(h.book.version.snapshotEtag);
    ack();
    const versions = await h.history.list();
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      created: new Date(NOW.getTime() + 1000).toISOString(),
      author: h.options.webId,
    });
    const first = required(versions[1]);
    expect(first.name).toBe("First");
    expect(await h.history.load(first.url)).toEqual(h.book.snapshot);
    await h.history.name(first, "  Protected  ");
    expect((await h.history.list())[1]?.name).toBe("Protected");
    await expect(h.history.name(first, "Stale")).rejects.toThrow("changed");
    const writes = h.calls.filter((call) => call.method === "PUT" && call.url.startsWith(h.root));
    expect(writes.slice(0, 4).every((call) => call.headers.get("if-none-match") === "*")).toBe(
      true,
    );
    expect(writes.at(-1)?.headers.get("if-match")).toBe(first.etag);
    expect(
      h.calls
        .filter((call) => call.url.startsWith(h.root))
        .every((call) => call.init.redirect === "manual"),
    ).toBe(true);
    expect(h.calls.some((call) => call.url.endsWith(".acl"))).toBe(false);
  });

  it("throttles accepted saves, reuses failed-save captures, and always snapshots before restore", async () => {
    const h = await fixture();
    const first = await h.history.beforeSave(h.book.version.snapshotEtag);
    await h.history.beforeSave(h.book.version.snapshotEtag);
    expect(await h.history.list()).toHaveLength(1);
    expect(first()).toBe(true);
    expect(first()).toBe(false);
    expect((await h.history.beforeSave(h.book.version.snapshotEtag))()).toBe(false);
    expect(await h.history.list()).toHaveLength(1);
    h.setDate(new Date(NOW.getTime() + 30 * 60 * 1000 - 1));
    expect((await h.history.beforeSave(h.book.version.snapshotEtag))()).toBe(false);
    expect(await h.history.list()).toHaveLength(1);
    h.setDate(new Date(NOW.getTime() + 30 * 60 * 1000));
    expect((await h.history.beforeSave(h.book.version.snapshotEtag))()).toBe(true);
    expect(await h.history.list()).toHaveLength(2);
    (await h.history.beforeSave(h.book.version.snapshotEtag, true))();
    expect(await h.history.list()).toHaveLength(3);
  });

  it("bounds listing membership and isolates broken metadata", async () => {
    const h = await fixture();
    await h.history.capture("Valid");
    const [valid] = await h.history.list();
    h.setHook((call) => {
      if (call.url === h.root)
        return listing(h.root, [
          { url: required(valid).url, container: false },
          { url: `${h.root}bad.meta.json`, container: false },
          { url: `${h.root}missing.meta.json`, container: false },
          { url: `${h.root}nested/child.meta.json`, container: false },
          { url: `${h.root}sub/`, container: true },
          { url: `${h.book.container}outside.meta.json`, container: false },
          { url: "https://evil.example/foreign.meta.json", container: false },
          { url: `${h.root}alias.meta.json?x`, container: false },
          { url: `${h.root}alias.meta.json#x`, container: false },
        ]);
      if (call.url.endsWith("bad.meta.json")) return new Response('{"created":"bad"}');
    });
    h.calls.length = 0;
    expect(await h.history.list()).toEqual([valid]);
    expect(h.calls.map((call) => call.url)).toEqual([
      h.root,
      required(valid).url,
      `${h.root}bad.meta.json`,
      `${h.root}missing.meta.json`,
    ]);
    for (const url of [
      "https://evil.example/a.meta.json",
      `${h.root}../x.meta.json`,
      `${h.root}x.meta.json?x`,
      `${h.root}x/y.meta.json`,
    ]) {
      await expect(h.history.load(url)).rejects.toThrow("Invalid");
      await expect(h.history.name({ ...required(valid), url }, "Bad")).rejects.toThrow("Invalid");
    }
    expect(() =>
      createVersionHistory({ fetch: h.fetch, container: `${h.book.container}workbook.json` }),
    ).toThrow("container");
  });

  it("refuses redirects for listings, reads and writes", async () => {
    const h = await fixture();
    await h.history.capture("Version");
    const [version] = await h.history.list();
    h.setHook(
      () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    await expect(h.history.list()).rejects.toThrow();
    await expect(h.history.load(required(version).url)).rejects.toThrow();
    await expect(h.history.capture("Redirect")).rejects.toThrow();
    expect(h.calls.some((call) => call.url.startsWith("https://evil.example"))).toBe(false);
  });

  it("rejects stale baselines, invalid snapshots/names, and missing or weak sidecar validators", async () => {
    const h = await fixture();
    await expect(h.history.beforeSave('"stale"')).rejects.toBeInstanceOf(WorkbookConflictError);
    await expect(h.history.capture(" ")).rejects.toThrow();
    await h.history.capture("Good");
    const [version] = await h.history.list();
    await expect(h.history.name(required(version), " ")).rejects.toThrow();
    for (const etag of [null, 'W/"weak"']) {
      h.setHook(async (call) => {
        if (call.url !== required(version).url || call.method !== "GET") return;
        const response = await h.pod.fetch(call.url, call.init);
        const headers = new Headers(response.headers);
        if (etag === null) headers.delete("etag");
        else headers.set("etag", etag);
        return new Response(response.body, { headers });
      });
      await expect(h.history.name({ ...required(version), etag }, "Valid")).rejects.toThrow(
        "strong ETag",
      );
    }
    for (const body of ["[]", "null", "1"]) {
      h.setHook((call) => (call.url.endsWith("workbook.json") ? new Response(body) : undefined));
      await expect(h.history.capture("Invalid")).rejects.toThrow("JSON object");
    }
    h.setHook((call) =>
      call.url.endsWith(".json") && !call.url.endsWith(".meta.json")
        ? new Response("null")
        : undefined,
    );
    await expect(h.history.load(required(version).url)).rejects.toThrow("JSON object");
  });

  it("preserves raw legacy snapshots and sanitizes optional comment/chart metadata for preview", async () => {
    const h = await fixture();
    const legacy = {
      ...h.book.snapshot,
      commentAnchors: { version: 2, anchors: {} },
      charts: { version: 1, entries: [] },
    };
    await h.fetch(`${h.book.container}workbook.json`, {
      method: "PUT",
      body: JSON.stringify(legacy),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await h.history.capture("Legacy");
      const version = required((await h.history.list())[0]);
      const raw = await h.fetch(version.url.replace(".meta.json", ".json"));
      expect(await raw.json()).toEqual(legacy);
      expect(await h.history.load(version.url)).toEqual({
        ...h.book.snapshot,
        charts: legacy.charts,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps 50 automatic versions, retains all named versions, and guards both deletes", async () => {
    const h = await fixture();
    await h.history.capture("Never prune");
    for (let i = 0; i < 52; i++) {
      h.setDate(new Date(NOW.getTime() + i * 1000));
      (await h.history.beforeSave(h.book.version.snapshotEtag, true))();
    }
    await h.history.prune();
    const versions = await h.history.list();
    expect(versions).toHaveLength(51);
    expect(versions.filter((v) => v.name)).toHaveLength(1);
    expect(versions.filter((v) => !v.name).at(-1)?.created).toBe(
      new Date(NOW.getTime() + 2000).toISOString(),
    );
    const deletes = h.calls.filter((c) => c.method === "DELETE");
    expect(deletes).toHaveLength(4);
    expect(deletes.every((c) => c.headers.has("if-match"))).toBe(true);
    expect(deletes[0]?.url).toContain(".meta.json");
  });

  it("pruning tolerates absent validators, races with naming, and snapshot delete failures", async () => {
    const h = await fixture();
    for (let i = 0; i < 53; i++) {
      h.setDate(new Date(NOW.getTime() + i * 1000));
      (await h.history.beforeSave(h.book.version.snapshotEtag, true))();
    }
    const old = (await h.history.list()).slice(50);
    await h.history.name(required(old[1]), "Raced name");
    h.setHook((call) => {
      if (
        call.method === "HEAD" &&
        call.url === required(old[0]).url.replace(".meta.json", ".json")
      )
        return new Response(null);
      if (
        call.method === "DELETE" &&
        call.url.endsWith(".json") &&
        !call.url.endsWith(".meta.json")
      )
        return new Response(null, { status: 503 });
    });
    await h.history.prune();
    expect((await h.history.list()).some((v) => v.name === "Raced name")).toBe(true);
    expect(h.pod.has(required(old[2]).url.replace(".meta.json", ".json"))).toBe(true);
    // Concurrent naming after listing causes If-Match failure; the snapshot survives.
    h.setHook(async (call) => {
      if (call.method === "DELETE" && call.url === required(old[0]).url) {
        const current = required((await h.history.list()).find((v) => v.url === call.url));
        await h.history.name(current, "Named during cleanup");
      }
    });
    // Add another version to make the oldest eligible again.
    (await h.history.beforeSave(h.book.version.snapshotEtag, true))();
    await h.history.prune();
    expect((await h.history.list()).some((v) => v.name === "Named during cleanup")).toBe(true);
  });

  it("supports anonymous authors and a default clock, sorts equal times deterministically, and blocks view-only writes", async () => {
    const h = await fixture();
    const plain = createVersionHistory({ fetch: h.fetch, container: h.book.container });
    await plain.capture("Default clock");
    expect((await plain.list())[0]?.author).toBeUndefined();
    await h.history.capture("Same time one");
    await h.history.capture("Same time two");
    const all = await h.history.list();
    const same = all.filter((v) => v.created === NOW.toISOString());
    expect(same.map((v) => v.url)).toEqual(
      same
        .map((v) => v.url)
        .sort()
        .reverse(),
    );
    const viewer = createVersionHistory({
      fetch: h.fetch,
      container: h.book.container,
      readOnly: true,
    });
    expect(await viewer.load(required(all[0]).url)).toEqual(h.book.snapshot);
    await expect(viewer.capture("No")).rejects.toThrow("View-only");
    await expect(viewer.name(required(all[0]), "No")).rejects.toThrow("View-only");
  });
});

describe("workbook save hooks", () => {
  it("prunes only after acknowledging a capture, including one retained from a failed save", async () => {
    const h = await fixture();
    h.calls.length = 0;
    h.setHook((c) =>
      c.method === "PUT" && c.url.endsWith("workbook.json")
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await expect(
      h.service.save(h.book.container, snapshot("Failed"), h.book.version),
    ).rejects.toMatchObject({ status: 503 });
    expect(h.calls.filter((c) => c.method === "PUT" && c.url.startsWith(h.root))).toHaveLength(2);
    expect(h.calls.some((c) => c.url === h.root)).toBe(false);

    h.calls.length = 0;
    h.setHook(() => undefined);
    const first = await h.service.save(h.book.container, snapshot("Retry"), h.book.version);
    expect(h.calls.some((c) => c.method === "PUT" && c.url.startsWith(h.root))).toBe(false);
    expect(h.calls.filter((c) => c.method === "GET" && c.url === h.root)).toHaveLength(1);

    h.calls.length = 0;
    const second = await h.service.save(h.book.container, snapshot("Throttled"), first.version);
    expect(h.calls.some((c) => c.url.startsWith(h.root))).toBe(false);

    h.calls.length = 0;
    h.setDate(new Date(NOW.getTime() + 30 * 60 * 1000));
    await h.service.save(h.book.container, snapshot("Next capture"), second.version);
    expect(h.calls.filter((c) => c.method === "PUT" && c.url.startsWith(h.root))).toHaveLength(2);
    expect(h.calls.filter((c) => c.method === "GET" && c.url === h.root)).toHaveLength(1);
  });

  it("preserves the session baseline and throttles, restarts sessions, and captures restore's current state", async () => {
    const h = await fixture();
    const first = await h.service.save(h.book.container, snapshot("Second"), h.book.version);
    const history = required(h.service.versions?.(h.book.container));
    const [baseline] = await history.list();
    expect(await history.load(required(baseline).url)).toEqual(h.book.snapshot);
    const next = await h.service.save(h.book.container, snapshot("Third"), first.version);
    expect(await history.list()).toHaveLength(1);
    const restored = await h.service.save(h.book.container, h.book.snapshot, next.version, {
      snapshotCurrent: true,
    });
    expect(restored.version.snapshotEtag).not.toBe(next.version.snapshotEtag);
    const versions = await history.list();
    expect(versions).toHaveLength(2);
    expect(await Promise.all(versions.map((v) => history.load(v.url)))).toContainEqual(
      snapshot("Third"),
    );
    const opened = await h.service.open(h.book.container);
    await h.service.save(h.book.container, snapshot("New session"), opened.version);
    expect(await history.list()).toHaveLength(3);
  });

  it.each([
    "network",
    "forbidden",
    "sidecar",
    "malformed",
  ])("saves despite an automatic %s capture failure and retries capture on the next save", async (failure) => {
    const h = await fixture();
    const current = snapshot("Saved without history");
    h.calls.length = 0;
    h.setHook(async (c) => {
      if (c.method === "GET" && c.url.endsWith("workbook.json") && failure === "malformed") {
        const response = await h.pod.fetch(c.url, c.init);
        return new Response("null", { headers: response.headers });
      }
      if (c.method !== "PUT" || !c.url.startsWith(h.root)) return;
      if (failure === "network") throw new TypeError("Network unavailable");
      if (failure === "forbidden") return new Response(null, { status: 403 });
      if (c.url.endsWith(".meta.json")) return new Response(null, { status: 503 });
    });
    const saved = await h.service.save(h.book.container, current, h.book.version);
    h.setHook(() => undefined);
    expect((await h.storage.loadSnapshot(h.book.container)).value).toEqual(current);
    expect(h.calls.some((c) => c.url === h.root)).toBe(false);

    h.calls.length = 0;
    const history = required(h.service.versions?.(h.book.container));
    await h.service.save(h.book.container, snapshot("Next edit"), saved.version);
    expect(h.calls.filter((c) => c.method === "PUT" && c.url.startsWith(h.root))).toHaveLength(2);
    expect(h.calls.filter((c) => c.method === "GET" && c.url === h.root)).toHaveLength(1);
    const versions = await history.list();
    expect(versions).toHaveLength(1);
    expect(await history.load(required(versions[0]).url)).toEqual(current);
  });

  it("keeps automatic capture conflicts on the conflict path without writing or pruning", async () => {
    const h = await fixture();
    h.calls.length = 0;
    h.setHook((c) =>
      c.method === "GET" && c.url.endsWith("workbook.json")
        ? new Response(JSON.stringify(h.book.snapshot), { headers: { etag: '"changed"' } })
        : undefined,
    );
    await expect(
      h.service.save(h.book.container, snapshot("New"), h.book.version),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
    expect(h.calls.some((c) => c.method === "PUT" || c.url === h.root)).toBe(false);
  });

  it("aborts restore when safety capture fails and ignores pruning failures after publication", async () => {
    const h = await fixture();
    h.setHook((c) =>
      c.method === "PUT" && c.url.startsWith(h.root)
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await expect(
      h.service.save(h.book.container, snapshot("New"), h.book.version, { snapshotCurrent: true }),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      h.calls.filter((c) => c.method === "PUT" && c.url.endsWith("workbook.json")),
    ).toHaveLength(1);
    h.setHook((c) => (c.url === h.root ? new Response(null, { status: 503 }) : undefined));
    await expect(
      h.service.save(h.book.container, snapshot("New"), h.book.version),
    ).resolves.toBeDefined();
  });

  it("uses credential-free history reads for public shared workbooks and forbids mutations", async () => {
    const h = await fixture();
    await h.history.capture("Shared");
    const publicFetch = vi.fn(h.fetch);
    const recipient = createWorkbookService({
      ...h.options,
      podRoot: "https://pod.example/bob/",
      publicFetch,
    });
    const history = required(recipient.versions?.(h.book.container));
    const [version] = await history.list();
    expect(await history.load(required(version).url)).toEqual(h.book.snapshot);
    expect(
      publicFetch.mock.calls.every(
        ([, init]) => init?.credentials === "omit" && init.redirect === "manual",
      ),
    ).toBe(true);
    await expect(history.name(required(version), "No")).rejects.toThrow("View-only");
    expect(() => recipient.versions?.("https://foreign.example/book/")).toThrow();
  });
});
