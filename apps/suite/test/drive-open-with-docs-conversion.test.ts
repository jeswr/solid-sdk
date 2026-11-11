// AUTHORED-BY Codex GPT-6.1
// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import type { JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUpdate, Doc } from "yjs";
import { openWithDocs } from "../src/apps/docs/hooks/open-with-docs";
import { importTransaction } from "../src/apps/docs/lib/convert/import-transaction";
import { createDocsStore, docContainerUrls } from "../src/apps/docs/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
});
afterEach(() => vi.unstubAllGlobals());

async function fixture(name: string, contents: string | Uint8Array = "# Original") {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const url = `${DEMO_ROOT}drive/${name}`;
  await pod.fetch(url, { method: "PUT", body: contents as BodyInit });
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: DEMO_NAME,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const source = { url, name };
  const store = createDocsStore({ podRoot: DEMO_ROOT, webId: DEMO_WEBID, fetchImpl: pod.fetch });
  return { pod, source, session, store };
}

describe("Drive conversion through Docs' real create and import path", () => {
  it.each([
    ["plan.md", "# Plan\n\n**Ready**", "heading"],
    [
      "plan.html",
      '<html><head><title>Hidden</title></head><body><h1>Plan</h1><p onclick="bad()">Ready</p></body></html>',
      "heading",
    ],
    ["plan.htm", "<h1>Plan</h1><p>Ready</p>", "heading"],
    ["plan.txt", "# Plan\r\n<Ready>", "paragraph"],
    ["plan.docx", "", "heading"],
  ])("converts %s, persists its layout and Yjs identity, and preserves the source", async (name, contents, firstType) => {
    const bytes = name.endsWith("docx")
      ? await readFile("e2e/fixtures/docs-import.docx")
      : contents;
    const { pod, source, session, store } = await fixture(name, bytes);
    const original = await pod.fetch(source.url);
    const originalBytes = await original.arrayBuffer();
    const result = await openWithDocs(source, session, vi.fn());
    expect(result.url).not.toBe(source.url);
    const stored = await store.read(result.url);
    expect(stored?.data.title).toBe("plan");
    expect(stored?.data.instanceId).toEqual(expect.any(String));
    expect(stored?.data.body).not.toContain("onclick");
    expect(stored?.data.body).not.toContain("Hidden");
    const layout = docContainerUrls(result.url);
    for (const url of [layout.container, layout.updateLog, layout.assets, layout.comments])
      expect(pod.has(url), url).toBe(true);
    expect(stored?.data.updateLog).toBe(layout.updateLog);
    const updates = await new SolidUpdateStore({
      container: layout.updateLog,
      fetch: pod.fetch,
    }).loadUpdates();
    expect(updates.length).toBeGreaterThan(0);
    const doc = new Doc();
    try {
      for (const { update } of updates) applyUpdate(doc, update);
      expect(doc.getMap("document").get("instanceId")).toBe(stored?.data.instanceId);
      const json = yDocToProsemirrorJSON(doc) as JSONContent;
      expect(json.content?.[0]?.type).toBe(firstType);
      if (name.endsWith("txt")) {
        expect(json.content?.[0]?.content?.[0]?.text).toBe("# Plan");
        expect(json.content?.[1]?.content?.[0]?.text).toBe("<Ready>");
      }
    } finally {
      doc.destroy();
    }
    const unchanged = await pod.fetch(source.url);
    expect(unchanged.headers.get("etag")).toBe(original.headers.get("etag"));
    expect(await unchanged.arrayBuffer()).toEqual(originalBytes);
  });

  it.each([
    "snapshot",
    "image",
    "log",
    "container",
  ])("removes every partial import after a failed %s write", async (stage) => {
    const name = ["image", "log"].includes(stage) ? "broken.docx" : "broken.md";
    const { pod, session, source } = await fixture(
      name,
      ["image", "log"].includes(stage)
        ? await readFile("e2e/fixtures/docs-import.docx")
        : "# Broken",
    );
    const before = pod.snapshot();
    let failed = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "PUT" && url.startsWith(`${DEMO_ROOT}docs/broken`)) {
        const matches =
          stage === "snapshot"
            ? url.endsWith(".ttl") && new Headers(init.headers).has("if-match")
            : stage === "image"
              ? url.includes("/assets/") && !url.endsWith("/")
              : stage === "log"
                ? url.includes("/updates/") && !url.endsWith("/")
                : url.endsWith("/assets/");
        if (matches) {
          failed = true;
          return new Response(null, { status: 500 });
        }
      }
      return pod.fetch(input, init);
    };
    await expect(openWithDocs(source, { ...session, fetch: fetchImpl }, vi.fn())).rejects.toThrow();
    expect(failed).toBe(true);
    const after = pod.snapshot();
    const docsUrls = (state: typeof before) =>
      [...state.resources.map(([url]) => url), ...state.containers.map(([url]) => url)]
        .filter((url) => url.startsWith(`${DEMO_ROOT}docs/`))
        .sort();
    expect(docsUrls(after)).toEqual(docsUrls(before));
    expect(after.resources.find(([url]) => url === source.url)).toEqual(
      before.resources.find(([url]) => url === source.url),
    );
  });

  it("reports a cleanup refusal instead of hiding a partial create", async () => {
    const { pod, source, session } = await fixture("broken.md");
    const fetchImpl: typeof fetch = async (input, init) => {
      if (init?.method === "DELETE") return new Response(null, { status: 403 });
      if (
        init?.method === "PUT" &&
        String(input).endsWith("broken.ttl") &&
        new Headers(init.headers).has("if-match")
      )
        return new Response(null, { status: 500 });
      return pod.fetch(input, init);
    };
    await expect(openWithDocs(source, { ...session, fetch: fetchImpl }, vi.fn())).rejects.toThrow(
      "incomplete document couldn't be fully removed",
    );
  });
});

