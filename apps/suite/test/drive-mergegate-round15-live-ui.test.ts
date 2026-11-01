// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import type { DriveClient } from "../src/apps/drive/lib/client/client";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, h, mount } from "./drive-ui-dom";
import { OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/drive/my",
  useSearchParams: () => navigation.params,
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));

import { FolderView } from "../src/apps/drive/components/views";
import { DriveProvider, useDrive } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider } from "../src/apps/drive/state/ui";

it("failed file provisioning refreshes its persistent banner without pod notifications", async () => {
  const f = await wacPod();
  const to = `${PUBLIC}copy.txt`;
  const session: PodSession = {
    mode: "demo",
    webId: OWNER,
    storageUrl: ROOT,
    displayName: "Owner",
    fetch: f.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  let client: DriveClient | undefined;
  function Probe() {
    client = useDrive().client;
    return h(FolderView, { url: PUBLIC });
  }
  const rendered = await mount(
    h(DriveProvider, {
      session,
      children: h(DriveUiProvider, { children: h(Probe) }),
    }),
  );
  expect(rendered.host.textContent).not.toContain("This file's sharing could not be secured");
  f.intercept(async (url, init) =>
    (url === `${to}.policy` && init?.method === "PUT") || (url === to && init?.method === "DELETE")
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await act(async () => {
    if (!client) throw new Error("Missing Drive client");
    await expect(
      client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" }),
    ).rejects.toThrow();
  });
  expect(rendered.host.textContent).toContain("This file's sharing could not be secured");
  expect(rendered.host.querySelector('[role="alert"]')?.textContent).toContain("copy.txt");
});
