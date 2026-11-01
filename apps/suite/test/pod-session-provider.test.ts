// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriveSidebar } from "../src/apps/drive/components/sidebar";
import { getDemoPod } from "../src/lib/demo-pod/browser";
import {
  ExtensionSessionError,
  openExtensionSession,
  requestStorageAccess,
} from "../src/lib/session/extension-pod-session";
import { EXTENSION_MARKER } from "../src/lib/session/extension-session";
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
vi.mock("@/lib/session/pod-session", async () => import("../src/lib/session/pod-session"));
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
let api: { webId: string | null; fetch: typeof fetch | undefined };
const extensionSession = (webId = WEBID): ExtensionPodSession => ({
  mode: "extension",
  webId,
  displayName: "Alice",
  storageUrl: "https://alice.example/",
  fetch: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  disconnect: vi.fn(),
});
function Probe({ sidebar = false }: { sidebar?: boolean }) {
  state = usePodSessionState();
  return sidebar && state.status === "ready" ? h(DriveSidebar, { usage: 0 }) : null;
}
const render = (sidebar = false) => mount(h(PodSessionProvider, null, h(Probe, { sidebar })));
const focus = () => act(() => window.dispatchEvent(new Event("focus")));
const grant = () => Object.assign(api, { webId: WEBID, fetch: vi.fn() });
const revoke = () => Object.assign(api, { webId: null, fetch: undefined });

beforeEach(() => {
  vi.clearAllMocks();
  api = { webId: null, fetch: undefined };
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
});

describe("PodSessionProvider", () => {
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
    expect(openExtensionSession).toHaveBeenCalledExactlyOnceWith(api);
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
      "Couldn't open your pod through the extension: no storage found in your profile",
    );
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
    if (session?.mode === "extension") expect(session.disconnect).toHaveBeenCalledOnce();
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
