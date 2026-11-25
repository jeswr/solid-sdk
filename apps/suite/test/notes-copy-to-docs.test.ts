// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uploadPodImage } from "../src/apps/docs/lib/editor/image-upload";
import { DocsStore } from "../src/apps/docs/lib/model/store";
import { copyNoteImages, createNoteDocsConverter } from "../src/apps/notes/lib/copy-to-docs";
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
  };
  const convert = createNoteDocsConverter();
  const documents = () =>
    pod.snapshot().resources.filter(([url]) => /\/docs\/[^/]+\.ttl$/.test(url));
  const images = () =>
    pod.snapshot().resources.filter(([url]) => url.includes("/assets/") && url.endsWith(".png"));
  return { pod, http, dependencies, convert, documents, images };
}

it.each([
  "copy",
  "move",
] as const)("%s copies distinct Notes images, preserving attributes and foreign URLs", async (mode) => {
  const f = await fixture();
  const original = structuredClone(note);
  const result = await f.convert(note, mode, f.dependencies);
  expect(note).toEqual(original);
  const parsed = new window.DOMParser().parseFromString(result.data.body, "text/html");
  const elements = [...parsed.querySelectorAll("img")];
  expect(elements[0]?.getAttribute("src")).toBe(elements[1]?.getAttribute("src"));
  expect(elements[0]?.getAttribute("src")?.startsWith(result.data.assets as string)).toBe(true);
  expect(elements[0]?.outerHTML).toContain('alt="Bird" title="Robin" width="24" height="32"');
  expect(elements[3]?.getAttribute("src")).toBe(FOREIGN);
  expect(elements[5]?.getAttribute("src")).toBe(`${ROOT}docs/other/assets/pasted.png`);
  expect(f.images()).toHaveLength(2);
  for (const [url, resource] of f.images()) {
    expect(new TextDecoder().decode(resource.body)).toBe("pixels");
    expect(f.http).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "PUT",
        redirect: "manual",
        headers: { "content-type": "image/png", "if-none-match": "*" },
      }),
    );
  }
  expect(f.documents()).toHaveLength(1);
  expect(f.http.mock.calls.some(([url]) => String(url).startsWith("https://foreign.example"))).toBe(
    false,
  );
  if (mode === "copy") {
    expect(f.dependencies.assertMovable).not.toHaveBeenCalled();
    expect(f.dependencies.trash).not.toHaveBeenCalled();
  } else {
    expect(f.dependencies.assertMovable).toHaveBeenCalledWith(note);
    expect(f.dependencies.trash).toHaveBeenCalledWith(note);
  }
});

it("preserves image-free HTML verbatim and supplies an untitled document title", async () => {
  const f = await fixture();
  const body = "<p>Text</p>";
  expect(await copyNoteImages(body, ROOT, vi.fn())).toBe(body);
  expect((await f.convert({ ...note, title: "", body }, "copy", f.dependencies)).data.title).toBe(
    "Untitled document",
  );
});

it.each([
  "read",
  "upload",
])("aborts an image %s failure before publishing or trashing, then resumes", async (kind) => {
  const f = await fixture();
  let fail = true;
  f.http.mockImplementation((url, init) => {
    if (
      fail &&
      ((kind === "read" && url === SECOND) ||
        (kind === "upload" && init?.method === "PUT" && String(url).endsWith(".png")))
    )
      return Promise.resolve(new Response(null, { status: 503 }));
    return f.pod.fetch(url, init);
  });
  await expect(f.convert(note, "move", f.dependencies)).rejects.toThrow();
  expect(f.documents()).toHaveLength(0);
  expect(f.dependencies.trash).not.toHaveBeenCalled();
  const prior = f.images().map(([url]) => url);
  fail = false;
  await f.convert(note, "move", f.dependencies);
  expect(f.images()).toHaveLength(2);
  expect(f.images().map(([url]) => url)).toEqual(expect.arrayContaining(prior));
  expect(f.documents()).toHaveLength(1);
  expect(f.dependencies.trash).toHaveBeenCalledOnce();
});

it.each([
  "image",
  "document",
])("recovers a lost %s acknowledgement without duplicate resources", async (kind) => {
  const f = await fixture();
  let fail = true;
  f.http.mockImplementation(async (url, init) => {
    const response = await f.pod.fetch(url, init);
    if (
      fail &&
      response.ok &&
      init?.method === "PUT" &&
      String(url).endsWith(kind === "image" ? ".png" : ".ttl")
    ) {
      fail = false;
      throw new TypeError("response lost");
    }
    return response;
  });
  await expect(f.convert(note, "move", f.dependencies)).rejects.toThrow("response lost");
  expect(f.dependencies.trash).not.toHaveBeenCalled();
  await f.convert(note, "move", f.dependencies);
  expect(f.documents()).toHaveLength(1);
  expect(f.images()).toHaveLength(2);
});

