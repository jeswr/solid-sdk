// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { SolidPersistence } from "@jeswr/y-solid";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Doc, encodeStateAsUpdate, XmlElement, XmlText } from "yjs";
import { deleteDocument, restoreDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

// Each connection is a separate device: no shared IndexedDB or cross-tab broadcast.
const mirrors = vi.hoisted(() => new Map<object, Map<string, unknown>>());
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve(this);
    constructor(
      readonly name: string,
      readonly doc: Doc,
    ) {
      mirrors.set(this, new Map());
      doc.on("update", this._storeUpdate);
    }
    save = () => mirrors.get(this)?.set("update", encodeStateAsUpdate(this.doc));
    _storeUpdate = this.save;
    async get(key: string) {
      return mirrors.get(this)?.get(key);
    }
    async set(key: string, value: unknown) {
      mirrors.get(this)?.set(key, value);
    }
    async destroy() {
      this.doc.off("update", this._storeUpdate);
    }
    async clearData() {
      mirrors.get(this)?.clear();
    }
  },
  storeState: async (mirror: { save(): void }) => mirror.save(),
  clearDocument: async () => {},
}));
const runtimes: DocumentPersistence[] = [];
// Use a Blob compatible with Node's fetch/Response for Drive's byte copies.
beforeEach(() => vi.stubGlobal("Blob", NodeBlob));
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.destroy()));
  mirrors.clear();
  vi.unstubAllGlobals();
});
const json = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
function bodyText(runtime: DocumentPersistence) {
  return (runtime.doc.getXmlFragment("prosemirror").get(0) as XmlElement).get(0) as XmlText;
}
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: DEMO_NAME,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const client = () => {
    const runtime = new DocumentPersistence(session);
    runtimes.push(runtime);
    return runtime;
  };
  const original = client();
  await original.open();
  const paragraph = new XmlElement("paragraph");
  const text = new XmlText();
  text.insert(0, "Original");
  paragraph.insert(0, [text]);
  original.doc.getXmlFragment("prosemirror").insert(0, [paragraph]);
  original.change("<p>Original</p>", json("Original"));
  await original.flush();
  const url = original.stored?.url as string;
  const log = original.stored?.data.updateLog as string;
  const tree = log.slice(0, -"updates/".length);
  await pod.fetch(`${tree}assets/chart.png`, { method: "PUT", body: "image" });
  return { pod, session, client, original, url, log, tree };
}
async function replay(log: string, session: PodSession) {
  const doc = new Doc();
  const provider = new SolidPersistence({ doc, container: log, fetch: session.fetch });
  try {
    await provider.whenSynced;
    return doc.getXmlFragment("prosemirror").toString();
  } finally {
    provider.destroy();
    doc.destroy();
  }
}

it("keeps edits local while trashed and flushes them into the original log after Undo", async () => {
  const { pod, session, original, url, log, tree } = await fixture();
  const trashed = await deleteDocument(url, session);
  expect(trashed.failed).toEqual([]);
  bodyText(original).insert(8, " B edit");
  original.change("<p>Original B edit</p>", json("Original B edit"));
  await original.provider?.flush();
  await original.flush();
  expect(pod.has(tree)).toBe(false);
  expect(original.trashed).toBe(true);
  expect(mirrors.get(original.local as object)?.get("pending")).toBe(1);
  expect((await restoreDocument(trashed.done, session)).failed).toEqual([]);
  await original.reconnect();
  expect(original.trashed).toBe(false);
  expect(original.state).toBe("saved");
  expect(await replay(log, session)).toBe("<paragraph>Original B edit</paragraph>");
  expect(await (await pod.fetch(`${tree}assets/chart.png`)).text()).toBe("image");
});

it("preserves retired-log edits in a separate copy and reloads without duplicate paragraphs", async () => {
  const { pod, session, original, client, url, log } = await fixture();
  const other = client();
  await other.open(url);
  const retired = other.provider;
  const recovered = client();
  await recovered.open(url, true);
  const active = recovered.stored?.data.updateLog as string;
  expect(active).not.toBe(log);
  await recovered.provider?.flush();
  const oldResources = pod.snapshot().resources.filter(([resource]) => resource.startsWith(log));
  bodyText(other).insert(8, " B edit");
  other.change("<p>Original B edit</p>", json("Original B edit"));
  await other.reconnect();
  await other.flush();
  expect(other.state).toBe("saved");
  expect(await replay(active, session)).toBe("<paragraph>Original</paragraph>");
  const copy = await other.store.read(other.recoveredCopy as string);
  expect(copy?.data.body).toBe("<p>Original B edit</p>");
  expect(await replay(copy?.data.updateLog as string, session)).toBe(
    "<paragraph>Original B edit</paragraph>",
  );
  expect(other.doc.getXmlFragment("prosemirror").toString()).toBe(
    "<paragraph>Original</paragraph>",
  );
  expect(retired?.destroyed).toBe(true);
  expect(other.provider?.store.container).toBe(active);
  expect(pod.snapshot().resources.filter(([resource]) => resource.startsWith(log))).toEqual(
    oldResources,
  );
  // The first client's independent mirror must follow the pointer too, even without edits.
  await original.reconnect();
  expect(original.provider?.store.container).toBe(active);
});

