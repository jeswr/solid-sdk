// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { type UploadQueue, useUploadQueue } from "../src/apps/drive/state/uploads";
import { rdfPod } from "./drive-rdf-pod";
import { act, click, h, mount } from "./drive-ui-dom";
import { OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

let queue: UploadQueue;
vi.mock("../src/apps/drive/state/drive-context", () => ({ useDrive: () => ({ uploads: queue }) }));
vi.mock("../src/apps/drive/state/ui", () => ({ captureDriveFocusRemoval: () => vi.fn() }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "@jeswr/suite-ui";
import { UploadDock } from "../src/apps/drive/components/upload-dock";

it.each([
  false,
  true,
])("round 60: failed uploads announce the permission error and status, including when collapsed (%s)", async (collapsed) => {
  vi.clearAllMocks();
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let refuse = true;
  f.intercept(async (url, init) =>
    refuse && url === `${PRIVATE}upload.txt` && init?.method === "PUT"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  function Probe() {
    queue = useUploadQueue(client, vi.fn());
    return h(UploadDock);
  }
  const view = await mount(h(Probe));
  await act(async () => queue.enqueue(PRIVATE, [new File(["upload"], "upload.txt")]));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(queue.tasks[0]?.status).toBe("failed");
  });
  if (collapsed)
    await click(
      view.host.querySelector<HTMLButtonElement>(
        '[aria-label="Collapse uploads"]',
      ) as HTMLButtonElement,
    );
  expect(view.host.querySelector("h2[aria-live]")?.textContent).toContain("1 upload failed");
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("permission"));
  expect(toast.error).toHaveBeenCalledTimes(1);
  await act(async () => {});
  expect(toast.error).toHaveBeenCalledTimes(1);
  if (collapsed)
    await click(
      view.host.querySelector<HTMLButtonElement>(
        '[aria-label="Expand uploads"]',
      ) as HTMLButtonElement,
    );
  await click(
    view.host.querySelector<HTMLButtonElement>(
      '[aria-label="Retry upload.txt"]',
    ) as HTMLButtonElement,
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(queue.tasks[0]?.status).toBe("failed");
    expect(toast.error).toHaveBeenCalledTimes(2);
  });
  refuse = false;
  await click(
    view.host.querySelector<HTMLButtonElement>(
      '[aria-label="Retry upload.txt"]',
    ) as HTMLButtonElement,
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(queue.tasks[0]?.status).toBe("done");
  });
  expect(view.host.querySelector("h2[aria-live]")?.textContent).toBe("1 upload complete");
});