it("reuses the document and images after trash fails, then starts a fresh intentional copy", async () => {
  const f = await fixture();
  f.dependencies.trash.mockRejectedValueOnce(new Error("Offline"));
  await expect(f.convert(note, "move", f.dependencies)).rejects.toThrow("Offline");
  const images = f.images().map(([url]) => url);
  const result = await f.convert(note, "move", f.dependencies);
  expect(f.documents()).toHaveLength(1);
  expect(f.images().map(([url]) => url)).toEqual(images);
  const copy = await f.convert(note, "copy", f.dependencies);
  expect(copy.url).not.toBe(result.url);
  expect(f.documents()).toHaveLength(2);
});

it.each([
  "success",
  "conflict",
  "offline",
  "image failure",
])("refreshes edited notes after a failed move (%s)", async (outcome) => {
  const f = await fixture();
  f.dependencies.trash.mockRejectedValueOnce(new Error("Offline"));
  await expect(f.convert(note, "move", f.dependencies)).rejects.toThrow("Offline");
  const originalUrl = f.documents()[0]?.[0] as string;
  const edited = {
    ...note,
    title: "Edited",
    body: `<p>Changed</p><img src="${SOURCE}"><img src="${ROOT}notes/media/new.png">`,
  };
  await f.pod.fetch(`${ROOT}notes/media/new.png`, {
    method: "PUT",
    body: "new pixels",
    headers: { "content-type": "image/png" },
  });
  let fail = outcome === "offline" || outcome === "image failure";
  if (outcome === "conflict")
    await f.pod.fetch(originalUrl, {
      method: "PUT",
      body: await (await f.pod.fetch(originalUrl)).text(),
      headers: { "content-type": "text/turtle" },
    });
  f.http.mockImplementation((url, init) => {
    if (
      fail &&
      ((outcome === "offline" && url === originalUrl && init?.method === "PUT") ||
        (outcome === "image failure" && url === `${ROOT}notes/media/new.png`))
    )
      return Promise.resolve(new Response(null, { status: 503 }));
    return f.pod.fetch(url, init);
  });
  if (fail) {
    await expect(f.convert(edited, "move", f.dependencies)).rejects.toThrow();
    expect(f.dependencies.trash).toHaveBeenCalledOnce();
    fail = false;
  }
  const result = await f.convert(edited, "move", f.dependencies);
  expect(result.data.title).toBe("Edited");
  expect(result.data.body).toContain("Changed");
  expect(result.data.body).not.toContain("notes/media/");
  expect(f.dependencies.trash).toHaveBeenCalledTimes(2);
  expect(result.url === originalUrl).toBe(outcome !== "conflict");
  expect(f.documents()).toHaveLength(outcome === "conflict" ? 2 : 1);
});

it("does no work if move preflight fails", async () => {
  const f = await fixture();
  f.dependencies.assertMovable.mockRejectedValue(new Error("Shared"));
  await expect(f.convert(note, "move", f.dependencies)).rejects.toThrow("Shared");
  expect(f.http).not.toHaveBeenCalled();
});

it.each([
  "missing",
  "length",
  "bytes",
])("refuses to reuse occupied image targets with %s bytes", async (kind) => {
  const http = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 412 }))
    .mockResolvedValueOnce(
      kind === "missing"
        ? new Response(null, { status: 404 })
        : new Response(kind === "length" ? "longer" : "other"),
    );
  await expect(
    uploadPodImage(
      new Blob(["image"], { type: "image/png" }),
      `${ROOT}docs/a/assets/`,
      http,
      crypto.randomUUID(),
    ),
  ).rejects.toThrow("Upload failed");
});

it("updates recovered Docs to include note edits made after a lost publication response", async () => {
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
  const edited = { ...note, title: "Recent title", body: `${note.body}<p>Recent body</p>` };
  const result = await f.convert(edited, "move", f.dependencies);
  expect(result.data.title).toBe("Recent title");
  expect(result.data.body).toContain("Recent body");
  expect(f.documents()).toHaveLength(1);
  expect(f.images()).toHaveLength(2);
});
