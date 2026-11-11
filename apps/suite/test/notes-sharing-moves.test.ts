// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { assert, expect, it } from "vitest";
import { documentSubject } from "../src/apps/docs/lib/model/document";
import { writeRdf } from "../src/apps/docs/lib/model/rdf-io";
import { privateAcl } from "../src/apps/drive/lib/client/access";
import { NoteConflictError, NoteMoveBlockedError } from "../src/apps/notes/lib/model/errors";
import { buildNote } from "../src/apps/notes/lib/model/note";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { NoteSharingAdapter } from "../src/apps/notes/lib/sharing";
import { SheetResource } from "../src/apps/sheets/lib/model";
import { harness, POD, WEBID } from "./sheets-workbook-helpers";

const ACL = "http://www.w3.org/ns/auth/acl#";
const BOB = "https://pod.example/bob/#me";
const signal = () => new AbortController().signal;
async function privateFixture() {
  const f = await harness();
  const store = createNotesStore(f.options);
  const note = await store.create({ title: "Private" });
  await writeRdf(`${POD}.acl`, privateAcl(POD, WEBID), {
    createOnly: true,
    fetchImpl: f.fetch,
  });
  const adapter = new NoteSharingAdapter(note, { ...f.options, storageUrl: POD, mode: "solid" });
  await adapter.load(note.url, signal());
  return { ...f, store, note, adapter };
}

it("archives after revoking Bob and public access, conditionally removing the own ACL", async () => {
  const f = await privateFixture();
  await f.adapter.setPerson(f.note.url, BOB, "editor");
  await f.adapter.setGeneral(f.note.url, { mode: "link", role: "viewer" });
  f.calls.length = 0;
  await expect(f.store.archive(f.note)).rejects.toBeInstanceOf(NoteMoveBlockedError);
  expect(f.calls.some((call) => call.method === "PUT" || call.method === "DELETE")).toBe(false);
  await f.adapter.setPerson(f.note.url, BOB, null);
  await f.adapter.setGeneral(f.note.url, { mode: "restricted" });
  const etag = (await f.pod.fetch(`${f.note.url}.acl`)).headers.get("etag");
  f.calls.length = 0;
  const moved = await f.store.archive(f.note);
  expect(moved.location).toBe("archived");
  expect(f.pod.has(`${f.note.url}.acl`)).toBe(false);
  expect(f.pod.has(`${moved.url}.acl`)).toBe(false);
  const deletion = f.calls.find((call) => call.method === "DELETE");
  expect(deletion?.url).toBe(`${f.note.url}.acl`);
  expect(deletion?.headers.get("if-match")).toBe(etag);
});

it("trashes after opening Share and cancelling, and can permanently delete after reopening Share", async () => {
  const f = await privateFixture();
  expect(f.pod.has(`${f.note.url}.acl`)).toBe(true);
  const trashed = await f.store.trash(f.note);
  expect(trashed.location).toBe("trashed");
  expect(f.pod.has(`${f.note.url}.acl`)).toBe(false);
  await new NoteSharingAdapter(trashed, { ...f.options, storageUrl: POD, mode: "solid" }).load(
    trashed.url,
    signal(),
  );
  await f.store.deleteForever(trashed.url, trashed.etag);
  expect(f.pod.has(trashed.url)).toBe(false);
  expect(f.pod.has(`${trashed.url}.acl`)).toBe(false);
});

