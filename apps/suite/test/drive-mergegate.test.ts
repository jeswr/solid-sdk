// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { AclResource } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessControl } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient, policyArchiveOf } from "../src/apps/drive/lib/client/client";
import { sameGraph } from "../src/apps/drive/lib/client/rdf";
import {
  deleteForever,
  listTrash,
  renameItem,
  restoreItems,
  trashItems,
} from "../src/apps/drive/lib/operations/operations";
import {
  addTrashRecord,
  emptyTrashIndex,
  serializeTrashIndex,
  trashEntries,
  trashIndexFrom,
} from "../src/apps/drive/lib/operations/trash-index";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://mergegate.test/";
const DRIVE = `${ROOT}drive/`;
const FROM = `${DRIVE}source/`;
const TO = `${DRIVE}target/`;
const INDEX = `${DRIVE}.trash/index.ttl`;
const OWNER = `${ROOT}profile#me`;
const ACL = "http://www.w3.org/ns/auth/acl#";
const TITLE = "http://purl.org/dc/terms/title";

class Fields extends TermWrapper {
  set modified(value: Date) {
    RequiredAs.object(this, "http://purl.org/dc/terms/modified", value, LiteralFrom.dateTime);
  }
  set link(value: Term) {
    RequiredAs.object(this, "urn:link", value, TermFrom.itself);
  }
  iris(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
  set title(value: string) {
    RequiredAs.object(this, TITLE, value, LiteralFrom.string);
  }
}
async function turtle(dataset: Store) {
  const writer = new Writer();
  writer.addQuads([...dataset]);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}
async function ownerAcl(resource: string) {
  const dataset = new Store();
  const rule = new Fields(`${resource}#owner`, dataset, DataFactory);
  rule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  rule.iris(`${ACL}accessTo`).add(resource);
  if (resource.endsWith("/")) rule.iris(`${ACL}default`).add(resource);
  rule.iris(`${ACL}agent`).add(OWNER);
  for (const mode of ["Read", "Write", "Control"]) rule.iris(`${ACL}mode`).add(`${ACL}${mode}`);
  return turtle(dataset);
}

/** A pod with public inherited defaults and separately stored own ACLs/container data. */
function fixture() {
  const pod = createDemoPod({
    root: ROOT,
    seed: [
      { path: "drive/source/a", body: "A", contentType: "text/plain" },
      { path: "drive/source/b", body: "B", contentType: "text/plain" },
    ],
  });
  const policies = new Map<string, string>();
  const defaults = new Store();
  const publicRule = new Fields(`${ROOT}#public`, defaults, DataFactory);
  publicRule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  publicRule.iris(`${ACL}accessTo`).add(ROOT);
  publicRule.iris(`${ACL}default`).add(ROOT);
  publicRule.iris(`${ACL}agentClass`).add("http://xmlns.com/foaf/0.1/Agent");
  publicRule.iris(`${ACL}mode`).add(`${ACL}Read`);
  const rootPolicy = turtle(defaults);
  const metadata = new Map<string, string>();
  const calls: { url: string; method: string }[] = [];
  let hook:
    | ((url: string, init: RequestInit | undefined) => Promise<Response | undefined>)
    | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const intercepted = await hook?.(url, init);
    if (intercepted) return intercepted;
    if (url.endsWith(".policy")) {
      const body = policies.get(url) ?? (url === `${ROOT}.policy` ? await rootPolicy : undefined);
      if (method === "PUT") {
        policies.set(url, String(init?.body));
        return new Response(null, { status: 201, headers: { etag: '"policy"' } });
      }
      return new Response(body ?? null, {
        status: body === undefined ? 404 : 200,
        headers: { "content-type": "text/turtle", etag: '"policy"' },
      });
    }
    const response = await pod.fetch(input, init);
    if (response.ok && method === "DELETE") {
      policies.delete(`${url}.policy`);
      metadata.delete(url);
    }
    if (response.ok && method === "PUT" && url.endsWith("/") && init?.body)
      metadata.set(url, String(init.body));
    const headers = new Headers(response.headers);
    if (response.ok && method === "PUT" && url.endsWith("/"))
      headers.set("etag", (await pod.fetch(url, { method: "HEAD" })).headers.get("etag") as string);
    headers.delete("x-solid-demo-access-control");
    headers.set("link", `<${url}.policy>; rel="acl"`);
    if (response.ok && method === "GET" && url.endsWith("/"))
      return new Response(`${await response.text()}\n${metadata.get(url) ?? ""}`, {
        status: 200,
        headers,
      });
    return new Response(response.body, { status: response.status, headers });
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch, webId: OWNER });
  return {
    pod,
    client,
    fetch,
    policies,
    metadata,
    calls,
    intercept(fn: typeof hook) {
      hook = fn;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PR 143 merge-gate regressions", () => {
  it("keeps an active folder transfer pending while source b DELETE is paused", async () => {
    const pod = createDemoPod({
      root: ROOT,
      seed: [
        { path: "drive/source/a", body: "A", contentType: "text/plain" },
        { path: "drive/source/b", body: "B", contentType: "text/plain" },
      ],
    });
    let visible: unknown;
    let restored: Awaited<ReturnType<typeof restoreItems>> | undefined;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === `${FROM}b` && init?.method === "DELETE") {
        const otherTab = createSolidDriveClient({ storageUrl: ROOT, fetch: pod.fetch });
        visible = await listTrash(otherTab, DRIVE);
        const current = await otherTab.readRdf(INDEX);
        if (!current) throw new Error("Missing intent");
        const entries = trashEntries(trashIndexFrom(current.dataset));
        restored = await restoreItems(otherTab, DRIVE, entries);
      }
      return pod.fetch(input, init);
    };
    const client = createSolidDriveClient({ storageUrl: ROOT, fetch });
    const moved = await trashItems(client, DRIVE, [await client.stat(FROM)]);
    expect(visible).toEqual([]);
    expect(restored?.failed[0]?.error).toMatchObject({ kind: "operation-in-progress" });
    expect(moved.failed).toEqual([]);
    expect(await (await client.read(`${moved.done[0]?.url}b`)).text()).toBe("B");
  });

  it("preserves and verifies container application RDF when moving a folder", async () => {
    const f = fixture();
    const data = new Store();
    new Fields(FROM, data, DataFactory).title = "Private research";
    f.metadata.set(FROM, await turtle(data));
    await f.client.move(FROM, TO, { kind: "confirm-move" });
    const moved = await f.client.readRdf(TO);
    expect(
      moved?.dataset
        .getObjects(DataFactory.namedNode(TO), DataFactory.namedNode(TITLE), null)
        .map((t) => t.value),
    ).toEqual(["Private research"]);
    expect(f.pod.has(FROM)).toBe(false);
  });

  it("privatizes Trash before index or recovery writes and preserves own ACLs through restore", async () => {
    const f = fixture();
    f.policies.set(`${FROM}a.policy`, await ownerAcl(`${FROM}a`));
    let privateBeforeFirstWrite = false;
    f.intercept(async (url, init) => {
      if (url === INDEX && init?.method === "PUT")
        privateBeforeFirstWrite = f.policies.has(`${DRIVE}.trash/.policy`);
      return undefined;
    });
    const result = await trashItems(f.client, DRIVE, [await f.client.stat(`${FROM}a`)], {
      webId: OWNER,
    });
    expect(result.failed).toEqual([]);
    expect(privateBeforeFirstWrite).toBe(true);
    const entry = result.done[0];
    if (!entry) throw new Error("Missing trash entry");
    const own = await parseRdf(f.policies.get(`${entry.url}.policy`) ?? "", "text/turtle");
    const rules = [...new AclResource(own, DataFactory).authorizations];
    expect(rules[0]?.accessTo).toBe(entry.url);
    expect([...(rules[0]?.agent ?? [])]).toEqual([OWNER]);
    expect((await restoreItems(f.client, DRIVE, [entry])).failed).toEqual([]);
    expect(f.policies.has(`${FROM}a.policy`)).toBe(true);
  });
});

