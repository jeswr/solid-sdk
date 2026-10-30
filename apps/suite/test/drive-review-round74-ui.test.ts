// AUTHORED-BY Codex
import "./drive-ui-dom";
import { expect, it, vi } from "vitest";
import {
  type DriveContextValue,
  DriveProvider,
  useDrive,
} from "../src/apps/drive/state/drive-context";
import { errorMessage } from "../src/apps/drive/state/ui";
import type { PodSession } from "../src/lib/session/pod-session";
import { customAclPod } from "./drive-custom-acl-pod";
import { act, h, mount } from "./drive-ui-dom";
import { aclBody, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

vi.mock(
  "@/apps/docs/lib/model/type-index",
  async () => import("../src/apps/docs/lib/model/type-index"),
);
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));

it.each([
  "settings/privateTypeIndex.ttl",
  "settings/prefs.ttl",
])("round 74: startup refuses a custom ACL at bootstrap content target %s", async (path) => {
  const f = await customAclPod();
  f.policies.set(`${ROOT}.policy`, await aclBody(ROOT));
  const endpoint = `${ROOT}${path}`;
  f.endpoints.set(`${PRIVATE}secret`, endpoint);
  await f.pod.fetch(OWNER.split("#")[0] as string, {
    method: "PUT",
    body: "",
    headers: { "content-type": "text/turtle" },
  });
  // The profile target already exists; the index/preferences targets are absent.
  const before = (await f.fetch(endpoint)).status;
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    storageUrl: ROOT,
    displayName: "Owner",
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  let state!: DriveContextValue;
  function Probe() {
    state = useDrive();
    return null;
  }
  await mount(h(DriveProvider, { session, children: h(Probe) }));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(state.rootError).toBeDefined();
  });
  expect(state.driveRoot).toBeUndefined();
  expect(errorMessage(state.rootError)).toContain("access-control resource");
  expect(f.calls).not.toContainEqual({ url: endpoint, method: "PUT" });
  expect((await f.fetch(`${PRIVATE}secret`)).status).toBe(200);
  expect((await f.fetch(endpoint)).status).toBe(before);
});
