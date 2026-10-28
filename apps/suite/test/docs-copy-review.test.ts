// @vitest-environment jsdom
// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { expect, it } from "vitest";
import { Doc } from "yjs";
import { copyDocument } from "../src/apps/docs/editor/copy";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { createDocsStore } from "../src/apps/docs/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

it("copies owned assets while preserving external Markdown and other-document image URLs", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session = { storageUrl: DEMO_ROOT, webId: DEMO_WEBID, fetch: pod.fetch } as PodSession;
  const store = createDocsStore({ podRoot: DEMO_ROOT, webId: DEMO_WEBID, fetchImpl: pod.fetch });
  const stored = await store.create({ title: "Images", body: "", format: "text/html" });
  const owned = `${stored.data.assets}owned.png`;
  const foreign = `${DEMO_ROOT}docs/other/assets/pasted.png`;
  const external = "https://images.example.org/chart.png";
  await pod.fetch(owned, {
    method: "PUT",
    body: "image",
    headers: { "content-type": "image/png" },
  });
  const json = importMarkdown(
    `![owned](${owned})\n\n![external](${external})\n\n![pasted](${foreign})`,
    "images.md",
  ).json;
  const copy = await copyDocument(store, stored, session, json);
  expect(copy.data.body).toContain(`${copy.data.assets}owned.png`);
  expect(copy.data.body).toContain(external);
  expect(copy.data.body).toContain(foreign);
  expect(await (await pod.fetch(`${copy.data.assets}owned.png`)).text()).toBe("image");
  const doc = new Doc();
  const provider = new SolidPersistence({
    doc,
    container: copy.data.updateLog as string,
    fetch: pod.fetch,
  });
  try {
    await provider.whenSynced;
    const replay = JSON.stringify(yDocToProsemirrorJSON(doc, "prosemirror"));
    expect(replay).toContain(external);
    expect(replay).toContain(foreign);
    expect(replay).toContain(`${copy.data.assets}owned.png`);
  } finally {
    provider.destroy();
    doc.destroy();
  }
});

it("finalizes the same reserved copy after its successful snapshot acknowledgement is lost", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  let lost = false;
  const http: typeof fetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    if (
      !lost &&
      response.ok &&
      init?.method === "PUT" &&
      String(input).endsWith("-copy.ttl") &&
      new Headers(init.headers).has("if-match")
    ) {
      lost = true;
      throw new TypeError("response lost");
    }
    return response;
  };
  const session = { storageUrl: DEMO_ROOT, webId: DEMO_WEBID, fetch: http } as PodSession;
  const store = createDocsStore({ podRoot: DEMO_ROOT, webId: DEMO_WEBID, fetchImpl: http });
  const source = await store.create({ title: "Lost ack", body: "" });
  let reservation: Awaited<ReturnType<typeof store.create>> | undefined;
  const live = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Recovered edits" }] }],
  };
  await expect(
    copyDocument(store, source, session, live, {
      onReserved: async (copy) => {
        reservation = copy;
      },
    }),
  ).rejects.toThrow("response lost");
  expect(lost).toBe(true);
  const durable = await store.read(reservation?.url as string);
  const copy = await copyDocument(store, source, session, live, { reservation });
  expect(copy.url).toBe(reservation?.url);
  expect(copy.etag).toBe(durable?.etag);
  expect(copy.data.body).toBe("<p>Recovered edits</p>");
  expect(
    pod.snapshot().resources.filter(([url]) => /lost-ack-copy.*\.ttl$/.test(url)),
  ).toHaveLength(1);
});