it.each([
  "refused",
  "discarded",
])("does not delete any source when container application RDF is %s", async (mode) => {
  const f = fixture();
  const data = new Store();
  new Fields(FROM, data, DataFactory).title = "Cannot lose this";
  f.metadata.set(FROM, await turtle(data));
  f.intercept(async (url, init) => {
    if (url === TO && init?.method === "PUT" && init.body) {
      if (mode === "refused") return new Response(null, { status: 403 });
      return f.pod.fetch(url, { method: "HEAD" });
    }
    return undefined;
  });
  await expect(f.client.move(FROM, TO, { kind: "confirm-move" })).rejects.toThrow();
  expect(f.pod.has(`${FROM}a`)).toBe(true);
  expect(f.pod.has(`${FROM}b`)).toBe(true);
  expect(f.calls.filter((c) => c.method === "DELETE" && c.url.startsWith(FROM))).toEqual([]);
});

it.each([
  "copy",
  "move",
  "rename",
  "trash",
])("preserves container data and source own ACLs for %s", async (operation) => {
  const f = fixture();
  f.policies.set(`${FROM}.policy`, await ownerAcl(FROM));
  f.policies.set(`${FROM}a.policy`, await ownerAcl(`${FROM}a`));
  const data = new Store();
  new Fields(FROM, data, DataFactory).title = "Research";
  new Fields(`${FROM}#details`, data, DataFactory).title = "Linked details";
  new Fields(`${FROM}#details`, data, DataFactory).modified = new Date("2026-01-01");
  f.metadata.set(FROM, await turtle(data));
  let target = TO;
  if (operation === "trash") {
    const result = await trashItems(f.client, DRIVE, [await f.client.stat(FROM)], { webId: OWNER });
    expect(result.failed).toEqual([]);
    const entry = result.done[0];
    if (!entry) throw new Error("Missing entry");
    expect((await restoreItems(f.client, DRIVE, [entry])).failed).toEqual([]);
    target = FROM;
  } else if (operation === "rename")
    target = await renameItem(f.client, await f.client.stat(FROM), "target");
  else if (operation === "move") await f.client.move(FROM, TO, { kind: "confirm-move" });
  else await f.client.copy(FROM, TO, { kind: "preserve-source" });
  const current = await f.client.readRdf(target);
  expect(
    current?.dataset
      .getObjects(DataFactory.namedNode(target), DataFactory.namedNode(TITLE), null)
      .map((t) => t.value),
  ).toEqual(["Research"]);
  expect(
    current?.dataset
      .getObjects(
        DataFactory.namedNode(`${target}#details`),
        DataFactory.namedNode("http://purl.org/dc/terms/modified"),
        null,
      )
      .map((t) => t.value),
  ).toEqual(["2026-01-01T00:00:00.000Z"]);
  const acl = await parseRdf(f.policies.get(`${target}.policy`) ?? "", "text/turtle");
  const rule = [...new AclResource(acl, DataFactory).authorizations][0];
  expect(rule?.accessTo).toBe(target);
  expect(rule?.default).toBe(target);
  expect(f.policies.has(`${target}a.policy`)).toBe(true);
});

