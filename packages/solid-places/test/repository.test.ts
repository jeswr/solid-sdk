// AUTHORED-BY Codex (GPT-6.1 Sol)
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { entities } from "../src/model.js";
import { createPlacesRepository, importId } from "../src/repository.js";
import { parseGoogleTimeline } from "../src/timeline.js";

const root = "https://pod.example/",
  owner = `${root}profile/card#me`;
const input = parseGoogleTimeline(
  JSON.stringify({
    semanticSegments: [
      {
        startTime: "2026-11-11T09:00:00Z",
        endTime: "2026-11-11T10:00:00Z",
        visit: {
          topCandidate: {
            placeId: "one",
            placeName: "Park",
            placeLocation: { latLng: "50.1,-1.2" },
          },
        },
      },
      {
        startTime: "2026-11-11T10:00:00Z",
        endTime: "2026-11-11T10:20:00Z",
        activity: {
          start: { latLng: "50.1,-1.2" },
          end: { latLng: "50.11,-1.21" },
          topCandidate: { type: "WALKING" },
          distanceMeters: 1200,
        },
      },
    ],
  }),
);
async function fixture() {
  const memory = createMemoryStorage({ root });
  await memory.create(root, await writeWac(ownerPolicy(owner, true), root, `${root}.acl`), {
    name: ".acl",
    contentType: "text/turtle",
  });
  await memory.create(root, null, { name: "profile", kind: "container" });
  await memory.create(
    `${root}profile/`,
    `<${owner}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}settings/privateTypeIndex.ttl>.`,
    { name: "card", contentType: "text/turtle" },
  );
  await memory.create(root, null, { name: "settings", kind: "container" });
  await memory.create(
    `${root}settings/`,
    `<${root}settings/privateTypeIndex.ttl> a <http://www.w3.org/ns/solid/terms#TypeIndex>.`,
    { name: "privateTypeIndex.ttl", contentType: "text/turtle" },
  );
  const storage: StorageClient = {
    ...memory,
    features: {
      ...memory.features,
      accessControl: { state: "available", detail: { model: "wac" }, evidence: "fixture" },
    },
    head: vi.fn(async (...args: Parameters<StorageClient["head"]>) => {
      const info = await memory.head(...args);
      return {
        ...info,
        links: new Map([...info.links, ["acl", [{ target: `${args[0]}.acl`, params: {} }]]]),
      };
    }),
    readRdf: vi.fn(memory.readRdf),
    create: vi.fn(memory.create),
    read: vi.fn(memory.read),
    write: vi.fn(memory.write),
  };
  const transport: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    try {
      if (method === "PUT") {
        const headers = new Headers(init?.headers);
        let current: Awaited<ReturnType<StorageClient["head"]>> | undefined;
        try {
          current = await memory.head(url);
        } catch (error) {
          if (!(error instanceof StorageError && error.code === "not-found")) throw error;
        }
        if (current && headers.get("if-none-match") === "*")
          return new Response(null, { status: 412 });
        const saved = current
          ? await memory.write(url, String(init?.body ?? ""), {
              contentType: "text/turtle",
              ifMatch: current.etag!,
            })
          : await memory.create(new URL(".", url).href, String(init?.body ?? ""), {
              name: new URL(url).pathname.split("/").pop()!,
              contentType: "text/turtle",
            });
        return new Response(null, { status: 201, headers: { etag: saved.etag! } });
      }
      const value = method === "HEAD" ? await storage.head(url) : await storage.read(url);
      return new Response(method === "HEAD" ? null : await value.text(), {
        status: 200,
        headers: {
          "content-type": value.contentType ?? "text/turtle",
          etag: value.etag!,
          link: `<${url}.acl>; rel="acl"`,
          "wac-allow": 'user="read write control",public=""',
        },
      });
    } catch (error) {
      if (error instanceof StorageError && error.status)
        return new Response(null, { status: error.status });
      if (error instanceof StorageError && error.code === "not-found")
        return new Response(null, { status: 404 });
      throw error;
    }
  };
  return { memory, storage, transport, repo: createPlacesRepository(storage, transport, owner) };
}
describe("privacy proofs", () => {
  it("hashes stable keys without disclosing source identifiers", async () => {
    expect(await importId("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    await expect(importId("x".repeat(4097))).rejects.toThrow(RangeError);
  });
});
it("creates private folders and a private Type Index, imports shards, edits, and re-imports without losing edits", async () => {
  const { repo, memory } = await fixture();
  await expect(repo.load()).rejects.toThrow("Open private");
  await repo.initialize();
  const progress: number[] = [];
  await repo.importTimeline(input, (done) => progress.push(done));
  expect(progress).toEqual([0, 1, 2, 3]);
  let snapshot = await repo.load();
  expect(snapshot.places).toHaveLength(1);
  expect(snapshot.visits).toHaveLength(1);
  expect(snapshot.journeys).toHaveLength(1);
  expect(snapshot.visits[0]?.url).toContain("/visits/2026/11/");
  expect(snapshot.visits[0]?.data.place).toBe(entities.Place.subject(snapshot.places[0]!.url));
  const before = snapshot.places[0]!;
  await repo.savePlace(before, {
    name: "My park",
    notes: "Quiet",
    saved: true,
    category: "outdoors",
  });
  await expect(repo.savePlace(before, { name: "Stale" })).rejects.toThrow("changed elsewhere");
  await repo.importTimeline(input);
  snapshot = await repo.load();
  expect(snapshot.places).toHaveLength(1);
  expect(snapshot.visits).toHaveLength(1);
  expect(snapshot.places[0]?.data.name).toBe("My park");
  expect(await (await memory.read(`${root}settings/privateTypeIndex.ttl`)).text()).toContain(
    "https://schema.org/Place",
  );
  await repo.initialize();
});
it("cancel is resumable and missing place references fail clearly", async () => {
  const { repo } = await fixture();
  await repo.initialize();
  const controller = new AbortController();
  controller.abort();
  await expect(repo.importTimeline(input, () => {}, controller.signal)).rejects.toThrow();
  await expect(repo.importTimeline({ ...input, places: [] })).rejects.toThrow("missing place");
  await repo.importTimeline(input);
  expect((await repo.load()).visits).toHaveLength(1);
});
it("refuses shared existing Places storage and leaked descendant ACLs", async () => {
  const { repo, memory, transport } = await fixture();
  await repo.initialize();
  await repo.importTimeline(input);
  const snapshot = await repo.load();
  const policy = ownerPolicy("https://stranger.example/me", true);
  const target = snapshot.places[0]!.url;
  await transport(`${target}.acl`, {
    method: "PUT",
    headers: { "if-none-match": "*" },
    body: await writeWac(policy, target, `${target}.acl`),
  });
  expect(await repo.load()).toMatchObject({ places: [], skipped: 1 });
  const acl = `${root}places/.acl`;
  const version = await memory.head(acl);
  await memory.write(acl, await writeWac(policy, `${root}places/`, acl), {
    contentType: "text/turtle",
    ifMatch: version.etag!,
  });
  await expect(repo.initialize()).rejects.toThrow("owner-only");
});
it("refuses unsupported storage without creating history", async () => {
  const memory = createMemoryStorage({ root, protocol: "lws" });
  const repo = createPlacesRepository(
    memory,
    async () => {
      throw new Error("Must not fetch");
    },
    owner,
  );
  await expect(repo.initialize()).rejects.toThrow("supported owner-only");
});
it("never registers in a shared private Type Index", async () => {
  const { repo, memory, transport } = await fixture();
  const index = `${root}settings/privateTypeIndex.ttl`;
  await transport(`${index}.acl`, {
    method: "PUT",
    body: await writeWac(ownerPolicy("https://stranger.example/me"), index, `${index}.acl`),
  });
  const before = await (await memory.read(index)).text();
  await expect(repo.initialize()).rejects.toThrow();
  expect(await (await memory.read(index)).text()).toBe(before);
});
it("refuses off-collection edits, invalid versions and uninitialised mutations", async () => {
  const { repo } = await fixture();
  await expect(repo.importTimeline(input)).rejects.toThrow("Open private");
  await repo.initialize();
  await repo.importTimeline(input);
  const before = (await repo.load()).places[0]!;
  await expect(
    repo.savePlace({ ...before, url: "https://evil.example/p.ttl" }, {}),
  ).rejects.toThrow("outside");
  // A missing version fails before a conditional write, even if both observations are null.
  await expect(repo.savePlace({ ...before, etag: null }, {})).rejects.toThrow();
});
it("re-checks an existing private index even when registration is already up to date", async () => {
  const { repo, transport } = await fixture();
  await repo.initialize();
  const index = `${root}settings/privateTypeIndex.ttl`;
  await transport(`${index}.acl`, {
    method: "PUT",
    body: await writeWac(ownerPolicy("https://stranger.example/me"), index, `${index}.acl`),
  });
  await expect(repo.initialize()).rejects.toThrow("owner-only");
});
it("rejects parent traversal and query/fragment aliases for place edits", async () => {
  const { repo } = await fixture();
  await repo.initialize();
  await repo.importTimeline(input);
  const before = (await repo.load()).places[0]!;
  for (const url of [
    before.url + "?x",
    before.url + "#it",
    `${root}places/places/../visits/other.ttl`,
  ])
    await expect(repo.savePlace({ ...before, url }, {})).rejects.toThrow("outside");
});
it("requires a single version and re-reads follow-up validators with their matching body", async () => {
  const { storage, transport, repo } = await fixture();
  await repo.initialize();
  await repo.importTimeline(input);
  const before = (await repo.load()).places[0]!;
  const followup = new Proxy(storage, {
    get(target, key) {
      if (key === "write")
        return async (...args: Parameters<StorageClient["write"]>) => ({
          ...(await target.write(...args)),
          etagSource: "follow-up" as const,
        });
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const other = createPlacesRepository(followup, transport, owner);
  await other.initialize();
  expect((await other.savePlace(before, { notes: "Reconciled" })).data.notes).toBe("Reconciled");
  for (const etag of [null, "*", "unquoted", '"a","b"']) {
    const invalid = new Proxy(storage, {
      get(target, key) {
        if (key === "read")
          return async (...args: Parameters<StorageClient["read"]>) => ({
            ...(await target.read(...args)),
            etag,
          });
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const guarded = createPlacesRepository(invalid, transport, owner);
    await guarded.initialize();
    const current = (await guarded.load()).places[0]!;
    await expect(guarded.savePlace(current, { notes: "Must not write" })).rejects.toThrow(
      "version",
    );
  }
});

it.each([
  "acp",
  "unknown",
])("refuses %s feature discovery before creating folders", async (model) => {
  const f = await fixture();
  const storage = {
    ...f.storage,
    features: {
      ...f.storage.features,
      accessControl:
        model === "acp"
          ? { state: "available" as const, detail: { model: "acp" as const }, evidence: "fixture" }
          : { state: "unknown" as const, evidence: "fixture", detail: { model: "none" as const } },
    },
  };
  await expect(createPlacesRepository(storage, f.transport, owner).initialize()).rejects.toThrow(
    "supported owner-only",
  );
  expect(f.storage.create).not.toHaveBeenCalled();
});
it.each([
  "outside",
  "acp-link",
  "missing-links",
  "multiple-links",
  "foreign-acl",
  "acl-head-denied",
  "acl-read-denied",
])("fails closed on %s discovery", async (variant) => {
  const f = await fixture();
  const original = vi.mocked(f.storage.head).getMockImplementation()!;
  vi.mocked(f.storage.head).mockImplementation(async (...args) => {
    if (variant === "acl-head-denied" && args[0].endsWith(".acl"))
      throw new StorageError("forbidden", {
        message: "Denied",
        status: 403,
        url: root,
        method: "HEAD",
      });
    const info = await f.memory.head(...args);
    if (args[0] !== `${root}places/`) return original(...args);
    const acl = { target: `${args[0]}.acl`, params: {} };
    return {
      ...info,
      links: new Map(
        variant === "acp-link"
          ? [["http://www.w3.org/ns/solid/acp#accessControl", [acl]]]
          : variant === "missing-links"
            ? []
            : [
                [
                  "acl",
                  variant === "multiple-links"
                    ? [acl, { ...acl, target: `${root}other.acl` }]
                    : [
                        {
                          ...acl,
                          target:
                            variant === "foreign-acl" ? "https://evil.example/policy" : acl.target,
                        },
                      ],
                ],
              ],
      ),
    };
  });
  if (variant === "outside") f.storage.isWithinStorage = () => false;
  if (variant === "acl-read-denied")
    vi.mocked(f.storage.readRdf).mockRejectedValue(
      new StorageError("forbidden", { message: "Denied", status: 403, url: root, method: "HEAD" }),
    );
  await expect(f.repo.initialize()).rejects.toThrow();
  expect(
    vi.mocked(f.storage.create).mock.calls.every(([, , options]) => options?.kind === "container"),
  ).toBe(true);
  await expect(f.repo.importTimeline(input)).rejects.toThrow("Open private");
});
it("refuses non-empty unsealed folders without changing their ACL", async () => {
  const f = await fixture();
  await f.memory.create(root, null, { name: "places", kind: "container" });
  await f.memory.create(`${root}places/`, "private bytes", {
    name: "existing.txt",
    contentType: "text/plain",
  });
  const fetch = vi.fn(f.transport);
  await expect(createPlacesRepository(f.storage, fetch, owner).initialize()).rejects.toThrow(
    "Make this Places folder private",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("does not ignore ACL PUT failures", async () => {
  const f = await fixture();
  const fetch = vi.fn(async () => new Response("Denied", { status: 403 }));
  await expect(createPlacesRepository(f.storage, fetch, owner).initialize()).rejects.toThrow(
    "Cannot protect",
  );
  expect(fetch).toHaveBeenCalledWith(
    `${root}places/.acl`,
    expect.objectContaining({
      method: "PUT",
      headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
    }),
  );
});
it.each([
  false,
  true,
])("reverifies the winner after an ACL create race (shared=%s)", async (shared) => {
  const f = await fixture();
  let raced = false;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (!raced) {
      raced = true;
      await f.transport(url, {
        ...init,
        body: await writeWac(
          ownerPolicy(shared ? "https://other.example/me" : owner, true),
          `${root}places/`,
          String(url),
        ),
      });
      return new Response(null, { status: 412 });
    }
    return f.transport(url, init);
  };
  const repo = createPlacesRepository(f.storage, fetch, owner);
  if (shared) await expect(repo.initialize()).rejects.toThrow("owner-only");
  else await repo.initialize();
});
it.each([
  "network",
  "conflict",
  "vanished",
])("handles folder create %s without assuming privacy", async (variant) => {
  const f = await fixture();
  vi.mocked(f.storage.create).mockImplementation(async (...args) => {
    if (variant === "network") throw new Error("Offline");
    if (variant === "conflict") {
      await f.memory.create(...args);
      throw new StorageError("conflict", {
        message: "Race",
        url: root,
        method: "PUT",
        status: 409,
      });
    }
    return { url: `${root}places/`, etag: null, etagSource: "response" as const, created: true };
  });
  if (variant === "conflict") await f.repo.initialize();
  else
    await expect(f.repo.initialize()).rejects.toThrow(
      variant === "network" ? "Offline" : "Cannot create",
    );
});
it("propagates non-404 folder HEAD failures", async () => {
  const f = await fixture();
  vi.mocked(f.storage.head).mockRejectedValueOnce(new Error("Offline"));
  await expect(f.repo.initialize()).rejects.toThrow("Offline");
});
it("rejects odd partial and untyped non-owner ACL grants through the shared helper", async () => {
  const f = await fixture();
  await f.repo.initialize();
  await f.repo.importTimeline(input);
  const { url } = (await f.repo.load()).places[0]!;
  await f.transport(`${url}.acl`, {
    method: "PUT",
    body: `@prefix acl: <http://www.w3.org/ns/auth/acl#>. [] a acl:Authorization; acl:accessTo <${url}>; acl:agent <${owner}>; acl:mode acl:Read, acl:Write, acl:Control. [] acl:accessTo <${url}>; acl:agent <https://other.example/me>; acl:mode acl:Append.`,
  });
  expect(await f.repo.load()).toMatchObject({ places: [], skipped: 1 });
});
it("skips and counts malformed, oversized, invalid and non-private files while keeping valid history", async () => {
  const f = await fixture();
  await f.repo.initialize();
  await f.repo.importTimeline(input);
  const collection = `${root}places/places/`;
  for (const [name, body] of [
    ["malformed.ttl", "{"],
    ["oversized.ttl", " ".repeat(128 * 1024 + 1)],
    ["invalid.ttl", "<> a <https://schema.org/Place>."],
    ["other.txt", "ignored"],
  ] as const)
    await f.memory.create(collection, body, { name, contentType: "text/turtle" });
  await f.memory.create(collection, null, { name: "ignored", kind: "container" });
  const shared = await f.memory.create(
    collection,
    await entities.Place.serialize(`${collection}shared.ttl`, input.places[0]!.data),
    { name: "shared.ttl", contentType: "text/turtle" },
  );
  await f.transport(`${shared.url}.acl`, {
    method: "PUT",
    body: await writeWac(ownerPolicy("https://other.example/me"), shared.url, `${shared.url}.acl`),
  });
  expect(await f.repo.load()).toMatchObject({
    places: [expect.anything()],
    visits: [expect.anything()],
    journeys: [expect.anything()],
    skipped: 4,
  });
});
it("verifies containers once per session, reuses sealed month folders and still checks file overrides", async () => {
  const f = await fixture();
  await f.repo.initialize();
  const many = {
    ...input,
    visits: Array.from({ length: 25 }, (_, i) => ({ ...input.visits[0]!, id: `visit-${i}` })),
  };
  await f.repo.importTimeline(many);
  const heads = vi.mocked(f.storage.head);
  const month = `${root}places/visits/2026/11/`;
  // Initial HEAD, post-create HEAD, then the shared proof, independent of record count.
  expect(heads.mock.calls.filter(([url]) => url === month)).toHaveLength(3);
  const requests = heads.mock.calls.length;
  await f.repo.load();
  await f.repo.load();
  expect(
    heads.mock.calls.slice(requests).filter(([url]) => url.endsWith("/") || url === `${month}.acl`),
  ).toHaveLength(0);
  expect(
    vi.mocked(f.storage.readRdf).mock.calls.filter(([url]) => url === `${month}.acl`),
  ).toHaveLength(1);
  expect(heads.mock.calls.slice(requests).filter(([url]) => url.endsWith(".ttl.acl")).length).toBe(
    54,
  );
  await f.repo.initialize();
  expect(
    vi.mocked(f.storage.readRdf).mock.calls.filter(([url]) => url === `${root}places/.acl`),
  ).toHaveLength(2);
});
it("bounds the resource count and unexpected shard depth", async () => {
  const f = await fixture();
  await f.repo.initialize();
  f.storage.listAll = async function* () {
    for (let i = 0; i <= 100_000; i++)
      yield {
        url: `${root}places/places/${i}.txt`,
        kind: "resource",
        contentType: null,
        size: null,
        modified: null,
        etag: null,
        displayName: null,
        types: [],
      };
  };
  await expect(f.repo.load()).rejects.toThrow("too large");
  const g = await fixture();
  await g.repo.initialize();
  await g.memory.create(`${root}places/visits/`, null, { name: "2026", kind: "container" });
  await g.memory.create(`${root}places/visits/2026/`, null, { name: "11", kind: "container" });
  await g.memory.create(`${root}places/visits/2026/11/`, null, { name: "deep", kind: "container" });
  await expect(g.repo.load()).rejects.toThrow("shard depth");
});
it.each(["invalid", "reversed"])("counts %s visits and journeys as skipped", async (variant) => {
  const f = await fixture();
  await f.repo.initialize();
  await f.repo.importTimeline(input);
  const snapshot = await f.repo.load();
  for (const [kind, value] of [
    ["Visit", snapshot.visits[0]!],
    ["Journey", snapshot.journeys[0]!],
  ] as const) {
    const body =
      variant === "invalid"
        ? ""
        : await entities[kind].serialize(value.url, {
            ...value.data,
            endTime: new Date(0),
          } as never);
    await f.memory.write(value.url, body, { ifMatch: value.etag!, contentType: "text/turtle" });
  }
  expect(await f.repo.load()).toMatchObject({ visits: [], journeys: [], skipped: 2 });
});
it("refuses existing wrong-type deterministic import IDs", async () => {
  const f = await fixture();
  await f.repo.initialize();
  await f.memory.create(`${root}places/places/`, "", {
    name: `${await importId(input.places[0]!.id)}.ttl`,
    contentType: "text/turtle",
  });
  await expect(f.repo.importTimeline(input)).rejects.toThrow("identifier conflicts");
});
it.each([
  "valid",
  "invalid",
  "network",
])("handles a %s create-time import conflict", async (variant) => {
  const f = await fixture();
  await f.repo.initialize();
  vi.mocked(f.storage.create).mockImplementationOnce(async (parent, body, options) => {
    if (variant === "network") throw new Error("Offline");
    await f.memory.create(parent, variant === "invalid" ? "" : body, options);
    throw new StorageError("conflict", { message: "Race", url: root, method: "PUT", status: 409 });
  });
  if (variant === "valid") {
    await f.repo.importTimeline(input);
    expect((await f.repo.load()).places).toHaveLength(1);
  } else
    await expect(f.repo.importTimeline(input)).rejects.toThrow(
      variant === "invalid" ? "identifier conflicts" : "Offline",
    );
});
it("preserves other apps' triples and unedited RDF while accepting a weak If-Match", async () => {
  const f = await fixture();
  await f.repo.initialize();
  await f.repo.importTimeline(input);
  const before = (await f.repo.load()).places[0]!;
  await f.memory.write(
    before.url,
    `${await (await f.memory.read(before.url)).text()}\n<${entities.Place.subject(before.url)}> <https://other.example/annotation> "kept". <https://other.example/subject> <https://other.example/p> "also kept".`,
    { ifMatch: before.etag!, contentType: "text/turtle" },
  );
  vi.mocked(f.storage.read).mockImplementation(async (...args) => {
    const value = await f.memory.read(...args);
    return { ...value, etag: `W/${value.etag}` };
  });
  vi.mocked(f.storage.write).mockImplementation(async (url, body, options) =>
    f.memory.write(url, body, { ...options, ifMatch: options.ifMatch.replace(/^W\//, "") }),
  );
  const current = (await f.repo.load()).places[0]!;
  await f.repo.savePlace(current, { name: "My park", saved: true });
  expect(f.storage.write).toHaveBeenCalledWith(
    current.url,
    expect.any(String),
    expect.objectContaining({ ifMatch: current.etag }),
  );
  const rdf = await f.memory.readRdf(current.url);
  expect(
    [...rdf.dataset].filter((quad) => quad.predicate.value.startsWith("https://other.example/")),
  ).toHaveLength(2);
  expect(entities.Place.parse(current.url, rdf.dataset)?.name).toBe("My park");
});
it.each([
  false,
  true,
])("guards Type Index create destinations after a read race (shared=%s)", async (shared) => {
  const f = await fixture();
  const index = `${root}settings/privateTypeIndex.ttl`;
  const originalRead = f.storage.readRdf;
  let raced = false;
  vi.mocked(f.storage.readRdf).mockImplementation(async (...args) => {
    if (args[0] === index && !raced) {
      raced = true;
      if (shared)
        await f.transport(`${root}settings/.acl`, {
          method: "PUT",
          body: await writeWac(
            ownerPolicy("https://other.example/me", true),
            `${root}settings/`,
            `${root}settings/.acl`,
          ),
        });
      throw new StorageError("not-found", { url: index, method: "GET", status: 404 });
    }
    return f.memory.readRdf(...args);
  });
  const originalHead = vi.mocked(f.storage.head).getMockImplementation()!;
  vi.mocked(f.storage.head).mockImplementation(async (...args) => ({
    ...(await originalHead(...args)),
    ...(args[0] === root
      ? { allow: { read: true, write: true, append: true, control: true } }
      : {}),
  }));
  if (shared) {
    await expect(f.repo.initialize()).rejects.toThrow("owner-only");
    expect(
      vi.mocked(f.storage.create).mock.calls.some(([parent]) => parent === `${root}settings/`),
    ).toBe(false);
  } else {
    await f.repo.initialize();
    expect(f.storage.create).toHaveBeenCalledWith(
      `${root}settings/`,
      expect.any(String),
      expect.objectContaining({ name: "privateTypeIndex.ttl" }),
    );
  }
  expect(originalRead).toBeDefined();
});
it("rejects invalid or concurrently malformed edits and unreadable follow-up bodies", async () => {
  const f = await fixture();
  await f.repo.initialize();
  await f.repo.importTimeline(input);
  const before = (await f.repo.load()).places[0]!;
  await expect(f.repo.savePlace(before, { name: "" })).rejects.toThrow("Invalid place");
  vi.mocked(f.storage.read).mockImplementationOnce(async (...args) => ({
    ...(await f.memory.read(...args)),
    body: null,
    contentType: null,
  }));
  await expect(f.repo.savePlace(before, {})).rejects.toThrow("Cannot read the place to edit");
  const actualWrite = f.memory.write;
  vi.mocked(f.storage.write).mockImplementationOnce(async (...args) => {
    const saved = await actualWrite(...args);
    await actualWrite(saved.url, "", { ifMatch: saved.etag!, contentType: "text/turtle" });
    return { ...saved, etagSource: "follow-up" };
  });
  await expect(f.repo.savePlace(before, { name: "Pending" })).rejects.toThrow(
    "Cannot read the saved place",
  );
});
it("accepts an empty newly sealed folder listing containing only its ACL endpoint", async () => {
  const f = await fixture();
  const original = f.storage.listAll;
  f.storage.listAll = (url, opts) =>
    url === `${root}places/`
      ? (async function* () {
          yield {
            url: `${url}.acl`,
            kind: "resource" as const,
            contentType: null,
            size: null,
            modified: null,
            etag: null,
            displayName: null,
            types: [],
          };
        })()
      : original(url, opts);
  await f.repo.initialize();
});
it("stops cancellation between serialisation and the create request", async () => {
  const f = await fixture();
  await f.repo.initialize();
  const active = new AbortController();
  const original = entities.Place.serialize;
  const spy = vi.spyOn(entities.Place, "serialize").mockImplementationOnce(async (...args) => {
    active.abort();
    return original(...args);
  });
  try {
    await expect(f.repo.importTimeline(input, undefined, active.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(
      vi.mocked(f.storage.create).mock.calls.some(([, , options]) => options?.kind !== "container"),
    ).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it("imports with an active cancellation signal", async () => {
  const f = await fixture();
  await f.repo.initialize();
  await f.repo.importTimeline(input, undefined, new AbortController().signal);
  expect((await f.repo.load()).places).toHaveLength(1);
});