it.each([
  "default",
  "defaultForNew",
  "unknown",
])("keeps an owner-only own ACL when inheritance is broad or unknown (%s)", async (predicate) => {
  const f = await privateFixture();
  // Access to the container itself remains private; its child defaults differ.
  const container = f.store.containers.active;
  const policy = privateAcl(container, WEBID);
  const reader = new SheetResource(`${container}.acl#reader`, policy, DataFactory);
  reader.types.add(`${ACL}Authorization`);
  reader.links(ACL + predicate).add(container);
  reader.links(`${ACL}agent`).add(BOB);
  reader.links(`${ACL}mode`).add(`${ACL}Read`);
  if (predicate === "unknown") {
    f.setHook((call) =>
      call.url === `${container}.acl` ? new Response(null, { status: 403 }) : undefined,
    );
  } else {
    await writeRdf(`${container}.acl`, policy, { createOnly: true, fetchImpl: f.fetch });
  }
  f.calls.length = 0;
  await expect(f.store.archive(f.note)).rejects.toBeInstanceOf(NoteMoveBlockedError);
  expect(f.pod.has(f.note.url)).toBe(true);
  expect(f.pod.has(`${f.note.url}.acl`)).toBe(true);
  expect(f.calls.some((call) => call.method === "PUT" || call.method === "DELETE")).toBe(false);
});

it.each([
  412,
  500,
  "network",
] as const)("refuses a failed own ACL deletion (%s)", async (failure) => {
  const f = await privateFixture();
  const etag = (await f.pod.fetch(`${f.note.url}.acl`)).headers.get("etag");
  f.setHook((call) => {
    if (call.url === `${f.note.url}.acl` && call.method === "DELETE") {
      expect(call.headers.get("if-match")).toBe(etag);
      if (failure === "network") throw new TypeError("Offline");
      return new Response(null, { status: failure });
    }
  });
  f.calls.length = 0;
  await expect(f.store.archive(f.note)).rejects.toBeInstanceOf(NoteMoveBlockedError);
  expect(f.pod.has(f.note.url)).toBe(true);
  expect(f.pod.has(`${f.note.url}.acl`)).toBe(true);
  expect(
    f.calls.some(
      (call) => call.method === "PUT" || (call.url === f.note.url && call.method === "DELETE"),
    ),
  ).toBe(false);
});

it.each([
  ["agent", BOB],
  ["agentClass", "http://xmlns.com/foaf/0.1/Agent"],
  ["agentClass", `${ACL}AuthenticatedAgent`],
  ["agentClass", "https://pod.example/unknown-class"],
  ["agentGroup", "https://pod.example/group#members"],
  ["origin", "https://app.example/"],
])("refuses every non-owner selector, including unrelated authorizations (%s %s)", async (predicate, value) => {
  const f = await privateFixture();
  const policy = privateAcl(f.note.url, WEBID);
  const other = new SheetResource(`${f.note.url}.acl#other`, policy, DataFactory);
  other.types.add(`${ACL}Authorization`);
  other.links(`${ACL}accessTo`).add(`${POD}unrelated.ttl`);
  other.links(`${ACL}${predicate}`).add(value);
  other.links(`${ACL}mode`).add(`${ACL}Read`);
  const current = await f.pod.fetch(`${f.note.url}.acl`);
  await writeRdf(`${f.note.url}.acl`, policy, {
    etag: current.headers.get("etag"),
    fetchImpl: f.fetch,
  });
  f.calls.length = 0;
  await expect(f.store.archive(f.note)).rejects.toBeInstanceOf(NoteMoveBlockedError);
  expect(f.pod.has(`${f.note.url}.acl`)).toBe(true);
  expect(f.calls.some((call) => call.method === "PUT" || call.method === "DELETE")).toBe(false);
});

it.each([
  "empty",
  "unknown-mode",
  "malformed-agent",
])("refuses unknown own policy RDF (%s)", async (failure) => {
  const f = await privateFixture();
  const policy = failure === "empty" ? new Store() : privateAcl(f.note.url, WEBID);
  if (failure !== "empty") {
    const other = new SheetResource(`${f.note.url}.acl#other`, policy, DataFactory);
    other.types.add(`${ACL}Authorization`);
    other.links(`${ACL}accessTo`).add(f.note.url);
    other.links(`${ACL}agent`).add(WEBID);
    if (failure === "unknown-mode") other.links(`${ACL}mode`).add(`${ACL}Unknown`);
    else other.setText(`${ACL}agent`, "Not an IRI");
  }
  const current = await f.pod.fetch(`${f.note.url}.acl`);
  await writeRdf(`${f.note.url}.acl`, policy, {
    etag: current.headers.get("etag"),
    fetchImpl: f.fetch,
  });
  f.calls.length = 0;
  await expect(f.store.archive(f.note)).rejects.toBeInstanceOf(NoteMoveBlockedError);
  expect(f.calls.some((call) => call.method === "PUT" || call.method === "DELETE")).toBe(false);
});

