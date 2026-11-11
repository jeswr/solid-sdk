// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { RedirectRefusedError } from "@jeswr/guarded-fetch";
import { DataFactory, Store } from "n3";
import { assert, describe, expect, it } from "vitest";
import {
  ConcurrencyValidatorError,
  OutOfScopeError,
  ResourceDeleteError,
  ResourceWriteError,
} from "../src/apps/docs/lib/model/errors";
import { readRdf, serializeTurtle, writeRdf } from "../src/apps/docs/lib/model/rdf-io";
import {
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
  TypeRegistration,
} from "../src/apps/docs/lib/model/type-index";
import { DOCUMENT_CLASS } from "../src/apps/docs/lib/model/vocab";
import {
  buildNote,
  createNotesStore,
  NoteConflictError,
  NoteMoveUncertainError,
  NotesStore,
  parseNote,
  type StoredNote,
} from "../src/apps/notes/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { mockFetch, privateIndexPolicy } from "./docs/helpers";

const POD = "https://notes.demo/";
const WEBID = `${POD}profile/card#me`;
const INDEX = `${POD}settings/privateTypeIndex.ttl`;
const PREFS = `${POD}settings/prefs.ttl`;
const ROOT = `${POD}notes/`;
const NOW = new Date("2026-11-01T12:00:00Z");
type Intercept = (url: string, init: RequestInit | undefined) => Promise<Response | undefined>;

async function fixture(
  registration: "none" | "profile" | "preferences" | "extended" | "extended-preferences" = "none",
) {
  let time = NOW;
  const pod = createDemoPod({ root: POD });
  const profile = new Store();
  const anchor = new ProfileTypeIndexAnchor(WEBID, profile, DataFactory);
  if (registration === "profile") anchor.privateIndex = INDEX;
  if (registration === "preferences") {
    anchor.preferencesFiles.add(PREFS);
    const preferences = new Store();
    new ProfileTypeIndexAnchor(WEBID, preferences, DataFactory).privateIndex = INDEX;
    await writeRdf(PREFS, preferences, { createOnly: true, fetchImpl: pod.fetch });
  }
  if (registration.startsWith("extended")) {
    const extended = `${POD}profile/extended`;
    const { NamedNodeAs, NamedNodeFrom, SetFrom } = await import("@rdfjs/wrapper");
    SetFrom.subjectPredicate(
      anchor,
      "http://www.w3.org/2000/01/rdf-schema#seeAlso",
      NamedNodeAs.string,
      NamedNodeFrom.string,
    ).add(extended);
    const dataset = new Store();
    const linked = new ProfileTypeIndexAnchor(WEBID, dataset, DataFactory);
    if (registration === "extended") linked.privateIndex = INDEX;
    else {
      linked.preferencesFiles.add(PREFS);
      const preferences = new Store();
      new ProfileTypeIndexAnchor(WEBID, preferences, DataFactory).privateIndex = INDEX;
      await writeRdf(PREFS, preferences, { createOnly: true, fetchImpl: pod.fetch });
    }
    await writeRdf(extended, dataset, { createOnly: true, fetchImpl: pod.fetch });
  }
  await writeRdf(WEBID.split("#")[0] as string, profile, {
    createOnly: true,
    fetchImpl: pod.fetch,
  });
  const index = new Store();
  const docs = new TypeRegistration(`${INDEX}#docs`, index, DataFactory);
  docs.markRegistration();
  docs.forClass = DOCUMENT_CLASS;
  docs.instanceContainer = `${POD}docs/`;
  if (registration !== "none")
    await writeRdf(INDEX, index, { createOnly: true, fetchImpl: pod.fetch });
  const policy = mockFetch(privateIndexPolicy(INDEX, WEBID));
  let intercept: Intercept | undefined;
  const calls: { url: string; method: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers: new Headers(init?.headers) });
    const response = await intercept?.(url, init);
    if (response) return response;
    if ((url === INDEX && method === "HEAD") || url === `${INDEX}.acl`)
      return policy.fetch(input, init);
    return pod.fetch(input, init);
  };
  const options = { fetch: fetchImpl, podRoot: POD, webId: WEBID, now: () => time };
  const store = createNotesStore(options);
  return {
    pod,
    store,
    fetchImpl,
    calls,
    options,
    intercept: (next: Intercept) => {
      intercept = next;
    },
    clock: (next: Date) => {
      time = next;
    },
  };
}

