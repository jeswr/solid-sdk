// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { SolidPersistence, SolidUpdateStore } from "@jeswr/y-solid";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { currentDraftId, listLocalDrafts } from "../src/apps/docs/editor/drafts";
import { rowExportJson } from "../src/apps/docs/editor/export-document";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { deleteDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { buildDocument, type StoredDocument, writeRdf } from "../src/apps/docs/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
const runtimes: DocumentPersistence[] = [];
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("Blob", NodeBlob);
});
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.online = false;
    await runtime.destroy();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const json = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
function edit(runtime: DocumentPersistence, content: JSONContent) {
  const fragment = runtime.doc.getXmlFragment("prosemirror");
  fragment.delete(0, fragment.length);
  const extensions = baseExtensions(runtime.session.fetch);
  const seed = prosemirrorJSONToYDoc(getSchema(extensions), content);
  applyUpdate(runtime.doc, encodeStateAsUpdate(seed));
  seed.destroy();
  runtime.change(generateHTML(content, extensions), content);
}
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session: PodSession = {
    mode: "demo",
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    displayName: DEMO_NAME,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const client = (draftId?: string, account = session) => {
    const runtime = new DocumentPersistence(account, draftId);
    runtimes.push(runtime);
    return runtime;
  };
  const create = async (text: string, title = "Plan") => {
    const runtime = client();
    await runtime.open();
    runtime.title = title;
    edit(runtime, json(text));
    await runtime.flush();
    expect(runtime.state).toBe("saved");
    return runtime;
  };
  return { pod, session, client, create };
}
async function replay(stored: StoredDocument, session: PodSession) {
  const doc = new Doc();
  try {
    for (const { update } of await new SolidUpdateStore({
      container: stored.data.updateLog as string,
      fetch: session.fetch,
    }).loadUpdates())
      applyUpdate(doc, update);
    return yDocToProsemirrorJSON(doc);
  } finally {
    doc.destroy();
  }
}
async function legacy(runtime: DocumentPersistence, updateLog?: string) {
  const created = await runtime.store.create({ title: "Legacy", body: "<p>Original</p>" });
  await writeRdf(
    created.url,
    buildDocument(created.url, {
      ...created.data,
      instanceId: undefined,
      ...(updateLog ? { updateLog } : {}),
    }),
    { etag: created.etag, fetchImpl: runtime.session.fetch },
  );
  return (await runtime.store.read(created.url)) as StoredDocument;
}

it("isolates two offline new tabs and resumes each draft without merging their persisted bodies", async () => {
  const { session, client } = await fixture();
  const first = client();
  const second = client();
  await first.open();
  await second.open();
  first.online = second.online = false;
  edit(first, json("First private draft"));
  edit(second, json("Second private draft"));
  await vi.waitFor(async () => {
    expect(await first.local?.get("pending")).toBe(1);
    expect(await second.local?.get("pending")).toBe(1);
  });
  await first.destroy();
  await second.destroy();
  const resumedFirst = client(first.draftId);
  const resumedSecond = client(second.draftId);
  await resumedFirst.open();
  await resumedSecond.open();
  expect(yDocToProsemirrorJSON(resumedFirst.doc)).toEqual(json("First private draft"));
  expect(yDocToProsemirrorJSON(resumedSecond.doc)).toEqual(json("Second private draft"));
  expect(await listLocalDrafts(session.webId)).toEqual(
    expect.arrayContaining([
      { id: first.draftId, title: "First private draft" },
      { id: second.draftId, title: "Second private draft" },
    ]),
  );
  expect(await listLocalDrafts("https://another.test/#me")).toEqual([]);
  // Opening a mirror must hydrate the snapshot too; reconnect has no mounted TipTap editor.
  await resumedFirst.reconnect();
  await resumedSecond.reconnect();
  expect(resumedFirst.state).toBe("saved");
  expect(resumedSecond.state).toBe("saved");
  expect(resumedFirst.stored?.url).not.toBe(resumedSecond.stored?.url);
  expect(await replay(resumedFirst.stored as StoredDocument, session)).toEqual(
    json("First private draft"),
  );
  expect(await replay(resumedSecond.stored as StoredDocument, session)).toEqual(
    json("Second private draft"),
  );
  expect(resumedFirst.stored?.data.body).toBe("<p>First private draft</p>");
  expect(resumedSecond.stored?.data.body).toBe("<p>Second private draft</p>");
  expect(await listLocalDrafts(session.webId)).toEqual([]);
  const reopened = client(first.draftId);
  await reopened.open();
  expect(reopened.stored?.url).toBe(resumedFirst.stored?.url);
  expect(reopened.stored?.data.instanceId).toBe(resumedFirst.stored?.data.instanceId);
});

