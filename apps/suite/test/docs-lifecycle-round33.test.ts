// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { useDocument } from "../src/apps/docs/hooks/use-document";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const navigation = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}));
const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
const runtimes: DocumentPersistence[] = [];
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.params = new URLSearchParams();
  navigation.router.replace.mockClear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) {
    runtime.online = false;
    await runtime.destroy();
  }
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
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
  return { session, client };
}
function edit(runtime: DocumentPersistence, value: string) {
  const json: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  };
  const extensions = baseExtensions(runtime.session.fetch);
  const seed = prosemirrorJSONToYDoc(getSchema(extensions), json);
  const fragment = runtime.doc.getXmlFragment("prosemirror");
  fragment.delete(0, fragment.length);
  applyUpdate(runtime.doc, encodeStateAsUpdate(seed));
  seed.destroy();
  runtime.change(generateHTML(json, extensions), json);
}

it("round33 consumes document recovery before New and its creation redirect, retaining later edits", async () => {
  const { session, client } = await fixture();
  const seed = client();
  await seed.open();
  edit(seed, "Original");
  await seed.flush();
  const url = seed.stored?.url as string;
  await seed.destroy();
  const opens = vi.spyOn(DocumentPersistence.prototype, "open");
  let state!: ReturnType<typeof useDocument>;
  function Harness({ resource }: { resource: string | undefined }) {
    state = useDocument(session, resource);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (resource: string | undefined) =>
    act(async () => root.render(createElement(Harness, { resource })));
  const opened = async () => {
    await act(async () => {
      const result = opens.mock.results.at(-1);
      if (result?.type === "return") await result.value;
    });
    expect(state.runtime).not.toBeNull();
    return state.runtime as DocumentPersistence;
  };
  try {
    await render(url);
    const first = await opened();
    await act(async () => state.recover());
    const recovered = await opened();
    expect(recovered).not.toBe(first);
    expect(opens).toHaveBeenLastCalledWith(url, true);
    window.history.replaceState({}, "", "/docs/new");
    await render(undefined);
    const draft = await opened();
    expect(opens).toHaveBeenLastCalledWith(undefined, false);
    // Delay the first pod allocation while the user keeps typing.
    const create = draft.store.create.bind(draft.store);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(draft.store, "create").mockImplementationOnce(async (...args) => {
      started();
      await hold;
      return create(...args);
    });
    await act(async () => edit(draft, "a"));
    let saving!: Promise<void>;
    await act(async () => {
      saving = draft.flush();
      await waiting;
    });
    await act(async () => edit(draft, "a complete sentence"));
    await act(async () => {
      release();
      await saving;
    });
    const created = draft.stored?.url as string;
    await render(created);
    expect(state.runtime).toBe(draft);
    expect(opens).toHaveBeenLastCalledWith(undefined, false);
    await act(async () => draft.flush());
    const reopened = client();
    await act(async () => reopened.open(created));
    expect(
      getSchema(baseExtensions(session.fetch)).nodeFromJSON(yDocToProsemirrorJSON(reopened.doc))
        .textContent,
    ).toBe("a complete sentence");
    expect((await reopened.store.read(created))?.data.body).toContain("a complete sentence");
    // A queued recovery belongs to the old route even if React batches it
    // with navigation; a stale button callback cannot recover the new route.
    await act(async () => {
      state.recover();
      root.render(createElement(Harness, { resource: url }));
    });
    await opened();
    expect(opens).toHaveBeenLastCalledWith(url, false);
    const staleRecover = state.recover;
    await render(created);
    const active = await opened();
    const count = opens.mock.calls.length;
    await act(async () => staleRecover());
    expect(state.runtime).toBe(active);
    expect(opens).toHaveBeenCalledTimes(count);
  } finally {
    await act(async () => root.unmount());
  }
});

it("round33 retries a partial incremental read with a fresh provider and applies every remote edit", async () => {
  const { client } = await fixture();
  const writer = client();
  await writer.open();
  edit(writer, "Start");
  await writer.flush();
  // Separate browser storage: remote changes must arrive through the pod log.
  vi.stubGlobal("indexedDB", new IDBFactory());
  const reader = client();
  await reader.open(writer.stored?.url);
  const provider = reader.provider as NonNullable<typeof reader.provider>;
  writer.doc.getMap("remote-edits").set("first", "One");
  writer.doc.getMap("remote-edits").set("second", "Two");
  await writer.provider?.flush();
  const read = provider.store.readUpdate.bind(provider.store);
  let reads = 0;
  vi.spyOn(provider.store, "readUpdate").mockImplementation(async (url) => {
    if (++reads === 2) throw new Error("second update unavailable");
    return read(url);
  });
  await reader.reconnect();
  expect(reader.state).toBe("retrying");
  expect(reader.doc.getMap("remote-edits").toJSON()).toEqual({});
  await reader.reconnect();
  expect(reader.doc.getMap("remote-edits").toJSON()).toEqual({ first: "One", second: "Two" });
  expect(reader.provider).not.toBe(provider);
  expect(provider.destroyed).toBe(true);
  expect(reader.state).toBe("saved");
  await reader.reconnect();
  expect(reader.doc.getMap("remote-edits").toJSON()).toEqual({ first: "One", second: "Two" });
});

it.each([
  "Documents",
  "another document",
])("round42 offline body and title retry after navigating to %s without reopening", async (destination) => {
  const { session, client } = await fixture();
  const seed = client();
  await seed.open();
  edit(seed, "Original");
  await seed.flush();
  const url = seed.stored?.url as string;
  await seed.destroy();
  const other = client();
  await other.open();
  edit(other, "Other");
  await other.flush();
  const otherUrl = other.stored?.url as string;
  await other.destroy();
  let connected = true;
  const fetchOnline = session.fetch;
  const traffic = vi.spyOn(session, "fetch").mockImplementation((...args) => {
    if (!connected) return Promise.reject(new TypeError("Offline"));
    return fetchOnline(...args);
  });
  const opens = vi.spyOn(DocumentPersistence.prototype, "open");
  let state!: ReturnType<typeof useDocument>;
  function Harness({ resource }: { resource: string | undefined }) {
    state = useDocument(session, resource);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let mounted = true;
  try {
    await act(async () => root.render(createElement(Harness, { resource: url })));
    await act(async () => opens.mock.results.at(-1)?.value);
    const runtime = state.runtime as DocumentPersistence;
    runtimes.push(runtime);
    connected = false;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event("offline")));
    await act(async () => {
      edit(runtime, "Changed offline body");
      runtime.rename("Changed offline title");
      await runtime.flush();
    });
    const reconnect = vi.spyOn(runtime, "reconnect");
    const destroy = vi.spyOn(runtime, "destroy");
    if (destination === "Documents") {
      await act(async () => root.unmount());
      mounted = false;
    } else {
      await act(async () => root.render(createElement(Harness, { resource: otherUrl })));
      await act(async () => opens.mock.results.at(-1)?.value);
      runtimes.push(state.runtime as DocumentPersistence);
    }
    connected = true;
    traffic.mockClear();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event("online")));
    await act(async () => {
      expect(reconnect).toHaveBeenCalled();
      await Promise.all(reconnect.mock.results.map((result) => result.value));
      expect(destroy).toHaveBeenCalledTimes(1);
      await Promise.all(destroy.mock.results.map((result) => result.value));
    });
    expect(traffic).toHaveBeenCalled();
    const remote = await seed.store.read(url);
    expect(remote?.data.body).toContain("Changed offline body");
    expect(remote?.data.title).toBe("Changed offline title");
    const attempts = reconnect.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(reconnect).toHaveBeenCalledTimes(attempts);
  } finally {
    if (mounted) await act(async () => root.unmount());
    host.remove();
  }
});