it("keeps explicitly public source policies inactive in Trash and restores them afterwards", async () => {
  const f = fixture();
  const original = await parseRdf(await ownerAcl(`${FROM}a`), "text/turtle");
  const rule = [...new AclResource(original, DataFactory).authorizations][0];
  if (!rule) throw new Error("Missing authorization");
  rule.agentClass.add("http://xmlns.com/foaf/0.1/Agent");
  f.policies.set(`${FROM}a.policy`, await turtle(original));
  const result = await trashItems(f.client, DRIVE, [await f.client.stat(`${FROM}a`)], {
    webId: OWNER,
  });
  expect(result.failed).toEqual([]);
  const entry = result.done[0];
  if (!entry) throw new Error("Missing entry");
  const privateDoc = await parseRdf(f.policies.get(`${entry.url}.policy`) ?? "", "text/turtle");
  expect(
    [...new AclResource(privateDoc, DataFactory).authorizations].flatMap((r) => [...r.agentClass]),
  ).toEqual([]);
  expect(f.pod.has(policyArchiveOf(entry.url) as string)).toBe(true);
  expect((await restoreItems(f.client, DRIVE, [entry])).failed).toEqual([]);
  const restored = await parseRdf(f.policies.get(`${FROM}a.policy`) ?? "", "text/turtle");
  expect(
    [...new AclResource(restored, DataFactory).authorizations].flatMap((r) => [...r.agentClass]),
  ).toEqual(["http://xmlns.com/foaf/0.1/Agent"]);
  expect(f.pod.has(policyArchiveOf(entry.url) as string)).toBe(false);
});

