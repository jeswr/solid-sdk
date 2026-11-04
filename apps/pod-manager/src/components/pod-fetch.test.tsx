// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryPod,
  TEST_POD_ROOT,
  TEST_WEBID,
  TEST_PROFILE_DOC,
} from "@jeswr/pod-connectors/testing";
import { useSession, type Session } from "./session-provider";
import { useFolder } from "./use-files";
import { useResource } from "./use-resource";
import { ResourceViewer } from "./resource-viewer";
import { usePodMedia } from "./use-pod-media";
import { useItems, useStore } from "./use-productivity";
import { calendarStore } from "@/lib/calendar";
import { contactsStore } from "@/lib/contacts";
import { readProfile } from "@/lib/profile";
import { readCache } from "@/lib/swr-cache";

vi.mock("./session-provider", () => ({ useSession: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let pod: ReturnType<typeof createMemoryPod>;
let podFetch: ReturnType<typeof vi.fn<typeof fetch>>;
let ambientFetch: ReturnType<typeof vi.fn<typeof fetch>>;
let session: Session;
let objectUrls: number;
let revoke: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("WebSocket", undefined);
  pod = createMemoryPod();
  podFetch = vi.fn(pod.fetch);
  ambientFetch = vi.fn<typeof fetch>(() => {
    throw new Error("Pod read used global fetch");
  });
  vi.stubGlobal("fetch", ambientFetch);
  objectUrls = 0;
  revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:manager/${++objectUrls}`),
      revokeObjectURL: revoke,
    }),
  );
  session = {
    status: "logged-in",
    webId: TEST_WEBID,
    profile: readProfile(TEST_WEBID, pod.dataset(TEST_PROFILE_DOC)),
    activeStorage: TEST_POD_ROOT,
    sourceFetch: ambientFetch,
    podFetch,
    recentAccounts: [],
    recentProviders: [],
    pending: null,
    error: null,
    ready: true,
    startupFailed: false,
    retry: vi.fn(),
    loginWithAddress: vi.fn(),
    loginWithIssuer: vi.fn(),
    loginWithAccount: vi.fn(),
    cancelLogin: vi.fn(),
    logout: vi.fn(async () => {}),
    setActiveStorage: vi.fn(),
  };
  vi.mocked(useSession).mockReturnValue(session);
  readCache.clearAll();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(hook: () => void) {
  function Harness() {
    hook();
    return null;
  }
  await act(async () => {
    root.render(createElement(Harness));
  });
}
describe("explicit session transport with a throwing global fetch", () => {
  it("lists files through podFetch", async () => {
    await pod.fetch(`${TEST_POD_ROOT}files/hello.txt`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    let result!: ReturnType<typeof useFolder>;
    await render(() => {
      result = useFolder(`${TEST_POD_ROOT}files/`);
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.map((item) => item.url)).toEqual([`${TEST_POD_ROOT}files/hello.txt`]);
    expect(podFetch).toHaveBeenCalledWith(`${TEST_POD_ROOT}files/`, expect.anything());
    expect(ambientFetch).not.toHaveBeenCalled();
  });
  it("reads, creates, updates and deletes contacts through the hook's store", async () => {
    let store!: ReturnType<typeof contactsStore>;
    let items!: ReturnType<typeof useItems>;
    await render(() => {
      store = useStore(contactsStore)!;
      items = useItems(store);
    });
    let created!: Awaited<ReturnType<typeof store.create>>;
    await act(async () => {
      created = await store.create({ fn: "Alice Contact" });
    });
    await act(async () => items.reload());
    expect(items.data).toHaveLength(1);
    const read = await store.read(created.url);
    expect(read?.data.fn).toBe("Alice Contact");
    await store.update(created.url, { fn: "Alice Updated" }, read!.etag);
    expect((await store.read(created.url))?.data.fn).toBe("Alice Updated");
    await store.remove(created.url);
    expect(pod.get(created.url)).toBeUndefined();
    expect(ambientFetch).not.toHaveBeenCalled();
  });
  it("lists calendar events through the hook's store", async () => {
    let store!: ReturnType<typeof calendarStore>;
    let items!: ReturnType<typeof useItems>;
    await render(() => {
      store = useStore(calendarStore)!;
      items = useItems(store);
    });
    await act(async () => {
      await store.create({ name: "Private meeting", start: new Date("2026-11-02T10:00:00Z") });
    });
    await act(async () => items.reload());
    expect(items.data?.[0]?.data).toMatchObject({ name: "Private meeting" });
    expect(ambientFetch).not.toHaveBeenCalled();
  });
  it("loads text and parsed RDF for the resource viewer through podFetch", async () => {
    let result!: ReturnType<typeof useResource>;
    await render(() => {
      result = useResource(TEST_PROFILE_DOC);
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.dataset?.size).toBeGreaterThan(0);
    expect(result.data?.text).toContain("Alice Test");
    expect(ambientFetch).not.toHaveBeenCalled();
  });
  it("loads binary previews through podFetch and revokes the object URL on unmount", async () => {
    const url = `${TEST_POD_ROOT}photo.png`;
    await pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    let result!: ReturnType<typeof useResource>;
    await render(() => {
      result = useResource(url);
    });
    expect(result.data?.objectUrl).toBe("blob:manager/1");
    expect(result.data?.viewer.kind).toBe("image");
    await act(async () => root.unmount());
    expect(revoke).toHaveBeenCalledWith("blob:manager/1");
    expect(ambientFetch).not.toHaveBeenCalled();
  });
  it("offers active content only as an authenticated download, never an app-origin blob navigation", async () => {
    const url = `${TEST_POD_ROOT}page.html`;
    await pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/html" },
      body: "<script>unsafe()</script>",
    });
    function Harness() {
      const loaded = useResource(url);
      return loaded.data ? <ResourceViewer resource={loaded.data} /> : null;
    }
    await act(async () => root.render(<Harness />));
    const anchor = container.querySelector("a")!;
    expect(anchor.href).toBe("blob:manager/1");
    expect(anchor.download).toBe("page.html");
    expect(vi.mocked(URL.createObjectURL).mock.calls[0][0]).toMatchObject({ type: "application/octet-stream" });
    expect(container.querySelector("[target='_blank']")).toBeNull();
    expect(container.querySelector("object,iframe,script")).toBeNull();
    expect(ambientFetch).not.toHaveBeenCalled();
  });
  it("loads linked Pod artwork through podFetch and cleans up on logout", async () => {
    const url = `${TEST_POD_ROOT}photo.png`;
    await pod.fetch(url, { method: "PUT", body: new Uint8Array([1]) });
    let src: string | undefined;
    await render(() => {
      src = usePodMedia(url);
    });
    expect(src).toBe("blob:manager/1");
    expect(podFetch).toHaveBeenCalledWith(url, { signal: expect.any(AbortSignal) });
    vi.mocked(useSession).mockReturnValue({ ...session, status: "logged-out" });
    await render(() => {
      src = usePodMedia(url);
    });
    expect(src).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith("blob:manager/1");
    expect(ambientFetch).not.toHaveBeenCalled();
  });
});