describe("notes store", () => {
  it("creates containers and create-only slugs, defaults to note, and scopes stored reads", async () => {
    const s = await fixture();
    expect(s.store.containers).toEqual({
      active: ROOT,
      archived: `${ROOT}archive/`,
      trashed: `${ROOT}.trash/`,
    });
    const a = await s.store.create({ title: "Hello World", body: "<p>text</p>", labels: ["home"] });
    expect(a.url).toBe(`${ROOT}hello-world.ttl`);
    expect((await s.store.create({ title: "Hello World" })).url).toBe(`${ROOT}hello-world-2.ttl`);
    expect((await s.store.create({ title: "Hello World" })).url).toBe(`${ROOT}hello-world-3.ttl`);
    expect((await s.store.create()).url).toBe(`${ROOT}note.ttl`);
    expect((await s.store.create({ title: "!!!" })).url).toBe(`${ROOT}note-2.ttl`);
    expect(await s.store.read(a.url)).toEqual(a);
    for (const url of Object.values(s.store.containers)) expect(s.pod.has(url)).toBe(true);
    expect(
      s.calls
        .filter((call) => call.method === "PUT")
        .every((call) => call.headers.get("if-none-match") === "*"),
    ).toBe(true);
    expect(s.calls.some((call) => call.url === INDEX)).toBe(false);
    expect(s.calls.filter((call) => call.url === WEBID)).toHaveLength(1);
    const automaticClock = new NotesStore({ fetch: s.fetchImpl, podRoot: POD, webId: WEBID });
    expect((await automaticClock.create({ title: "Clock" })).created).toBeDefined();
  });

  it.each([
    "profile",
    "preferences",
    "extended",
    "extended-preferences",
  ] as const)("registers once alongside Docs via %s, without bootstrapping an absent index", async (location) => {
    const s = await fixture(location);
    await Promise.all([s.store.create({ title: "First" }), s.store.create({ title: "Second" })]);
    const { dataset } = await readRdf(INDEX, s.pod.fetch);
    expect(
      new TypeIndexDataset(dataset, DataFactory)
        .locate(DOCUMENT_CLASS)
        .map((entry) => entry.container),
    ).toEqual([`${POD}docs/`, ROOT]);
    expect(s.calls.filter((call) => call.url === INDEX && call.method === "PUT")).toHaveLength(1);
    const another = new NotesStore(s.options);
    await another.create({ title: "Third" });
    expect(s.calls.filter((call) => call.url === INDEX && call.method === "PUT")).toHaveLength(1);
  });

  it("never fails capture for index or explicit-container failures, but propagates note writes", async () => {
    const s = await fixture("profile");
    s.intercept(async (url, init) =>
      url === INDEX || (url.endsWith("/") && init?.method === "PUT")
        ? new Response(null, { status: 403 })
        : undefined,
    );
    expect((await s.store.create()).url).toBe(`${ROOT}note.ttl`);
    s.intercept(async (url, init) =>
      url.endsWith(".ttl") && init?.method === "PUT"
        ? new Response(null, { status: 500 })
        : undefined,
    );
    await expect(s.store.create()).rejects.toBeInstanceOf(ResourceWriteError);
  });

  it("lists with four concurrent reads, skipping unreadable and non-document children", async () => {
    const s = await fixture();
    expect(await s.store.list("active")).toEqual([]);
    const notes = await Promise.all(
      Array.from({ length: 9 }, (_, index) => s.store.create({ title: `Note ${index}` })),
    );
    await writeRdf(`${ROOT}foreign.ttl`, new Store(), { createOnly: true, fetchImpl: s.pod.fetch });
    let active = 0;
    let max = 0;
    s.intercept(async (url, init) => {
      if ((init?.method ?? "GET") !== "GET" || !url.endsWith(".ttl")) return undefined;
      active++;
      max = Math.max(active, max);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      active--;
      if (url === notes[0]?.url) return new Response(null, { status: 403 });
      if (url === notes[1]?.url)
        return new Response("malformed {{{", { headers: { "content-type": "text/turtle" } });
      return undefined;
    });
    const listed = await s.store.list("active");
    expect(listed).toHaveLength(7);
    expect(max).toBe(4);
    expect(await s.store.read(`${ROOT}foreign.ttl`)).toBeUndefined();
    s.intercept(async (url) => (url === ROOT ? new Response(null, { status: 403 }) : undefined));
    await expect(s.store.list("active")).rejects.toMatchObject({ status: 403 });
    s.intercept(async (url) =>
      url === ROOT ? new Response("", { headers: { "content-type": "text/turtle" } }) : undefined,
    );
    expect(await s.store.list("active")).toEqual([]);
  });

  it("skips foreign, nested, container and encoded-separator listing links before I/O", async () => {
    const s = await fixture();
    const dataset = new Store();
    const { Container } = await import("@solid/object");
    const { NamedNodeAs, NamedNodeFrom, SetFrom } = await import("@rdfjs/wrapper");
    const container = new Container(ROOT, dataset, DataFactory);
    container.type.add("http://www.w3.org/ns/ldp#BasicContainer");
    const contains = SetFrom.subjectPredicate(
      container,
      "http://www.w3.org/ns/ldp#contains",
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
    for (const url of [
      "https://evil.example/a",
      `${ROOT}nested/a`,
      `${ROOT}a%2Fb`,
      `${ROOT}folder/`,
    ])
      contains.add(url);
    const body = await serializeTurtle(dataset);
    s.intercept(async (url) =>
      url === ROOT ? new Response(body, { headers: { "content-type": "text/turtle" } }) : undefined,
    );
    expect(await s.store.list("active")).toEqual([]);
    expect(s.calls).toHaveLength(1);
  });

  it("saves conditionally, preserves labels/timestamps, caps history across many saves and reports conflicts", async () => {
    const s = await fixture();
    let note = await s.store.create({ body: "first", labels: ["home"] });
    const original = note;
    for (let index = 1; index <= 25; index++) {
      s.clock(new Date(NOW.getTime() + index * 600_000));
      note = await s.store.save(note, { body: `body ${index}` }, note.etag);
      expect(note.revisions.length).toBe(Math.min(index + 1, 20));
      expect(note.revisions.at(-1)?.wasRevisionOf).toBeUndefined();
    }
    expect(note.created).toBe(original.created);
    expect(note.labels).toEqual(["home"]);
    expect(note.revisions[0]?.id).toBe(`${note.url}#rev-25`);
    expect(await s.store.read(note.url)).toEqual(note);
    await expect(s.store.save(original, { title: "Stale" }, original.etag)).rejects.toBeInstanceOf(
      NoteConflictError,
    );
    await expect(s.store.save(note, {}, null)).rejects.toBeInstanceOf(ConcurrencyValidatorError);
    expect(new NoteConflictError(note.url)).toMatchObject({
      name: "NoteConflictError",
      url: note.url,
      status: 412,
    });
    s.intercept(async (_url, init) =>
      init?.method === "PUT" ? new Response(null, { status: 403 }) : undefined,
    );
    await expect(s.store.save(note, {}, note.etag)).rejects.toMatchObject({ status: 403 });
  });

  it("archives, unarchives, trashes and restores body, labels, provenance and rebased history", async () => {
    const s = await fixture();
    let note = await s.store.create({ title: "Roundtrip", body: "first", labels: ["label"] });
    s.clock(new Date(NOW.getTime() + 600_000));
    note = await s.store.save(note, { body: "second" }, note.etag);
    const contents = note.revisions.map(
      ({ id: _id, wasRevisionOf: _previous, ...revision }) => revision,
    );
    const originalUrl = note.url;
    for (const operation of [
      s.store.archive.bind(s.store),
      s.store.trash.bind(s.store),
      s.store.restore.bind(s.store),
      s.store.unarchive.bind(s.store),
      s.store.trash.bind(s.store),
      s.store.restore.bind(s.store),
    ]) {
      const source = note;
      note = await operation(note);
      expect(note.revisions.map((revision) => revision.id)).toEqual(
        source.revisions.map((revision) => revision.id.replace(source.url, note.url)),
      );
      expect(note).toMatchObject({
        body: "second",
        labels: ["label"],
        created: source.created,
        creator: WEBID,
      });
      expect(
        note.revisions.map(({ id: _id, wasRevisionOf: _previous, ...revision }) => revision),
      ).toEqual(contents);
      expect(
        note.revisions.every(
          (revision) =>
            revision.id.startsWith(`${note.url}#`) &&
            (!revision.wasRevisionOf || revision.wasRevisionOf.startsWith(`${note.url}#`)),
        ),
      ).toBe(true);
      expect(s.pod.has(source.url)).toBe(false);
      if (note.location === "trashed") {
        expect(note.previous).toBe(source.location);
        expect(note.trashedAt).toBe(new Date(NOW.getTime() + 600_000).toISOString());
        const { dataset } = await readRdf(note.url, s.pod.fetch);
        expect(parseNote(note.url, dataset, "trashed")).toMatchObject(noteWithoutEtag(note));
      } else {
        expect(note.trashedAt).toBeUndefined();
        expect(note.previous).toBeUndefined();
      }
    }
    expect(note.url).toBe(originalUrl);
    expect(await s.store.list("active")).toEqual([note]);
    expect(await s.store.unarchive(note)).toBe(note);
    const archived = await s.store.archive(note);
    expect(await s.store.archive(archived)).toBe(archived);
    const trash = await s.store.trash(archived);
    expect(await s.store.trash(trash)).toBe(trash);
    await expect(s.store.archive(trash)).rejects.toMatchObject({ code: "invalid-transition" });
    await expect(s.store.restore(note)).rejects.toMatchObject({ code: "invalid-transition" });
  });

  it("allocates move collisions without overwriting and handles resources with no file extension or history", async () => {
    const s = await fixture();
    const original = await s.store.create({ title: "Same" });
    const first = await s.store.archive(original);
    const second = await s.store.create({ title: "Same" });
    expect((await s.store.archive(second)).url).toBe(`${ROOT}archive/same-2.ttl`);
    expect(await s.store.read(first.url)).toEqual(first);
    const url = `${ROOT}extensionless`;
    const dataset = buildNote(url, { title: "Plain" });
    await writeRdf(url, dataset, { createOnly: true, fetchImpl: s.pod.fetch });
    const stored = await s.store.read(url);
    assert(stored);
    const noHistory = { ...stored, revisions: [], modified: undefined };
    const moved = await s.store.archive(noHistory);
    expect(moved.url).toBe(`${ROOT}archive/extensionless`);
    const imported = await s.store.unarchive({
      ...moved,
      revisions: moved.revisions.map((revision) => ({
        ...revision,
        id: "https://foreign.example/#original",
      })),
    });
    expect(imported.revisions[0]?.id).toBe(`${imported.url}#imported-0`);
    const trash = await s.store.trash(imported);
    expect((await s.store.restore({ ...trash, previous: undefined })).location).toBe("active");
  });

  it("rolls back a move on source delete conflict, preserving the source and the original failure", async () => {
    const s = await fixture();
    const note = await s.store.create();
    await expect(s.store.archive({ ...note, etag: null })).rejects.toBeInstanceOf(
      ConcurrencyValidatorError,
    );
    await expect(s.store.archive({ ...note, etag: 'W/"weak"' })).rejects.toBeInstanceOf(
      ConcurrencyValidatorError,
    );
    s.intercept(async (url, init) =>
      url === note.url && init?.method === "DELETE"
        ? new Response(null, { status: 412 })
        : undefined,
    );
    await expect(s.store.archive(note)).rejects.toBeInstanceOf(NoteConflictError);
    expect(s.pod.has(note.url)).toBe(true);
    expect(s.pod.has(`${ROOT}archive/note.ttl`)).toBe(false);
    expect(
      s.calls
        .filter((call) => call.method === "DELETE")
        .every((call) => Boolean(call.headers.get("if-match"))),
    ).toBe(true);
    s.intercept(async (_url, init) =>
      init?.method === "DELETE" ? new Response(null, { status: 500 }) : undefined,
    );
    await expect(s.store.archive(note)).rejects.toBeInstanceOf(AggregateError);
  });

  it.each([
    404, 410,
  ])("keeps the destination when a committed DELETE loses its response (%s)", async (status) => {
    const s = await fixture();
    const note = await s.store.create({ body: "Only copy" });
    let deleted = false;
    s.intercept(async (url, init) => {
      if (url !== note.url) return;
      if (init?.method === "DELETE") {
        await s.pod.fetch(url, init);
        deleted = true;
        throw new TypeError("Lost response");
      }
      if (deleted) return new Response(null, { status });
    });
    const moved = await s.store.archive(note);
    expect(s.pod.has(note.url)).toBe(false);
    expect(s.pod.has(moved.url)).toBe(true);
    expect(moved.body).toBe("Only copy");
    expect(s.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it.each([
    401, 403,
  ])("rolls back definite source DELETE refusals (%s) without verification", async (status) => {
    const s = await fixture();
    const note = await s.store.create();
    s.intercept(async (url, init) =>
      url === note.url && init?.method === "DELETE" ? new Response(null, { status }) : undefined,
    );
    await expect(s.store.archive(note)).rejects.toMatchObject({
      name: "ResourceDeleteError",
      status,
    });
    expect(s.pod.has(note.url)).toBe(true);
    expect(s.pod.has(`${ROOT}archive/note.ttl`)).toBe(false);
    expect(s.calls.filter((call) => call.url === note.url && call.method === "GET")).toEqual([]);
  });

  it.each([
    404, 410, 502,
  ])("keeps the destination when source DELETE commits but reports %s", async (status) => {
    const s = await fixture();
    const note = await s.store.create({ body: "Only surviving copy" });
    s.intercept(async (url, init) => {
      if (url !== note.url || init?.method !== "DELETE") return;
      await s.pod.fetch(url, init);
      return new Response(null, { status });
    });
    const moved = await s.store.archive(note);
    expect(s.pod.has(note.url)).toBe(false);
    expect((await s.store.read(moved.url))?.body).toBe("Only surviving copy");
    expect(s.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it.each([
    408,
    429,
    409,
    500,
    502,
    "transport",
  ])("verifies the original validator before rolling back an ambiguous DELETE (%s)", async (status) => {
    const s = await fixture();
    const note = await s.store.create();
    s.intercept(async (url, init) => {
      if (url !== note.url || init?.method !== "DELETE") return;
      if (typeof status === "string") throw new TypeError("Offline");
      return new Response(null, { status });
    });
    await expect(s.store.archive(note)).rejects.toThrow();
    expect(s.pod.has(note.url)).toBe(true);
    expect(s.pod.has(`${ROOT}archive/note.ttl`)).toBe(false);
    expect(s.calls.filter((call) => call.url === note.url && call.method === "GET")).toHaveLength(
      1,
    );
  });

  it("keeps both copies when a 502 cannot be verified", async () => {
    const s = await fixture();
    const note = await s.store.create();
    s.intercept(async (url) =>
      url === note.url ? new Response(null, { status: 502 }) : undefined,
    );
    await expect(s.store.archive(note)).rejects.toBeInstanceOf(NoteMoveUncertainError);
    expect(s.pod.has(note.url)).toBe(true);
    expect(s.pod.has(`${ROOT}archive/note.ttl`)).toBe(true);
  });

  it.each([
    "new-etag",
    "same-etag",
    "no-etag",
  ])("keeps the original destination when another tab replaces the deleted slug (%s)", async (validator) => {
    const s = await fixture();
    const note = await s.store.create({ body: "Original body" });
    s.intercept(async (url, init) => {
      if (url !== note.url) return;
      if (init?.method === "DELETE") {
        await s.pod.fetch(url, init);
        await writeRdf(
          url,
          buildNote(url, { title: "Replacement", body: "Unrelated replacement" }),
          {
            createOnly: true,
            fetchImpl: s.pod.fetch,
          },
        );
        throw new TypeError("Lost DELETE response");
      }
      if (validator === "new-etag") return;
      const response = await s.pod.fetch(url, init);
      const headers = new Headers(response.headers);
      if (validator === "same-etag") headers.set("etag", note.etag as string);
      else headers.delete("etag");
      return new Response(await response.text(), { headers });
    });
    const moved = await s.store.archive(note);
    expect((await s.store.read(note.url))?.body).toBe("Unrelated replacement");
    expect((await s.store.read(moved.url))?.body).toBe("Original body");
    expect(s.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it("treats a missing verification validator as uncertain when the body is unchanged", async () => {
    const s = await fixture();
    const note = await s.store.create({ body: "Original body" });
    s.intercept(async (url, init) => {
      if (url !== note.url) return;
      if (init?.method === "DELETE") throw new TypeError("Lost response");
      const response = await s.pod.fetch(url, init);
      const headers = new Headers(response.headers);
      headers.delete("etag");
      return new Response(await response.text(), { headers });
    });
    await expect(s.store.archive(note)).rejects.toBeInstanceOf(NoteMoveUncertainError);
    expect(s.pod.has(note.url)).toBe(true);
    expect(s.pod.has(`${ROOT}archive/note.ttl`)).toBe(true);
  });

  it("never rolls back a destination that another tab has modified", async () => {
    const s = await fixture();
    const note = await s.store.create({ body: "Original body" });
    const destination = `${ROOT}archive/note.ttl`;
    s.intercept(async (url, init) => {
      if (url !== note.url || init?.method !== "DELETE") return;
      const moved = await s.store.read(destination);
      assert(moved);
      await s.store.save(moved, { body: "Newer destination edit" }, moved.etag);
      return new Response(null, { status: 412 });
    });
    await expect(s.store.archive(note)).rejects.toBeInstanceOf(AggregateError);
    expect((await s.store.read(destination))?.body).toBe("Newer destination edit");
    const deletion = s.calls.find((call) => call.url === destination && call.method === "DELETE");
    expect(deletion?.headers.get("if-match")).toBeTruthy();
    expect(deletion?.headers.get("if-match")).not.toBe((await s.store.read(destination))?.etag);
  });

  it.each([
    "transport",
    "http",
  ])("preserves both possible copies if the verification read fails (%s)", async (failure) => {
    const s = await fixture();
    const note = await s.store.create();
    s.intercept(async (url, init) => {
      if (url !== note.url) return;
      if (init?.method === "DELETE") throw new TypeError("Lost response");
      if (failure === "transport") throw new TypeError("Offline");
      return new Response(null, { status: 503 });
    });
    await expect(s.store.archive(note)).rejects.toBeInstanceOf(NoteMoveUncertainError);
    await expect(s.store.archive(note)).rejects.toMatchObject({
      name: "NoteMoveUncertainError",
      source: note.url,
      destination: `${ROOT}archive/note-2.ttl`,
      message: expect.stringContaining("may exist twice"),
    });
    expect(s.pod.has(note.url)).toBe(true);
    expect(s.pod.has(`${ROOT}archive/note.ttl`)).toBe(true);
    expect(
      s.calls.filter((call) => call.method === "DELETE").every((call) => call.url === note.url),
    ).toBe(true);
  });

  it("purges older than 30 days, retains 29-day and unstamped trash, and reports failures", async () => {
    const s = await fixture();
    const urls: string[] = [];
    for (const [title, days] of [
      ["old", 31],
      ["recent", 29],
      ["boundary", 30],
      ["failed", 31],
    ] as const) {
      s.clock(new Date(NOW.getTime() - days * 86_400_000));
      urls.push((await s.store.trash(await s.store.create({ title }))).url);
    }
    const missing = `${ROOT}.trash/missing.ttl`;
    await writeRdf(missing, buildNote(missing, { title: "No timestamp" }), {
      createOnly: true,
      fetchImpl: s.pod.fetch,
    });
    s.clock(NOW);
    s.intercept(async (url, init) =>
      url === urls[3] && init?.method === "DELETE"
        ? new Response(null, { status: 403 })
        : undefined,
    );
    const result = await s.store.purgeTrash();
    expect(result.deleted).toEqual([urls[0]]);
    expect(result.failed).toEqual([
      { url: urls[3], error: expect.objectContaining({ status: 403 }) },
    ]);
    expect(s.pod.has(urls[1] as string)).toBe(true);
    expect(s.pod.has(urls[2] as string)).toBe(true);
    expect(s.pod.has(missing)).toBe(true);
    expect(await s.store.purgeTrash(32)).toEqual({ deleted: [], failed: [] });
    for (const days of [-1, Number.NaN, Infinity])
      await expect(s.store.purgeTrash(days)).rejects.toThrow(RangeError);
    const recent = await s.store.read(urls[1] as string);
    assert(recent);
    await s.store.deleteForever(recent.url, recent.etag);
    expect(s.pod.has(urls[1] as string)).toBe(false);
    const foreign = `${ROOT}.trash/foreign.ttl`;
    await writeRdf(foreign, new Store(), { createOnly: true, fetchImpl: s.pod.fetch });
    await expect(s.store.deleteForever(foreign, null)).rejects.toBeInstanceOf(
      ConcurrencyValidatorError,
    );
    expect(s.pod.has(foreign)).toBe(true);
  });

  it("renames and deletes labels across active and archived notes with per-note failures", async () => {
    const s = await fixture();
    const active = await s.store.create({ title: "Active", labels: ["before", "other"] });
    const archive = await s.store.archive(
      await s.store.create({ title: "Archived", labels: ["before"] }),
    );
    const trash = await s.store.trash(
      await s.store.create({ title: "Trashed", labels: ["before"] }),
    );
    await s.store.create({ title: "Unchanged", labels: ["other"] });
    expect(await s.store.renameLabelEverywhere("before", "after")).toEqual([]);
    expect((await s.store.read(active.url))?.labels).toEqual(["after", "other"]);
    expect((await s.store.read(archive.url))?.labels).toEqual(["after"]);
    expect((await s.store.read(trash.url))?.labels).toEqual(["before"]);
    expect(await s.store.renameLabelEverywhere("after", "after")).toEqual([]);
    s.intercept(async (url, init) =>
      url === archive.url && init?.method === "PUT"
        ? new Response(null, { status: 412 })
        : undefined,
    );
    const failures = await s.store.deleteLabelEverywhere("after");
    expect(failures).toEqual([{ url: archive.url, error: expect.any(NoteConflictError) }]);
    expect((await s.store.read(active.url))?.labels).toEqual(["other"]);
    expect((await s.store.read(archive.url))?.labels).toEqual(["after"]);
  });

  it("merges existing labels without duplicates and retries a partially failed rename", async () => {
    const s = await fixture();
    const active = await s.store.create({ title: "Active", labels: ["A", "B", "keep"] });
    const archived = await s.store.archive(
      await s.store.create({ title: "Archived", labels: ["A"] }),
    );
    const destination = await s.store.create({ title: "Destination", labels: ["B"] });
    let fail = true;
    s.intercept(async (url, init) =>
      url === archived.url && init?.method === "PUT" && fail
        ? new Response(null, { status: 412 })
        : undefined,
    );
    expect(await s.store.renameLabelEverywhere("A", "B")).toEqual([
      { url: archived.url, error: expect.any(NoteConflictError) },
    ]);
    expect((await s.store.read(active.url))?.labels).toEqual(["B", "keep"]);
    expect((await s.store.read(archived.url))?.labels).toEqual(["A"]);
    fail = false;
    expect(await s.store.renameLabelEverywhere("A", "B")).toEqual([]);
    expect((await s.store.read(archived.url))?.labels).toEqual(["B"]);
    expect(await s.store.read(destination.url)).toEqual(destination);
    expect(await s.store.renameLabelEverywhere("A", "B")).toEqual([]);
  });

  it("guards every URL argument and note/location pairing before I/O and refuses redirects", async () => {
    const s = await fixture();
    const note = await s.store.create();
    s.calls.length = 0;
    for (const url of [
      "no-url",
      "https://evil.example/note.ttl",
      `${POD}docs/note.ttl`,
      `${ROOT}nested/note.ttl`,
      `${ROOT}a%2Fb`,
      `${ROOT}a%5Cb`,
      `${ROOT}note.ttl?q=x`,
      `${ROOT}note.ttl#it`,
      `${ROOT}archive/`,
    ]) {
      await expect(s.store.read(url)).rejects.toBeInstanceOf(OutOfScopeError);
      await expect(s.store.save({ ...note, url }, {}, note.etag)).rejects.toBeInstanceOf(
        OutOfScopeError,
      );
      await expect(s.store.trash({ ...note, url })).rejects.toBeInstanceOf(OutOfScopeError);
      await expect(s.store.deleteForever(url, note.etag)).rejects.toBeInstanceOf(OutOfScopeError);
    }
    await expect(
      s.store.save({ ...note, location: "archived" }, {}, note.etag),
    ).rejects.toBeInstanceOf(OutOfScopeError);
    await expect(s.store.deleteForever(note.url, note.etag)).rejects.toBeInstanceOf(
      OutOfScopeError,
    );
    expect(s.calls).toEqual([]);
    s.intercept(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    await expect(s.store.read(note.url)).rejects.toMatchObject({
      cause: expect.any(RedirectRefusedError),
    });
  });
});

function noteWithoutEtag({ etag: _etag, ...note }: StoredNote) {
  return note;
}

it("never deletes a replacement at the confirmed trash URL", async () => {
  const s = await fixture();
  const confirmed = await s.store.trash(
    await s.store.create({ title: "Same title", body: "Original" }),
  );
  const restored = await s.store.restore(confirmed);
  await s.store.archive(restored);
  const replacement = await s.store.trash(
    await s.store.create({ title: "Same title", body: "Replacement" }),
  );
  expect(replacement.url).toBe(confirmed.url);
  expect(replacement.etag).not.toBe(confirmed.etag);
  s.calls.length = 0;
  await expect(s.store.deleteForever(confirmed.url, confirmed.etag)).rejects.toBeInstanceOf(
    NoteConflictError,
  );
  expect(s.calls).toEqual([
    { url: confirmed.url, method: "GET", headers: expect.any(Headers) },
    { url: confirmed.url, method: "DELETE", headers: expect.any(Headers) },
  ]);
  expect(s.calls[1]?.headers.get("if-match")).toBe(confirmed.etag);
  expect(await s.store.read(replacement.url)).toEqual(replacement);
});

it("reports a typed purge conflict if trash is replaced after listing", async () => {
  const s = await fixture();
  s.clock(new Date(NOW.getTime() - 31 * 86_400_000));
  const old = await s.store.trash(await s.store.create({ title: "Expired" }));
  s.clock(NOW);
  let replace = true;
  s.intercept(async (url, init) => {
    if (url !== old.url || init?.method !== "DELETE" || !replace) return;
    replace = false;
    await s.pod.fetch(url, { method: "DELETE" });
    await writeRdf(url, buildNote(url, { title: "Unrelated", body: "Keep" }), {
      createOnly: true,
      fetchImpl: s.pod.fetch,
    });
  });
  expect(await s.store.purgeTrash()).toEqual({
    deleted: [],
    failed: [{ url: old.url, error: expect.any(NoteConflictError) }],
  });
  expect((await s.store.read(old.url))?.body).toBe("Keep");
});

it("rolls back the stale destination on a concurrent source edit without a verification read", async () => {
  const s = await fixture();
  const original = await s.store.create({ title: "Concurrent", body: "Old content" });
  const edited = await s.store.save(original, { body: "New content" }, original.etag);
  s.calls.length = 0;
  await expect(s.store.archive(original)).rejects.toBeInstanceOf(NoteConflictError);
  expect(s.calls.filter((call) => call.method === "GET")).toEqual([]);
  expect(await s.store.read(original.url)).toEqual(edited);
  expect(s.pod.has(`${ROOT}archive/concurrent.ttl`)).toBe(false);
});

it.each([
  "transport",
  "http",
  "redirect",
])("rolls back a failed, uncommitted source delete (%s)", async (failure) => {
  const s = await fixture();
  const original = await s.store.create();
  s.calls.length = 0;
  s.intercept(async (url, init) => {
    if (url !== original.url || init?.method !== "DELETE") return;
    if (failure === "transport") throw new TypeError("Offline");
    if (failure === "redirect")
      return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
    return new Response(null, { status: 403 });
  });
  await expect(s.store.archive(original)).rejects.toBeInstanceOf(
    failure === "transport"
      ? TypeError
      : failure === "redirect"
        ? RedirectRefusedError
        : ResourceDeleteError,
  );
  expect(s.calls.filter((call) => call.method === "GET")).toHaveLength(failure === "http" ? 0 : 1);
  expect(s.pod.has(original.url)).toBe(true);
  expect(s.pod.has(`${ROOT}archive/note.ttl`)).toBe(false);
});

it("verifies a transport that rejects without an Error and rolls back its uncommitted copy", async () => {
  const s = await fixture();
  const original = await s.store.create();
  s.calls.length = 0;
  s.intercept(async (url, init) => {
    if (url === original.url && init?.method === "DELETE") return Promise.reject();
  });
  await expect(s.store.archive(original)).rejects.toBeUndefined();
  expect(s.calls.filter((call) => call.method === "GET")).toHaveLength(1);
  expect(s.pod.has(original.url)).toBe(true);
  expect(s.pod.has(`${ROOT}archive/note.ttl`)).toBe(false);
});
