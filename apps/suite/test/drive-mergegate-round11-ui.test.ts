// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, h, mount } from "./drive-ui-dom";
import { DRIVE, OWNER, ROOT, wacPod } from "./drive-wac-pod";

const notices = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: notices.toast,
}));
vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));

import { DriveProvider, useDrive } from "../src/apps/drive/state/drive-context";

it("the result toast explains that an unknown-access recreated folder was restored as private", async () => {
  const f = await wacPod();
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    storageUrl: ROOT,
    displayName: "Owner",
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  let drive: ReturnType<typeof useDrive> | undefined;
  function Probe() {
    drive = useDrive();
    return null;
  }
  await mount(h(DriveProvider, { session, children: h(Probe) }));
  if (!drive) throw new Error("Missing Drive context");
  const client = drive.client;
  const folder = `${DRIVE}recovered/`;
  f.audit([folder]);
  await act(async () => {
    await client.write(
      `${folder}secret`,
      "secret contents",
      { contentType: "text/plain" },
      { kind: "protect-ancestors" },
    );
  });
  expect(notices.toast).toHaveBeenCalledWith("recovered was restored as private", {
    description:
      "Its original access was unknown. Only you can access this folder and new files in it.",
  });
  expect(f.exposures).toEqual([]);
});