it.each([
  "no-link",
  "acp",
  "missing-owner",
  "bad-owner",
  "denied",
  "ignored",
  "missing-validator",
  "weak-validator",
  "unreadable",
  "folder-denied",
])("refuses Trash before index or recovery bytes when private ACL setup fails: %s", async (mode) => {
  const f = fixture();
  f.intercept(async (url, init) => {
    if (url === `${DRIVE}.trash/` && init?.method === "PUT" && mode === "folder-denied")
      return new Response(null, { status: 403 });
    if (url === `${DRIVE}.trash/` && init?.method === "HEAD" && ["no-link", "acp"].includes(mode)) {
      return new Response(null, {
        headers: {
          link:
            mode === "acp" ? `<policy>; rel="http://www.w3.org/ns/solid/acp#accessControl"` : "",
        },
      });
    }
    if (url === `${DRIVE}.trash/.policy`) {
      if (init?.method === "PUT" && mode === "denied") return new Response(null, { status: 403 });
      if (init?.method === "PUT" && mode === "ignored") return new Response(null, { status: 201 });
      if (!init?.method && mode === "unreadable") return new Response(null, { status: 403 });
      if (!init?.method && ["missing-validator", "weak-validator"].includes(mode))
        return new Response("", {
          headers: {
            "content-type": "text/turtle",
            ...(mode === "weak-validator" ? { etag: 'W/"p"' } : {}),
          },
        });
    }
    return undefined;
  });
  const result = await trashItems(
    f.client,
    DRIVE,
    [await f.client.stat(`${FROM}a`)],
    mode === "missing-owner" ? {} : { webId: mode === "bad-owner" ? "urn:bad" : OWNER },
  );
  expect(result.failed[0]?.error).toMatchObject({
    kind: "private-access-unavailable",
    message: expect.stringContaining("Delete forever"),
  });
  expect(f.pod.has(`${FROM}a`)).toBe(true);
  expect(f.pod.has(INDEX)).toBe(false);
  expect(f.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/a"))).toEqual([]);
});

it.each([
  "copy",
  "move",
])("establishes a restrictive own ACL before writing destination bytes for %s", async (operation) => {
  const f = fixture();
  f.policies.set(`${FROM}a.policy`, await ownerAcl(`${FROM}a`));
  let privateAtWrite = false;
  f.intercept(async (url, init) => {
    if (url === `${DRIVE}target` && init?.method === "PUT" && init.body instanceof Blob)
      privateAtWrite = f.policies.has(`${DRIVE}target.policy`);
    return undefined;
  });
  await f.client[operation as "copy" | "move"](`${FROM}a`, `${DRIVE}target`, {
    kind: "preserve-source",
  });
  expect(privateAtWrite).toBe(true);
});

it.each([
  "no-destination-link",
  "policy-denied",
  "source-policy-denied",
  "source-policy-changed",
  "destination-policy-changed",
])("retains source bytes when own ACL preservation fails: %s", async (mode) => {
  const f = fixture();
  f.policies.set(`${FROM}a.policy`, await ownerAcl(`${FROM}a`));
  let sourceReads = 0;
  let destReads = 0;
  f.intercept(async (url, init) => {
    if (url === `${FROM}a.policy` && !init?.method && mode === "source-policy-denied")
      return new Response(null, { status: 403 });
    if (
      url === `${FROM}a.policy` &&
      !init?.method &&
      ++sourceReads > 1 &&
      mode === "source-policy-changed"
    )
      return new Response("", { headers: { "content-type": "text/turtle", etag: '"changed"' } });
    if (url === `${DRIVE}target` && init?.method === "HEAD" && mode === "no-destination-link")
      return new Response(null);
    if (url === `${DRIVE}target.policy` && init?.method === "PUT" && mode === "policy-denied")
      return new Response(null, { status: 403 });
    if (
      url === `${DRIVE}target.policy` &&
      !init?.method &&
      ++destReads > 2 &&
      mode === "destination-policy-changed"
    )
      return new Response("", { headers: { "content-type": "text/turtle", etag: '"changed"' } });
    return undefined;
  });
  await expect(
    f.client.move(`${FROM}a`, `${DRIVE}target`, { kind: "confirm-move" }),
  ).rejects.toThrow();
  expect(f.pod.has(`${FROM}a`)).toBe(true);
});

it("keeps a fresh lease from another tab pending and exposes an expired completed transfer as partial", async () => {
  const f = fixture();
  const recovery = `${DRIVE}.trash/12345678-1234-1234-1234-123456789012/source/`;
  await f.client.copy(FROM, recovery, { kind: "preserve-source" });
  await f.client.remove(`${FROM}a`);
  const index = emptyTrashIndex();
  addTrashRecord(index, { url: recovery, original: FROM, trashedAt: new Date(), name: "source" });
  const record = index.record(recovery);
  record.status = "pending";
  record.leaseOwner = "urn:uuid:another-tab";
  record.leaseUntil = new Date(Date.now() + 60_000);
  await f.client.write(
    INDEX,
    await serializeTrashIndex(index),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  expect(await listTrash(f.client, DRIVE)).toEqual([]);
  record.leaseUntil = new Date(0);
  await f.client.write(
    INDEX,
    await serializeTrashIndex(index),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  const entries = await listTrash(f.client, DRIVE);
  expect(entries[0]?.status).toBe("partial");
  expect((await restoreItems(f.client, DRIVE, entries)).failed[0]?.error).toMatchObject({
    kind: "trash-restore-partial",
  });
  expect(await (await f.client.read(`${recovery}b`)).text()).toBe("B");
  expect(await (await f.client.read(`${recovery}a`)).text()).toBe("A");
  expect(await (await f.client.read(`${FROM}a`)).text()).toBe("A");
});

it("deletes a private policy receipt only after confirmed permanent deletion", async () => {
  const f = fixture();
  const result = await trashItems(f.client, DRIVE, [await f.client.stat(FROM)], { webId: OWNER });
  expect(result.failed).toEqual([]);
  const entry = result.done[0];
  if (!entry) throw new Error("Missing entry");
  expect((await deleteForever(f.client, DRIVE, [entry])).failed).toEqual([]);
  expect(f.pod.has(policyArchiveOf(entry.url) as string)).toBe(false);
});

it.each([
  false,
  true,
])("renews a live operation lease while a source DELETE is paused (heartbeat fails: %s)", async (fail) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "drive/a", body: "A", contentType: "text/plain" }],
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  let release: (() => void) | undefined;
  let reached: (() => void) | undefined;
  const paused = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let putCount = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === INDEX && init?.method === "PUT" && ++putCount === 2 && fail)
      return new Response(null, { status: 500 });
    if (String(input) === `${DRIVE}a` && init?.method === "DELETE") {
      reached?.();
      await gate;
    }
    return pod.fetch(input, init);
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch });
  const moving = trashItems(client, DRIVE, [await client.stat(`${DRIVE}a`)]);
  await paused;
  const initial = await client.readRdf(INDEX);
  if (!initial) throw new Error("Missing index");
  const until = trashIndexFrom(initial.dataset).records[0]?.leaseUntil?.getTime();
  const extra = trashIndexFrom(initial.dataset);
  const active = extra.records[0];
  if (!active) throw new Error("Missing active record");
  for (const [name, owner] of [
    ["foreign", "urn:foreign"],
    ["finished", active.leaseOwner],
  ] as const) {
    const url = `${active.value}-${name}`;
    addTrashRecord(extra, { url, original: `${DRIVE}${name}`, name, trashedAt: new Date() });
    extra.record(url).status = "complete";
    extra.record(url).leaseOwner = owner;
  }
  await pod.fetch(INDEX, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serializeTrashIndex(extra),
  });
  await vi.advanceTimersByTimeAsync(15_000);
  const refreshed = await client.readRdf(INDEX);
  if (!refreshed) throw new Error("Missing renewed index");
  expect(trashIndexFrom(refreshed.dataset).records[0]?.leaseUntil?.getTime()).toBe(
    (until as number) + (fail ? 0 : 15_000),
  );
  expect(await listTrash(client, DRIVE)).toEqual([]);
  expect(warn.mock.calls.length > 0).toBe(fail);
  release?.();
  expect((await moving).failed).toEqual([]);
  // Completed records are ignored by the next live owner's heartbeat; old local
  // ownership knowledge expires without keeping timers alive after completion.
  await vi.advanceTimersByTimeAsync(61_000);
  await trashItems(client, DRIVE, []);
});

