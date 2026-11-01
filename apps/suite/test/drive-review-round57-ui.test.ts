// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { type UploadQueue, useUploadQueue } from "../src/apps/drive/state/uploads";
import { rdfPod } from "./drive-rdf-pod";
import { act, h, mount } from "./drive-ui-dom";
import { OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

it("round 57: failed replacement uploads show every private recovery location", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let uploaded = false;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) uploaded = true;
    return response;
  });
  f.intercept(async (target) =>
    uploaded && target === `${PRIVATE}.policy` ? new Response(null, { status: 503 }) : undefined,
  );
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
  const backups: string[] = [];
  for (const [target] of f.pod.snapshot().resources)
    if (target.includes("/.drive-recovery-") && !target.endsWith("/")) backups.push(target);
  expect(backups).toHaveLength(2);
  for (const target of backups) expect(view.host.textContent).toContain(target);
});
