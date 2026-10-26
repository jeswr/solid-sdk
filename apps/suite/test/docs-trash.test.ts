// AUTHORED-BY Codex
import { describe, expect, it } from "vitest";
import { deleteDocument, deleteForever, restoreDocument } from "../src/apps/docs/editor/operations";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems } from "../src/apps/drive/lib/operations/operations";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const ROOT = "https://docs-trash.test/alice/";
const DRIVE = `${ROOT}drive/`;
const DOC = `${ROOT}docs/plan.ttl`;
const TREE = `${ROOT}docs/plan/`;
function fixture(companion = true) {
  const pod = createDemoPod({
    root: ROOT,
    seed: [
      { path: "docs/plan.ttl", body: "document snapshot", contentType: "text/turtle" },
      ...(companion
        ? [
            { path: "docs/plan/assets/chart.png", body: "image", contentType: "image/png" },
            {
              path: "docs/plan/updates/one.bin",
              body: "update",
              contentType: "application/octet-stream",
            },
          ]
        : []),
    ],
  });
  const session = { storageUrl: ROOT, webId: `${ROOT}profile#me`, fetch: pod.fetch } as PodSession;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: pod.fetch });
  return { pod, session, client };
}

describe("Docs uses Drive trash records", () => {
  it("lists a Docs delete in Drive and restores both the snapshot and companion tree with restoreItems", async () => {
    const { pod, session, client } = fixture();
    const result = await deleteDocument(DOC, session);
    expect(result).toMatchObject({ done: [{ original: DOC }, { original: TREE }], failed: [] });
    const entries = await listTrash(client, DRIVE);
    expect(entries).toEqual(result.done);
    expect(entries).toHaveLength(2);
    expect((await pod.fetch(DOC)).status).toBe(404);
    expect((await pod.fetch(`${TREE}assets/chart.png`)).status).toBe(404);
    const restored = await restoreItems(client, DRIVE, entries);
    expect(restored.failed).toEqual([]);
    expect(restored.done.map(({ url }) => url)).toEqual([DOC, TREE]);
    expect(await (await pod.fetch(DOC)).text()).toBe("document snapshot");
    expect(await (await pod.fetch(`${TREE}assets/chart.png`)).text()).toBe("image");
    expect(await (await pod.fetch(`${TREE}updates/one.bin`)).text()).toBe("update");
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });
  it("uses the same records for Docs restore and confirmed permanent deletion", async () => {
    const { session, client, pod } = fixture();
    const first = await deleteDocument(DOC, session);
    expect((await restoreDocument(first.done, session)).failed).toEqual([]);
    const second = await deleteDocument(DOC, session);
    await expect(deleteForever(second.done, session, false)).rejects.toThrow("Confirm");
    expect(await listTrash(client, DRIVE)).toHaveLength(2);
    expect((await deleteForever(second.done, session, true)).failed).toEqual([]);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    for (const entry of second.done) expect((await pod.fetch(entry.url)).status).toBe(404);
  });
  it("trashes a document without a companion container", async () => {
    const { session, client } = fixture(false);
    const result = await deleteDocument(DOC, session);
    expect(result.done).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(await listTrash(client, DRIVE)).toEqual(result.done);
  });
  it.each([
    "docs/sub/plan.ttl",
    "drive/plan.ttl",
    "docs/plan.ttl?x=1",
    "docs/plan.txt",
  ])("refuses non-document location %s before deleting anything", async (path) => {
    const { session, pod } = fixture();
    await expect(deleteDocument(`${ROOT}${path}`, session)).rejects.toThrow();
    expect((await pod.fetch(DOC)).ok).toBe(true);
  });
  it("preserves Drive partial records when the companion tree cannot finish moving", async () => {
    const { session, client, pod } = fixture();
    const interrupted = {
      ...session,
      fetch: (async (input, init) =>
        String(input) === `${TREE}updates/one.bin` && init?.method === "DELETE"
          ? new Response(null, { status: 403 })
          : pod.fetch(input, init)) as typeof fetch,
    };
    const result = await deleteDocument(DOC, interrupted);
    expect(result.done.map((entry) => entry.original)).toEqual([DOC]);
    expect(result.failed).toMatchObject([{ url: TREE }]);
    const visible = await listTrash(client, DRIVE);
    expect(visible).toHaveLength(2);
    expect(visible.find((entry) => entry.original === TREE)?.status).toBe("partial");
    expect((await restoreItems(client, DRIVE, visible)).failed).toEqual([]);
    expect(await (await pod.fetch(`${TREE}assets/chart.png`)).text()).toBe("image");
    expect(await (await pod.fetch(`${TREE}updates/one.bin`)).text()).toBe("update");
    expect((await pod.fetch(DOC)).ok).toBe(true);
  });
  it("does not remove either source when Drive cannot persist the batch intents", async () => {
    const { session, pod } = fixture();
    const unavailable = {
      ...session,
      fetch: (async (input, init) =>
        String(input) === `${DRIVE}.trash/index.ttl` && init?.method === "PUT"
          ? new Response(null, { status: 503 })
          : pod.fetch(input, init)) as typeof fetch,
    };
    const result = await deleteDocument(DOC, unavailable);
    expect(result.done).toEqual([]);
    expect(result.failed.map(({ url }) => url)).toEqual([DOC, TREE]);
    expect(result.warnings).toMatchObject([{ kind: "trash-index-persistence" }]);
    expect((await pod.fetch(DOC)).ok).toBe(true);
    expect((await pod.fetch(`${TREE}assets/chart.png`)).ok).toBe(true);
  });
  it("surfaces completion warnings and leaves records that Drive can reconcile", async () => {
    const { session, pod, client } = fixture();
    let writes = 0;
    const unavailable = {
      ...session,
      fetch: (async (input, init) => {
        if (String(input) === `${DRIVE}.trash/index.ttl` && init?.method === "PUT" && ++writes > 1)
          return new Response(null, { status: 503 });
        return pod.fetch(input, init);
      }) as typeof fetch,
    };
    const result = await deleteDocument(DOC, unavailable);
    expect(result.done).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(result.warnings).toMatchObject([{ kind: "trash-index-persistence" }]);
    const reconciled = await listTrash(client, DRIVE);
    expect(reconciled).toEqual(result.done);
    expect((await restoreDocument(reconciled, session)).failed).toEqual([]);
  });
  it("refuses to start a delete when the companion existence check is forbidden", async () => {
    const { session, pod } = fixture();
    const forbidden = {
      ...session,
      fetch: (async (input, init) =>
        String(input) === TREE && init?.method === "HEAD"
          ? new Response(null, { status: 403 })
          : pod.fetch(input, init)) as typeof fetch,
    };
    await expect(deleteDocument(DOC, forbidden)).rejects.toMatchObject({ kind: "forbidden" });
    expect((await pod.fetch(DOC)).ok).toBe(true);
  });
  it("refuses Docs restore or purge of records for other apps", async () => {
    const { session } = fixture();
    const entry = {
      url: `${DRIVE}.trash/slot/file`,
      original: `${ROOT}mail/file.ttl`,
      name: "file",
      trashedAt: new Date(),
    };
    await expect(restoreDocument([entry], session)).rejects.toThrow("Expected a document in Docs");
    await expect(deleteForever([entry], session, true)).rejects.toThrow(
      "Expected a document in Docs",
    );
  });
});
