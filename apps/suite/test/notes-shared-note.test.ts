// AUTHORED-BY Codex GPT-6.1-Sol
import { Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { serializeTurtle } from "../src/apps/docs/lib/model/rdf-io";
import { buildNote } from "../src/apps/notes/lib/model/note";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { noteHref, noteLink, readSharedNote } from "../src/apps/notes/lib/shared-note";
import { encodeRef } from "../src/lib/refs";
import { harness, POD } from "./sheets-workbook-helpers";

const URL = "https://pod.example/bob/notes/test.ttl";
const REF = encodeRef(URL);
afterEach(() => vi.restoreAllMocks());
it("parses owner, archive, trash and foreign note links", () => {
  expect(noteHref(URL)).toBe(`/notes/n/${REF}`);
  expect(noteLink(REF, POD)).toEqual({
    url: URL,
    ownerRoot: "https://pod.example/bob/",
    foreign: true,
  });
  for (const part of ["", "archive/", ".trash/"])
    expect(noteLink(encodeRef(`${POD}notes/${part}note.ttl`), POD).foreign).toBe(false);
});
it.each([
  "not-a-valid-ref!",
  encodeRef("https://pod.example/bob//notes/note.ttl"),
  encodeRef("https://elsewhere.example/notes/a.ttl"),
  encodeRef("https://alice:secret@pod.example/bob/notes/a.ttl"),
  encodeRef(`${URL}?query=1`),
  encodeRef(`${URL}#it`),
  encodeRef("https://pod.example/bob/notes/a%2Fprivate.ttl"),
  encodeRef("https://pod.example/bob/notes/a%252Fprivate.ttl"),
  encodeRef("https://pod.example/bob/notes/a%20b.ttl"),
  encodeRef("https://pod.example/bob/docs/a.ttl"),
  encodeRef("https://pod.example/bob/notes/extensionless"),
  encodeRef("https://pod.example/bob/notes/a.acl.ttl"),
  encodeRef("https://pod.example/bob/notes/media/image.png"),
  encodeRef("https://pod.example/bob/notes/a/b.ttl"),
])("refuses ambiguous, foreign-origin or auxiliary link %s before fetching", async (reference) => {
  const fetch = vi.fn();
  await expect(readSharedNote(reference, POD, fetch)).rejects.toThrow(
    "This note link isn't supported",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("reads public notes anonymously as view only with their shared labels and reminders", async () => {
  const dataset = buildNote(URL, {
    title: "Public",
    body: "<p>Text</p>",
    labels: ["Shared"],
    reminder: "2027-01-01T10:00:00Z",
  });
  const fetch = vi.fn(
    async () =>
      new Response(await serializeTurtle(dataset), {
        headers: { "content-type": "text/turtle", etag: '"public"' },
      }),
  );
  const { note, ownerRoot } = await readSharedNote(REF, POD, fetch);
  expect(note).toMatchObject({
    title: "Public",
    body: "<p>Text</p>",
    labels: ["Shared"],
    reminder: "2027-01-01T10:00:00.000Z",
    reminderId: expect.any(String),
    readOnly: true,
    etag: '"public"',
  });
  expect(ownerRoot).toBe("https://pod.example/bob/");
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    URL,
    expect.objectContaining({ credentials: "omit", redirect: "manual" }),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
  expect((await readSharedNote(REF, POD)).note.readOnly).toBe(true);
});
it.each([
  401, 403,
])("explains private foreign notes on %s, anonymously or with the account", async (status) => {
  const denied = vi.fn(async () => new Response(null, { status }));
  await expect(readSharedNote(REF, POD, denied)).rejects.toMatchObject({
    reason: "private",
    message: "This note is private. You need access from its owner's pod to open it.",
  });
  await expect(readSharedNote(REF, POD, vi.fn(), denied)).rejects.toMatchObject({
    reason: "denied",
    message: "Your account doesn't have access to this note. Ask its owner to share it with you.",
  });
});
it("reads a granted note through the account, still view only and without redirects", async () => {
  const body = await serializeTurtle(buildNote(URL, { title: "Private", body: "<p>Hi</p>" }));
  const anonymous = vi.fn();
  const account = vi.fn(
    async () => new Response(body, { headers: { "content-type": "text/turtle" } }),
  );
  const { note } = await readSharedNote(REF, POD, anonymous, account);
  expect(note).toMatchObject({ title: "Private", readOnly: true });
  expect(anonymous).not.toHaveBeenCalled();
  expect(account).toHaveBeenCalledExactlyOnceWith(
    URL,
    expect.objectContaining({ credentials: "omit", redirect: "manual" }),
  );
  const moved = vi.fn(
    async () => new Response(null, { status: 302, headers: { location: `${URL}.other` } }),
  );
  await expect(readSharedNote(REF, POD, anonymous, moved)).rejects.toThrow("redirects");
});
it("refuses redirects and missing note bodies and propagates storage failures", async () => {
  await expect(
    readSharedNote(
      REF,
      POD,
      vi.fn(async () => new Response(null, { status: 302, headers: { location: `${URL}.acl` } })),
    ),
  ).rejects.toThrow("redirects to another address");
  await expect(
    readSharedNote(
      REF,
      POD,
      vi.fn(
        async () =>
          new Response(await serializeTurtle(new Store()), {
            headers: { "content-type": "text/turtle" },
          }),
      ),
    ),
  ).rejects.toThrow("This shared note could not be read");
  await expect(
    readSharedNote(
      REF,
      POD,
      vi.fn(async () => new Response(null, { status: 500 })),
    ),
  ).rejects.toMatchObject({ status: 500 });
});
it.each([
  ['user="read",public=""', true],
  ['user="read write",public=""', false],
  [null, undefined],
])("respects WAC-Allow %s for own notes", async (allow, expected) => {
  const fixture = await harness();
  const store = createNotesStore(fixture.options);
  const note = await store.create();
  fixture.setHook(async (call) => {
    if (call.url !== note.url || call.method !== "GET") return undefined;
    const response = await fixture.pod.fetch(call.url, call.init);
    const headers = new Headers(response.headers);
    headers.delete("wac-allow");
    if (allow !== null) headers.set("wac-allow", allow as string);
    return new Response(response.body, { status: response.status, headers });
  });
  expect((await store.read(note.url))?.readOnly).toBe(expected);
});

it.each([
  "",
  "archive/",
  ".trash/",
])("routes owned extensionless notes in %s through the store's scope", async (part) => {
  const fixture = await harness();
  const store = createNotesStore(fixture.options);
  const url = `${POD}notes/${part}extensionless`;
  await fixture.pod.fetch(url, {
    method: "PUT",
    body: await serializeTurtle(buildNote(url, { title: "Extensionless" })),
    headers: { "content-type": "text/turtle" },
  });
  expect(noteLink(encodeRef(url), POD)).toEqual({ url, ownerRoot: POD, foreign: false });
  expect((await store.read(url))?.title).toBe("Extensionless");
});
