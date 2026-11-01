// @vitest-environment jsdom
// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { SolidPersistence, SolidUpdateStore } from "@jeswr/y-solid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate, XmlElement, XmlText } from "yjs";
import { rowExportJson } from "../src/apps/docs/editor/export-document";
import { deleteDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems } from "../src/apps/drive/lib/operations/operations";
import { trashIndexFrom } from "../src/apps/drive/lib/operations/trash-index";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

// Browser IndexedDB is exercised by Playwright; the Node tests inspect mirror metadata.
const connections = vi.hoisted(() => new Set<object>());
const mirrors = vi.hoisted(() => new Map<string, Map<string, unknown>>());
const { IDBFactory } = createRequire(`${process.cwd()}/../../packages/solid-offline/package.json`)(
  "fake-indexeddb",
) as { IDBFactory: new () => IDBFactory };
// These adapter tests exercise reconnect without cross-tab notifications.
beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("indexedDB", new IDBFactory());
});
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve(this);
    closed = false;
    constructor(
      readonly name: string,
      readonly doc: Doc,
    ) {
      if (!mirrors.has(name)) mirrors.set(name, new Map());
      const update = mirrors.get(name)?.get("update") as Uint8Array | undefined;
      if (update) applyUpdate(doc, update);
      doc.on("update", this._storeUpdate);
      connections.add(this);
    }
    save = () => {
      if (this.closed) throw new DOMException("The connection is closed", "InvalidStateError");
      mirrors.get(this.name)?.set("update", encodeStateAsUpdate(this.doc));
    };
    _storeUpdate = this.save;
    async get(key: string) {
      if (this.closed) throw new DOMException("The connection is closed", "InvalidStateError");
      return mirrors.get(this.name)?.get(key);
    }
    async set(key: string, value: unknown) {
      if (this.closed) throw new DOMException("The connection is closed", "InvalidStateError");
      mirrors.get(this.name)?.set(key, value);
    }
    async destroy() {
      this.doc.off("update", this._storeUpdate);
      connections.delete(this);
    }
    async clearData() {
      mirrors.delete(this.name);
    }
  },
  storeState: async (mirror: { save(): void }) => {
    mirror.save();
  },
  clearDocument: async (name: string) => {
    for (const connection of connections) {
      const mirror = connection as { name: string; closed: boolean };
      if (mirror.name === name) mirror.closed = true;
    }
    mirrors.delete(name);
  },
}));
const json = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const writes: string[] = [];
  let failSnapshot = false;
  let intercept: typeof fetch | undefined;
  const http: typeof fetch = async (input, init) => {
    if (intercept) return intercept(input, init);
    const url = String(input);
    if (init?.method === "PUT") writes.push(url);
    if (failSnapshot && init?.method === "PUT" && url.includes("/docs/") && url.endsWith(".ttl"))
      return new Response(null, { status: 503 });
    return pod.fetch(input, init);
  };
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: DEMO_NAME,
    fetch: http,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const runtime = new DocumentPersistence(session);
  return {
    pod,
    session,
    runtime,
    writes,
    intercept: (value: typeof fetch | undefined) => {
      intercept = value;
    },
    fail: (value: boolean) => {
      failSnapshot = value;
    },
  };
}
const runtimes: DocumentPersistence[] = [];
it.each([
  "snapshot",
  "companion",
])("round43 unrenamed restore retries its persisted destination after %s deletion is denied", async (denied) => {
  vi.stubGlobal("Blob", NodeBlob);
  const { runtime, session, pod } = await fixture();
  runtimes.push(runtime);
  await runtime.open();
  const paragraph = new XmlElement("paragraph");
  const text = new XmlText();
  text.insert(0, "Confidential plan");
  paragraph.insert(0, [text]);
  runtime.doc.getXmlFragment("prosemirror").insert(0, [paragraph]);
  runtime.rename("Plan");
  runtime.change("<p>Confidential plan</p>", json("Confidential plan"));
  await runtime.flush();
  const url = runtime.stored?.url as string;
  expect(url).toBe(`${DEMO_ROOT}docs/plan.ttl`);
  const log = runtime.stored?.data.updateLog;
  runtime.online = false;
  await runtime.destroy();
  const trashed = await deleteDocument(url, session);
  expect(trashed.failed).toEqual([]);
  const client = createSolidDriveClient({ storageUrl: DEMO_ROOT, fetch: pod.fetch });
  const snapshot = trashed.done.find((entry) => entry.original === url);
  if (!snapshot) throw new Error("Missing snapshot");
  const blocked = trashed.done.find(
    (entry) => entry.original.endsWith("/") === (denied === "companion"),
  );
  if (!blocked) throw new Error("Missing denied entry");
  const interrupted = createSolidDriveClient({
    storageUrl: DEMO_ROOT,
    fetch: async (input, init) =>
      String(input) === blocked.url && init?.method === "DELETE"
        ? new Response(null, { status: 403 })
        : pod.fetch(input, init),
  });
  const first = await restoreItems(interrupted, `${DEMO_ROOT}drive/`, [snapshot]);
  expect(first.failed).toHaveLength(1);
  expect(first.failed[0]?.url).toBe(blocked.url);
  const current = await client.readRdf(`${DEMO_ROOT}drive/.trash/index.ttl`);
  if (!current) throw new Error("Missing trash index");
  const remaining = await listTrash(client, `${DEMO_ROOT}drive/`);
  for (const entry of remaining)
    expect(trashIndexFrom(current.dataset).record(entry.url).restoredLocation).toBe(entry.original);
  const retry = await restoreItems(client, `${DEMO_ROOT}drive/`, remaining);
  expect(retry.failed).toEqual([]);
  expect(retry.done.map((item) => item.url)).toEqual(remaining.map((entry) => entry.original));
  const reopened = new DocumentPersistence(session);
  runtimes.push(reopened);
  await reopened.open(url);
  expect(reopened.state).toBe("saved");
  expect(reopened.stored?.data.updateLog).toBe(log);
  expect(reopened.doc.getXmlFragment("prosemirror").toString()).toBe(
    "<paragraph>Confidential plan</paragraph>",
  );
  expect(await listTrash(client, `${DEMO_ROOT}drive/`)).toEqual([]);
  expect(pod.snapshot().resources.some(([resource]) => resource.includes("(restored)"))).toBe(
    false,
  );
});
it("isolates a newly created document from the previous occupant's shared mirror", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  const { runtime, session } = await fixture();
  runtimes.push(runtime);
  await runtime.open();
  const paragraph = new XmlElement("paragraph");
  const text = new XmlText();
  text.insert(0, "Old content");
  paragraph.insert(0, [text]);
  runtime.doc.getXmlFragment("prosemirror").insert(0, [paragraph]);
  runtime.rename("Plan");
  runtime.change("<p>Old content</p>", json("Old content"));
  await runtime.flush();
  const url = runtime.stored?.url as string;
  runtime.online = false;
  runtime.provider?.destroy();
  expect((await deleteDocument(url, session)).failed).toEqual([]);
  const replacement = new DocumentPersistence(session);
  runtimes.push(replacement);
  await replacement.open();
  replacement.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("replacement")]);
  replacement.rename("Plan");
  replacement.change("<p>Replacement</p>", json("Replacement"));
  await replacement.flush();
  expect(replacement.stored?.url).toBe(url);
  expect(await replayText(replacement, session)).toBe("<replacement></replacement>");
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.destroy()));
  mirrors.clear();
  connections.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("Docs pod and local mirror lifecycle", () => {
  it("keeps an untouched draft off the pod and serializes edits during creation", async () => {
    const { runtime, writes, session } = await fixture();
    runtimes.push(runtime);
    await runtime.open();
    await runtime.flush();
    expect(writes).toEqual([]);
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
    runtime.rename("Plan");
    runtime.change("<p>First paragraph</p>", json("First paragraph"));
    runtime.change("<p>Latest paragraph</p>", json("Latest paragraph"));
    await runtime.flush();
    expect(runtime.state).toBe("saved");
    expect(runtime.stored?.data.title).toBe("Plan");
    expect(runtime.stored?.data.body).toBe("<p>Latest paragraph</p>");
    expect(runtime.stored?.data.wordCount).toBe(2);
    expect(mirrors.get(runtime.local?.name as string)?.get("pending")).toBe(0);
    const replay = new Doc();
    const provider = new SolidPersistence({
      doc: replay,
      container: runtime.stored?.data.updateLog as string,
      fetch: session.fetch,
    });
    await provider.whenSynced;
    expect(replay.getXmlFragment("prosemirror").length).toBe(1);
    provider.destroy();
    replay.destroy();
  });
  it("retains failed snapshots for retry and reconciles offline edits", async () => {
    const { runtime, fail } = await fixture();
    runtimes.push(runtime);
    runtime.change("<p>Start</p>", json("Start"));
    await runtime.flush();
    fail(true);
    runtime.change("<p>Retry this</p>", json("Retry this"));
    await runtime.flush();
    expect(runtime.state).toBe("retrying");
    expect(mirrors.get(runtime.local?.name as string)?.get("pending")).toBe(1);
    fail(false);
    await runtime.flush();
    expect(runtime.state).toBe("saved");
    runtime.online = false;
    runtime.change("<p>Offline words</p>", json("Offline words"));
    await runtime.flush();
    expect(runtime.stored?.data.body).toBe("<p>Retry this</p>");
    await runtime.reconnect();
    expect(runtime.stored?.data.body).toBe("<p>Offline words</p>");
    expect(runtime.state).toBe("saved");
  });
  it("surfaces simultaneous title edits and supports keeping the remote title", async () => {
    const { runtime } = await fixture();
    runtimes.push(runtime);
    runtime.rename("Original");
    await runtime.flush();
    const baseline = runtime.stored;
    if (!baseline) throw new Error("Fixture was not created");
    await runtime.store.save(
      baseline,
      { title: "Theirs" },
      { regenerate: () => ({ body: "<p></p>", format: "text/html" }) },
    );
    runtime.rename("Mine");
    await runtime.flush();
    expect(runtime.conflict?.remoteTitle).toBe("Theirs");
    await runtime.resolveTitle(false);
    expect(runtime.title).toBe("Theirs");
    expect(runtime.stored?.data.title).toBe("Theirs");
    expect(runtime.state).toBe("saved");
  });
});