it.each([
  "missing",
  "unreadable",
  "missing-entry",
  "policy-removed",
])("handles private policy receipt recovery failure %s without deleting the recovery bytes", async (mode) => {
  const f = fixture();
  f.policies.set(`${FROM}a.policy`, await ownerAcl(`${FROM}a`));
  const result = await trashItems(f.client, DRIVE, [await f.client.stat(`${FROM}a`)], {
    webId: OWNER,
  });
  const entry = result.done[0];
  if (!entry) throw new Error("Missing entry");
  const archive = policyArchiveOf(entry.url) as string;
  if (mode === "missing") await f.client.remove(archive);
  if (mode === "policy-removed") f.policies.delete(`${entry.url}.policy`);
  if (mode === "missing-entry")
    await f.client.write(
      archive,
      "{}",
      { contentType: "application/json" },
      { kind: "protect-ancestors" },
    );
  if (mode === "unreadable")
    f.intercept(async (url) => (url === archive ? new Response(null, { status: 403 }) : undefined));
  const restored = await restoreItems(f.client, DRIVE, [entry]);
  if (mode === "missing-entry" || mode === "unreadable") {
    expect(restored.failed).toHaveLength(1);
    expect(f.pod.has(entry.url)).toBe(true);
  } else expect(restored.failed).toEqual([]);
});

