// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.2-Astra
import { Container, Resource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { buildDocument } from "../src/apps/docs/lib/model/document";
import { serializeTurtle, writeRdf } from "../src/apps/docs/lib/model/rdf-io";
import {
  ImageCleanupBlockedError,
  NoteImageCleanup,
  planUnusedNoteImages,
  storedDraftTexts,
} from "../src/apps/notes/lib/image-cleanup";
import { buildNote, type Note, parseNote } from "../src/apps/notes/lib/model/note";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import "./drive-ui-dom";

const POD = "https://cleanup.example/alice/";
const MEDIA = `${POD}notes/media/`;
const IMAGE = `${MEDIA}bird.png`;
const img = (url = IMAGE) => `<img src="${url}" alt="Bird">`;
const note = (body: string, location = "active" as Note["location"]): Note => {
  const url = `${POD}notes/${location === "active" ? "" : location === "archived" ? "archive/" : ".trash/"}note.ttl`;
  return parseNote(url, buildNote(url, { title: "", body }), location) as Note;
};

it("plans only unreferenced media, preserving images in any folder and retained history", () => {
  const revision = `${MEDIA}history.png`;
  const archived = `${MEDIA}archived.png`;
  const trash = `${MEDIA}trash.png`;
  const shared = note(img());
  shared.revisions = [
    { ...(shared.revisions[0] as Note["revisions"][number]), body: img(revision) },
  ];
  expect(
    planUnusedNoteImages(
      POD,
      [IMAGE, revision, archived, trash, `${MEDIA}unused.png`, `${MEDIA}unused.png`],
      [shared, note(img()), note(img(archived), "archived"), note(img(trash), "trashed")],
    ),
  ).toEqual([`${MEDIA}unused.png`]);
  expect(planUnusedNoteImages(POD, [], [])).toEqual([]);
});

it("protects relative, escaped and percent-encoded references, including query/hash aliases", () => {
  expect(
    planUnusedNoteImages(
      POD,
      [IMAGE, `${MEDIA}a&b.png`],
      [note('<img src="media/%62ird.png?download=1#preview"><img src="media/a&amp;b.png"><img>')],
    ),
  ).toEqual([]);
});

it.each([
  "https://elsewhere.example/notes/media/a.png",
  `${POD}docs/a/assets/image.png`,
  `${POD}notes/media-other/a.png`,
  `${MEDIA}../private.png`,
  `${MEDIA}nested/a.png`,
  `${MEDIA}nested%2fa.png`,
  `${MEDIA}a%255cb.png`,
  `${MEDIA}a.png?query`,
  `${MEDIA}a.png#fragment`,
  `${MEDIA}a.png.acl`,
  `${MEDIA}a.png.ACR`,
  `${MEDIA}a.png.a%63l`,
  `${MEDIA}a.png%2eacr`,
  MEDIA,
  "not a URL",
])("never plans an out-of-scope file or access document: %s", (url) => {
  expect(planUnusedNoteImages(POD, [url], [])).toEqual([]);
});

it("fails closed for unreadable notes and absent DOM support", () => {
  expect(() => planUnusedNoteImages(POD, [IMAGE], [undefined])).toThrow("could not be read");
  const browser = window;
  try {
    vi.stubGlobal("window", undefined);
    expect(() => planUnusedNoteImages(POD, [IMAGE], [])).toThrow("needs a browser");
  } finally {
    vi.stubGlobal("window", browser);
  }
});

const DAY = 24 * 60 * 60 * 1000;
afterEach(() => vi.useRealTimers());
it("never blocks on a malformed img src, but a malformed src naming an image protects it (C4)", () => {
  const bad = [note('<img src="http://["><img src="media/bad%xx">')];
  expect(planUnusedNoteImages(POD, [IMAGE], bad)).toEqual([IMAGE]);
  expect(
    planUnusedNoteImages(POD, [IMAGE], [note('<img src="http://[/notes/media/bird.png">')]),
  ).toEqual([]);
  expect(planUnusedNoteImages(POD, [IMAGE], [note('<img src="media/bird.png%xx">')], [])).toEqual(
    [],
  );
});

async function fixture() {
  // Images are written two days in the past, so the 24 hour grace period has expired.
  vi.useFakeTimers({ toFake: ["Date"] });
  const present = Date.now();
  const pod = createDemoPod({ root: POD });
  const override = vi.fn<(url: string, init?: RequestInit) => Promise<Response | undefined>>();
  const http = vi.fn<typeof fetch>(
    async (input, init) => (await override(String(input), init)) ?? pod.fetch(input, init),
  );
  const store = createNotesStore({ fetch: http, podRoot: POD, webId: `${POD}#me` });
  await store.create({ title: "Plain note" });
  const putAt = async (age: number, url: string, body = "pixels", type = "image/png") => {
    vi.setSystemTime(present - age);
    try {
      await pod.fetch(url, { method: "PUT", headers: { "content-type": type }, body });
    } finally {
      vi.setSystemTime(present);
    }
  };
  const put = (url: string, body = "pixels", type = "image/png") => putAt(2 * DAY, url, body, type);
  await put(IMAGE);
  const addNote = async (url: string, body: string) => {
    await writeRdf(url, buildNote(url, { title: "", body }), {
      createOnly: true,
      fetchImpl: pod.fetch,
    });
  };
  http.mockClear();
  return { pod, http, override, store, put, putAt, addNote };
}
const deletes = (http: ReturnType<typeof vi.fn<typeof fetch>>) =>
  http.mock.calls.filter(([, init]) => init?.method === "DELETE");

it("dry-runs count/size without mutations, then conditionally deletes an unreferenced image", async () => {
  const { store, http } = await fixture();
  const plan = await store.imageCleanup.scan();
  expect(plan).toEqual({
    images: [{ url: IMAGE, bytes: 6, etag: expect.stringMatching(/^"/) }],
    totalBytes: 6,
    recent: 0,
  });
  expect(deletes(http)).toEqual([]);
  http.mockClear();
  expect(await store.imageCleanup.delete(plan)).toEqual({ deleted: 1, kept: 0, failed: 0 });
  expect(deletes(http)).toEqual([
    [
      IMAGE,
      {
        method: "DELETE",
        redirect: "manual",
        cache: "no-store",
        headers: { "if-match": plan.images[0]?.etag },
      },
    ],
  ]);
  // notes/media/, notes/, archive/, .trash/, docs/ and pod-docs/ plus the pod-level Drive trash.
  expect(http.mock.calls.filter(([url]) => String(url).endsWith("/"))).toHaveLength(6);
  for (const [, init] of http.mock.calls) expect(init?.redirect).toBe("manual");
});

it("reads active, archive and trash notes afresh, preserving images shared by copies", async () => {
  const { store, http, put, addNote } = await fixture();
  const archived = `${MEDIA}archived.png`;
  const trashed = `${MEDIA}trashed.png`;
  await put(archived);
  await put(trashed);
  await addNote(`${POD}notes/copy.ttl`, img());
  await addNote(`${POD}notes/second-copy.ttl`, img());
  await addNote(`${POD}notes/archive/archived.ttl`, img(archived));
  await addNote(`${POD}notes/.trash/trashed.ttl`, img(trashed));
  expect(await store.imageCleanup.scan()).toEqual({ images: [], totalBytes: 0, recent: 0 });
  expect(deletes(http)).toEqual([]);
});

it.each([
  "notes/",
  "notes/archive/",
  "notes/.trash/",
])("aborts before any delete if a note in %s cannot be read", async (path) => {
  const { store, http, override, addNote } = await fixture();
  const plan = await store.imageCleanup.scan();
  const url = `${POD}${path}broken.ttl`;
  await addNote(url, img());
  override.mockImplementation(async (target) =>
    target === url ? new Response(null, { status: 403 }) : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow();
  await expect(store.imageCleanup.delete(plan)).rejects.toThrow();
  expect(deletes(http)).toEqual([]);
});

it("accepts a typed empty BasicContainer without ldp:contains", async () => {
  const { store, override } = await fixture();
  const container = `${POD}notes/archive/`;
  const dataset = new Store();
  new Container(container, dataset, DataFactory).type.add(
    "http://www.w3.org/ns/ldp#BasicContainer",
  );
  const body = await serializeTurtle(dataset);
  override.mockImplementation(async (url) =>
    url === container
      ? new Response(body, { headers: { "content-type": "text/turtle" } })
      : undefined,
  );
  expect((await store.imageCleanup.scan()).images).toHaveLength(1);
});

it("rejects a listing whose membership belongs to another container", async () => {
  const { store, override } = await fixture();
  const dataset = new Store();
  const container = new Container(`${POD}other/`, dataset, DataFactory);
  container.contains.add(new Resource(`${POD}other/note.ttl`, dataset, DataFactory));
  const body = await serializeTurtle(dataset);
  override.mockImplementation(async (url) =>
    url === `${POD}notes/`
      ? new Response(body, { headers: { "content-type": "text/turtle" } })
      : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow("folder could not be checked");
});

it("aborts when a folder cannot be listed", async () => {
  const { store, override, http } = await fixture();
  const plan = await store.imageCleanup.scan();
  override.mockImplementation(async (url) =>
    url === `${POD}notes/.trash/` ? new Response(null, { status: 403 }) : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow();
  await expect(store.imageCleanup.delete(plan)).rejects.toThrow();
  expect(deletes(http)).toEqual([]);
});

it("aborts if a listed note disappears or is not a readable note", async () => {
  const { store, http, put } = await fixture();
  await put(`${POD}notes/malformed.ttl`, "", "text/turtle");
  await expect(store.imageCleanup.scan()).rejects.toThrow("could not be read");
  expect(deletes(http)).toEqual([]);
});

it.each([404, 410])("treats a missing collection as empty (%s)", async (status) => {
  const { store, override } = await fixture();
  override.mockImplementation(async (url) =>
    url.endsWith("/") ? new Response(null, { status }) : undefined,
  );
  expect(await store.imageCleanup.scan()).toEqual({ images: [], totalBytes: 0, recent: 0 });
});

it.each([
  "",
  "@prefix ldp: <http://www.w3.org/ns/ldp#>. <https://other.example/> a ldp:BasicContainer.",
])("fails closed for malformed or mismatched container listings", async (body) => {
  const { store, override, http } = await fixture();
  override.mockImplementation(async (url) =>
    url === `${POD}notes/`
      ? new Response(body, { headers: { "content-type": "text/turtle" } })
      : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow("folder could not be checked");
  expect(deletes(http)).toEqual([]);
});

it("ignores folders, non-direct children and access documents in listings", async () => {
  const { store, override } = await fixture();
  const url = `${POD}notes/`;
  const dataset = new Store();
  const container = new Container(url, dataset, DataFactory);
  container.type.add("http://www.w3.org/ns/ldp#BasicContainer");
  for (const member of [
    `${url}media/`,
    `${url}nested/note.ttl`,
    `${url}orphan.acl`,
    `${url}orphan.acr`,
  ])
    container.contains.add(new Resource(member, dataset, DataFactory));
  const body = await serializeTurtle(dataset);
  override.mockImplementation(async (target) =>
    target === url ? new Response(body, { headers: { "content-type": "text/turtle" } }) : undefined,
  );
  expect((await store.imageCleanup.scan()).images).toHaveLength(1);
});

it.each([
  null,
  "",
  "-1",
  "six",
  "1.5",
  "9007199254740992",
])("fails the dry-run when a media size cannot be determined (%s)", async (length) => {
  const { store, override } = await fixture();
  override.mockImplementation(async (_url, init) =>
    init?.method === "HEAD"
      ? new Response(null, {
          headers: {
            "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
            ...(length === null ? {} : { "content-length": length }),
          },
        })
      : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow("size could not be checked");
});

it("fails a dry-run if image metadata cannot be read", async () => {
  const { store, override } = await fixture();
  override.mockImplementation(async (_url, init) =>
    init?.method === "HEAD" ? new Response(null, { status: 403 }) : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow("image could not be checked");
});

it.each([
  null,
  'W/"weak"',
])("refuses deletion without a strong scanned validator (%s)", async (etag) => {
  const { store, http } = await fixture();
  const plan = await store.imageCleanup.scan();
  expect(
    await store.imageCleanup.delete({
      ...plan,
      images: [{ ...(plan.images[0] as (typeof plan.images)[number]), etag }],
    }),
  ).toEqual({ deleted: 0, kept: 0, failed: 1, stopped: "failed" });
  expect(deletes(http)).toEqual([]);
});

it("rejects a forged plan in full before deleting any valid image", async () => {
  const { store, http } = await fixture();
  const plan = await store.imageCleanup.scan();
  for (const url of [`${POD}secret.png`, `${IMAGE}.acl`]) {
    await expect(
      store.imageCleanup.delete({
        ...plan,
        images: [...plan.images, { url, bytes: 1, etag: '"v1"' }],
      }),
    ).rejects.toThrow("inside Notes media");
  }
  expect(deletes(http)).toEqual([]);
  expect(await store.imageCleanup.delete({ images: [], totalBytes: 0 })).toEqual({
    deleted: 0,
    kept: 0,
    failed: 0,
  });
});

it("keeps a newly referenced image after confirmation, even with an image ACL", async () => {
  const { store, http, put, addNote } = await fixture();
  await put(`${IMAGE}.acl`, "", "text/turtle");
  const plan = await store.imageCleanup.scan();
  await addNote(`${POD}notes/archive/shared-copy.ttl`, img());
  expect(await store.imageCleanup.delete(plan)).toEqual({ deleted: 0, kept: 1, failed: 0 });
  expect(deletes(http)).toEqual([]);
});

it("rescans every note once before the batch and only deletes images from the plan", async () => {
  const { store, http, put, addNote } = await fixture();
  const second = `${MEDIA}second.png`;
  await put(second);
  await addNote(`${POD}notes/archive/archived.ttl`, "Archived");
  await addNote(`${POD}notes/.trash/trashed.ttl`, "Trashed");
  const plan = await store.imageCleanup.scan();
  await put(`${MEDIA}later.png`);
  const noteReads = http.mock.calls.filter(
    ([url, init]) => !init?.method && !String(url).endsWith("/"),
  );
  expect(noteReads).toHaveLength(3);
  http.mockClear();
  expect(await store.imageCleanup.delete(plan)).toEqual({ deleted: 2, kept: 0, failed: 0 });
  expect(deletes(http).map(([url]) => url)).toEqual(plan.images.map((image) => image.url));
  // The complete rescan comes first (8 listings and notes, plus the pod-level Drive trash);
  // each image is then re-checked with a HEAD immediately before its own DELETE.
  const reads = http.mock.calls.filter(
    ([, init]) => !["DELETE", "HEAD"].includes(init?.method ?? ""),
  );
  expect(reads).toHaveLength(9);
  expect(reads.filter(([url]) => !String(url).endsWith("/"))).toEqual(noteReads);
  expect(http.mock.calls.slice(0, 9)).toEqual(reads);
  expect(http.mock.calls.filter(([, init]) => init?.method === "HEAD")).toHaveLength(2);
  for (const [url, init] of deletes(http)) {
    expect(init?.headers).toEqual({
      "if-match": plan.images.find((image) => image.url === url)?.etag,
    });
  }
});

it("keeps a changed image on 412 and continues deleting the rest of the batch", async () => {
  const { store, http, put, pod } = await fixture();
  await put(`${MEDIA}second.png`);
  const plan = await store.imageCleanup.scan();
  await put(IMAGE, "replacement");
  expect(await store.imageCleanup.delete(plan)).toEqual({ deleted: 1, kept: 1, failed: 0 });
  expect(deletes(http)).toHaveLength(2);
  expect((await pod.fetch(IMAGE)).status).toBe(200);
});

it.each([404, 410])("continues after an already missing image (%s)", async (status) => {
  const { store, http, put, override } = await fixture();
  await put(`${MEDIA}second.png`);
  const plan = await store.imageCleanup.scan();
  override.mockImplementation(async (url, init) =>
    url === plan.images[0]?.url && init?.method === "DELETE"
      ? new Response(null, { status })
      : undefined,
  );
  expect(await store.imageCleanup.delete(plan)).toEqual({ deleted: 2, kept: 0, failed: 0 });
  expect(deletes(http)).toHaveLength(2);
});

it.each([
  403,
  500,
  "network",
] as const)("stops on a failed delete and reports partial counts (%s)", async (failure) => {
  const { store, http, put, addNote, override } = await fixture();
  for (const name of ["second.png", "third.png", "fourth.png"]) await put(`${MEDIA}${name}`);
  const plan = await store.imageCleanup.scan();
  const [referenced, deleted, failed] = plan.images;
  await addNote(`${POD}notes/copy.ttl`, img(referenced?.url));
  override.mockImplementation(async (url, init) => {
    if (url !== failed?.url || init?.method !== "DELETE") return undefined;
    if (failure === "network") throw new TypeError("Failed to fetch");
    return new Response(null, { status: failure });
  });
  expect(await store.imageCleanup.delete(plan)).toEqual({
    deleted: 1,
    kept: 1,
    failed: 1,
    stopped: "failed",
  });
  expect(deletes(http).map(([url]) => url)).toEqual([deleted?.url, failed?.url]);
});

it("does no I/O if offline before confirmation", async () => {
  const { store, http } = await fixture();
  const plan = await store.imageCleanup.scan();
  http.mockClear();
  expect(await store.imageCleanup.delete(plan, () => false)).toEqual({
    deleted: 0,
    kept: 0,
    failed: 0,
    stopped: "offline",
  });
  expect(http).not.toHaveBeenCalled();
});

it.each([
  "listing",
  "note",
  "last listing",
])("stops before deletion when going offline during a rescan %s", async (source) => {
  const { store, http, override } = await fixture();
  const plan = await store.imageCleanup.scan();
  const target =
    source === "note"
      ? (await store.list("active"))[0]?.url
      : `${POD}notes/${source === "last listing" ? ".trash/" : ""}`;
  http.mockClear();
  let online = true;
  override.mockImplementation(async (url) => {
    if (url === target) online = false;
    return undefined;
  });
  expect(await store.imageCleanup.delete(plan, () => online)).toEqual({
    deleted: 0,
    kept: 0,
    failed: 0,
    stopped: "offline",
  });
  expect(deletes(http)).toEqual([]);
  expect(http).toHaveBeenCalledTimes(source === "listing" ? 1 : source === "note" ? 2 : 4);
});

it("reports an in-flight failure caused by going offline and stops the batch", async () => {
  const { store, http, override, put } = await fixture();
  await put(`${MEDIA}second.png`);
  const plan = await store.imageCleanup.scan();
  let online = true;
  override.mockImplementation(async (_url, init) => {
    if (init?.method === "DELETE") {
      online = false;
      throw new TypeError("Offline");
    }
    return undefined;
  });
  expect(await store.imageCleanup.delete(plan, () => online)).toEqual({
    deleted: 0,
    kept: 0,
    failed: 1,
    stopped: "offline",
  });
  expect(deletes(http)).toHaveLength(1);
});

it("stops between deletes when going offline and reports completed work", async () => {
  const { store, http, put, override } = await fixture();
  await put(`${MEDIA}second.png`);
  const plan = await store.imageCleanup.scan();
  const online = vi.spyOn(navigator, "onLine", "get");
  try {
    override.mockImplementation(async (_url, init) => {
      if (init?.method === "DELETE") online.mockReturnValue(false);
      return undefined;
    });
    expect(await store.imageCleanup.delete(plan)).toEqual({
      deleted: 1,
      kept: 0,
      failed: 0,
      stopped: "offline",
    });
    expect(deletes(http)).toHaveLength(1);
  } finally {
    online.mockRestore();
  }
});

it("does not independently delete ACLs, including on servers retaining the auxiliary file", async () => {
  const { store, http, put, pod } = await fixture();
  await put(`${IMAGE}.acl`, "", "text/turtle");
  const plan = await store.imageCleanup.scan();
  await store.imageCleanup.delete(plan);
  expect(deletes(http).map(([url]) => url)).toEqual([IMAGE]);
  expect((await pod.fetch(IMAGE, { method: "HEAD" })).status).toBe(404);
  const remaining = `${IMAGE}.acl`;
  await put(remaining, "", "text/turtle");
  expect((await store.imageCleanup.scan()).images).toEqual([]);
});

it("propagates failed note reads instead of turning them into an empty reference set", async () => {
  const { pod } = await fixture();
  const cleanup = new NoteImageCleanup({
    podRoot: POD,
    fetch: pod.fetch,
    readNote: async () => {
      throw new Error("Offline");
    },
  });
  await expect(cleanup.scan()).rejects.toThrow("Offline");
});

it("keeps images that Docs converted from notes still reference, and fails closed on unreadable Docs", async () => {
  const { store, pod, override } = await fixture();
  const kept = `${MEDIA}in-doc.png`;
  const revised = `${MEDIA}in-doc-revision.png`;
  await pod.fetch(kept, { method: "PUT", headers: { "content-type": "image/png" }, body: "px" });
  await pod.fetch(revised, { method: "PUT", headers: { "content-type": "image/png" }, body: "px" });
  const doc = `${POD}docs/from-note.ttl`;
  await writeRdf(
    doc,
    buildDocument(doc, {
      title: "From a note",
      body: `<p><img src="${kept}"></p>`,
      priorRevisions: [
        {
          id: `${doc}#rev-1`,
          body: `<img src="${revised}">`,
          format: "text/html",
          generatedAt: new Date(0).toISOString(),
        },
      ],
    }),
    { createOnly: true, fetchImpl: pod.fetch },
  );
  await pod.fetch(`${POD}docs/notes.txt`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: "<#a> <#b> <#c> .",
  });
  const plan = await store.imageCleanup.scan();
  expect(plan.images.map((image) => image.url)).toEqual([IMAGE]);
  override.mockImplementation(async (url) =>
    url === doc ? new Response(null, { status: 403 }) : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow();
});

const urls = (plan: { images: readonly { url: string }[] }) =>
  plan.images.map((image) => image.url);

it("never offers an image changed in the last 24 hours, or one with no usable Last-Modified (C1b)", async () => {
  const { store, put, putAt, override } = await fixture();
  await putAt(60 * 60 * 1000, `${MEDIA}fresh.png`);
  await putAt(DAY - 60_000, `${MEDIA}almost.png`);
  await put(`${MEDIA}old.png`);
  const plan = await store.imageCleanup.scan();
  expect(urls(plan).sort()).toEqual([IMAGE, `${MEDIA}old.png`].sort());
  expect(plan.recent).toBe(2);
  for (const header of [null, "not a date"]) {
    override.mockImplementation(async (_url, init) =>
      init?.method === "HEAD"
        ? new Response(null, {
            headers: {
              "content-length": "6",
              ...(header === null ? {} : { "last-modified": header }),
            },
          })
        : undefined,
    );
    expect(await store.imageCleanup.scan()).toEqual({ images: [], totalBytes: 0, recent: 4 });
  }
});

it("keeps images that an unsaved draft in this or any other tab references (C1a)", async () => {
  const { store, put } = await fixture();
  await put(`${MEDIA}other-tab.png`);
  await put(`${MEDIA}memory.png`);
  localStorage.setItem(
    `suite.notes.pending-drafts.${POD}#me:${POD}notes/x.ttl:another-tab`,
    JSON.stringify({ snapshot: { draft: { body: `<img src="${IMAGE}">` } } }),
  );
  localStorage.setItem("notes-capture-draft:tab", `<img src='${MEDIA}other-tab.png'>`);
  try {
    expect(urls(await store.imageCleanup.scan(() => [`<img src="${MEDIA}memory.png">`]))).toEqual(
      [],
    );
    localStorage.clear();
    expect(
      urls(await store.imageCleanup.scan(() => [`<img src="${MEDIA}memory.png">`])).sort(),
    ).toEqual([IMAGE, `${MEDIA}other-tab.png`].sort());
  } finally {
    localStorage.clear();
  }
});

it("fails closed when unsaved drafts cannot be read", async () => {
  const { store } = await fixture();
  localStorage.setItem("suite.notes.pending-drafts.x", "y");
  const getItem = vi
    .spyOn(Object.getPrototypeOf(localStorage), "getItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  try {
    await expect(store.imageCleanup.scan()).rejects.toThrow("Unsaved drafts couldn't be checked");
  } finally {
    getItem.mockRestore();
    localStorage.clear();
  }
});

it("returns no stored draft texts when localStorage is unavailable", () => {
  const storage = localStorage;
  try {
    vi.stubGlobal("localStorage", undefined);
    expect(storedDraftTexts()).toEqual([]);
  } finally {
    vi.stubGlobal("localStorage", storage);
  }
});

it("reads only draft keys and skips a draft removed since enumeration", () => {
  const removed = "suite.notes.pending-drafts.removed";
  const unrelated = "suite.settings";
  localStorage.setItem(removed, "old draft");
  localStorage.setItem(unrelated, "preferences");
  localStorage.setItem("notes-capture-draft:tab", "capture text");
  const getItem = localStorage.getItem.bind(localStorage);
  const read = vi
    .spyOn(Object.getPrototypeOf(localStorage) as Storage, "getItem")
    .mockImplementation((key: string) => {
      if (key === removed) localStorage.removeItem(key);
      return getItem(key);
    });
  try {
    expect(storedDraftTexts()).toEqual(["capture text"]);
    expect(read).not.toHaveBeenCalledWith(unrelated);
  } finally {
    read.mockRestore();
    localStorage.clear();
  }
});

it("re-checks drafts and age immediately before each delete (C1c)", async () => {
  const { store, put, http, override } = await fixture();
  await put(`${MEDIA}second.png`);
  await put(`${MEDIA}third.png`);
  const plan = await store.imageCleanup.scan();
  expect(plan.images).toHaveLength(3);
  http.mockClear();
  // A draft starts using the second image after the batch's rescan.
  let calls = 0;
  override.mockImplementation(async (url, init) => {
    // The third image was just replaced by a fresh upload at the same URL.
    if (init?.method === "HEAD" && url === `${MEDIA}third.png`)
      return new Response(null, {
        headers: { etag: '"x"', "last-modified": new Date().toUTCString() },
      });
    return undefined;
  });
  const result = await store.imageCleanup.delete(
    plan,
    () => true,
    () => {
      calls++;
      // Calls 1 is the batch rescan; each image then checks once more.
      return calls >= 3 ? [`<img src="${MEDIA}second.png">`] : [];
    },
  );
  expect(result).toEqual({ deleted: 1, kept: 2, failed: 0 });
  expect(deletes(http).map(([url]) => url)).toEqual([IMAGE]);
});

it("treats a missing notes/ folder next to existing media as a fault, not as no notes (C3)", async () => {
  const { store, override } = await fixture();
  override.mockImplementation(async (url) =>
    url === `${POD}notes/` ? new Response(null, { status: 404 }) : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow("Notes folder couldn't be found");
  await expect(store.imageCleanup.scan()).rejects.toBeInstanceOf(ImageCleanupBlockedError);
});

it("keeps the image when the pre-delete HEAD fails", async () => {
  const { store, override, http } = await fixture();
  const plan = await store.imageCleanup.scan();
  http.mockClear();
  override.mockImplementation(async (url, init) =>
    url === IMAGE && init?.method === "HEAD" ? new Response(null, { status: 403 }) : undefined,
  );
  expect(await store.imageCleanup.delete(plan)).toEqual({ deleted: 0, kept: 1, failed: 0 });
  expect(http).toHaveBeenCalledWith(IMAGE, expect.objectContaining({ method: "HEAD" }));
  expect(deletes(http)).toEqual([]);
});

it("names the file that blocks clean-up when a note cannot be read (C4)", async () => {
  const { pod } = await fixture();
  const cleanup = new NoteImageCleanup({
    podRoot: POD,
    fetch: pod.fetch,
    readNote: async () => undefined,
  });
  await expect(cleanup.scan()).rejects.toThrow(/Check or remove notes\/plain-note\.ttl/);
});

async function withDocsHistory(path: string, body: string) {
  const f = await fixture();
  const doc = `${POD}docs/history.ttl`;
  await writeRdf(doc, buildDocument(doc, { title: "History", body: "<p>now</p>" }), {
    createOnly: true,
    fetchImpl: f.pod.fetch,
  });
  await f.pod.fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body,
  });
  return f;
}

async function listingBody(url: string, members: readonly string[]) {
  const dataset = new Store();
  const container = new Container(url, dataset, DataFactory);
  for (const member of members) container.contains.add(new Resource(member, dataset, DataFactory));
  return serializeTurtle(dataset);
}

it("checks shared history folders only once and keeps images named there", async () => {
  const { store, pod, override, put, http } = await fixture();
  const docs = `${POD}docs/`;
  // These two listed identifiers resolve to the same history layout.
  const documents = [`${docs}history.ttl?`, `${docs}history..ttl`];
  for (const url of documents) {
    await writeRdf(url, buildDocument(url, { title: "History", body: "" }), {
      createOnly: true,
      fetchImpl: pod.fetch,
    });
  }
  const versions = `${docs}history./versions/`;
  const snapshot = `${versions}v1.bin`;
  await put(snapshot, "bird.png", "application/octet-stream");
  const listing = await listingBody(docs, documents);
  override.mockImplementation(async (url) =>
    url === docs
      ? new Response(listing, { headers: { "content-type": "text/turtle" } })
      : undefined,
  );
  expect(urls(await store.imageCleanup.scan())).toEqual([]);
  for (const url of [...documents, versions, snapshot])
    expect(http.mock.calls.filter(([input]) => input === url)).toHaveLength(1);
});

it("stops before reading a 2,001st history file", async () => {
  const { store, override, http } = await fixture();
  const trash = `${POD}.trash/`;
  const files = Array.from({ length: 2001 }, (_, index) => `${trash}entry-${index}`);
  const listing = await listingBody(trash, files);
  override.mockImplementation(async (url) => {
    if (url === trash) return new Response(listing, { headers: { "content-type": "text/turtle" } });
    if (url.startsWith(trash)) return new Response(null);
    return undefined;
  });
  await expect(store.imageCleanup.scan()).rejects.toThrow("too much Docs history");
  expect(http.mock.calls.filter(([url]) => String(url).startsWith(`${trash}entry-`))).toHaveLength(
    2000,
  );
});

it("blocks cleanup when individually allowed history files exceed 64 MiB together", async () => {
  const { store, override, http } = await fixture();
  const trash = `${POD}.trash/`;
  const files = Array.from({ length: 9 }, (_, index) => `${trash}entry-${index}`);
  const listing = await listingBody(trash, files);
  const chunk = new Blob([new Uint8Array(8 * 1024 * 1024)]);
  override.mockImplementation(async (url) => {
    if (url === trash) return new Response(listing, { headers: { "content-type": "text/turtle" } });
    if (url.startsWith(trash)) return new Response(url === files[8] ? "x" : chunk);
    return undefined;
  });
  await expect(store.imageCleanup.scan()).rejects.toMatchObject({
    name: "ImageCleanupBlockedError",
    message: expect.stringContaining("too much Docs history"),
  });
  expect(http.mock.calls.filter(([url]) => String(url).startsWith(`${trash}entry-`))).toHaveLength(
    9,
  );
});

it.each([
  ["a Docs version snapshot", `${POD}docs/history/versions/v1.bin`],
  ["a Docs update log entry", `${POD}docs/history/updates/u1.bin`],
  ["Drive's trash", `${POD}.trash/abc/old-note.ttl`],
])("keeps an image named in %s (C2)", async (_name, path) => {
  const { store } = await withDocsHistory(path, `\u0001\u0002 ${MEDIA}bird.png \u0003`);
  expect(urls(await store.imageCleanup.scan())).toEqual([]);
});

it("offers the image when Docs history does not mention it, and fails closed when that history cannot be read (C2)", async () => {
  const { store, override } = await withDocsHistory(
    `${POD}docs/history/versions/v1.bin`,
    "other.png",
  );
  expect(urls(await store.imageCleanup.scan())).toEqual([IMAGE]);
  override.mockImplementation(async (url) =>
    url === `${POD}docs/history/versions/v1.bin` ? new Response(null, { status: 403 }) : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow("couldn't be read");
  override.mockImplementation(async (url) =>
    url === `${POD}docs/history/versions/` ? new Response(null, { status: 500 }) : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow("couldn't be checked for images");
  override.mockImplementation(async (url) =>
    url === `${POD}docs/history/versions/v1.bin`
      ? new Response("x", { headers: { "content-length": String(9 * 1024 * 1024) } })
      : undefined,
  );
  await expect(store.imageCleanup.scan()).rejects.toThrow("too much Docs history");
});