it.each([
  null,
  'W/"weak"',
  "invalid",
])("refuses an own ACL without a strong ETag (%s)", async (etag) => {
  const f = await privateFixture();
  f.setHook(async (call) => {
    if (call.url !== `${f.note.url}.acl` || call.method !== "GET") return;
    const response = await f.pod.fetch(call.url);
    const headers = new Headers(response.headers);
    if (etag === null) headers.delete("etag");
    else headers.set("etag", etag);
    return new Response(await response.text(), { headers });
  });
  f.calls.length = 0;
  await expect(f.store.archive(f.note)).rejects.toBeInstanceOf(NoteMoveBlockedError);
  expect(f.calls.some((call) => call.method === "PUT" || call.method === "DELETE")).toBe(false);
});

async function fixture() {
  const f = await harness();
  const store = createNotesStore(f.options);
  const note = await store.create({
    title: "Shared",
    labels: ["Shared label"],
    reminder: "2027-01-01T10:00:00Z",
  });
  const policy = privateAcl(note.url, WEBID);
  const reader = new SheetResource(`${note.url}.acl#reader`, policy, DataFactory);
  reader.types.add(`${ACL}Authorization`);
  for (const predicate of ["accessTo", "default", "defaultForNew"])
    reader.links(ACL + predicate).add(note.url);
  reader.links(`${ACL}accessTo`).add(`${note.url}.acl`);
  reader.links(`${ACL}agent`).add(BOB);
  reader.links(`${ACL}mode`).add(`${ACL}Read`);
  const general = new SheetResource(`${note.url}.acl#public`, policy, DataFactory);
  general.types.add(`${ACL}Authorization`);
  general.links(`${ACL}accessTo`).add(note.url);
  general.links(`${ACL}agentClass`).add("http://xmlns.com/foaf/0.1/Agent");
  general.links(`${ACL}mode`).add(`${ACL}Read`);
  await writeRdf(`${note.url}.acl`, policy, { createOnly: true, fetchImpl: f.fetch });
  const session = { ...f.options, storageUrl: POD, mode: "demo" };
  return { ...f, store, note, session };
}

it.each([
  "archive",
  "unarchive",
  "trash",
  "restore",
  "deleteForever",
] as const)("refuses %s for an own ACL before any write or deletion", async (action) => {
  const f = await harness();
  const store = createNotesStore(f.options);
  let note = await store.create({ title: "Shared", body: "Private body" });
  if (action === "unarchive") note = await store.archive(note);
  if (action === "restore" || action === "deleteForever") note = await store.trash(note);
  const policy = privateAcl(note.url, WEBID);
  const reader = new SheetResource(`${note.url}.acl#reader`, policy, DataFactory);
  reader.types.add(`${ACL}Authorization`);
  reader.links(`${ACL}agent`).add(BOB);
  reader.links(`${ACL}accessTo`).add(note.url);
  reader.links(`${ACL}mode`).add(`${ACL}Read`);
  await writeRdf(`${note.url}.acl`, policy, {
    createOnly: true,
    fetchImpl: f.fetch,
  });
  const before = await (await f.pod.fetch(note.url)).text();
  f.calls.length = 0;
  const operation =
    action === "deleteForever" ? store.deleteForever(note.url, note.etag) : store[action](note);
  await expect(operation).rejects.toMatchObject({
    name: "NoteMoveBlockedError",
    url: note.url,
    message: "Stop sharing this note before archiving or deleting it.",
  });
  expect(f.calls.some((call) => call.method === "PUT" || call.method === "DELETE")).toBe(false);
  expect(await (await f.pod.fetch(note.url)).text()).toBe(before);
  expect(f.pod.has(`${note.url}.acl`)).toBe(true);
});