it.each([
  "open",
  "recover",
  "claim",
  "save",
  "export",
])("rejects legacy off-origin log discovery before authenticated fetch on %s", async (action) => {
  const { session, client } = await fixture();
  const stored = await legacy(client(), "https://attacker.example/updates/");
  const fetch = vi.fn(session.fetch);
  const account = { ...session, fetch };
  const runtime = client(undefined, account);
  const operation =
    action === "claim"
      ? runtime.store.claimIdentity(stored)
      : action === "save"
        ? runtime.store.save(
            stored,
            { title: "Renamed" },
            { regenerate: () => ({ body: "", format: "text/html" }) },
          )
        : action === "export"
          ? rowExportJson(stored.url, account)
          : runtime.open(stored.url, action === "recover");
  const error: unknown = await operation.catch((cause: unknown) => cause);
  expect(
    fetch.mock.calls.every(
      ([url]) => new URL(String(url)).origin === new URL(session.storageUrl).origin,
    ),
  ).toBe(true);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("Invalid update location");
});

it.each([
  "rename",
  "body save",
  "caller-supplied identity",
])("adopts an existing log identity before a legacy list %s", async (action) => {
  const { session, client } = await fixture();
  const runtime = client();
  const stored = await legacy(runtime);
  const seed = prosemirrorJSONToYDoc(getSchema(baseExtensions(session.fetch)), json("Original"));
  seed.getMap("document").set("instanceId", "existing-log-id");
  await new SolidUpdateStore({
    container: stored.data.updateLog as string,
    fetch: session.fetch,
  }).appendUpdate(encodeStateAsUpdate(seed));
  seed.destroy();
  const saved = await runtime.store.save(
    stored,
    action === "rename"
      ? { title: "Renamed" }
      : action === "body save"
        ? { body: "<p>Edited snapshot</p>" }
        : { instanceId: "incorrect" },
    {
      regenerate: () => ({ body: stored.data.body, format: "text/html" }),
    },
  );
  expect(saved.data.instanceId).toBe("existing-log-id");
  const opened = client();
  await opened.open(saved.url);
  expect(yDocToProsemirrorJSON(opened.doc)).toEqual(json("Original"));
  expect(opened.stored?.data.title).toBe(action === "rename" ? "Renamed" : "Legacy");
});