async function replayText(runtime: DocumentPersistence, session: PodSession) {
  const replay = new Doc();
  const provider = new SolidPersistence({
    doc: replay,
    container: runtime.stored?.data.updateLog as string,
    fetch: session.fetch,
  });
  try {
    await provider.whenSynced;
    return replay.getXmlFragment("prosemirror").toString();
  } finally {
    provider.destroy();
    replay.destroy();
  }
}
describe("Docs persistence review regressions", () => {
  it("reopens and resumes a reserved recovery copy without duplicating its log", async () => {
    const f = await fixture();
    const { runtime, session, pod } = f;
    runtimes.push(runtime);
    await runtime.open();
    const paragraph = new XmlElement("paragraph");
    const text = new XmlText();
    text.insert(0, "Original");
    paragraph.insert(0, [text]);
    runtime.doc.getXmlFragment("prosemirror").insert(0, [paragraph]);
    runtime.change("<p>Original</p>", json("Original"));
    await runtime.flush();
    const url = runtime.stored?.url as string;
    const recovered = new DocumentPersistence(session);
    runtimes.push(recovered);
    await recovered.open(url, true);
    text.insert(8, " pending");
    runtime.change("<p>Original pending</p>", json("Original pending"));
    f.intercept(async (input, init) =>
      /-copy(?:-\d+)?\.ttl$/.test(String(input)) &&
      init?.method === "PUT" &&
      new Headers(init.headers).has("if-match")
        ? new Response(null, { status: 503 })
        : pod.fetch(input, init),
    );
    await runtime.reconnect();
    expect(runtime.state).toBe("retrying");
    const owner = JSON.parse(
      mirrors.get(runtime.local?.name as string)?.get("edit") as string,
    ).owner;
    const pending = JSON.parse(
      mirrors.get(runtime.local?.name as string)?.get(`recovery:${owner}`) as string,
    );
    expect(pending.reservation.url).toMatch(/-copy\.ttl$/);
    runtime.online = false;
    await runtime.destroy();
    f.intercept(undefined);
    const reopened = new DocumentPersistence(session);
    runtimes.push(reopened);
    await reopened.open(url);
    await reopened.flush();
    expect(reopened.recoveredCopy).toBe(pending.reservation.url);
    const copy = await reopened.store.read(reopened.recoveredCopy as string);
    expect(copy?.data.body).toBe("<p>Original pending</p>");
    const reader = new DocumentPersistence(session);
    runtimes.push(reader);
    await reader.open(copy?.url);
    expect(await replayText(reader, session)).toBe("<paragraph>Original pending</paragraph>");
    expect(
      pod.snapshot().resources.filter(([resource]) => /-copy(?:-\d+)?\.ttl$/.test(resource)),
    ).toHaveLength(1);
  });
  it("ignores a retired mirror metadata write that rejects after the new Y.Doc is installed", async () => {
    const { runtime, session } = await fixture();
    runtimes.push(runtime);
    await runtime.open();
    const paragraph = new XmlElement("paragraph");
    const text = new XmlText();
    text.insert(0, "Original");
    paragraph.insert(0, [text]);
    runtime.doc.getXmlFragment("prosemirror").insert(0, [paragraph]);
    runtime.change("<p>Original</p>", json("Original"));
    await runtime.flush();
    const recovered = new DocumentPersistence(session);
    runtimes.push(recovered);
    await recovered.open(runtime.stored?.url, true);
    const oldMirror = runtime.local;
    if (!oldMirror) throw new Error("Missing mirror");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let paused = false;
    const set = oldMirror.set.bind(oldMirror);
    const late = vi.spyOn(oldMirror, "set").mockImplementation(async (key, value) => {
      if (key === "edit") {
        paused = true;
        await gate;
        throw new DOMException("The connection is closed", "InvalidStateError");
      }
      return set(key, value);
    });
    try {
      text.insert(8, " pending");
      runtime.change("<p>Original pending</p>", json("Original pending"));
      await vi.waitFor(() => expect(paused).toBe(true));
      await runtime.reconnect();
      const currentMirror = runtime.local;
      expect(currentMirror?.name).not.toBe(oldMirror.name);
      release();
      await vi.waitFor(() =>
        expect(late.mock.settledResults.every((result) => result.type !== "incomplete")).toBe(true),
      );
      await runtime.flush();
      expect(runtime.local).toBe(currentMirror);
      expect(runtime.doc.getXmlFragment("prosemirror").toString()).toBe(
        "<paragraph>Original</paragraph>",
      );
      expect(await replayText(runtime, session)).toBe("<paragraph>Original</paragraph>");
    } finally {
      release();
      late.mockRestore();
    }
  });
  it("preserves another tab's pending rename when a body-only snapshot is saved", async () => {
    const { runtime, session } = await fixture();
    runtimes.push(runtime);
    await runtime.open();
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
    runtime.rename("Original title");
    await runtime.flush();
    const url = runtime.stored?.url as string;
    const other = new DocumentPersistence(session);
    runtimes.push(other);
    await other.open(url);
    runtime.online = false;
    runtime.rename("Pending rename in A");
    await vi.waitFor(() =>
      expect(mirrors.get(runtime.local?.name as string)?.get("title")).toBe("Pending rename in A"),
    );
    other.change("<p>Body from B</p>", json("Body from B"));
    await other.flush();
    expect(other.stored?.data.title).toBe("Original title");
    expect(mirrors.get(runtime.local?.name as string)?.get("pending")).toBe(1);
    expect(
      JSON.parse(mirrors.get(runtime.local?.name as string)?.get("edit") as string).title,
    ).toBe("Pending rename in A");
    await runtime.destroy();
    const reopened = new DocumentPersistence(session);
    runtimes.push(reopened);
    await reopened.open(url);
    expect(reopened.title).toBe("Pending rename in A");
    await reopened.flush();
    expect(reopened.stored?.data.title).toBe("Pending rename in A");
  });
  it("exports the current recovery mirror from the document list after editing and saving", async () => {
    const { runtime, session } = await fixture();
    runtimes.push(runtime);
    await runtime.open();
    const paragraph = new XmlElement("paragraph");
    const text = new XmlText();
    text.insert(0, "Original");
    paragraph.insert(0, [text]);
    runtime.doc.getXmlFragment("prosemirror").insert(0, [paragraph]);
    runtime.change("<p>Original</p>", json("Original"));
    await runtime.flush();
    const recovered = new DocumentPersistence(session);
    runtimes.push(recovered);
    const url = runtime.stored?.url as string;
    await recovered.open(url, true);
    const recoveredText = (recovered.doc.getXmlFragment("prosemirror").get(0) as XmlElement).get(
      0,
    ) as XmlText;
    recoveredText.insert(8, " recovered edit");
    recovered.change("<p>Original recovered edit</p>", json("Original recovered edit"));
    await recovered.flush();
    expect(await rowExportJson(url, session)).toEqual(json("Original recovered edit"));
  });
  it("reloads a retired saved mirror into a fresh document without merging its old identities", async () => {
    const { runtime, session } = await fixture();
    runtimes.push(runtime);
    await runtime.open();
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("original")]);
    runtime.rename("Reopened log transfer");
    await runtime.flush();
    const stored = runtime.stored;
    if (!stored) throw new Error("Missing fixture");
    await runtime.destroy();
    const container = (stored.data.updateLog as string).replace("updates/", "updates-123/");
    const recovered = new Doc();
    recovered.getMap("document").set("instanceId", stored.data.instanceId);
    recovered.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
    await new SolidUpdateStore({ container, fetch: session.fetch }).appendUpdate(
      encodeStateAsUpdate(recovered),
    );
    recovered.destroy();
    await runtime.store.save(
      stored,
      { updateLog: container },
      {
        regenerate: () => ({ body: runtime.body, format: "text/html" }),
      },
    );
    const reopened = new DocumentPersistence(session);
    runtimes.push(reopened);
    await reopened.open(stored.url);
    expect(reopened.doc.getXmlFragment("prosemirror").toString()).toBe("<paragraph></paragraph>");
    expect(reopened.recoveredCopy).toBeUndefined();
    await reopened.flush();
    expect(reopened.state).toBe("saved");
    const replay = await replayText(reopened, session);
    expect(replay).toBe("<paragraph></paragraph>");
  });
  it("recovery leaves another tab's mirror usable and its next edit durable", async () => {
    const { runtime, session } = await fixture();
    runtimes.push(runtime);
    await runtime.open();
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
    runtime.rename("Shared mirror");
    await runtime.flush();
    const recovered = new DocumentPersistence(session);
    runtimes.push(recovered);
    await recovered.open(runtime.stored?.url, true);
    expect(() =>
      runtime.doc.getXmlFragment("prosemirror").insert(1, [new XmlElement("paragraph")]),
    ).not.toThrow();
    runtime.change("<p>Local edit</p>", json("Local edit"));
    expect(mirrors.get(runtime.local?.name as string)?.get("update")).toEqual(
      encodeStateAsUpdate(runtime.doc),
    );
  });
  it("reopens a closed mirror connection without throwing or dropping the next edit", async () => {
    const { runtime } = await fixture();
    runtimes.push(runtime);
    await runtime.open();
    runtime.rename("Closed mirror");
    await runtime.flush();
    (runtime.local as unknown as { closed: boolean }).closed = true;
    expect(() =>
      runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]),
    ).not.toThrow();
    runtime.change("<p>Survives closure</p>", json("Survives closure"));
    await runtime.flush();
    expect(runtime.state).toBe("saved");
    expect(mirrors.get(runtime.local?.name as string)?.get("update")).toEqual(
      encodeStateAsUpdate(runtime.doc),
    );
  });
  it("reopens a closed mirror for an offline title-only edit", async () => {
    const { runtime } = await fixture();
    runtimes.push(runtime);
    await runtime.open();
    runtime.rename("Before closure");
    await runtime.flush();
    const closed = runtime.local;
    (closed as unknown as { closed: boolean }).closed = true;
    runtime.online = false;
    runtime.rename("Durable offline title");
    await vi.waitFor(() => expect(runtime.local).not.toBe(closed));
    await vi.waitFor(() =>
      expect(mirrors.get(runtime.local?.name as string)?.get("title")).toBe(
        "Durable offline title",
      ),
    );
    expect(mirrors.get(runtime.local?.name as string)?.get("pending")).toBe(1);
  });
  it("follows recovery mirrors offline and preserves pending edits through another recovery", async () => {
    const f = await fixture();
    const { runtime, session } = f;
    runtimes.push(runtime);
    await runtime.open();
    const paragraph = new XmlElement("paragraph");
    const text = new XmlText();
    text.insert(0, "Original");
    paragraph.insert(0, [text]);
    runtime.doc.getXmlFragment("prosemirror").insert(0, [paragraph]);
    runtime.change("<p>Original</p>", json("Original"));
    await runtime.flush();
    const url = runtime.stored?.url as string;
    const first = new DocumentPersistence(session);
    runtimes.push(first);
    await first.open(url, true);
    first.online = false;
    const firstText = (first.doc.getXmlFragment("prosemirror").get(0) as XmlElement).get(
      0,
    ) as XmlText;
    firstText.insert(8, " offline");
    first.change("<p>Original offline</p>", json("Original offline"));
    await first.destroy();
    f.intercept(async () => {
      throw new TypeError("offline");
    });
    const offline = new DocumentPersistence(session);
    runtimes.push(offline);
    await offline.open(url);
    expect(offline.online).toBe(false);
    expect(offline.doc.getXmlFragment("prosemirror").toString()).toBe(
      "<paragraph>Original offline</paragraph>",
    );
    await offline.destroy();
    f.intercept(undefined);
    const second = new DocumentPersistence(session);
    runtimes.push(second);
    await second.open(url, true);
    const reopened = new DocumentPersistence(session);
    runtimes.push(reopened);
    await reopened.open(url);
    await reopened.flush();
    expect(reopened.state).toBe("saved");
    expect(await replayText(reopened, session)).toBe("<paragraph>Original</paragraph>");
    const copy = await reopened.store.read(reopened.recoveredCopy as string);
    expect(copy?.data.body).toBe("<p>Original offline</p>");
    expect(mirrors.get(first.local?.name as string)?.get("pending")).toBe(0);
  });
  it("retains a rename made during creation when the next snapshot fails and the document reopens", async () => {
    const f = await fixture();
    const { runtime, session, pod } = f;
    runtimes.push(runtime);
    await runtime.open();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let creating = false;
    f.intercept(async (input, init) => {
      if (
        init?.method === "PUT" &&
        String(input).endsWith(".ttl") &&
        String(input).includes("/docs/")
      ) {
        if (new Headers(init.headers).has("if-match")) return new Response(null, { status: 503 });
        creating = true;
        await gate;
      }
      return pod.fetch(input, init);
    });
    runtime.rename("Original title");
    const writing = runtime.flush();
    await vi.waitFor(() => expect(creating).toBe(true));
    runtime.rename("Renamed while creating");
    release();
    await writing;
    expect(runtime.state).toBe("retrying");
    runtime.online = false;
    await runtime.destroy();
    const reopened = new DocumentPersistence(session);
    runtimes.push(reopened);
    await reopened.open(runtime.stored?.url);
    expect(reopened.title).toBe("Renamed while creating");
    expect(reopened.state).not.toBe("saved");
    f.intercept(undefined);
    await reopened.flush();
    expect(reopened.stored?.data.title).toBe("Renamed while creating");
    expect(reopened.state).toBe("saved");
  });
  it("resumes creation after the initial log read fails without duplicating the document", async () => {
    const f = await fixture();
    const { runtime, pod, session } = f;
    runtimes.push(runtime);
    await runtime.open();
    const created = vi.fn();
    runtime.onCreated = created;
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
    f.intercept(async (input, init) =>
      String(input).endsWith("/updates/") && (init?.method ?? "GET") === "GET"
        ? new Response(null, { status: 503 })
        : pod.fetch(input, init),
    );
    runtime.rename("Resume creation");
    await runtime.flush();
    const url = runtime.stored?.url;
    expect(runtime.state).toBe("retrying");
    expect(created).not.toHaveBeenCalled();
    f.intercept(undefined);
    runtime.change("<p>Edited while creating</p>", json("Edited while creating"));
    await runtime.flush();
    expect(runtime.stored?.data.body).toBe("<p>Edited while creating</p>");
    expect(runtime.stored?.url).toBe(url);
    expect(runtime.provider?.synced).toBe(true);
    expect(created).toHaveBeenCalledExactlyOnceWith(url);
    expect(mirrors.has(`suite.docs.draft:${session.webId}`)).toBe(false);
    expect(await replayText(runtime, session)).toContain("paragraph");
    expect(runtime.state).toBe("saved");
  });
  it("keeps full-state retry pending until the log really contains the latest edit", async () => {
    const f = await fixture();
    const { runtime, pod, session } = f;
    runtimes.push(runtime);
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("old")]);
    runtime.rename("Retry log");
    await runtime.flush();
    f.intercept(async (input, init) =>
      init?.method === "PUT" && String(input).includes("/updates/")
        ? new Response(null, { status: 503 })
        : pod.fetch(input, init),
    );
    runtime.doc.getXmlFragment("prosemirror").insert(1, [new XmlElement("latest")]);
    await runtime.provider?.flush();
    runtime.change("<p>Latest</p>", json("Latest"));
    await runtime.flush();
    expect(runtime.state).toBe("retrying");
    expect(mirrors.get(runtime.local?.name as string)?.get("pending")).toBe(1);
    f.intercept(undefined);
    await runtime.flush();
    expect(await replayText(runtime, session)).toContain("latest");
    expect(runtime.state).toBe("saved");
    expect(mirrors.get(runtime.local?.name as string)?.get("pending")).toBe(0);
  });
  it("retains the pending title baseline across reopen and surfaces a remote rename", async () => {
    const { runtime, session } = await fixture();
    runtimes.push(runtime);
    await runtime.open();
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
    runtime.rename("Original title");
    await runtime.flush();
    const original = runtime.stored;
    if (!original) throw new Error("Missing document");
    runtime.online = false;
    runtime.rename("Local title");
    runtime.change("<p>Local body</p>", json("Local body"));
    await runtime.destroy();
    await runtime.store.save(
      original,
      { title: "Remote title" },
      { regenerate: () => ({ body: original.data.body, format: "text/html" }) },
    );
    const reopened = new DocumentPersistence(session);
    runtimes.push(reopened);
    await reopened.open(original.url);
    reopened.capture("<p>Local body</p>", json("Local body"));
    await reopened.flush();
    expect(reopened.conflict?.remoteTitle).toBe("Remote title");
    expect((await reopened.store.read(original.url))?.data.title).toBe("Remote title");
    await reopened.resolveTitle(false);
    expect(reopened.stored?.data.body).toBe("<p>Local body</p>");
  });
  it("backs off and saves after reconnect synchronization temporarily fails", async () => {
    const { runtime } = await fixture();
    runtimes.push(runtime);
    runtime.rename("Reconnect");
    await runtime.flush();
    runtime.online = false;
    runtime.change("<p>After offline</p>", json("After offline"));
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(2000);
    const previous = runtime.provider as SolidPersistence;
    const sync = vi.spyOn(previous, "sync").mockRejectedValueOnce(new TypeError("unavailable"));
    await runtime.reconnect();
    expect(runtime.state).toBe("retrying");
    await vi.advanceTimersByTimeAsync(4000);
    expect(sync).toHaveBeenCalledOnce();
    expect(previous.destroyed).toBe(true);
    expect(runtime.provider).not.toBe(previous);
    expect(runtime.state).toBe("saved");
    expect(runtime.stored?.data.body).toBe("<p>After offline</p>");
  });
  it("opens a durable local copy before an offline pod read and reconciles on reconnect", async () => {
    const f = await fixture();
    const { runtime, session } = f;
    runtimes.push(runtime);
    await runtime.open();
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
    runtime.rename("Cached title");
    await runtime.flush();
    runtime.online = false;
    const paragraph = runtime.doc.getXmlFragment("prosemirror").get(0) as XmlElement;
    const text = new XmlText();
    paragraph.insert(0, [text]);
    text.insert(0, "Durable offline");
    runtime.change("<p>Durable offline</p>", json("Durable offline"));
    await runtime.destroy();
    f.intercept(async () => {
      throw new TypeError("offline");
    });
    const reopened = new DocumentPersistence(session);
    runtimes.push(reopened);
    await reopened.open(runtime.stored?.url);
    expect(reopened.local).toBeDefined();
    expect(reopened.doc.getXmlFragment("prosemirror").toString()).toContain("offline");
    expect(reopened.title).toBe("Cached title");
    expect(reopened.online).toBe(false);
    reopened.capture("<p>Durable offline</p>", json("Durable offline"));
    f.intercept(undefined);
    await reopened.reconnect();
    expect(reopened.stored?.data.body).toBe("<p>Durable offline</p>");
    expect(reopened.provider?.synced).toBe(true);
    expect(await replayText(reopened, session)).toContain("offline");
  });
  it("finishes initial Yjs reconciliation before exposing a cached document for editing", async () => {
    const f = await fixture();
    const { runtime, session, pod } = f;
    runtimes.push(runtime);
    await runtime.open();
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
    runtime.rename("Delayed reconciliation");
    await runtime.flush();
    await runtime.destroy();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loading = false;
    f.intercept(async (input, init) => {
      if (String(input).endsWith("/updates/") && (init?.method ?? "GET") === "GET") {
        loading = true;
        await gate;
      }
      return pod.fetch(input, init);
    });
    const reopened = new DocumentPersistence(session);
    runtimes.push(reopened);
    let editable = false;
    const opening = reopened.open(runtime.stored?.url).then(() => {
      editable = true;
    });
    await vi.waitFor(() => expect(loading).toBe(true));
    // Drain the cached-open microtasks while the network merge remains gated.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    try {
      expect(editable).toBe(false);
    } finally {
      release();
      await opening;
    }
    expect(reopened.provider?.synced).toBe(true);
  });
  it("aborts an open whose pod read resolves after destruction without leaking mirrors or providers", async () => {
    const { runtime, session } = await fixture();
    runtimes.push(runtime);
    runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
    runtime.rename("Late open");
    await runtime.flush();
    const opened = new DocumentPersistence(session);
    const read = vi.spyOn(opened.store, "read");
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    read.mockImplementation(async () => {
      await gate;
      return runtime.stored;
    });
    const pending = opened.open(runtime.stored?.url).catch((error: unknown) => error);
    // Let open enter its network read, regardless of whether IndexedDB is opened first.
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await opened.destroy();
    const active = connections.size;
    release?.();
    await pending;
    expect(connections.size).toBe(active);
    expect(opened.provider?.destroyed ?? true).toBe(true);
  });
});