it("moves an unshared note through every location without writing any ACL", async () => {
  const f = await harness();
  const store = createNotesStore(f.options);
  let note = await store.create({ title: "Unshared", body: "Body", labels: ["Work"] });
  for (const action of ["archive", "trash", "restore", "unarchive"] as const) {
    f.calls.length = 0;
    const source = note;
    note = await store[action](note);
    expect(note.url).not.toBe(source.url);
    expect(note).toMatchObject({ body: source.body, labels: source.labels });
    expect(f.pod.has(source.url)).toBe(false);
    expect(f.calls.filter((call) => call.url.endsWith(".acl")).map((call) => call.method)).toEqual([
      "GET",
    ]);
    expect(f.calls.find((call) => call.method === "DELETE")?.headers.get("if-match")).toBe(
      source.etag,
    );
  }
});

it("keeps shared labels and reminders in one conditional note write under concurrent saves", async () => {
  const f = await fixture();
  const stale = await f.store.read(f.note.url);
  assert(stale);
  const newer = await f.store.save(
    f.note,
    { labels: ["New"], reminder: "2027-02-01T10:00:00Z" },
    f.note.etag,
  );
  f.calls.length = 0;
  await expect(
    f.store.save(
      stale,
      { body: "Stale body", labels: ["Old"], reminder: "2027-03-01T10:00:00Z" },
      stale.etag,
    ),
  ).rejects.toBeInstanceOf(NoteConflictError);
  expect(f.calls.map(({ url, method }) => ({ url, method }))).toEqual([
    { url: f.note.url, method: "PUT" },
  ]);
  expect(await f.store.read(f.note.url)).toMatchObject({
    labels: newer.labels,
    reminder: newer.reminder,
    body: newer.body,
  });
  const saved = await f.store.save(
    newer,
    { labels: ["Collaborator label"], reminder: "2027-04-01T10:00:00Z" },
    newer.etag,
  );
  const wire = await f.pod.fetch(saved.url);
  const body = await wire.text();
  expect(body).toContain("Collaborator label");
  expect(body).toContain("2027-04-01");
  expect(body).not.toContain("seeAlso");
  expect(f.calls.some((call) => call.url.includes("settings/notes/"))).toBe(false);
});

it("a failed note PUT leaves body, labels and reminders together at their previous values", async () => {
  const f = await fixture();
  f.setHook((call) =>
    call.method === "PUT" && call.url === f.note.url
      ? new Response(null, { status: 500 })
      : undefined,
  );
  await expect(
    f.store.save(f.note, { body: "Unwritten", labels: ["Unwritten"], reminder: null }, f.note.etag),
  ).rejects.toMatchObject({ status: 500 });
  expect(await f.store.read(f.note.url)).toMatchObject({
    body: f.note.body,
    labels: f.note.labels,
    reminder: f.note.reminder,
  });
});

it("allocates a unique archive destination without overwriting another note's labels or reminder", async () => {
  const base = await harness();
  const f = { ...base, store: createNotesStore(base.options) };
  const first = await f.store.archive(await f.store.create({ title: "Shared" }));
  const second = await f.store.create({
    title: "Shared",
    labels: ["Second"],
    reminder: "2027-02-01T10:00:00Z",
  });
  const moved = await f.store.archive(second);
  expect(moved.url).toBe(`${POD}notes/archive/shared-2.ttl`);
  expect(await f.store.read(first.url)).toMatchObject({
    labels: first.labels,
    reminder: first.reminder,
  });
  expect(await f.store.read(moved.url)).toMatchObject({
    labels: second.labels,
    reminder: second.reminder,
  });
});

