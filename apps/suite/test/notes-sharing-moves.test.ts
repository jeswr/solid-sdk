// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { assert, expect, it } from "vitest";
import { documentSubject } from "../src/apps/docs/lib/model/document";
import { readRdf, writeRdf } from "../src/apps/docs/lib/model/rdf-io";
import { privateAcl } from "../src/apps/drive/lib/client/access";
import { NoteConflictError } from "../src/apps/notes/lib/model/errors";
import { buildNote } from "../src/apps/notes/lib/model/note";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { copyNoteAccess, readNoteAccess } from "../src/apps/notes/lib/move-access";
import { NoteSharingAdapter } from "../src/apps/notes/lib/sharing";
import { SheetResource } from "../src/apps/sheets/lib/model";
import { harness, POD, WEBID } from "./sheets-workbook-helpers";

const ACL = "http://www.w3.org/ns/auth/acl#";
const BOB = "https://pod.example/bob/#me";
const signal = () => new AbortController().signal;
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

it("preserves sharing through archive, trash, restore and unarchive before removing each source", async () => {
  const f = await fixture();
  let source = f.note;
  for (const action of ["archive", "trash", "restore", "unarchive"] as const) {
    f.calls.length = 0;
    const moved = await f.store[action](source);
    expect(moved.url).not.toBe(source.url);
    expect(f.pod.has(source.url)).toBe(false);
    const policy = await readRdf(`${moved.url}.acl`, f.fetch);
    const reader = new SheetResource(`${f.note.url}.acl#reader`, policy.dataset, DataFactory);
    for (const predicate of ["accessTo", "default", "defaultForNew"]) {
      expect(reader.links(ACL + predicate).has(moved.url)).toBe(true);
      expect(reader.links(ACL + predicate).has(source.url)).toBe(false);
    }
    expect(reader.links(`${ACL}accessTo`).has(`${moved.url}.acl`)).toBe(true);
    const state = await new NoteSharingAdapter(moved, f.session).load(moved.url, signal());
    expect(state.people).toContainEqual({ webId: BOB, role: "viewer" });
    expect(state.general).toEqual({ mode: "link", role: "viewer" });
    expect(moved.labels).toEqual(["Shared label"]);
    expect(
      f.calls.findIndex((call) => call.method === "PUT" && call.url === `${moved.url}.acl`),
    ).toBeLessThan(
      f.calls.findIndex((call) => call.method === "DELETE" && call.url === source.url),
    );
    source = moved;
  }
});

it.each([
  "archive",
  "unarchive",
  "trash",
  "restore",
] as const)("aborts %s when copying access fails and keeps the shared source", async (action) => {
  const f = await fixture();
  const source =
    action === "unarchive"
      ? await f.store.archive(f.note)
      : action === "restore"
        ? await f.store.trash(f.note)
        : f.note;
  f.calls.length = 0;
  f.setHook((call) =>
    call.method === "PUT" && call.url.endsWith(".acl")
      ? new Response(null, { status: 500 })
      : undefined,
  );
  await expect(f.store[action](source)).rejects.toMatchObject({ status: 500 });
  expect(f.pod.has(source.url)).toBe(true);
  expect(
    (await new NoteSharingAdapter(source, f.session).load(source.url, signal())).people,
  ).toContainEqual({ webId: BOB, role: "viewer" });
  expect(f.calls.some((call) => call.method === "DELETE" && call.url === source.url)).toBe(false);
  const destination = f.calls.find(
    (call) => call.method === "PUT" && !call.url.endsWith(".acl"),
  )?.url;
  expect(destination).toBeTruthy();
  expect(f.pod.has(destination as string)).toBe(false);
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
  const f = await fixture();
  const first = await f.store.archive(f.note);
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
])("keeps the source when own access cannot be captured (%s)", async (failure) => {
  const f = await fixture();
  f.calls.length = 0;
  f.setHook((call) => {
    if (call.url === f.note.url && call.method === "HEAD") {
      if (failure === "head-failure") return new Response(null, { status: 503 });
      if (failure === "extended-relation")
        return new Response(null, { headers: { link: `<${f.note.url}.acl>; rel="acl other"` } });
      if (failure === "changed-endpoint")
        return new Response(null, { headers: { link: `<${f.note.url}.other>; rel="acl"` } });
    }
    if (failure === "unreadable-policy" && call.url === `${f.note.url}.acl`)
      return new Response(null, { status: 403 });
  });
  await expect(f.store.archive(f.note)).rejects.toThrow();
  expect(f.pod.has(f.note.url)).toBe(true);
  expect(f.calls.some((call) => call.method === "PUT" || call.method === "DELETE")).toBe(false);
});

it("never overwrites an existing destination ACL", async () => {
  const f = await fixture();
  const destination = `${POD}notes/archive/shared.ttl`;
  await writeRdf(destination, buildNote(destination, { title: "Existing" }), {
    createOnly: true,
    fetchImpl: f.fetch,
  });
  await writeRdf(`${destination}.acl`, privateAcl(destination, BOB), {
    createOnly: true,
    fetchImpl: f.fetch,
  });
  const before = await (await f.pod.fetch(`${destination}.acl`)).text();
  const access = await readNoteAccess(f.note.url, f.fetch);
  assert(access);
  f.calls.length = 0;
  await expect(copyNoteAccess(access, f.note.url, destination, f.fetch)).rejects.toMatchObject({
    code: "conflict",
  });
  expect(f.pod.has(f.note.url)).toBe(true);
  expect(f.pod.has(destination)).toBe(true);
  expect(f.calls.some((call) => call.method === "PUT")).toBe(false);
  expect(await (await f.pod.fetch(`${destination}.acl`)).text()).toBe(before);
});

it("reports cleanup failure after a failed ACL copy while keeping the source", async () => {
  const f = await fixture();
  f.setHook((call) => {
    if ((call.method === "PUT" && call.url.endsWith(".acl")) || call.method === "DELETE")
      return new Response(null, { status: 500 });
  });
  await expect(f.store.archive(f.note)).rejects.toBeInstanceOf(AggregateError);
  expect(f.pod.has(f.note.url)).toBe(true);
  expect(f.pod.has(`${POD}notes/archive/shared.ttl`)).toBe(true);
});