it("keeps retired-log edits pending when saving their separate copy fails", async () => {
  const { pod, session, client, url } = await fixture();
  let fail = false;
  const writer = new DocumentPersistence({
    ...session,
    fetch: async (input, init) =>
      fail && init?.method === "PUT" && String(input).includes("-copy")
        ? new Response(null, { status: 503 })
        : pod.fetch(input, init),
  });
  runtimes.push(writer);
  await writer.open(url);
  const oldDoc = writer.doc;
  const recovered = client();
  await recovered.open(url, true);
  bodyText(writer).insert(8, " pending");
  writer.change("<p>Original pending</p>", json("Original pending"));
  fail = true;
  await writer.reconnect();
  expect(writer.state).toBe("retrying");
  expect(writer.doc).toBe(oldDoc);
  expect(mirrors.get(writer.local as object)?.get("pending")).toBe(1);
  expect(await replay(recovered.stored?.data.updateLog as string, session)).toBe(
    "<paragraph>Original</paragraph>",
  );
  fail = false;
  await writer.reconnect();
  expect(writer.state).toBe("saved");
  const copy = await writer.store.read(writer.recoveredCopy as string);
  expect(copy?.data.body).toBe("<p>Original pending</p>");
});

it("retries a stale opening listing after compaction without seeding duplicate paragraphs", async () => {
  const { pod, session, original, url, log } = await fixture();
  // Ensure compaction has multiple original resources to fold.
  bodyText(original).insert(8, " content");
  original.change("<p>Original content</p>", json("Original content"));
  await original.flush();
  const resources = new Set(
    pod
      .snapshot()
      .resources.filter(([resource]) => resource.startsWith(log))
      .map(([resource]) => resource),
  );
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paused = false;
  let lists = 0;
  const opening = new DocumentPersistence({
    ...session,
    fetch: async (input, init) => {
      if (String(input) === log && (init?.method ?? "GET") === "GET") lists++;
      if (resources.has(String(input)) && (init?.method ?? "GET") === "GET") {
        paused = true;
        await gate;
      }
      return pod.fetch(input, init);
    },
  });
  runtimes.push(opening);
  const pending = opening.open(url);
  try {
    await vi.waitFor(() => expect(paused).toBe(true));
    await original.provider?.compact();
  } finally {
    release();
  }
  await pending;
  await opening.provider?.flush();
  await opening.reconnect();
  expect(opening.doc.getXmlFragment("prosemirror").toString()).toBe(
    "<paragraph>Original content</paragraph>",
  );
  expect(lists).toBeGreaterThanOrEqual(2);
  expect(await replay(log, session)).toBe("<paragraph>Original content</paragraph>");
});

it("bounds retries for an existing empty log and never seeds its HTML snapshot", async () => {
  const { pod, session, url, log } = await fixture();
  for (const [resource] of pod.snapshot().resources)
    if (resource.startsWith(log)) await pod.fetch(resource, { method: "DELETE" });
  let lists = 0;
  let writes = 0;
  const opening = new DocumentPersistence({
    ...session,
    fetch: async (input, init) => {
      if (String(input) === log && (init?.method ?? "GET") === "GET") lists++;
      if (init?.method === "PUT") writes++;
      return pod.fetch(input, init);
    },
  });
  runtimes.push(opening);
  await expect(opening.open(url)).rejects.toThrow("update log is empty");
  expect(lists).toBe(3);
  expect(opening.doc.getXmlFragment("prosemirror").length).toBe(0);
  expect(writes).toBe(0);
});

