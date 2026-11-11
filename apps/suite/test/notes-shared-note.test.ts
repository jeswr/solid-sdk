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
it("reads public notes anonymously as view only and does not expose owner fields", async () => {
  const dataset = buildNote(URL, {
    title: "Public",
    body: "<p>Text</p>",
    labels: ["Private"],
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
    labels: [],
    reminder: undefined,
    reminderId: undefined,
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
it.each([401, 403])("explains private foreign notes are unsupported on %s", async (status) => {
  await expect(
    readSharedNote(
      REF,
      POD,
      vi.fn(async () => new Response(null, { status })),
    ),
  ).rejects.toThrow("opening private notes shared from another pod is not supported yet");
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