it("restores folder RDF and ACLs when partial recovery must recreate a missing container", async () => {
  const f = fixture();
  f.policies.set(`${FROM}.policy`, await ownerAcl(FROM));
  const data = new Store();
  new Fields(FROM, data, DataFactory).title = "Folder metadata";
  f.metadata.set(FROM, await turtle(data));
  const result = await trashItems(f.client, DRIVE, [await f.client.stat(FROM)], { webId: OWNER });
  const entry = result.done[0];
  if (!entry) throw new Error("Missing entry");
  const current = await f.client.readRdf(INDEX);
  if (!current) throw new Error("Missing index");
  const index = trashIndexFrom(current.dataset);
  index.record(entry.url).status = "partial";
  await f.client.write(
    INDEX,
    await serializeTrashIndex(index),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  expect((await restoreItems(f.client, DRIVE, [entry])).failed).toEqual([]);
  expect(f.policies.has(`${FROM}.policy`)).toBe(true);
  expect(
    (await f.client.readRdf(FROM))?.dataset
      .getObjects(DataFactory.namedNode(FROM), DataFactory.namedNode(TITLE), null)
      .map((t) => t.value),
  ).toEqual(["Folder metadata"]);
});

it("verifies RDF modulo blank labels without conflating two nodes or losing links", async () => {
  const a = DataFactory.blankNode("a"),
    b = DataFactory.blankNode("b");
  const graph = new Store();
  new Fields(a, graph, DataFactory).title = "A";
  new Fields(a, graph, DataFactory).link = b;
  new Fields(b, graph, DataFactory).title = "B";
  expect(sameGraph(graph, await parseRdf(await turtle(graph), "text/turtle"))).toBe(true);
  const collapsed = new Store();
  new Fields(a, collapsed, DataFactory).title = "A";
  new Fields(a, collapsed, DataFactory).link = a;
  new Fields(a, collapsed, DataFactory).iris(TITLE).add("urn:other");
  expect(sameGraph(graph, collapsed)).toBe(false);
  const named = new Store();
  new Fields("urn:a", named, DataFactory).title = "A";
  new Fields("urn:a", named, DataFactory).link = b;
  new Fields(b, named, DataFactory).title = "B";
  expect(sameGraph(graph, named)).toBe(false);
  const two = new Store();
  new Fields(a, two, DataFactory).title = "A";
  new Fields(b, two, DataFactory).title = "B";
  const one = new Store();
  const c = new Fields(a, one, DataFactory);
  c.title = "A";
  RequiredAs.object(c, "urn:other", "B", LiteralFrom.string);
  expect(sameGraph(two, one)).toBe(false);
});

it("discovers only applicable WAC links and refuses unsafe or unsupported policy targets", async () => {
  const http = vi.fn<typeof globalThis.fetch>();
  const access = accessControl(http, ROOT);
  expect(
    access.discover(
      FROM,
      new Headers({ link: '<bad>; rel="acl"; anchor="other", <other>, <policy>; rel=acl' }),
    ),
  ).toBe(`${FROM}policy`);
  expect(access.discover(FROM, new Headers())).toBeUndefined();
  expect(() =>
    access.discover(FROM, new Headers({ link: "<https://foreign.test/policy>; rel=acl" })),
  ).toThrow();
  http.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(access.privateFolder(FROM, OWNER)).rejects.toThrow();
  http.mockResolvedValueOnce(
    new Response(null, { headers: { "x-solid-demo-access-control": "none" } }),
  );
  await expect(access.privateFolder(FROM)).resolves.toBeUndefined();
});

it("rejects a server that stores a different ACL and conditionally replaces an existing own policy", async () => {
  const f = fixture();
  const acl = `${FROM}a.policy`;
  f.policies.set(acl, await ownerAcl(`${FROM}a`));
  const access = accessControl(f.fetch, ROOT);
  const data = await parseRdf(await ownerAcl(`${FROM}a`), "text/turtle");
  await expect(access.store(acl, data)).resolves.toMatchObject({ url: acl });
  f.intercept(async (url, init) => {
    if (url === acl && init?.method === "PUT") {
      f.policies.set(acl, "");
      return new Response(null, { status: 205 });
    }
    return undefined;
  });
  await expect(access.store(acl, data)).rejects.toThrow();
});

it("refuses to promote an expired transfer renewed by another tab during reconciliation", async () => {
  const f = fixture();
  const recovery = `${DRIVE}.trash/12345678-1234-1234-1234-123456789012/source/`;
  await f.client.copy(FROM, recovery, { kind: "preserve-source" });
  await f.client.remove(`${FROM}a`);
  const index = emptyTrashIndex();
  addTrashRecord(index, { url: recovery, original: FROM, name: "source", trashedAt: new Date() });
  index.record(recovery).status = "pending";
  index.record(recovery).leaseOwner = "urn:uuid:renewed-owner";
  index.record(recovery).leaseUntil = new Date(0);
  await f.client.write(
    INDEX,
    await serializeTrashIndex(index),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  const read = f.client.readRdf.bind(f.client);
  let reads = 0;
  vi.spyOn(f.client, "readRdf").mockImplementation(async (url) => {
    if (url === INDEX && ++reads === 2) {
      index.record(recovery).leaseUntil = new Date(Date.now() + 60_000);
      await f.client.write(
        INDEX,
        await serializeTrashIndex(index),
        { contentType: "text/turtle" },
        { kind: "protect-ancestors" },
      );
    }
    return read(url);
  });
  expect(await listTrash(f.client, DRIVE)).toEqual([]);
  index.record(recovery).status = "partial";
  await f.client.write(
    INDEX,
    await serializeTrashIndex(index),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  expect((await restoreItems(f.client, DRIVE, trashEntries(index))).failed[0]?.error).toMatchObject(
    { kind: "trash-moving" },
  );
});

it("rechecks an existing Trash ACL before every batch", async () => {
  const f = fixture();
  expect(
    (await trashItems(f.client, DRIVE, [await f.client.stat(`${FROM}a`)], { webId: OWNER })).failed,
  ).toEqual([]);
  f.policies.set(`${DRIVE}.trash/.policy`, "");
  expect(
    (await trashItems(f.client, DRIVE, [await f.client.stat(`${FROM}b`)], { webId: OWNER })).failed,
  ).toEqual([]);
  const acl = await parseRdf(f.policies.get(`${DRIVE}.trash/.policy`) ?? "", "text/turtle");
  expect(
    [...new AclResource(acl, DataFactory).authorizations].flatMap((rule) => [...rule.agent]),
  ).toEqual([OWNER]);
});

it("keeps a recovery container if its application RDF cannot be verified after merging", async () => {
  const f = fixture();
  const data = new Store();
  new Fields(FROM, data, DataFactory).title = "Only recovery metadata";
  f.metadata.set(FROM, await turtle(data));
  await f.client.createFolder(TO, { kind: "inherit-verified" });
  f.intercept(async (url, init) =>
    url === TO && init?.method === "PUT" && init.body
      ? f.pod.fetch(url, { method: "HEAD" })
      : undefined,
  );
  await expect(
    f.client.mergeContainer(FROM, TO, { kind: "preserve-source" }),
  ).rejects.toMatchObject({
    kind: "conflict",
  });
  expect(f.pod.has(FROM)).toBe(true);
});

it("retains an empty folder recovery graph when an expired owner's DELETE may still arrive", async () => {
  const f = fixture();
  const recovery = `${DRIVE}.trash/12345678-1234-1234-1234-123456789012/empty/`;
  await f.client.createFolder(recovery, { kind: "inherit-verified" });
  const data = new Store();
  new Fields(recovery, data, DataFactory).title = "Irreplaceable metadata";
  f.metadata.set(recovery, await turtle(data));
  const index = emptyTrashIndex();
  addTrashRecord(index, {
    url: recovery,
    original: `${DRIVE}empty/`,
    name: "empty",
    trashedAt: new Date(),
  });
  index.record(recovery).status = "partial";
  index.record(recovery).leaseOwner = "urn:uuid:expired";
  index.record(recovery).leaseUntil = new Date(0);
  await f.client.write(
    INDEX,
    await serializeTrashIndex(index),
    { contentType: "text/turtle" },
    { kind: "protect-ancestors" },
  );
  expect((await restoreItems(f.client, DRIVE, trashEntries(index))).failed).toHaveLength(1);
  expect(f.pod.has(recovery)).toBe(true);
  expect(f.pod.has(`${DRIVE}empty/`)).toBe(true);
});

it.each([
  "type",
  "accessControl",
  "memberAccessControl",
])("refuses ACP RDF advertised through legacy rel=acl (%s)", async (kind) => {
  const f = fixture();
  const dataset = new Store();
  const resource = new Fields(`${DRIVE}.trash/.policy`, dataset, DataFactory);
  const acp = "http://www.w3.org/ns/solid/acp#";
  resource
    .iris(kind === "type" ? "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" : acp + kind)
    .add(acp + (kind === "type" ? "AccessControlResource" : "policy"));
  f.policies.set(`${DRIVE}.trash/.policy`, await turtle(dataset));
  const result = await trashItems(f.client, DRIVE, [await f.client.stat(`${FROM}a`)], {
    webId: OWNER,
  });
  expect(result.failed[0]?.error).toMatchObject({ kind: "private-access-unavailable" });
  expect(f.pod.has(INDEX)).toBe(false);
  expect(f.pod.has(`${FROM}a`)).toBe(true);
  expect(f.policies.get(`${DRIVE}.trash/.policy`)).toBe(await turtle(dataset));
});

it.each([
  false,
  true,
])("failed metadata merge cleans up only its newly provisioned folder (cleanup fails: %s)", async (cleanupFails) => {
  const f = fixture();
  const data = new Store();
  new Fields(FROM, data, DataFactory).title = "Retain recovery metadata";
  f.metadata.set(FROM, await turtle(data));
  f.intercept(async (url, init) =>
    url === TO &&
    ((init?.method === "PUT" && !!init.body) || (cleanupFails && init?.method === "DELETE"))
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(
    f.client.mergeContainer(FROM, TO, { kind: "preserve-source" }),
  ).rejects.toMatchObject(
    cleanupFails ? { kind: "delete-pending", cause: { status: 503 } } : { status: 503 },
  );
  expect(f.pod.has(TO)).toBe(cleanupFails);
  expect(f.pod.has(FROM)).toBe(true);
  expect(f.metadata.get(FROM)).toBe(await turtle(data));
});
