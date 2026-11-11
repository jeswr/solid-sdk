// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type EffectivePolicy, ownerPolicy, writeWac } from "@jeswr/pod-access";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it } from "vitest";
import { entities } from "../src/model.js";
import { assertOwnerOnly, createPlacesRepository, importId } from "../src/repository.js";
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
  const storage = new Proxy(memory, {
    get(target, key) {
      if (key === "head")
        return async (...args: Parameters<StorageClient["head"]>) => {
          const info = await target.head(...args);
          return {
            ...info,
            links: new Map([...info.links, ["acl", [{ target: `${args[0]}.acl`, params: {} }]]]),
          };
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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
  it("requires owner control for resources and descendants", () => {
    expect(() => assertOwnerOnly(ownerPolicy(owner, true), owner)).not.toThrow();
    expect(() => assertOwnerOnly(ownerPolicy(owner, true), owner, true)).not.toThrow();
    expect(() => assertOwnerOnly(ownerPolicy(owner), owner, true)).toThrow();
  });
  it.each([
    "public",
    "authenticated",
    "group",
    "agent",
    "origin",
  ] as const)("refuses a non-owner %s selector", (kind) => {
    const policy = ownerPolicy(owner, true);
    policy.grants[0]!.who = [
      [
        kind === "agent"
          ? { kind, webId: "https://other.example/me" }
          : kind === "group"
            ? { kind, group: "https://other.example/group" }
            : kind === "origin"
              ? { kind, origin: "https://other.example" }
              : { kind },
      ],
    ];
    expect(() => assertOwnerOnly(policy, owner)).toThrow();
  });
  it("refuses empty, conditional, intersecting and denied permissions", () => {
    const base = ownerPolicy(owner, true);
    const grant = base.grants[0]!;
    const variants: EffectivePolicy[] = [
      { grants: [], denials: [] },
      { grants: [{ ...grant, who: [] }], denials: [] },
      { grants: [{ ...grant, who: [[]] }], denials: [] },
      { grants: [{ ...grant, except: [{ kind: "public" }] }], denials: [] },
      { grants: [{ ...grant, modes: new Set(["read"]) }], denials: [] },
      { grants: base.grants, denials: base.grants },
      { grants: [{ ...grant, who: [[...grant.who[0]!, { kind: "public" }]] }], denials: [] },
    ];
    for (const policy of variants) expect(() => assertOwnerOnly(policy, owner)).toThrow();
  });
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
  await expect(repo.load()).rejects.toThrow("owner-only");
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
it("requires a single strong version and re-reads follow-up validators with their matching body", async () => {
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
  for (const etag of [null, "*", 'W/"weak"', "unquoted", '"a","b"']) {
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
