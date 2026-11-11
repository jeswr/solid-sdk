// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, expect, it, vi } from "vitest";
import { ResourceWriteError } from "../src/apps/docs/lib/model/errors";
import { BootstrapIdentityError } from "../src/apps/drive/lib/client/bootstrap";
import { DriveError } from "../src/apps/drive/lib/client/client";
import { DRIVE_ROOT_CLASS } from "../src/apps/drive/lib/constants";
import { DriveProvider, useDrive } from "../src/apps/drive/state/drive-context";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, h, mount } from "./drive-ui-dom";

const discovery = vi.hoisted(() => vi.fn());
const ensure = vi.hoisted(() => vi.fn());
const createFolder = vi.hoisted(() => vi.fn());
vi.mock("../src/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: discovery,
  ensureTypeRegistrations: ensure,
}));
vi.mock("../src/apps/drive/lib/client/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createSolidDriveClient: () => ({ recheckDeletions: async () => [], createFolder }),
}));

const session: PodSession = {
  mode: "solid",
  storageUrl: "https://pod.example/",
  webId: "https://pod.example/profile#me",
  displayName: "Alice",
  fetch: vi.fn(),
  publicFetch: vi.fn(),
  subscribe: () => () => {},
};
beforeEach(() => vi.resetAllMocks());

it("retries failed discovery in the current session and clears its error", async () => {
  discovery.mockRejectedValueOnce(new Error("Storage unavailable"));
  discovery.mockResolvedValueOnce([
    { forClass: DRIVE_ROOT_CLASS, container: "https://pod.example/existing/" },
  ]);
  let drive!: ReturnType<typeof useDrive>;
  function Probe() {
    drive = useDrive();
    return null;
  }
  await mount(h(DriveProvider, { session, children: h(Probe) }));
  expect(drive.rootError).toBeInstanceOf(Error);
  expect(drive.driveRoot).toBeUndefined();
  await act(() => drive.retryRoot());
  expect(drive.driveRoot).toBe("https://pod.example/existing/");
  expect(drive.rootError).toBeUndefined();
  expect(discovery).toHaveBeenCalledTimes(2);
  expect(drive.session).toBe(session);
});

it.each([
  new DriveError("conflict", 412, "https://pod.example/settings/privateTypeIndex.ttl"),
  new ResourceWriteError("https://pod.example/settings/prefs.ttl", 412),
  new BootstrapIdentityError("https://pod.example/profile"),
])("rediscovers a competing tab's Drive registration after bootstrap fails with %s", async (error) => {
  discovery
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { forClass: DRIVE_ROOT_CLASS, container: "https://pod.example/registered/" },
    ]);
  ensure.mockRejectedValueOnce(error);
  let drive!: ReturnType<typeof useDrive>;
  function Probe() {
    drive = useDrive();
    return null;
  }
  await mount(h(DriveProvider, { session, children: h(Probe) }));
  expect(drive.driveRoot).toBe("https://pod.example/registered/");
  expect(drive.rootError).toBeUndefined();
  expect(discovery).toHaveBeenCalledTimes(2);
  expect(ensure).toHaveBeenCalledOnce();
});

it("bounds bootstrap restarts and uses fresh conditional-write captures each time", async () => {
  discovery.mockResolvedValue([]);
  const error = new BootstrapIdentityError("https://pod.example/settings/privateTypeIndex.ttl");
  ensure.mockRejectedValue(error);
  let drive!: ReturnType<typeof useDrive>;
  function Probe() {
    drive = useDrive();
    return null;
  }
  await mount(h(DriveProvider, { session, children: h(Probe) }));
  expect(drive.rootError).toBe(error);
  expect(ensure).toHaveBeenCalledTimes(4);
  expect(new Set(ensure.mock.calls.map(([options]) => options.fetchImpl)).size).toBe(4);
});

it.each([
  401, 403,
])("surfaces bootstrap HTTP %s without retrying or treating it as absence", async (status) => {
  discovery.mockResolvedValue([]);
  const error = new ResourceWriteError("https://pod.example/settings/privateTypeIndex.ttl", status);
  ensure.mockRejectedValue(error);
  let drive!: ReturnType<typeof useDrive>;
  function Probe() {
    drive = useDrive();
    return null;
  }
  await mount(h(DriveProvider, { session, children: h(Probe) }));
  expect(drive.rootError).toBe(error);
  expect(drive.driveRoot).toBeUndefined();
  expect(ensure).toHaveBeenCalledOnce();
  expect(discovery).toHaveBeenCalledOnce();
});
