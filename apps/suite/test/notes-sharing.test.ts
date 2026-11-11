// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { serializeTurtle } from "../src/apps/docs/lib/model/rdf-io";
import { privateAcl } from "../src/apps/drive/lib/client/access";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { discoverNoteShares, NoteSharingAdapter } from "../src/apps/notes/lib/sharing";
import { SheetResource } from "../src/apps/sheets/lib/model";
import { MemorySharingAdapter } from "../src/shell/share/memory-adapter";
import type { SharingState } from "../src/shell/share/types";
import { act, deferred } from "./drive-ui-dom";
import { harness, POD, WEBID } from "./sheets-workbook-helpers";

const signal = () => new AbortController().signal;
const BOB = "https://pod.example/bob/profile/card#me";
const state: SharingState = {
  people: [{ webId: WEBID, role: "owner" }],
  general: { mode: "restricted" },
  canManage: true,
};
async function setup(body = "<p>Note</p>") {
  const fixture = await harness();
  const store = createNotesStore(fixture.options);
  const note = await store.create({ title: "Share me", body });
  const session = { ...fixture.options, storageUrl: POD, mode: "demo" };
  return { ...fixture, note, session, store };
}

describe("Notes WAC sharing", () => {
  it("shares a document with viewers, editors and public links", async () => {
    const { note, session, calls } = await setup();
    const adapter = new NoteSharingAdapter(note, session);
    await expect(adapter.setPerson(note.url, BOB, "viewer")).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(adapter.setGeneral(note.url, { mode: "link" })).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(adapter.load(`${note.url}.acl`, signal())).rejects.toMatchObject({
      code: "unsupported",
    });
    expect((await adapter.load(note.url, signal())).canManage).toBe(true);
    expect(
      calls
        .find((call) => call.method === "PUT" && call.url === `${note.url}.acl`)
        ?.headers.get("if-none-match"),
    ).toBe("*");
    await adapter.setPerson(note.url, BOB, "editor");
    await adapter.setGeneral(note.url, { mode: "link", role: "viewer" });
    expect((await adapter.load(note.url, signal())).people).toContainEqual({
      webId: BOB,
      role: "editor",
    });
    await adapter.setPerson(note.url, BOB, null);
    await adapter.setGeneral(note.url, { mode: "restricted" });
    expect((await adapter.load(note.url, signal())).general.mode).toBe("restricted");
    await expect(adapter.setPerson(note.url, BOB, "commenter")).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(adapter.setGeneral(note.url, { mode: "signed-in" })).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(
      adapter.setGeneral(note.url, { mode: "link", role: "commenter" }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it.each([
    "default",
    "defaultForNew",
  ])("preserves inherited %s collaborators by refusing own ACL creation", async (predicate) => {
    const { note, session, pod, calls } = await setup();
    const policy = privateAcl(POD, WEBID);
    const other = new SheetResource(`${POD}.acl#other`, policy, DataFactory);
    const Acl = "http://www.w3.org/ns/auth/acl#";
    other.types.add(`${Acl}Authorization`);
    other.links(`${Acl}${predicate}`).add(POD);
    other.links(`${Acl}agent`).add(BOB);
    other.links(`${Acl}mode`).add(`${Acl}Read`);
    await pod.fetch(`${POD}.acl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await serializeTurtle(policy),
    });
    calls.length = 0;
    const adapter = new NoteSharingAdapter(note, { ...session, mode: "solid" });
    await expect(adapter.load(note.url, signal())).rejects.toMatchObject({ code: "unsupported" });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("refuses changed endpoints at the mutation boundary and retains stale state locked", async () => {
    const { note, session, calls, setHook } = await setup();
    const adapter = new NoteSharingAdapter(note, session);
    await adapter.load(note.url, signal());
    setHook((call) =>
      call.method === "HEAD" && call.url === note.url
        ? new Response(null, { headers: { link: `<${note.url}.other>; rel="acl"` } })
        : undefined,
    );
    calls.length = 0;
    await expect(adapter.setPerson(note.url, BOB, "viewer")).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });
});

it("grants images read access only, preserving other notes' grants on downgrades and removal", async () => {
  const image = `${POD}notes/media/shared.png`;
  const { note, session } = await setup(`<p><img src="${image}"><img src="${image}"></p>`);
  const memory = new MemorySharingAdapter(state, 0);
  const adapter = new NoteSharingAdapter(note, session, memory);
  await adapter.load(note.url, signal());
  await adapter.setPerson(note.url, BOB, "editor");
  expect((await memory.load(image, signal())).people).toContainEqual({
    webId: BOB,
    role: "viewer",
  });
  await memory.setPerson(image, BOB, "editor");
  await adapter.setPerson(note.url, BOB, "viewer");
  await adapter.setPerson(note.url, BOB, null);
  expect((await memory.load(image, signal())).people).toContainEqual({
    webId: BOB,
    role: "editor",
  });
  await adapter.setGeneral(note.url, { mode: "link" });
  expect((await memory.load(image, signal())).general).toEqual({ mode: "link", role: "viewer" });
  await memory.setGeneral(image, { mode: "link", role: "editor" });
  await adapter.setGeneral(note.url, { mode: "link", role: "editor" });
  await adapter.setGeneral(note.url, { mode: "restricted" });
  expect((await memory.load(image, signal())).general).toEqual({ mode: "link", role: "editor" });
  expect(adapter.supportsCommenter).toBe(false);
  expect(adapter.supportsGeneralCommenter).toBe(false);
});

it("preflights listed images and excludes assets outside Notes media", async () => {
  const image = `${POD}notes/media/shared.png`;
  const { note, session } = await setup(`<img src="${image}">`);
  const memory = new MemorySharingAdapter(state, 0);
  const originalLoad = memory.load.bind(memory);
  const load = vi.spyOn(memory, "load").mockImplementation(async (url, signal) => ({
    ...(await originalLoad(url, signal)),
    ...(url === image ? { canManage: false } : {}),
  }));
  const adapter = new NoteSharingAdapter(note, session, memory);
  await expect(adapter.load(note.url, signal())).rejects.toMatchObject({ code: "forbidden" });
  load.mockImplementation(async (url, signal) => ({
    ...(await originalLoad(url, signal)),
    ...(url === image ? { readOnly: "offline" as const } : {}),
  }));
  await expect(adapter.load(note.url, signal())).rejects.toMatchObject({ code: "forbidden" });
  await expect(adapter.setPerson(note.url, BOB, "viewer")).rejects.toMatchObject({
    code: "unsupported",
  });
  const unsupported = new NoteSharingAdapter(
    { ...note, body: `<img src="${POD}docs/a/assets/image.png">` },
    session,
    memory,
  );
  expect(unsupported.images).toEqual([]);
  await expect(unsupported.load(note.url, signal())).resolves.toMatchObject({ canManage: true });
});

it("never blocks the list or bootstraps ACLs, caps discovery at four, and leaves failures unknown", async () => {
  const { session, note, calls } = await setup();
  const found = vi.fn();
  await discoverNoteShares([note.url], session, signal(), found);
  expect(found).not.toHaveBeenCalled();
  expect(calls.some((call) => call.method === "PUT" && call.url.endsWith(".acl"))).toBe(false);
  const memory = new MemorySharingAdapter(state, 0);
  const wait = deferred<void>();
  let active = 0;
  let max = 0;
  const load = vi.spyOn(memory, "load").mockImplementation(async (url) => {
    active++;
    max = Math.max(max, active);
    await wait.promise;
    active--;
    return url === "public"
      ? { ...state, general: { mode: "link" } }
      : url === "person"
        ? { ...state, people: [...state.people, { webId: BOB, role: "viewer" }] }
        : state;
  });
  const work = discoverNoteShares(
    ["owner", "public", "person", "four", "five"],
    session,
    signal(),
    found,
    memory,
  );
  expect(load).toHaveBeenCalledTimes(4);
  await act(() => wait.resolve());
  await work;
  expect(max).toBe(4);
  expect(found.mock.calls).toEqual([
    ["owner", false],
    ["public", true],
    ["person", true],
    ["four", false],
    ["five", false],
  ]);
  const controller = new AbortController();
  load.mockImplementation(async () => {
    controller.abort();
    return state;
  });
  found.mockClear();
  await discoverNoteShares(["a", "b", "c", "d", "e"], session, controller.signal, found, memory);
  expect(found).not.toHaveBeenCalled();
  await discoverNoteShares(["a"], session, controller.signal, found, memory);
});

it("carries existing readers and public read access onto newly attached images", async () => {
  const image = `${POD}notes/media/new.png`;
  const { note, session } = await setup(`<img src="${image}">`);
  const memory = new MemorySharingAdapter(state, 0);
  await memory.setPerson(note.url, BOB, "editor");
  await memory.setGeneral(note.url, { mode: "link", role: "viewer" });
  await new NoteSharingAdapter(note, session, memory).shareImages(signal());
  expect((await memory.load(image, signal())).people).toContainEqual({
    webId: BOB,
    role: "viewer",
  });
  expect((await memory.load(image, signal())).general).toEqual({ mode: "link", role: "viewer" });
  await memory.setGeneral(note.url, { mode: "restricted" });
  await memory.setPerson(note.url, BOB, "viewer");
  await new NoteSharingAdapter(note, session, memory).shareImages(signal());
});

it("never grants a collaborator-inserted private image on an ordinary owner save", async () => {
  const { store, note, pod, session, calls } = await setup();
  const adapter = new NoteSharingAdapter(note, session);
  await adapter.load(note.url, signal());
  await adapter.setPerson(note.url, BOB, "editor");
  await adapter.setGeneral(note.url, { mode: "link", role: "viewer" });
  const image = `${POD}notes/media/private.png`;
  await pod.fetch(image, {
    method: "PUT",
    body: "image",
    headers: { "content-type": "image/png" },
  });
  await pod.fetch(`${image}.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: await serializeTurtle(privateAcl(image, WEBID)),
  });
  // The collaborator knows the URL but has no access to this image.
  const collaborator = createNotesStore({ ...session, podRoot: POD, webId: BOB });
  const inserted = await collaborator.save(
    note,
    { body: `<p><img src="${image}" alt="Private"></p>` },
    note.etag,
  );
  calls.length = 0;
  const saved = await store.save(
    inserted,
    { body: `${inserted.body}<p>Owner edit</p>` },
    inserted.etag,
  );
  expect(calls.filter((call) => call.method === "PUT").map((call) => call.url)).toEqual([note.url]);
  const access = new (await import("../src/shell/share/wac-adapter")).WacSharingAdapter(session);
  expect((await access.load(image, signal())).people).toEqual([{ webId: WEBID, role: "owner" }]);
  expect((await access.load(image, signal())).general.mode).toBe("restricted");
  const reopened = new NoteSharingAdapter(saved, session);
  expect(reopened.images).toEqual([image]);
  await reopened.load(note.url, signal());
  expect((await access.load(image, signal())).general.mode).toBe("restricted");
  await reopened.shareImages(signal());
  expect((await access.load(image, signal())).people).toContainEqual({
    webId: BOB,
    role: "viewer",
  });
  expect((await access.load(image, signal())).general).toEqual({ mode: "link", role: "viewer" });
});

it("bounds note grants to Notes documents and refuses unsupported grant conditions", async () => {
  const { note, session } = await setup();
  const memory = new MemorySharingAdapter(state, 0);
  const foreign = new NoteSharingAdapter(
    { ...note, url: `${POD}settings/private.ttl` },
    session,
    memory,
  );
  await expect(foreign.load(`${POD}settings/private.ttl`, signal())).rejects.toMatchObject({
    code: "unsupported",
  });
  const adapter = new NoteSharingAdapter(note, session, memory);
  await adapter.load(note.url, signal());
  await expect(
    adapter.setPerson(note.url, BOB, "viewer", { expires: new Date() }),
  ).rejects.toMatchObject({ code: "unsupported" });
  await expect(
    adapter.setPerson(note.url, BOB, "viewer", { purpose: "Review" }),
  ).rejects.toMatchObject({ code: "unsupported" });
  await adapter.setPerson(note.url, BOB, "viewer", {});
  for (const path of ["archive/", ".trash/"]) {
    const url = `${POD}notes/${path}note.ttl`;
    expect(
      (await new NoteSharingAdapter({ ...note, url }, session, memory).load(url, signal()))
        .canManage,
    ).toBe(true);
  }
});

it.each([
  { canManage: false },
  { readOnly: "offline" as const },
])("requires the owner to retain access management in Share (%j)", async (denied) => {
  const { note, session } = await setup();
  const memory = new MemorySharingAdapter(state, 0);
  const adapter = new NoteSharingAdapter(note, session, memory);
  const load = vi.spyOn(memory, "load").mockResolvedValue({ ...state, ...denied });
  await expect(adapter.shareImages(signal())).rejects.toMatchObject({ code: "forbidden" });
  expect(load).toHaveBeenCalled();
});

it.each([
  { canManage: false },
  { readOnly: "offline" as const },
])("rechecks each listed image's access before granting (%j)", async (denied) => {
  const image = `${POD}notes/media/changed.png`;
  const { note, session } = await setup(`<img src="${image}">`);
  const memory = new MemorySharingAdapter(state, 0);
  const original = memory.load.bind(memory);
  let imageReads = 0;
  vi.spyOn(memory, "load").mockImplementation(async (url, signal) => ({
    ...(await original(url, signal)),
    ...(url === image && ++imageReads >= 3 ? denied : {}),
  }));
  const setPerson = vi.spyOn(memory, "setPerson");
  const adapter = new NoteSharingAdapter(note, session, memory);
  await adapter.load(note.url, signal());
  await expect(adapter.setPerson(note.url, BOB, "viewer")).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(setPerson).not.toHaveBeenCalled();
});
