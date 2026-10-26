// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate, XmlElement } from "yjs";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

// Browser IndexedDB is exercised by Playwright; the Node tests inspect mirror metadata.
const connections = vi.hoisted(() => new Set<object>());
const mirrors = vi.hoisted(() => new Map<string, Map<string, unknown>>());
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve(this);
    constructor(
      readonly name: string,
      readonly doc: Doc,
    ) {
      if (!mirrors.has(name)) mirrors.set(name, new Map());
      const update = mirrors.get(name)?.get("update") as Uint8Array | undefined;
      if (update) applyUpdate(doc, update);
      doc.on("update", this.save);
      connections.add(this);
    }
    save = () => mirrors.get(this.name)?.set("update", encodeStateAsUpdate(this.doc));
    async get(key: string) {
      return mirrors.get(this.name)?.get(key);
    }
    async set(key: string, value: unknown) {
      mirrors.get(this.name)?.set(key, value);
    }
    async destroy() {
      this.doc.off("update", this.save);
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
    expect(mirrors.get(runtime.stored?.url as string)?.get("pending")).toBe(0);
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
    expect(mirrors.get(runtime.stored?.url as string)?.get("pending")).toBe(1);
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
    expect(mirrors.get(runtime.stored?.url as string)?.get("pending")).toBe(1);
    f.intercept(undefined);
    await runtime.flush();
    expect(await replayText(runtime, session)).toContain("latest");
    expect(runtime.state).toBe("saved");
    expect(mirrors.get(runtime.stored?.url as string)?.get("pending")).toBe(0);
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
    const sync = vi
      .spyOn(runtime.provider as SolidPersistence, "sync")
      .mockRejectedValueOnce(new TypeError("unavailable"));
    await runtime.reconnect();
    expect(runtime.state).toBe("retrying");
    await vi.advanceTimersByTimeAsync(4000);
    expect(sync).toHaveBeenCalledTimes(2);
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
    runtime.doc.getXmlFragment("prosemirror").insert(1, [new XmlElement("offline")]);
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
  mirrors.get(url)?.set("pending", 1);
  mirrors.get(url)?.set("title", "Older cached title");
  mirrors.get(url)?.delete("edit");
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
