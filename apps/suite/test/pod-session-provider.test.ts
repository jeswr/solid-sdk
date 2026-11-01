// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriveSidebar } from "../src/apps/drive/components/sidebar";
import { getDemoPod } from "../src/lib/demo-pod/browser";
import {
  ExtensionSessionError,
  openExtensionSession,
  requestStorageAccess,
  STORAGE_CLASS,
} from "../src/lib/session/extension-pod-session";
import {
  EXTENSION_CHANNEL,
  EXTENSION_MARKER,
  EXTENSION_READY_EVENT,
  type SolidExtensionApi,
  type SolidExtensionGrant,
} from "../src/lib/session/extension-session";
import {
  type ExtensionPodSession,
  PodSessionProvider,
  usePodSessionState,
} from "../src/lib/session/pod-session";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

vi.mock("../src/lib/demo-pod/browser", () => ({
  getDemoPod: vi.fn(),
  resetDemoPod: vi.fn(),
}));
vi.mock("../src/lib/session/extension-pod-session", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openExtensionSession: vi.fn(),
  requestStorageAccess: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/drive/my" }));
vi.mock("../src/apps/drive/state/drive-context", () => ({
  useDrive: () => {
    const current = usePodSessionState();
    if (current.status !== "ready") throw new Error("Drive rendered before its session opened");
    return { session: current.session, driveRoot: undefined };
  },
}));
vi.mock("../src/apps/drive/state/ui", () => ({
  useDriveUi: () => ({ currentFolder: undefined }),
}));

const WEBID = "https://alice.example/profile#me";
let state: ReturnType<typeof usePodSessionState>;
let grants: SolidExtensionGrant[];
const storageGrant = (): SolidExtensionGrant => ({
  grantId: "storage",
  dataClass: STORAGE_CLASS,
  modes: ["read", "write"],
  purpose: "Solid Suite",
  expiresAt: Date.now() + 60_000,
  targets: [{ url: "https://alice.example/", kind: "container" }],
});
function makeApi() {
  return {
    webId: null as string | null,
    fetch: undefined as typeof fetch | undefined,
    listGrants: vi.fn(async () => grants),
    revokeGrant: vi.fn(async (id: string) => {
      grants = grants.filter((grant) => grant.grantId !== id);
      return true;
    }),
    disconnect: undefined as SolidExtensionApi["disconnect"],
  };
}
let api: ReturnType<typeof makeApi>;
const extensionSession = (webId = WEBID): ExtensionPodSession => ({
  mode: "extension",
  webId,
  displayName: "Alice",
  storageUrl: "https://alice.example/",
  fetch: vi.fn(),
  publicFetch: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  disconnect: vi.fn(),
});
function Probe({ sidebar = false }: { sidebar?: boolean }) {
  state = usePodSessionState();
  return sidebar && state.status === "ready" ? h(DriveSidebar, { usage: 0 }) : null;
}
const render = (sidebar = false) => mount(h(PodSessionProvider, null, h(Probe, { sidebar })));
const focus = () => act(() => window.dispatchEvent(new Event("focus")));
const grant = () => {
  grants = [storageGrant()];
  Object.assign(api, { webId: WEBID, fetch: vi.fn() });
};
const revoke = () => {
  grants = [];
  Object.assign(api, { webId: null, fetch: undefined });
};
const stateMessage = () =>
  act(() =>
    window.dispatchEvent(
      new window.MessageEvent("message", {
        source: window,
        data: { channel: EXTENSION_CHANNEL, dir: "to-page", type: "SOLID_STATE_UPDATE" },
      }),
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
  grants = [];
  api = makeApi();
  Object.defineProperty(window, "solid", { configurable: true, value: api });
  document.documentElement.setAttribute(EXTENSION_MARKER, "1");
  vi.mocked(getDemoPod).mockResolvedValue({
    fetch: vi.fn(),
    subscribe: () => () => {},
  } as unknown as Awaited<ReturnType<typeof getDemoPod>>);
  vi.mocked(openExtensionSession).mockResolvedValue(extensionSession());
  vi.mocked(requestStorageAccess).mockResolvedValue(true);
});

afterEach(() => {
  document.documentElement.removeAttribute(EXTENSION_MARKER);
  vi.restoreAllMocks();
});

describe("PodSessionProvider", () => {
  it("ignores bridge reply storms and coalesces state broadcasts during grant checks", async () => {
    grant();
    const first = deferred<SolidExtensionGrant[]>();
    const second = deferred<SolidExtensionGrant[]>();
    let inFlight = 0;
    let maxInFlight = 0;
    const reply = (requestId: string, extra: object = {}) =>
      window.dispatchEvent(
        new window.MessageEvent("message", {
          source: window,
          data: {
            channel: EXTENSION_CHANNEL,
            dir: "to-page",
            type: "SOLID_ACCESS_RESPONSE",
            requestId,
            grants,
            ...extra,
          },
        }),
      );
    api.listGrants.mockImplementation(async () => {
      const index = api.listGrants.mock.calls.length;
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      try {
        const result = await (index === 1 ? first.promise : second.promise);
        reply(`list-${index}`);
        return result;
      } finally {
        --inFlight;
      }
    });
    await render();
    expect(api.listGrants).toHaveBeenCalledOnce();
    await act(() => {
      for (let i = 0; i < 100; i++) reply(`unrelated-${i}`);
    });
    expect(api.listGrants).toHaveBeenCalledOnce();
    // Capture the deferred zero-delay notifications instead of letting real timers also fire
    // them: a real timer landing after the queued check would add a legitimate extra recheck.
    const realSetTimeout = window.setTimeout.bind(window);
    const deferredNotifications: Array<() => void> = [];
    const timers = vi.spyOn(window, "setTimeout").mockImplementation(((
      callback: () => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 0) {
        deferredNotifications.push(callback);
        return 0;
      }
      return realSetTimeout(callback, ms, ...args);
    }) as typeof window.setTimeout);
    for (let i = 0; i < 12; i++) await stateMessage();
    timers.mockRestore();
    await act(() => {
      for (const callback of deferredNotifications) callback();
    });
    expect(api.listGrants).toHaveBeenCalledOnce();
    await act(() => first.resolve(grants));
    expect(api.listGrants).toHaveBeenCalledTimes(2);
    await act(() => second.resolve(grants));
    await act(() => {
      for (let i = 0; i < 100; i++) reply(`late-${i}`);
    });
    expect(api.listGrants).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
    expect(state).toMatchObject({ status: "ready", session: { mode: "extension" } });
  });

  it("rechecks grants when the page becomes visible", async () => {
    await render();
    grant();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(state).toMatchObject({ session: { mode: "demo" } });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(state).toMatchObject({ session: { mode: "extension" } });
  });

  it("uses an appended valid grant after reconnect without deleting an empty grant", async () => {
    grant();
    const empty = { ...storageGrant(), grantId: "old", targets: [] };
    grants = [empty];
    await render();
    expect(state).toMatchObject({ session: { mode: "demo" } });
    vi.mocked(requestStorageAccess).mockImplementation(async () => {
      grants.push(storageGrant());
      return true;
    });
    await act(() => state.connectExtension());
    expect(state).toMatchObject({ session: { mode: "extension" } });
    expect(grants[0]).toBe(empty);
    expect(openExtensionSession).toHaveBeenCalledWith(
      api,
      expect.objectContaining({ grant: grants[1] }),
    );
  });

  it("keeps an announced, unpopulated stub loading until delayed granted state arrives", async () => {
    const listGrants = api.listGrants;
    Object.assign(api, { listGrants: undefined });
    const timers = vi.spyOn(window, "setTimeout");
    await render();
    expect(state.status).toBe("loading");
    expect(getDemoPod).not.toHaveBeenCalled();
    expect(timers).toHaveBeenCalledWith(expect.any(Function), 1500);
    grant();
    Object.assign(api, { listGrants });
    await stateMessage();
    expect(state).toMatchObject({ status: "ready", session: { mode: "extension" } });
    expect(getDemoPod).not.toHaveBeenCalled();
  });

  it("handles an announcement received after mounting without opening demo first", async () => {
    document.documentElement.removeAttribute(EXTENSION_MARKER);
    await render();
    expect(state.status).toBe("loading");
    grant();
    document.documentElement.setAttribute(EXTENSION_MARKER, "1");
    await act(() => window.dispatchEvent(new Event(EXTENSION_READY_EVENT)));
    expect(state).toMatchObject({ session: { mode: "extension" } });
    expect(getDemoPod).not.toHaveBeenCalled();
  });

  it.each([
    "unpopulated",
    "unresponsive",
  ])("bounds initial %s state to 1.5 seconds", async (initial) => {
    const decision = deferred<SolidExtensionGrant[]>();
    if (initial === "unpopulated") Object.assign(api, { listGrants: undefined });
    else api.listGrants.mockReturnValueOnce(decision.promise);
    const timers = vi.spyOn(window, "setTimeout");
    await render();
    expect(state.status).toBe("loading");
    expect(getDemoPod).not.toHaveBeenCalled();
    const fallback = timers.mock.calls.find(([, ms]) => ms === 1500)?.[0] as () => void;
    await act(fallback);
    expect(state).toMatchObject({ status: "ready", session: { mode: "demo" } });
    if (initial === "unresponsive") await act(() => decision.resolve([]));
  });

  it.each([
    "focus",
    "message",
  ])("returns to demo on storage-only revocation via %s with privileged properties intact", async (event) => {
    grant();
    const view = await render(true);
    grants = [{ ...storageGrant(), grantId: "contacts", dataClass: "https://schema.org/Person" }];
    if (event === "focus") await focus();
    else await stateMessage();
    expect(state).toMatchObject({
      status: "ready",
      session: { mode: "demo" },
      extension: { granted: true, webId: WEBID },
    });
    expect(view.host.textContent).toContain("Reset demo");
    expect(view.host.textContent).toContain("Use your pod through the Solid extension");
    expect(view.host.textContent).toContain("No storage grant yet. Connect to use your pod.");
  });

  it("returns to demo at storage-grant expiry without a state message or focus", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    grant();
    grants = [{ ...storageGrant(), expiresAt: now + 2000 }];
    const timers = vi.spyOn(window, "setTimeout");
    await render();
    expect(state).toMatchObject({ session: { mode: "extension" } });
    vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    const expire = timers.mock.calls.find(([, ms]) => ms === 2000)?.[0] as () => void;
    await act(expire);
    expect(state).toMatchObject({ session: { mode: "demo" }, extension: { granted: true } });
  });

  it("caps the expiry timer for a 30-day grant to the browser timer limit", async () => {
    grant();
    grants = [{ ...storageGrant(), expiresAt: Date.now() + 30 * 86400_000 }];
    const timers = vi.spyOn(window, "setTimeout");
    await render();
    expect(timers).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647);
  });

  it("keeps demo recovery controls visible when grant introspection fails", async () => {
    grant();
    api.listGrants.mockRejectedValue(new Error("extension unreachable"));
    const view = await render(true);
    expect(state).toMatchObject({ session: { mode: "demo" }, extension: { granted: true } });
    expect(view.host.textContent).toContain("Couldn't reach the extension. Please try again.");
    expect(view.host.textContent).toContain("Reset demo");
    expect(view.host.textContent).toContain("Use your pod through the Solid extension");
  });

  it("ignores a delayed Alice grant decision once Bob has opened", async () => {
    grant();
    const decision = deferred<SolidExtensionGrant[]>();
    api.listGrants.mockReturnValueOnce(decision.promise);
    await render();
    api.webId = "https://bob.example/profile#me";
    vi.mocked(openExtensionSession).mockResolvedValueOnce(extensionSession(api.webId));
    await focus();
    await act(() => decision.resolve([storageGrant()]));
    expect(state).toMatchObject({ session: { mode: "extension", webId: api.webId } });
    expect(openExtensionSession).toHaveBeenCalledOnce();
  });

  it("invalidates Alice's generation on switch and does not revive it on switching back", async () => {
    grant();
    await render();
    const options = vi.mocked(openExtensionSession).mock.calls[0]?.[1];
    const aliceGeneration = options?.generation as number;
    expect(options?.isCurrent?.(aliceGeneration)).toBe(true);
    api.webId = "https://bob.example/profile#me";
    const decision = deferred<SolidExtensionGrant[]>();
    api.listGrants.mockReturnValueOnce(decision.promise);
    await focus();
    expect(options?.isCurrent?.(aliceGeneration)).toBe(false);
    grant();
    await focus();
    await act(() => decision.resolve([storageGrant()]));
    expect(options?.isCurrent?.(aliceGeneration)).toBe(false);
  });

  it("keeps Bob active when Alice's delayed public-profile opening finishes", async () => {
    const actual = await vi.importActual<typeof import("../src/lib/session/extension-pod-session")>(
      "../src/lib/session/extension-pod-session",
    );
    vi.mocked(openExtensionSession).mockImplementation(actual.openExtensionSession);
    const profile = deferred<Response>();
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("public profile offline"))
      .mockReturnValueOnce(profile.promise);
    grant();
    await render();
    expect(state.status).toBe("loading");
    api.webId = "https://bob.example/profile#me";
    grants = [
      {
        ...storageGrant(),
        grantId: "bob",
        targets: [{ url: "https://bob.example/", kind: "container" }],
      },
    ];
    await focus();
    await act(() => profile.resolve(new Response("Alice's profile")));
    expect(state).toMatchObject({
      status: "ready",
      session: { mode: "extension", webId: api.webId, storageUrl: "https://bob.example/" },
    });
    expect(getDemoPod).not.toHaveBeenCalled();
  });

  it("rejects retained Alice fetches, uploads and disconnects even after switching back to Alice", async () => {
    const actual = await vi.importActual<typeof import("../src/lib/session/extension-pod-session")>(
      "../src/lib/session/extension-pod-session",
    );
    vi.mocked(openExtensionSession).mockImplementation(actual.openExtensionSession);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("public profile offline"));
    grant();
    const response = deferred<Response>();
    const forwarded = vi.fn<typeof fetch>(() => response.promise);
    api.fetch = forwarded;
    await render();
    if (state.status !== "ready" || state.session.mode !== "extension")
      throw new Error("Expected Alice");
    const alice = state.session;
    const fetching = alice.fetch("https://alice.example/file");
    const body = deferred<ArrayBuffer>();
    const uploading = (async () =>
      alice.fetch("https://alice.example/upload", { method: "PUT", body: await body.promise }))();
    api.webId = "https://bob.example/profile#me";
    await focus();
    grant();
    await focus();
    expect(state).toMatchObject({ session: { webId: WEBID } });
    response.resolve(new Response("old Alice bytes"));
    body.resolve(new Uint8Array([0, 128, 255]).buffer);
    await act(async () => {
      await expect(fetching).rejects.toMatchObject({ code: "stale" });
      await expect(uploading).rejects.toMatchObject({ code: "stale" });
      await expect(alice.disconnect()).rejects.toMatchObject({ code: "stale" });
    });
    expect(forwarded).toHaveBeenCalledOnce();
    expect(api.revokeGrant).not.toHaveBeenCalled();
  });

  it.each([
    "native",
    "class",
  ])("re-runs the decision after a %s disconnect without a reload", async (method) => {
    const actual = await vi.importActual<typeof import("../src/lib/session/extension-pod-session")>(
      "../src/lib/session/extension-pod-session",
    );
    vi.mocked(openExtensionSession).mockImplementation(actual.openExtensionSession);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("public profile offline"));
    grant();
    const disconnect = vi.fn(async () => {
      grants = [];
      return true;
    });
    if (method === "native") api.disconnect = disconnect;
    await render();
    const session =
      state.status === "ready" && state.session.mode === "extension" ? state.session : undefined;
    expect(session).toBeDefined();
    await act(() => session?.disconnect());
    expect(state).toMatchObject({ session: { mode: "demo" }, extension: { granted: true } });
    if (method === "native") {
      expect(disconnect).toHaveBeenCalledOnce();
      expect(api.revokeGrant).not.toHaveBeenCalled();
    } else expect(api.revokeGrant).toHaveBeenCalledWith("storage");
  });

  it("waits for detection before falling back to the demo when the extension is absent", async () => {
    document.documentElement.removeAttribute(EXTENSION_MARKER);
    const timers = vi.spyOn(window, "setTimeout");
    try {
      await render();
      expect(state.status).toBe("loading");
      expect(timers).toHaveBeenCalledWith(expect.any(Function), 500);
      expect(getDemoPod).not.toHaveBeenCalled();
      const finishDetection = timers.mock.calls[0]?.[0] as () => void;
      await act(finishDetection);
      expect(state).toMatchObject({
        status: "ready",
        session: { mode: "demo" },
        extension: { present: false },
      });
    } finally {
      timers.mockRestore();
    }
  });

  it("opens an existing extension session without opening the demo pod", async () => {
    grant();
    await render();
    expect(state).toMatchObject({ status: "ready", session: { mode: "extension", webId: WEBID } });
    expect(openExtensionSession).toHaveBeenCalledExactlyOnceWith(
      api,
      expect.objectContaining({
        grant: grants[0],
        generation: expect.any(Number),
        isCurrent: expect.any(Function),
      }),
    );
    expect(getDemoPod).not.toHaveBeenCalled();
  });

  it("falls back to the demo and retains the extension error", async () => {
    grant();
    const error = new ExtensionSessionError("no-storage");
    vi.mocked(openExtensionSession).mockRejectedValue(error);
    const view = await render(true);
    expect(state).toMatchObject({
      status: "ready",
      session: { mode: "demo" },
      extensionError: error,
    });
    expect(view.host.textContent).toContain(
      "Your storage grant has no usable root. Connect again to choose your pod.",
    );
    await focus();
    expect(state.extensionError).toBe(error);
    expect(view.host.textContent).toContain("Reset demo");
  });

  it("switches from demo to extension on a grant, then back on a side-panel revoke", async () => {
    await render();
    expect(state).toMatchObject({ status: "ready", session: { mode: "demo" } });
    grant();
    await focus();
    expect(state).toMatchObject({ status: "ready", session: { mode: "extension" } });
    await focus();
    expect(openExtensionSession).toHaveBeenCalledOnce();
    revoke();
    await focus();
    expect(state).toMatchObject({
      status: "ready",
      session: { mode: "demo" },
      extension: { granted: false, webId: null },
    });
  });

  it("requests storage access and switches as soon as consent succeeds", async () => {
    await render();
    vi.mocked(requestStorageAccess).mockImplementation(async () => {
      grant();
      return true;
    });
    await act(() => state.connectExtension());
    expect(requestStorageAccess).toHaveBeenCalledExactlyOnceWith(api);
    expect(state).toMatchObject({ status: "ready", session: { mode: "extension" } });
  });

  it("offers extension access in the demo card and disconnect in the extension card", async () => {
    const opened = extensionSession();
    vi.mocked(openExtensionSession).mockResolvedValueOnce(opened);
    const view = await render(true);
    const connect = [...view.host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Use your pod through the Solid extension"),
    );
    expect(connect).toBeDefined();
    expect(view.host.textContent).toContain("Reset demo");
    vi.mocked(requestStorageAccess).mockImplementation(async () => {
      grant();
      return true;
    });
    await click(connect as HTMLButtonElement);
    expect(view.host.textContent).toContain("Using your pod through the Solid extension as Alice");
    expect(view.host.textContent).not.toContain("Reset demo");
    const disconnect = [...view.host.querySelectorAll("button")].find(
      (button) => button.textContent === "Disconnect",
    );
    await click(disconnect as HTMLButtonElement);
    const session = state.status === "ready" ? state.session : undefined;
    expect(session?.mode).toBe("extension");
    expect(opened.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps the demo after denied consent and exposes consent errors", async () => {
    await render();
    vi.mocked(requestStorageAccess).mockResolvedValueOnce(false);
    await act(() => state.connectExtension());
    expect(state).toMatchObject({ status: "ready", session: { mode: "demo" } });
    expect(openExtensionSession).not.toHaveBeenCalled();
    const error = new Error("consent unavailable");
    vi.mocked(requestStorageAccess).mockRejectedValueOnce(error);
    await act(() => state.connectExtension());
    expect(state.extensionError).toBe(error);
  });

  it("retries a failed extension opening when the person presses connect again", async () => {
    grant();
    vi.mocked(openExtensionSession).mockRejectedValueOnce(new ExtensionSessionError("no-storage"));
    await render();
    expect(state).toMatchObject({ session: { mode: "demo" } });
    await act(() => state.connectExtension());
    expect(state).toMatchObject({ session: { mode: "extension" } });
    expect(state.extensionError).toBeUndefined();
  });

  it("preserves a completed-consent retry when a focus event queues another check", async () => {
    grant();
    vi.mocked(openExtensionSession).mockRejectedValueOnce(new ExtensionSessionError("no-storage"));
    await render();
    expect(state).toMatchObject({ session: { mode: "demo" } });
    const decision = deferred<SolidExtensionGrant[]>();
    api.listGrants.mockReturnValueOnce(decision.promise);
    let connecting!: Promise<void>;
    await act(() => {
      connecting = state.connectExtension();
    });
    await focus();
    await act(async () => {
      decision.resolve(grants);
      await connecting;
    });
    expect(state).toMatchObject({ session: { mode: "extension" } });
    expect(openExtensionSession).toHaveBeenCalledTimes(2);
  });

  it("ignores a slow extension opening after its grant is revoked", async () => {
    const opening = deferred<ExtensionPodSession>();
    grant();
    vi.mocked(openExtensionSession).mockReturnValueOnce(opening.promise);
    await render();
    expect(state.status).toBe("loading");
    revoke();
    await focus();
    await act(() => opening.resolve(extensionSession()));
    expect(state).toMatchObject({ status: "ready", session: { mode: "demo" } });
  });

  it("ignores a slow demo opening after an extension grant appears", async () => {
    const opening = deferred<Awaited<ReturnType<typeof getDemoPod>>>();
    vi.mocked(getDemoPod).mockReturnValueOnce(opening.promise);
    await render();
    grant();
    await focus();
    await act(() =>
      opening.resolve({ fetch: vi.fn(), subscribe: () => () => {} } as unknown as Awaited<
        ReturnType<typeof getDemoPod>
      >),
    );
    expect(state).toMatchObject({ status: "ready", session: { mode: "extension" } });
  });

  it("opens a new extension session when the extension switches accounts", async () => {
    grant();
    await render();
    const bob = "https://bob.example/profile#me";
    api.webId = bob;
    vi.mocked(openExtensionSession).mockResolvedValueOnce(extensionSession(bob));
    await focus();
    expect(state).toMatchObject({ session: { mode: "extension", webId: bob } });
    expect(openExtensionSession).toHaveBeenCalledTimes(2);
  });

  it("reports demo storage errors with the source mode", async () => {
    const error = new Error("IndexedDB unavailable");
    vi.mocked(getDemoPod).mockRejectedValueOnce(error);
    await render();
    expect(state).toMatchObject({ status: "error", mode: "demo", error });
  });

  it("unsubscribes and ignores an opening that settles after unmount", async () => {
    grant();
    const opening = deferred<ExtensionPodSession>();
    vi.mocked(openExtensionSession).mockReturnValueOnce(opening.promise);
    const view = await render();
    await view.unmount();
    const previous = state;
    await act(() => opening.resolve(extensionSession()));
    revoke();
    await focus();
    expect(state).toBe(previous);
    expect(getDemoPod).not.toHaveBeenCalled();
  });
});
