// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { type UploadQueue, useUploadQueue } from "../src/apps/drive/state/uploads";
import { rdfPod } from "./drive-rdf-pod";
import { act, h, mount } from "./drive-ui-dom";
import { OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

it("round 59: upload Replace displays the original's only recovery location when the second quarantine backup fails", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let uploaded = false;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) uploaded = true;
    return response;
  });
  f.intercept(async (target, init) => {
    if (uploaded && target === `${PRIVATE}.policy`) return new Response(null, { status: 503 });
    if (
      target.includes("/.drive-recovery-") &&
      target.endsWith("/1-secret") &&
      init?.method === "PUT"
    )
      return new Response(null, { status: 503 });
    return undefined;
  });
  let queue!: UploadQueue;
  function Probe() {
    queue = useUploadQueue(client, vi.fn());
    return h("p", null, queue.tasks[0]?.error);
  }
  const view = await mount(h(Probe));
  await act(async () => queue.enqueue(PRIVATE, [new File(["replacement"], "secret")]));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(queue.tasks[0]?.status).toBe("conflict");
  });
  const task = queue.tasks[0];
  if (!task) throw new Error("Missing upload task");
  await act(async () => queue.resolve(task.id, "replace"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(queue.tasks[0]?.status).toBe("failed");
  });
  const backups = f.pod
    .snapshot()
    .resources.map(([target]) => target)
    .filter((target) => target.includes("/.drive-recovery-") && !target.endsWith("/"));
  expect(backups).toHaveLength(1);
  expect(await (await f.pod.fetch(backups[0] as string)).text()).toBe("secret contents");
  expect((await f.anonymous(backups[0] as string)).status).toBe(403);
  expect(view.host.textContent).toContain(backups[0]);
  expect(await (await f.pod.fetch(url)).text()).toBe("replacement");
});
