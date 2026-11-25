// AUTHORED-BY Claude Sonnet 5.5
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocsStore } from "../src/apps/docs/lib/model/store";
import {
  CopyToDocsPrivacyError,
  createNoteDocsConverter,
} from "../src/apps/notes/lib/copy-to-docs";
import { readCappedBlob } from "../src/apps/notes/lib/images";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import "./drive-ui-dom";

const ROOT = "https://pod.example/";
const SOURCE = `${ROOT}notes/media/bird.png`;
const SECOND = `${ROOT}notes/media/cat.png`;
const FOREIGN = "https://foreign.example/notes/media/bird.png";
const note: StoredNote = {
  url: `${ROOT}notes/original.ttl`,
  title: "Birds",
  body: `<p>Body</p><img src="${SOURCE}" alt="Bird" title="Robin" width="24" height="32"><img src="${SOURCE}" alt="Again"><img src="${SECOND}" alt="Cat"><img src="${FOREIGN}" alt="Remote"><img alt="No source"><img src="${ROOT}docs/other/assets/pasted.png" alt="Pasted">`,
  labels: ["Wildlife"],
  location: "active",
  format: "text/html",
  revisions: [],
  etag: '"v1"',
};
beforeEach(() => {
  vi.spyOn(DocsStore.prototype, "ensureRegistered").mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const pod = createDemoPod({ root: ROOT });
  for (const source of [SOURCE, SECOND])
    await pod.fetch(source, {
      method: "PUT",
      body: "pixels",
      headers: { "content-type": "image/png" },
    });
  const http = vi.fn<typeof fetch>((...args) => pod.fetch(...args));
  const dependencies = {
    fetchImpl: http,
    podRoot: ROOT,
    webId: `${ROOT}profile/card#me`,
    assertMovable: vi.fn(async () => {}),
    trash: vi.fn(async () => {}),
    destinationIsOwnerOnly: vi.fn<(url: string) => Promise<boolean>>(async () => true),
    noteTreatedAsPrivate: vi.fn<(url: string) => Promise<boolean>>(async () => true),
  };
  const convert = createNoteDocsConverter();
  const documents = () =>
    pod.snapshot().resources.filter(([url]) => /\/docs\/[^/]+\.ttl$/.test(url));
  const images = () =>
    pod.snapshot().resources.filter(([url]) => url.includes("/assets/") && url.endsWith(".png"));
  return { pod, http, dependencies, convert, documents, images };
}

it("verifies the stored Docs document on the update path too (N2)", async () => {
  const f = await fixture();
  let lost = false;
  f.http.mockImplementation(async (url, init) => {
    const response = await f.pod.fetch(url, init);
    if (!lost && response.ok && init?.method === "PUT" && String(url).endsWith(".ttl")) {
      lost = true;
      throw new Error("Lost publication");
    }
    return response;
  });
  await expect(f.convert(note, "move", f.dependencies)).rejects.toThrow("Lost publication");
  const edited = { ...note, body: `${note.body}<p>More</p>` };
  const result = await f.convert(edited, "move", f.dependencies);
  const checked = f.dependencies.destinationIsOwnerOnly.mock.calls.map(([url]) => url);
  expect(checked).toContain(result.url);
});

it("refuses the update when the stored document is no longer owner-only (N2)", async () => {
  const f = await fixture();
  let lost = false;
  f.http.mockImplementation(async (url, init) => {
    const response = await f.pod.fetch(url, init);
    if (!lost && response.ok && init?.method === "PUT" && String(url).endsWith(".ttl")) {
      lost = true;
      throw new Error("Lost publication");
    }
    return response;
  });
  await expect(f.convert(note, "move", f.dependencies)).rejects.toThrow("Lost publication");
  const documentUrl = f.documents()[0]?.[0] as string;
  // The folder passes, but the stored document now carries its own wider policy.
  f.dependencies.destinationIsOwnerOnly.mockImplementation(async (url) => url !== documentUrl);
  const edited = { ...note, body: `${note.body}<p>More</p>` };
  await expect(f.convert(edited, "move", f.dependencies)).rejects.toBeInstanceOf(
    CopyToDocsPrivacyError,
  );
  // Nothing wrote the edit into the stored document.
  const stored = await (await f.pod.fetch(documentUrl)).text();
  expect(stored).not.toContain("More");
  expect(f.dependencies.trash).not.toHaveBeenCalled();
});

it("never buffers an unstreamed body past the cap (N6)", async () => {
  const unstreamed = (headers: Record<string, string>) => {
    const response = new Response("x", { headers });
    Object.defineProperty(response, "body", { value: null });
    const blob = vi.spyOn(response, "blob");
    return { response, blob };
  };
  const big = unstreamed({ "content-length": "100" });
  await expect(readCappedBlob(big.response, 10)).rejects.toThrow("exceeds");
  expect(big.blob).not.toHaveBeenCalled();
  const small = unstreamed({ "content-length": "1" });
  await expect(readCappedBlob(small.response, 10)).rejects.toThrow("exceeds");
  expect(small.blob).not.toHaveBeenCalled();
  const empty = unstreamed({ "content-type": "image/png" });
  const blob = await readCappedBlob(empty.response, 10);
  expect(blob.size).toBe(0);
  expect(empty.blob).not.toHaveBeenCalled();
});
