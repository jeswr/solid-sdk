// AUTHORED-BY Claude Opus 5.5
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, h, mount } from "./drive-ui-dom";

const STORAGE = "https://pod.example/";
const FILE = `${STORAGE}drive/report.txt`;
const mocks = vi.hoisted(() => ({
  saveNatively: vi.fn<(blob: Blob, name: string, contentType?: string) => Promise<boolean>>(),
  toastError: vi.fn(),
}));
vi.mock("../src/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/drive/my",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ ref: encodeRef(FILE) }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: mocks.toastError,
  }),
}));
vi.mock("@/lib/native/save-file", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  saveNatively: mocks.saveNatively,
}));

import { DriveApp } from "../src/apps/drive/components/drive-app";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { useDriveActions } from "../src/apps/drive/state/ui";
import { NATIVE_SAVE_LIMIT } from "../src/lib/native/save-file";

let session: PodSession;
let drive: ReturnType<typeof useDrive>;
let actions: ReturnType<typeof useDriveActions>;
function Probe() {
  drive = useDrive();
  actions = useDriveActions();
  return null;
}

async function setup() {
  const pod = createDemoPod({
    root: STORAGE,
    seed: [{ path: "drive/report.txt", body: "hello", contentType: "text/plain" }],
  });
  session = {
    mode: "demo",
    webId: `${STORAGE}profile#me`,
    displayName: "Me",
    storageUrl: STORAGE,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: vi.fn(),
  };
  await mount(h(DriveApp, null, h(Probe)));
  return (await drive.client.stat(FILE)) as DriveItem;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.saveNatively.mockReset();
  mocks.toastError.mockReset();
});

it("saves through the share sheet in the native shell, never a blob: anchor", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  mocks.saveNatively.mockResolvedValue(true);
  const item = await setup();
  const objectUrl = vi.spyOn(URL, "createObjectURL");
  const bounded = vi.spyOn(drive.client, "readLimited");
  await act(() => actions.download(item));
  expect(bounded).toHaveBeenCalledWith(FILE, NATIVE_SAVE_LIMIT);
  expect(mocks.saveNatively).toHaveBeenCalledOnce();
  const [blob, name, contentType] = mocks.saveNatively.mock.calls[0] ?? [];
  expect(await (blob as Blob).text()).toBe("hello");
  expect(name).toBe("report.txt");
  expect(contentType).toContain("text/plain");
  expect(objectUrl).not.toHaveBeenCalled();
  expect(mocks.toastError).not.toHaveBeenCalled();
});

it("refuses a file over the native save limit without staging it", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  const item = await setup();
  vi.spyOn(drive.client, "readLimited").mockResolvedValue(undefined);
  await act(() => actions.download(item));
  expect(mocks.saveNatively).not.toHaveBeenCalled();
  expect(mocks.toastError).toHaveBeenCalledWith("Too large to save on this device");
});

it("reports a failed native save", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  mocks.saveNatively.mockRejectedValue(new Error("staging failed"));
  const item = await setup();
  await act(() => actions.download(item));
  expect(mocks.toastError).toHaveBeenCalledOnce();
});
