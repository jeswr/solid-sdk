// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import { serializeTurtle } from "../src/apps/docs/lib/model/rdf-io";
import { privateAcl } from "../src/apps/drive/lib/client/access";
import { parseNote } from "../src/apps/notes/lib/model/note";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { preferencesUrl, privateNotePreferences } from "../src/apps/notes/lib/private-preferences";
import { SheetResource } from "../src/apps/sheets/lib/model";
import { harness, POD, WEBID } from "./sheets-workbook-helpers";

it("moves labels and reminders into verified private storage before sharing and keeps them private on save", async () => {
  const fixture = await harness();
  const store = createNotesStore({ ...fixture.options, mode: "demo" });
  const note = await store.create({
    labels: ["Personal"],
    reminder: "2027-01-01T10:00:00Z",
    body: "<p>Shared</p>",
  });
  const prepared = await store.prepareSharing(note);
  expect(prepared.labels).toEqual(["Personal"]);
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const document = await parseRdf(await (await fixture.pod.fetch(note.url)).text(), "text/turtle");
  expect(parseNote(note.url, document, "active")).toMatchObject({
    labels: [],
    reminder: undefined,
    reminderId: undefined,
  });
  expect((await store.read(note.url))?.labels).toEqual(["Personal"]);
  expect(await store.prepareSharing(prepared)).toBe(prepared);
  const changed = await store.save(
    prepared,
    { body: "New", labels: ["Later"], reminder: null },
    prepared.etag,
  );
  expect(changed.labels).toEqual(["Later"]);
  const reopened = await store.read(note.url);
  expect(reopened?.labels).toEqual(["Later"]);
  expect(reopened?.reminder).toBeUndefined();
  expect(await (await fixture.pod.fetch(note.url)).text()).not.toContain('"Later"');
  const moved = await store.archive(changed);
  expect((await store.read(moved.url))?.labels).toEqual(["Later"]);
  const trashed = await store.trash(moved);
  expect((await store.read(trashed.url))?.reminder).toBeUndefined();
  await expect(
    store.save(
      { ...changed, privatePreferences: "https://foreign.example/preferences" },
      {},
      changed.etag,
    ),
  ).rejects.toThrow();
  await expect(store.read(note.url)).rejects.toMatchObject({ status: 404 });
});

it("requires verified inherited owner-only policies and refuses public or mixed-policy preferences", async () => {
  const fixture = await harness();
  const session = { ...fixture.options, storageUrl: POD, mode: "solid" };
  const preferences = privateNotePreferences(session);
  const note = `${POD}notes/a.ttl`;
  expect(preferences.urlFor(note)).toBe(preferencesUrl(note, POD));
  expect(await preferences.read(note)).toBeUndefined();
  await expect(preferences.write(note, { labels: [] })).rejects.toThrow();
  await fixture.pod.fetch(`${POD}.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serializeTurtle(privateAcl(POD, WEBID)),
  });
  await preferences.write(note, { labels: [], reminder: undefined });
  expect((await preferences.read(note))?.fields).toEqual({
    labels: [],
    reminder: undefined,
    reminderId: undefined,
  });
  const policy = privateAcl(POD, WEBID);
  const publicRule = new SheetResource(`${POD}.acl#public`, policy, DataFactory);
  const Acl = "http://www.w3.org/ns/auth/acl#";
  publicRule.types.add(`${Acl}Authorization`);
  publicRule.links(`${Acl}agentClass`).add("http://xmlns.com/foaf/0.1/Agent");
  publicRule.links(`${Acl}default`).add(POD);
  publicRule.links(`${Acl}mode`).add(`${Acl}Read`);
  await fixture.pod.fetch(`${POD}.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serializeTurtle(policy),
  });
  const calls = fixture.calls.length;
  await expect(preferences.write(note, { labels: ["Secret"] })).rejects.toThrow();
  expect(fixture.calls.slice(calls).some((call) => call.method === "PUT")).toBe(false);
  fixture.setHook((call) =>
    call.method === "GET" && call.url === preferences.urlFor(note)
      ? new Response(null, { status: 500 })
      : undefined,
  );
  await expect(preferences.read(note)).rejects.toMatchObject({ status: 500 });
});

it("gives reminders added after sharing a durable identity", async () => {
  const fixture = await harness();
  const store = createNotesStore({ ...fixture.options, mode: "demo" });
  const prepared = await store.prepareSharing(await store.create());
  const saved = await store.save(prepared, { reminder: "2027-01-01T10:00:00Z" }, prepared.etag);
  expect(saved.reminderId).toBeTruthy();
  expect((await store.read(saved.url))?.reminderId).toBe(saved.reminderId);
});

it.each([
  401, 403,
])("keeps the note readable without exposing inaccessible owner preferences (%s)", async (status) => {
  const fixture = await harness();
  const store = createNotesStore({ ...fixture.options, mode: "demo" });
  const prepared = await store.prepareSharing(
    await store.create({ title: "Readable", labels: ["Owner only"] }),
  );
  fixture.setHook((call) =>
    call.method === "GET" && call.url === prepared.privatePreferences
      ? new Response(null, { status })
      : undefined,
  );
  expect(await store.read(prepared.url)).toMatchObject({
    title: "Readable",
    labels: [],
    readOnly: true,
  });
});

it("refuses foreign preference pointers and propagates private metadata storage failures", async () => {
  const fixture = await harness();
  const store = createNotesStore({ ...fixture.options, mode: "demo" });
  const prepared = await store.prepareSharing(await store.create({ title: "Readable" }));
  const { buildNote } = await import("../src/apps/notes/lib/model/note");
  fixture.setHook(async (call) =>
    call.method === "GET" && call.url === prepared.url
      ? new Response(
          await serializeTurtle(
            buildNote(prepared.url, {
              title: "Readable",
              privatePreferences: "https://foreign.example/private",
            }),
          ),
          { headers: { "content-type": "text/turtle" } },
        )
      : undefined,
  );
  await expect(store.read(prepared.url)).rejects.toThrow();
  expect(fixture.calls.some((call) => call.url === "https://foreign.example/private")).toBe(false);
  fixture.setHook((call) =>
    call.method === "GET" && call.url === prepared.privatePreferences
      ? new Response(null, { status: 500 })
      : undefined,
  );
  await expect(store.read(prepared.url)).rejects.toMatchObject({ status: 500 });
  fixture.setHook((call) =>
    call.method === "GET" && call.url === prepared.privatePreferences
      ? new Response(null, { status: 404 })
      : undefined,
  );
  expect(await store.read(prepared.url)).toMatchObject({ title: "Readable", labels: [] });
});
