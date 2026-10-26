// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Doc, XmlElement } from "yjs";
import { deleteDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

// Browser IndexedDB is exercised by Playwright; the Node tests inspect mirror metadata.
const mirrors = vi.hoisted(() => new Map<string, Map<string, unknown>>());
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve(this);
    constructor(readonly name: string) {
      if (!mirrors.has(name)) mirrors.set(name, new Map());
    }
    async get(key: string) {
      return mirrors.get(this.name)?.get(key);
    }
    async set(key: string, value: unknown) {
      mirrors.get(this.name)?.set(key, value);
    }
    async destroy() {}
    async clearData() {
      mirrors.delete(this.name);
    }
  },
  storeState: async () => {},
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
  const http: typeof fetch = async (input, init) => {
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
    fail: (value: boolean) => {
      failSnapshot = value;
    },
  };
}
const runtimes: DocumentPersistence[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.destroy()));
  mirrors.clear();
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
  it("deletes the document and its nested assets and log resources", async () => {
    const { runtime, session, pod } = await fixture();
    runtimes.push(runtime);
    runtime.change("<p>Delete me</p>", json("Delete me"));
    await runtime.flush();
    const stored = runtime.stored;
    if (!stored) throw new Error("Fixture was not created");
    await session.fetch(`${stored.data.assets}image.png`, {
      method: "PUT",
      body: "binary",
      headers: { "content-type": "image/png" },
    });
    await deleteDocument(stored.url, session);
    expect((await pod.fetch(stored.url)).status).toBe(404);
    expect((await pod.fetch(stored.data.updateLog as string)).status).toBe(404);
    expect((await pod.fetch(`${stored.data.assets}image.png`)).status).toBe(404);
  });
});