it("asks about a mismatched title when resuming legacy pending metadata without a baseline", async () => {
  const { runtime, session } = await fixture();
  runtimes.push(runtime);
  runtime.doc.getXmlFragment("prosemirror").insert(0, [new XmlElement("paragraph")]);
  runtime.rename("Current remote title");
  await runtime.flush();
  const url = runtime.stored?.url as string;
  await runtime.destroy();
  mirrors.get(runtime.local?.name as string)?.set("pending", 1);
  mirrors.get(runtime.local?.name as string)?.set("title", "Older cached title");
  mirrors.get(runtime.local?.name as string)?.delete("edit");
  const reopened = new DocumentPersistence(session);
  runtimes.push(reopened);
  await reopened.open(url);
  await reopened.flush();
  expect(reopened.conflict?.remoteTitle).toBe("Current remote title");
  expect((await reopened.store.read(url))?.data.title).toBe("Current remote title");
});

it("keeps the offline banner state while a background reconnect waits for the browser network", async () => {
  const { runtime } = await fixture();
  runtimes.push(runtime);
  runtime.rename("Wait for network");
  await runtime.flush();
  runtime.online = false;
  runtime.change("<p>Still offline</p>", json("Still offline"));
  vi.stubGlobal("navigator", { onLine: false });
  const sync = vi.spyOn(runtime.provider as SolidPersistence, "sync");
  await runtime.reconnect();
  expect(runtime.online).toBe(false);
  expect(sync).not.toHaveBeenCalled();
  expect(runtime.stored?.data.body).not.toBe("<p>Still offline</p>");
  vi.stubGlobal("navigator", { onLine: true });
  await runtime.reconnect();
  expect(runtime.online).toBe(true);
  expect(runtime.stored?.data.body).toBe("<p>Still offline</p>");
});