it.each([
  false,
  true,
])("recovers an offline image from its recorded trash companion after the original is replaced (filename reused=%s)", async (reused) => {
  const { pod, session, client, create } = await fixture();
  const original = await create("Original");
  const stored = original.stored as StoredDocument;
  const asset = `${stored.data.assets}chart.png`;
  await pod.fetch(asset, {
    method: "PUT",
    body: "chart bytes",
    headers: { "content-type": "image/png" },
  });
  original.online = false;
  original.provider?.destroy();
  edit(original, {
    type: "doc",
    content: [
      ...(json("Offline text").content ?? []),
      { type: "image", attrs: { src: asset, alt: "Quarterly chart" } },
    ],
  });
  expect((await deleteDocument(stored.url, session)).failed).toEqual([]);
  const replacement = await create("Replacement");
  expect(replacement.stored?.url).toBe(stored.url);
  if (reused) await pod.fetch(asset, { method: "PUT", body: "replacement image" });
  await original.reconnect();
  expect(original.state).toBe("saved");
  expect(original.recoveredCopy).toBeDefined();
  const copy = (await client().store.read(original.recoveredCopy as string)) as StoredDocument;
  expect(copy.data.body).toContain("Offline text");
  expect(copy.data.body).toContain(`${copy.data.assets}chart.png`);
  expect(await (await pod.fetch(`${copy.data.assets}chart.png`)).text()).toBe("chart bytes");
  expect(JSON.stringify(await replay(copy, session))).toContain(`${copy.data.assets}chart.png`);
});

it.each([
  404, 410,
])("recovers missing image %s as a visible placeholder retaining its alt text", async (status) => {
  const { session, client, create } = await fixture();
  const original = await create("Original");
  const stored = original.stored as StoredDocument;
  const asset = `${stored.data.assets}missing.png`;
  original.online = false;
  original.provider?.destroy();
  edit(original, {
    type: "doc",
    content: [{ type: "image", attrs: { src: asset, alt: "Quarterly chart" } }],
  });
  expect((await deleteDocument(stored.url, session)).failed).toEqual([]);
  await create("Replacement");
  const fetch = original.session.fetch;
  const missingReads: string[] = [];
  vi.spyOn(original.session, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (url.endsWith("/assets/missing.png")) {
      missingReads.push(url);
      return Promise.resolve(new Response(null, { status }));
    }
    return fetch(input, init);
  });
  await original.reconnect();
  expect(original.state).toBe("saved");
  expect(missingReads).toHaveLength(1);
  const copy = (await client().store.read(original.recoveredCopy as string)) as StoredDocument;
  expect(copy.data.body).toContain("Image unavailable");
  expect(copy.data.body).toContain("Quarterly chart");
  expect(copy.data.body).not.toContain("<img");
  expect(JSON.stringify(await replay(copy, session))).toContain("Quarterly chart");
});

it("keeps a new-tab draft id in the URL for reload without sharing it with another new navigation", () => {
  window.history.replaceState({}, "", "/docs/new");
  const first = currentDraftId();
  expect(new URL(window.location.href).searchParams.get("draft")).toBe(first);
  expect(currentDraftId()).toBe(first);
  window.history.replaceState({}, "", "/docs/new");
  expect(currentDraftId()).not.toBe(first);
});

it("resumes an interrupted draft promotion using its one existing document reservation", async () => {
  const { session, client } = await fixture();
  const original = client("interrupted-draft");
  await original.open();
  vi.spyOn(SolidPersistence.prototype, "persistFullState").mockRejectedValueOnce(
    new TypeError("offline"),
  );
  edit(original, json("One reserved draft"));
  await original.flush();
  expect(original.state).toBe("retrying");
  const reserved = original.stored as StoredDocument;
  original.online = false;
  await original.destroy();
  const resumed = client("interrupted-draft");
  const create = vi.spyOn(resumed.store, "create");
  await resumed.open();
  await resumed.reconnect();
  expect(resumed.state).toBe("saved");
  expect(create).not.toHaveBeenCalled();
  expect(resumed.stored?.url).toBe(reserved.url);
  expect(resumed.stored?.data.instanceId).toBe(reserved.data.instanceId);
  expect(await replay(resumed.stored as StoredDocument, session)).toEqual(
    json("One reserved draft"),
  );
});

