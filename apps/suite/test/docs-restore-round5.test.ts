// AUTHORED-BY Codex
import { SolidUpdateStore } from "@jeswr/y-solid";
import { NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate, XmlElement } from "yjs";
import { deleteDocument, deleteForever } from "../src/apps/docs/editor/operations";
import { buildDocument, parseDocument, serializeTurtle } from "../src/apps/docs/lib/model";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems } from "../src/apps/drive/lib/operations/operations";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const ROOT = "https://restore.test/alice/";
const DRIVE = `${ROOT}drive/`;
const URL = `${ROOT}docs/plan.ttl`;
const TREE = `${ROOT}docs/plan/`;
const TARGET = `${ROOT}docs/plan%20(restored).ttl`;
const MOVED = `${ROOT}docs/plan%20(restored)/`;
const OA = "http://www.w3.org/ns/oa#";
class Annotation extends TermWrapper {
  get target() {
    return OptionalFrom.subjectPredicate(this, `${OA}hasTarget`, NamedNodeAs.string);
  }
  set target(value: string | undefined) {
    OptionalAs.object(this, `${OA}hasTarget`, value, NamedNodeFrom.string);
  }
  get source() {
    return OptionalFrom.subjectPredicate(this, `${OA}hasSource`, NamedNodeAs.string);
  }
  set source(value: string | undefined) {
    OptionalAs.object(this, `${OA}hasSource`, value, NamedNodeFrom.string);
  }
}
async function fixture() {
  const image = `${TREE}assets/chart.png`;
  const body = `<p>Plan</p><img src="${image}"><img src="https://external.test/chart.png">`;
  const first = parseDocument(
    URL,
    buildDocument(URL, {
      title: "Plan",
      body,
      revisionLabel: "First",
      now: new Date("2026-01-01"),
    }),
  );
  const snapshot = buildDocument(URL, {
    ...first,
    title: "Plan",
    body,
    updateLog: `${TREE}updates/`,
    assets: `${TREE}assets/`,
    comments: `${TREE}comments/`,
    priorRevisions: first?.revisions,
    revisionLabel: "Second",
    now: new Date("2026-01-02"),
  });
  const comments = new Store();
  new Annotation(`${TREE}comments/root.ttl#it`, comments, DataFactory).target =
    `${TREE}comments/root.ttl#target`;
  new Annotation(`${TREE}comments/root.ttl#target`, comments, DataFactory).source = `${URL}#it`;
  const reply = new Store();
  new Annotation(`${TREE}comments/reply.ttl#it`, reply, DataFactory).target =
    `${TREE}comments/root.ttl#it`;
  const doc = new Doc();
  const paragraph = new XmlElement("paragraph");
  const img = new XmlElement("image");
  img.setAttribute("src", image);
  // ProseMirror attributes can contain numbers (image width, table spans).
  img.setAttribute("width", 320 as unknown as string);
  const external = new XmlElement("image");
  external.setAttribute("src", "https://external.test/chart.png");
  paragraph.insert(0, [img, external]);
  doc.getXmlFragment("prosemirror").insert(0, [paragraph]);
  const pod = createDemoPod({
    root: ROOT,
    seed: [
      { path: "docs/plan.ttl", body: await serializeTurtle(snapshot), contentType: "text/turtle" },
      { path: "docs/plan/assets/chart.png", body: "image", contentType: "image/png" },
      {
        path: "docs/plan/comments/root.ttl",
        body: await serializeTurtle(comments),
        contentType: "text/turtle",
      },
      {
        path: "docs/plan/comments/reply.ttl",
        body: await serializeTurtle(reply),
        contentType: "text/turtle",
      },
      {
        path: "docs/plan/updates/001798000000000-00000000-0000-4000-8000-000000000001",
        body: encodeStateAsUpdate(doc),
        contentType: "application/octet-stream",
      },
    ],
  });
  doc.destroy();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: pod.fetch });
  const session = { storageUrl: ROOT, webId: `${ROOT}profile#me`, fetch: pod.fetch } as PodSession;
  const trash = await deleteDocument(URL, session);
  expect(trash.failed).toEqual([]);
  return { pod, client, session, trash };
}
async function readSnapshot(client: ReturnType<typeof createSolidDriveClient>) {
  const snapshot = await client.readRdf(TARGET);
  return snapshot && parseDocument(TARGET, snapshot.dataset);
}
it("rewrites restored image URLs in the HTML, revision bodies and replayed Yjs fragment", async () => {
  const { pod, client, trash } = await fixture();
  await pod.fetch(URL, { method: "PUT", body: "replacement" });
  expect((await restoreItems(client, DRIVE, trash.done)).failed).toEqual([]);
  const snapshot = await readSnapshot(client);
  expect(snapshot?.body).toContain(`${MOVED}assets/chart.png`);
  expect(snapshot?.body).not.toContain(`${TREE}assets/`);
  expect(snapshot?.revisions).toHaveLength(2);
  for (const rev of snapshot?.revisions ?? []) {
    expect(rev.id).toContain(`${TARGET}#rev-`);
    expect(rev.body).toContain(`${MOVED}assets/chart.png`);
  }
  const doc = new Doc();
  for (const { update } of await new SolidUpdateStore({
    container: snapshot?.updateLog as string,
    fetch: pod.fetch,
  }).loadUpdates())
    applyUpdate(doc, update);
  expect(doc.getXmlFragment("prosemirror").toString()).toContain(`${MOVED}assets/chart.png`);
  expect(doc.getXmlFragment("prosemirror").toString()).not.toContain(`${TREE}assets/`);
  expect(doc.getXmlFragment("prosemirror").toString()).toContain("https://external.test/chart.png");
  const paragraph = doc.getXmlFragment("prosemirror").get(0) as XmlElement;
  expect((paragraph.get(0) as XmlElement).getAttribute("width")).toBe(320);
  expect(await (await pod.fetch(`${MOVED}assets/chart.png`)).text()).toBe("image");
  doc.destroy();
});
it("relocates comment subjects, document targets and reply targets with a renamed restore", async () => {
  const { pod, client, trash } = await fixture();
  await pod.fetch(URL, { method: "PUT", body: "replacement" });
  expect((await restoreItems(client, DRIVE, trash.done)).failed).toEqual([]);
  const root = await client.readRdf(`${MOVED}comments/root.ttl`);
  expect(
    new Annotation(`${MOVED}comments/root.ttl#it`, root?.dataset as Store, DataFactory).target,
  ).toBe(`${MOVED}comments/root.ttl#target`);
  expect(
    new Annotation(`${MOVED}comments/root.ttl#target`, root?.dataset as Store, DataFactory).source,
  ).toBe(`${TARGET}#it`);
  const reply = await client.readRdf(`${MOVED}comments/reply.ttl`);
  expect(
    new Annotation(`${MOVED}comments/reply.ttl#it`, reply?.dataset as Store, DataFactory).target,
  ).toBe(`${MOVED}comments/root.ttl#it`);
});
it("retries a failed snapshot PUT using the companion destination persisted before restoring", async () => {
  const { pod, client, trash } = await fixture();
  await pod.fetch(`${TREE}assets/unrelated.png`, { method: "PUT", body: "unrelated" });
  let fail = true;
  const interrupted = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: async (input, init) => {
      if (String(input) === TARGET && init?.method === "PUT" && fail) {
        fail = false;
        return new Response(null, { status: 503 });
      }
      return pod.fetch(input, init);
    },
  });
  expect((await restoreItems(interrupted, DRIVE, trash.done)).failed).toHaveLength(1);
  const remaining = await listTrash(client, DRIVE);
  expect(remaining).toHaveLength(1);
  const restored = await restoreItems(client, DRIVE, remaining);
  expect(restored.failed).toEqual([]);
  expect(restored.done[0]?.url).toBe(TARGET);
  expect((await readSnapshot(client))?.updateLog).toBe(`${MOVED}updates/`);
  expect((await pod.fetch(URL)).status).toBe(404);
  expect(await (await pod.fetch(`${TREE}assets/unrelated.png`)).text()).toBe("unrelated");
  expect(await listTrash(client, DRIVE)).toEqual([]);
});
it.each([
  "PUT",
  "DELETE",
])("reconciles a lost acknowledgement of the restore rewrite %s", async (method) => {
  const { pod, client, trash } = await fixture();
  await pod.fetch(URL, { method: "PUT", body: "replacement" });
  let lost = false;
  const interrupted = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: async (input, init) => {
      const response = await pod.fetch(input, init);
      if (
        !lost &&
        response.ok &&
        init?.method === method &&
        String(input) === (method === "PUT" ? TARGET : trash.done[0]?.url)
      ) {
        lost = true;
        throw new TypeError("response lost");
      }
      return response;
    },
  });
  const restored = await restoreItems(interrupted, DRIVE, trash.done);
  expect(lost).toBe(true);
  expect(restored.failed).toEqual([]);
  expect((await readSnapshot(client))?.title).toBe("Plan");
  expect(await listTrash(client, DRIVE)).toEqual([]);
});
it("reconciles a lost acknowledgement of permanent trash deletion", async () => {
  const { pod, client, session, trash } = await fixture();
  let lost = false;
  const interrupted = {
    ...session,
    fetch: (async (input, init) => {
      const response = await pod.fetch(input, init);
      if (
        !lost &&
        response.ok &&
        init?.method === "DELETE" &&
        String(input) === trash.done[0]?.url
      ) {
        lost = true;
        throw new TypeError("response lost");
      }
      return response;
    }) as typeof fetch,
  };
  expect((await deleteForever(trash.done, interrupted, true)).failed).toEqual([]);
  expect(lost).toBe(true);
  expect(await listTrash(client, DRIVE)).toEqual([]);
});

