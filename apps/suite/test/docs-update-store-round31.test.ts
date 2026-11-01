// AUTHORED-BY Codex

import { SolidUpdateStore } from "@jeswr/y-solid";
import { expect, it, vi } from "vitest";
import { Doc, encodeStateAsUpdate, XmlElement } from "yjs";
import { relocateDocument } from "../src/apps/docs/editor/relocate";
import { buildDocument, docContainerUrls, parseDocument } from "../src/apps/docs/lib/model";
import { DocumentReplacedError } from "../src/apps/docs/lib/model/incarnation";
import {
  assertUpdateIdentities,
  DocumentUpdateStore,
  InactiveLogError,
} from "../src/apps/docs/lib/model/update-store";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://updates.test/";
const container = `${root}docs/plan/updates/`;
function update(id?: string) {
  const doc = new Doc();
  if (id) doc.getMap("document").set("instanceId", id);
  doc.getText("body").insert(0, "content");
  const encoded = encodeStateAsUpdate(doc);
  doc.destroy();
  return encoded;
}

it("round31 validates each log resource before Yjs can hide conflicting identities", async () => {
  const updates = [update("replacement"), update("retired")];
  expect(() => assertUpdateIdentities(updates)).toThrow("different document");
  const pod = createDemoPod({
    root,
    seed: updates.map((body, index) => ({
      path: `docs/plan/updates/${index}`,
      body,
      contentType: "application/octet-stream",
    })),
  });
  const store = new DocumentUpdateStore(container, pod.fetch, async () => {}, false, "replacement");
  await expect(store.readUpdate(`${container}1`)).rejects.toThrow("different document");
  await expect(store.loadUpdates()).rejects.toThrow("different document");
});

it("round31 retains legacy updates and pending identity deltas while validating the assembled log", () => {
  expect(() => assertUpdateIdentities([update(), update("active")], "active")).not.toThrow();
  const doc = new Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (value: Uint8Array) => updates.push(value));
  doc.getText("body").insert(0, "before identity");
  doc.getMap("document").set("instanceId", "retired");
  // Neither out-of-order resource can expose the dependent map entry alone.
  expect(() => assertUpdateIdentities([updates[1] as Uint8Array], "active")).not.toThrow();
  expect(() => assertUpdateIdentities(updates, "active")).toThrow("different document");
  doc.destroy();
});

it.each([
  new InactiveLogError("retired"),
  new DocumentReplacedError(),
])("round31 removes its own delayed append after a confirmed replacement (%s)", async (failure) => {
  const pod = createDemoPod({ root, seed: [] });
  const active = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
  const store = new DocumentUpdateStore(container, pod.fetch, active, true, "retired");
  await expect(store.appendUpdate(update("retired"))).rejects.toBe(failure);
  expect(await store.listUpdateUrls()).toEqual([]);
});

it.each([
  false,
  true,
])("round31 preserves the replacement error when cleanup is denied (%s)", async (denied) => {
  const pod = createDemoPod({ root, seed: [] });
  const failure = new DocumentReplacedError();
  const active = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
  const http: typeof fetch = (input, init) =>
    init?.method === "DELETE"
      ? denied
        ? Promise.reject(new TypeError("offline"))
        : Promise.resolve(new Response(null, { status: 403 }))
      : pod.fetch(input, init);
  const store = new DocumentUpdateStore(container, http, active, true, "retired");
  await expect(store.appendUpdate(update("retired"))).rejects.toBe(failure);
  expect(await store.listUpdateUrls()).toHaveLength(1);
});

it("round31 does not delete a successful update when only the identity probe goes offline", async () => {
  const pod = createDemoPod({ root, seed: [] });
  const failure = new TypeError("offline");
  const active = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
  const store = new DocumentUpdateStore(container, pod.fetch, active, true, "active");
  await expect(store.appendUpdate(update("active"))).rejects.toBe(failure);
  expect(await store.listUpdateUrls()).toHaveLength(1);
});

it("round31 restore relocation never rewrites and appends a log mixing document incarnations", async () => {
  const pod = createDemoPod({ root, seed: [] });
  const url = `${root}docs/plan.ttl`;
  const data = parseDocument(
    url,
    buildDocument(url, {
      ...docContainerUrls(url),
      instanceId: "active",
      title: "Plan",
      body: "<p>Original</p>",
    }),
  );
  if (!data) throw new Error("Missing fixture document");
  const stored = { url, data };
  const target = `${root}docs/restored.ttl`;
  const log = new SolidUpdateStore({
    container: docContainerUrls(target).updateLog,
    fetch: pod.fetch,
  });
  for (const id of [stored.data.instanceId, "retired"]) {
    const doc = new Doc();
    doc.getMap("document").set("instanceId", id);
    const image = new XmlElement("image");
    image.setAttribute("src", `${docContainerUrls(stored.url).assets}chart.png`);
    doc.getXmlFragment("prosemirror").insert(0, [image]);
    await log.appendUpdate(encodeStateAsUpdate(doc));
    doc.destroy();
  }
  const before = await log.loadUpdates();
  await relocateDocument(
    createSolidDriveClient({ storageUrl: root, fetch: pod.fetch }),
    stored.url,
    target,
    stored.data,
    new Date(),
  );
  expect(await log.loadUpdates()).toEqual(before);
});
