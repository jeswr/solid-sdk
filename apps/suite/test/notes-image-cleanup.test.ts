// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Container, Resource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import { serializeTurtle, writeRdf } from "../src/apps/docs/lib/model/rdf-io";
import { NoteImageCleanup, planUnusedNoteImages } from "../src/apps/notes/lib/image-cleanup";
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

it("fails closed for unreadable notes, unparseable references and absent DOM support", () => {
  expect(() => planUnusedNoteImages(POD, [IMAGE], [undefined])).toThrow("could not be read");
  expect(() => planUnusedNoteImages(POD, [IMAGE], [note('<img src="http://[">')])).toThrow();
  expect(() => planUnusedNoteImages(POD, [IMAGE], [note('<img src="media/bad%xx">')])).toThrow();
  const browser = window;
  try {
    vi.stubGlobal("window", undefined);
    expect(() => planUnusedNoteImages(POD, [IMAGE], [])).toThrow("needs a browser");
  } finally {
    vi.stubGlobal("window", browser);
  }
});

async function fixture() {
  const pod = createDemoPod({ root: POD });
  const override = vi.fn<(url: string, init?: RequestInit) => Promise<Response | undefined>>();
  const http = vi.fn<typeof fetch>(
    async (input, init) => (await override(String(input), init)) ?? pod.fetch(input, init),
  );
  const store = createNotesStore({ fetch: http, podRoot: POD, webId: `${POD}#me` });
  await store.create({ title: "Plain note" });
  const put = async (url: string, body = "pixels", type = "image/png") => {
    await pod.fetch(url, { method: "PUT", headers: { "content-type": type }, body });
  };
  await put(IMAGE);
  const addNote = async (url: string, body: string) => {
    await writeRdf(url, buildNote(url, { title: "", body }), {
      createOnly: true,
      fetchImpl: pod.fetch,
    });
  };
  http.mockClear();
  return { pod, http, override, store, put, addNote };
}
const deletes = (http: ReturnType<typeof vi.fn<typeof fetch>>) =>
  http.mock.calls.filter(([, init]) => init?.method === "DELETE");

it("dry-runs count/size without mutations, then conditionally deletes an unreferenced image", async () => {
  const { store, http } = await fixture();
  const plan = await store.imageCleanup.scan();
  expect(plan).toEqual({
    images: [{ url: IMAGE, bytes: 6, etag: expect.stringMatching(/^"/) }],
    totalBytes: 6,
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
  expect(http.mock.calls.filter(([url]) => String(url).endsWith("/"))).toHaveLength(3);
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
  expect(await store.imageCleanup.scan()).toEqual({ images: [], totalBytes: 0 });
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
  expect(await store.imageCleanup.scan()).toEqual({ images: [], totalBytes: 0 });
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
      ? new Response(null, { headers: length === null ? {} : { "content-length": length } })
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
  const reads = http.mock.calls.filter(([, init]) => init?.method !== "DELETE");
  expect(reads).toHaveLength(6);
  expect(reads.filter(([url]) => !String(url).endsWith("/"))).toEqual(noteReads);
  expect(http.mock.calls.slice(0, 6)).toEqual(reads);
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