it("reads shared fields independently of collaborator-edited seeAlso links", async () => {
  const f = await fixture();
  for (const link of [undefined, "https://foreign.example/preferences.ttl"]) {
    const dataset = buildNote(f.note.url, { ...f.note, priorRevisions: f.note.revisions });
    const subject = new SheetResource(documentSubject(f.note.url), dataset, DataFactory);
    if (link) subject.links("http://www.w3.org/2000/01/rdf-schema#seeAlso").add(link);
    const current = await f.store.read(f.note.url);
    assert(current);
    await writeRdf(f.note.url, dataset, { etag: current.etag, fetchImpl: f.fetch });
    f.calls.length = 0;
    expect(await f.store.read(f.note.url)).toMatchObject({
      labels: f.note.labels,
      reminder: f.note.reminder,
    });
    expect(f.calls.map((call) => call.url)).toEqual([f.note.url]);
    expect((await f.store.list("active")).map((note) => note.url)).toContain(f.note.url);
  }
});

it.each([
  "head-failure",
  "extended-relation",
  "changed-endpoint",
  "unreadable-policy",
  "missing-link",
  "duplicate-link",
  "acp",
  "network",
  "malformed-policy",
  "policy-error",
])("refuses an unknown ACL state (%s) without any writes", async (failure) => {
  const f = await fixture();
  f.calls.length = 0;
  f.setHook((call) => {
    if (call.url === f.note.url && call.method === "HEAD") {
      if (failure === "network") throw new Error("Offline");
      if (failure === "head-failure") return new Response(null, { status: 503 });
      if (failure === "missing-link") return new Response(null);
      if (failure === "extended-relation")
        return new Response(null, { headers: { link: `<${f.note.url}.acl>; rel="acl other"` } });
      if (failure === "changed-endpoint")
        return new Response(null, { headers: { link: `<${f.note.url}.other>; rel="acl"` } });
      if (failure === "duplicate-link")
        return new Response(null, {
          headers: { link: `<${f.note.url}.acl>; rel="acl", <${f.note.url}.other>; rel="acl"` },
        });
      if (failure === "acp")
        return new Response(null, {
          headers: {
            link: `<${f.note.url}.acl>; rel="acl", <${f.note.url}.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"`,
          },
        });
    }
    if (call.url === `${f.note.url}.acl`) {
      if (failure === "unreadable-policy") return new Response(null, { status: 403 });
      if (failure === "policy-error") return new Response(null, { status: 500 });
      if (failure === "malformed-policy")
        return new Response("malformed {{{", { headers: { "content-type": "text/turtle" } });
    }
  });
  await expect(f.store.archive(f.note)).rejects.toBeInstanceOf(NoteMoveBlockedError);
  expect(f.pod.has(f.note.url)).toBe(true);
  expect(f.calls.some((call) => call.method === "PUT" || call.method === "DELETE")).toBe(false);
});

it("reports refused expired notes and still deletes unshared expired notes", async () => {
  const f = await harness();
  const store = createNotesStore(f.options);
  const shared = await store.trash(await store.create({ title: "Shared" }));
  const unknown = await store.trash(await store.create({ title: "Unknown" }));
  const unshared = await store.trash(await store.create({ title: "Unshared" }));
  await writeRdf(`${shared.url}.acl`, privateAcl(shared.url, WEBID), {
    createOnly: true,
    fetchImpl: f.fetch,
  });
  f.setDate(new Date("2027-01-01T00:00:00Z"));
  f.setHook((call) =>
    call.url === `${unknown.url}.acl` ? new Response(null, { status: 403 }) : undefined,
  );
  f.calls.length = 0;
  const result = await store.purgeTrash();
  expect(result.deleted).toEqual([unshared.url]);
  expect(result.failed).toEqual([
    { url: shared.url, error: expect.any(NoteMoveBlockedError) },
    { url: unknown.url, error: expect.any(NoteMoveBlockedError) },
  ]);
  expect(f.pod.has(shared.url)).toBe(true);
  expect(f.pod.has(unknown.url)).toBe(true);
  expect(f.calls.filter((call) => call.method === "DELETE").map((call) => call.url)).toEqual([
    unshared.url,
  ]);
});