it("reloads a temporarily empty existing log without creating independent CRDT identities", async () => {
  const { pod, session, original, url, log } = await fixture();
  const updates = pod.snapshot().resources.filter(([resource]) => resource.startsWith(log));
  for (const [resource] of updates) await pod.fetch(resource, { method: "DELETE" });
  let lists = 0;
  const opening = new DocumentPersistence({
    ...session,
    fetch: async (input, init) => {
      if (String(input) === log && (init?.method ?? "GET") === "GET" && ++lists === 2)
        for (const [resource, { body, contentType }] of updates)
          await pod.fetch(resource, {
            method: "PUT",
            headers: { "content-type": contentType },
            body: new Uint8Array(body),
          });
      return pod.fetch(input, init);
    },
  });
  runtimes.push(opening);
  await opening.open(url);
  expect(lists).toBe(2);
  expect(encodeStateAsUpdate(opening.doc)).toEqual(encodeStateAsUpdate(original.doc));
});

it("surfaces repeated missing listed updates after three complete load attempts", async () => {
  const { pod, session, url, log } = await fixture();
  let lists = 0;
  const opening = new DocumentPersistence({
    ...session,
    fetch: async (input, init) => {
      if (String(input) === log) lists++;
      else if (String(input).startsWith(log)) return new Response(null, { status: 404 });
      return pod.fetch(input, init);
    },
  });
  runtimes.push(opening);
  await expect(opening.open(url)).rejects.toThrow("update disappeared");
  expect(lists).toBe(3);
  expect(opening.doc.getXmlFragment("prosemirror").length).toBe(0);
});

it("does not report Saved when the pointer changes during a successful update PUT", async () => {
  const { pod, session, original, client, url, log } = await fixture();
  let switched = false;
  let replacement: DocumentPersistence | undefined;
  const writer = new DocumentPersistence({
    ...session,
    fetch: async (input, init) => {
      const response = await pod.fetch(input, init);
      if (init?.method === "PUT" && String(input).startsWith(log) && !switched) {
        switched = true;
        replacement = client();
        await replacement.open(url, true);
      }
      return response;
    },
  });
  runtimes.push(writer);
  await writer.open(url);
  const retired = writer.provider;
  bodyText(writer).insert(8, " racing edit");
  writer.change("<p>Original racing edit</p>", json("Original racing edit"));
  await retired?.flush();
  expect(switched).toBe(true);
  expect(writer.state).toBe("retrying");
  expect(mirrors.get(writer.local as object)?.get("pending")).toBe(1);
  await writer.reconnect();
  expect(writer.state).toBe("saved");
  expect(retired?.destroyed).toBe(true);
  const active = replacement?.stored?.data.updateLog as string;
  expect(writer.provider?.store.container).toBe(active);
  expect(await replay(active, session)).toBe("<paragraph>Original</paragraph>");
  const copy = await writer.store.read(writer.recoveredCopy as string);
  expect(await replay(copy?.data.updateLog as string, session)).toBe(
    "<paragraph>Original racing edit</paragraph>",
  );
  await original.reconnect();
});

it("keeps a concurrent remote title rename when saving a body-only edit", async () => {
  const { original } = await fixture();
  const stored = original.stored;
  if (!stored) throw new Error("Missing fixture");
  await original.store.save(
    stored,
    { title: "Remote title" },
    {
      regenerate: () => ({ body: original.body, format: "text/html" }),
    },
  );
  bodyText(original).insert(8, " body edit");
  original.change("<p>Original body edit</p>", json("Original body edit"));
  await original.flush();
  expect(original.state).toBe("saved");
  expect(original.conflict).toBeUndefined();
  expect(original.stored?.data.title).toBe("Remote title");
});

it("saves an edit arriving while an idle flush checks the active log", async () => {
  const { pod, session, url } = await fixture();
  let checking = false;
  let checks = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paused = false;
  const writer = new DocumentPersistence({
    ...session,
    fetch: async (input, init) => {
      if (
        checking &&
        String(input) === url &&
        (init?.method ?? "GET") === "GET" &&
        ++checks === 2
      ) {
        paused = true;
        await gate;
      }
      return pod.fetch(input, init);
    },
  });
  runtimes.push(writer);
  await writer.open(url);
  checking = true;
  const pending = writer.flush();
  try {
    await vi.waitFor(() => expect(paused).toBe(true));
    bodyText(writer).insert(8, " late edit");
    writer.change("<p>Original late edit</p>", json("Original late edit"));
  } finally {
    release();
  }
  await pending;
  expect(writer.state).toBe("saved");
  expect(writer.stored?.data.body).toBe("<p>Original late edit</p>");
  expect(mirrors.get(writer.local as object)?.get("pending")).toBe(0);
});