describe("Import rollback ownership", () => {
  const root = "https://pod.test/";
  const file = `${root}docs/import.ttl`;
  it("ignores reads, common setup, other origins, refused creates and unowned replacements", async () => {
    const http = vi.fn<typeof fetch>(
      async () => new Response(null, { headers: { etag: '"one"' } }),
    );
    const transaction = importTransaction({ storageUrl: root, fetch: http });
    await transaction.fetch(file);
    await transaction.fetch(`${root}docs/`, { method: "PUT", headers: { "if-none-match": "*" } });
    await transaction.fetch("https://elsewhere.test/docs/import.ttl", {
      method: "PUT",
      headers: { "if-none-match": "*" },
    });
    await transaction.fetch(`${root}docs/type-index`, {
      method: "PUT",
      headers: { "if-none-match": "*" },
    });
    await transaction.fetch(file, { method: "PUT", headers: { "if-match": '"old"' } });
    http.mockResolvedValueOnce(new Response(null, { status: 412 }));
    await transaction.fetch(file, { method: "PUT", headers: { "if-none-match": "*" } });
    await transaction.rollback();
    expect(http.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
  it("uses the final file validator and refuses to delete a concurrent replacement", async () => {
    const http = vi.fn<typeof fetch>(
      async () => new Response(null, { headers: { etag: '"created"' } }),
    );
    const transaction = importTransaction({ storageUrl: root, fetch: http });
    await transaction.fetch(file, { method: "PUT", headers: { "if-none-match": "*" } });
    http.mockResolvedValueOnce(new Response(null, { headers: { etag: '"saved"' } }));
    await transaction.fetch(file, { method: "PUT", headers: { "if-match": '"created"' } });
    http.mockResolvedValueOnce(new Response(null, { status: 412 }));
    await expect(transaction.rollback()).rejects.toThrow("Couldn't remove");
    expect(http).toHaveBeenLastCalledWith(file, {
      method: "DELETE",
      redirect: "error",
      headers: { "if-match": '"saved"' },
    });
  });
  it.each([null, 'W/"weak"'])("refuses unvalidated cleanup (%s)", async (etag) => {
    const http = vi.fn<typeof fetch>(
      async () => new Response(null, { headers: etag ? { etag } : {} }),
    );
    const transaction = importTransaction({ storageUrl: root, fetch: http });
    await transaction.fetch(file, { method: "PUT", headers: { "if-none-match": "*" } });
    await expect(transaction.rollback()).rejects.toThrow("validator");
  });
  it.each([404, 410])("accepts already absent files and containers (%s)", async (status) => {
    const http = vi.fn<typeof fetch>(
      async () => new Response(null, { headers: { etag: '"created"' } }),
    );
    const transaction = importTransaction({ storageUrl: root, fetch: http });
    await transaction.fetch(file, { method: "PUT", headers: { "if-none-match": "*" } });
    await transaction.fetch(`${root}docs/import/`, {
      method: "PUT",
      headers: { "if-none-match": "*" },
    });
    http.mockImplementation(async () => new Response(null, { status }));
    await transaction.rollback();
    expect(http.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });
  it("reports failure to inspect a container", async () => {
    const http = vi.fn<typeof fetch>(
      async () => new Response(null, { headers: { etag: '"created"' } }),
    );
    const transaction = importTransaction({ storageUrl: root, fetch: http });
    await transaction.fetch(`${root}docs/import/`, {
      method: "PUT",
      headers: { "if-none-match": "*" },
    });
    http.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(transaction.rollback()).rejects.toThrow("Couldn't inspect");
  });
});