it.each([
  "asset",
  "snapshot",
])("rebuilds recovery from current edits after an interrupted %s copy", async (stage) => {
  const { pod, session, client, create } = await fixture();
  const original = await create("Original");
  const stored = original.stored as StoredDocument;
  const asset = `${stored.data.assets}chart.png`;
  await pod.fetch(asset, { method: "PUT", body: "chart bytes" });
  original.online = false;
  original.provider?.destroy();
  edit(original, {
    type: "doc",
    content: [{ type: "image", attrs: { src: asset, alt: "Old image" } }],
  });
  const recovered = client();
  await recovered.open(stored.url, true);
  const copy = vi.spyOn(original.store, "makeCopy");
  const http = session.fetch;
  let interrupted = true;
  vi.spyOn(session, "fetch").mockImplementation((input, init) => {
    const blocked =
      stage === "asset"
        ? String(input) === asset
        : String(input).endsWith("/plan-copy.ttl") &&
          init?.method === "PUT" &&
          new Headers(init.headers).has("if-match");
    return interrupted && blocked
      ? Promise.resolve(new Response(null, { status: 503 }))
      : http(input, init);
  });
  await original.reconnect();
  expect(original.state).toBe("retrying");
  original.online = false;
  edit(original, json("Current edits without image"));
  interrupted = false;
  await original.reconnect();
  expect(original.state).toBe("saved");
  expect(copy).toHaveBeenCalledTimes(2);
  const saved = (await client().store.read(original.recoveredCopy as string)) as StoredDocument;
  expect(saved.data.body).toBe("<p>Current edits without image</p>");
  expect(await replay(saved, session)).toEqual(json("Current edits without image"));
  expect(
    pod.snapshot().resources.filter(([url]) => /plan-copy(?:-\d+)?\.ttl$/.test(url)),
  ).toHaveLength(1);
});

it("promotes a draft once after the first snapshot commits but its acknowledgement is lost", async () => {
  const { pod, session, client } = await fixture();
  let lost = false;
  const http = session.fetch;
  vi.spyOn(session, "fetch").mockImplementation(async (input, init) => {
    const response = await http(input, init);
    if (!lost && String(input).endsWith("/lost-ack.ttl") && init?.method === "PUT" && response.ok) {
      lost = true;
      throw new TypeError("Lost first snapshot acknowledgement");
    }
    return response;
  });
  const original = client("lost-first-ack");
  await original.open();
  original.title = "Lost ack";
  edit(original, json("One draft body"));
  await original.flush();
  expect(lost).toBe(true);
  expect(original.state).toBe("retrying");
  original.online = false;
  await original.destroy();
  const resumed = client(original.draftId);
  await resumed.open();
  await resumed.reconnect();
  expect(resumed.state).toBe("saved");
  expect(resumed.stored?.url).toBe(`${session.storageUrl}docs/lost-ack.ttl`);
  expect(
    pod.snapshot().resources.filter(([url]) => /lost-ack(?:-\d+)?\.ttl$/.test(url)),
  ).toHaveLength(1);
  expect(await replay(resumed.stored as StoredDocument, session)).toEqual(json("One draft body"));
});

it.each([
  404,
  403,
  "offline",
] as const)("handles an occupied draft companion whose snapshot read returns %s", async (status) => {
  const { session, client } = await fixture();
  const store = client().store;
  const occupied = await store.create({ title: "Occupied", body: "<p>Other document</p>" });
  const http = session.fetch;
  vi.spyOn(session, "fetch").mockImplementation((input, init) => {
    if (String(input) === occupied.url && !init?.method) {
      return status === "offline"
        ? Promise.reject(new TypeError("offline"))
        : Promise.resolve(new Response(null, { status }));
    }
    return http(input, init);
  });
  const creation = store.create({
    title: "Occupied",
    body: "<p>Draft</p>",
    instanceId: "draft-allocation",
  });
  if (status === 404) {
    const created = await creation;
    expect(created.url).toBe(`${session.storageUrl}docs/occupied-2.ttl`);
    expect(created.data.instanceId).toBe("draft-allocation");
  } else await expect(creation).rejects.toThrow();
  expect((await http(occupied.url)).ok).toBe(true);
});