it("reuses the rewritten snapshot when its trash DELETE fails before committing", async () => {
  const { pod, client, trash } = await fixture();
  await pod.fetch(URL, { method: "PUT", body: "replacement" });
  let fail = true;
  const interrupted = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: async (input, init) => {
      if (fail && String(input) === trash.done[0]?.url && init?.method === "DELETE") {
        fail = false;
        return new Response(null, { status: 503 });
      }
      return pod.fetch(input, init);
    },
  });
  expect((await restoreItems(interrupted, DRIVE, trash.done)).failed).toHaveLength(1);
  expect((await pod.fetch(trash.done[0]?.url as string)).ok).toBe(true);
  const before = await (await pod.fetch(TARGET)).text();
  const retry = await restoreItems(client, DRIVE, await listTrash(client, DRIVE));
  expect(retry.failed).toEqual([]);
  expect(retry.done[0]?.url).toBe(TARGET);
  expect(await (await pod.fetch(TARGET)).text()).toBe(before);
  expect(await listTrash(client, DRIVE)).toEqual([]);
});
it("keeps a snapshot-only restore recoverable when its source read fails", async () => {
  const { pod, client, trash } = await fixture();
  await pod.fetch(URL, { method: "PUT", body: "replacement" });
  const interrupted = {
    ...client,
    readVersion: async () => {
      throw new TypeError("read failed");
    },
  };
  expect((await restoreItems(interrupted, DRIVE, trash.done.slice(0, 1))).failed).toHaveLength(1);
  expect((await pod.fetch(trash.done[0]?.url as string)).ok).toBe(true);
});
it("retains a trash resource when an ambiguous DELETE failure has no durable effect", async () => {
  const { pod, client, session, trash } = await fixture();
  const interrupted = {
    ...session,
    fetch: (async (input, init) => {
      if (String(input) === trash.done[0]?.url && init?.method === "DELETE")
        throw new TypeError("request lost");
      return pod.fetch(input, init);
    }) as typeof fetch,
  };
  const result = await deleteForever(trash.done, interrupted, true);
  expect(result.failed).toHaveLength(1);
  expect((await pod.fetch(trash.done[0]?.url as string)).ok).toBe(true);
  expect(await listTrash(client, DRIVE)).toHaveLength(1);
});

it("keeps both trash sources when the paired restore destination cannot be persisted", async () => {
  const { pod, client, trash } = await fixture();
  await pod.fetch(URL, { method: "PUT", body: "replacement" });
  const interrupted = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: async (input, init) => {
      if (String(input) === `${DRIVE}.trash/index.ttl` && init?.method === "PUT")
        return new Response(null, { status: 503 });
      return pod.fetch(input, init);
    },
  });
  const result = await restoreItems(interrupted, DRIVE, trash.done);
  expect(result.done).toEqual([]);
  expect(result.failed).toHaveLength(2);
  for (const entry of trash.done) expect((await pod.fetch(entry.url)).ok).toBe(true);
  expect((await pod.fetch(TARGET)).status).toBe(404);
  expect((await pod.fetch(MOVED)).status).toBe(404);
  expect(await listTrash(client, DRIVE)).toHaveLength(2);
});
